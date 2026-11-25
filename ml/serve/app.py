"""HopOrNot 추론 서버 (README 10장). 수집 DB를 읽기만 하고, 예측은 src/live.py 가 만든다.

    cd ml && uvicorn serve.app:app --port 8000

GET /health                                   마지막 수집 시각, 모델 정보
GET /stops?route=M5107                        예측 대상 정류장 목록
GET /predict?route=M5107&station_seq=40       다가오는 버스들의 좌석 확률 + 버스별 "이 버스까지 내가 탈 확률"
    &arrived_at=2026-11-12T18:05:00+09:00     (선택) 내가 정류장에 도착한 시각. 없으면 지금
GET /route?route=M5107                        정류장 목록: 노선 한 바퀴(캠퍼스 → 서울 → 캠퍼스)를 한 줄로 + 지금 달리는 버스
GET /path?route=M5107                         지도용 도로 경로 (일반 도로 / 고속도로 선분)
GET /history?route=M5107&station_seq=40       지난 7일 이 정류장 도착 잔여석, 30분 단위 (하루 한 번 계산)
GET /line?route=M5107&station_seq=40          내 정류장으로 오는 버스: 위치, 버스별 정류장별 1석 이상 확률
GET /recommend?route=M5107&station_seq=40     가까운 승차 정류장을 내가 탈 확률 순으로

새 수집이 들어왔을 때만 다시 계산한다 (수집 간격 2–7분, 계산 1–2초).

환경 변수 API_KEY 가 있으면 /health 를 뺀 모든 요청에 X-API-Key 헤더가 맞아야 한다 (없으면 인증 없음, 개발용).
서버가 시작되면 백그라운드에서 현재 스냅샷과 지난 7일 도착 기록을 미리 계산하고 5분마다 갱신해서,
첫 사용자가 12초를 기다리지 않게 한다.
"""
import asyncio
import hmac
import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from src.config import ROUTES, TIMEZONE
from src.export_db import make_engine, read_observations
from src.build_trips import arrival_events, assign_trips
from src.live import (HISTORY_DAYS, history_view, line_view, load_artifacts, path_view, recommend, route_view, snapshot,
                      stop_prediction)
from src.split import service_date

API_KEY = os.environ.get("API_KEY") or None
WARM_SECONDS = 300
log = logging.getLogger("hopornot")


@asynccontextmanager
async def lifespan(_: FastAPI):
    async def warm():
        while True:
            try:
                await asyncio.to_thread(current_snapshot)
                await asyncio.to_thread(history_events)
            except Exception:  # 수집이 멈췄거나 DB가 잠깐 안 될 때: 다음 주기에 다시
                log.exception("warm-up 실패")
            await asyncio.sleep(WARM_SECONDS)

    task = asyncio.create_task(warm())
    yield
    task.cancel()


# 키가 있으면 문서 페이지도 닫는다 (브라우저는 헤더를 못 보내므로)
app = FastAPI(title="HopOrNot 추론 서버", lifespan=lifespan,
              docs_url=None if API_KEY else "/docs", redoc_url=None if API_KEY else "/redoc",
              openapi_url=None if API_KEY else "/openapi.json")


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    if API_KEY and request.url.path != "/health":
        if not hmac.compare_digest(request.headers.get("x-api-key", ""), API_KEY):
            return JSONResponse({"detail": "접근 키가 없거나 틀렸다"}, status_code=401)
    return await call_next(request)


engine = make_engine()
artifacts = load_artifacts()
_lock = threading.Lock()          # 현재 스냅샷
_history_lock = threading.Lock()  # 지난 7일 (수십 초 걸리므로 스냅샷과 잠금을 나눈다)
_cache: dict = {"latest": None, "snapshot": None}
_history: dict = {"day": None, "events": None}
RouteName = Literal["1112", "M5107", "5100"]
assert set(RouteName.__args__) == {route.name for route in ROUTES}


def latest_collection() -> pd.Timestamp | None:
    with engine.connect() as connection:
        value = connection.execute(text("SELECT max(collected_at) FROM bus_observation")).scalar()
    return None if value is None else pd.Timestamp(value).tz_convert(TIMEZONE)


def current_snapshot():
    latest = latest_collection()
    if latest is None:
        raise HTTPException(503, "수집된 관측이 없다")
    with _lock:
        if _cache["latest"] != latest:
            day = service_date(pd.Series([latest])).iloc[0]
            observations = read_observations(engine, day, day)
            _cache.update(latest=latest, snapshot=snapshot(observations, artifacts))
        return _cache["snapshot"]


@app.get("/health")
def health():
    latest = latest_collection()
    return {"status": "ok", "latest_collection": None if latest is None else latest.isoformat(),
            "model": "LightGBM 5단계 + 대기 인원 모델 (보정 전)"}


@app.get("/stops")
def stops(route: RouteName):
    table = artifacts.stops[(artifacts.stops["route"] == route) & artifacts.stops["is_target"]]
    return [{"station_seq": int(r.station_seq), "station_name": r.station_name, "direction": r.direction, "zone": r.zone}
            for r in table.itertuples(index=False)]


@app.get("/predict")
def predict(route: RouteName, station_seq: int,
            arrived_at: datetime | None = Query(None, description="내가 정류장에 도착한 시각 (ISO 8601). 없으면 지금")):
    user_arrived_at = None
    if arrived_at is not None:
        user_arrived_at = pd.Timestamp(arrived_at)
        user_arrived_at = (user_arrived_at.tz_localize(TIMEZONE) if user_arrived_at.tzinfo is None
                           else user_arrived_at.tz_convert(TIMEZONE))
    try:
        return stop_prediction(current_snapshot(), artifacts, route, station_seq, user_arrived_at)
    except KeyError as error:
        raise HTTPException(404, str(error)) from error


def user_time(arrived_at: datetime | None) -> pd.Timestamp | None:
    if arrived_at is None:
        return None
    at = pd.Timestamp(arrived_at)
    return at.tz_localize(TIMEZONE) if at.tzinfo is None else at.tz_convert(TIMEZONE)


@app.get("/line")
def line(route: RouteName, station_seq: int):
    try:
        return line_view(current_snapshot(), artifacts, route, station_seq)
    except KeyError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/recommend")
def recommend_stops(route: RouteName, station_seq: int,
                    arrived_at: datetime | None = Query(None, description="내가 정류장에 도착한 시각 (ISO 8601). 없으면 지금")):
    try:
        return recommend(current_snapshot(), artifacts, route, station_seq, user_time(arrived_at))
    except KeyError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/route")
def route_stops(route: RouteName):
    try:
        return route_view(current_snapshot(), artifacts, route)
    except KeyError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/path")
def route_path(route: RouteName):
    return path_view(artifacts, route)


def history_events():
    """지난 HISTORY_DAYS 운행일의 도착 이벤트. 운행일이 바뀔 때 한 번 다시 계산한다 (수십 초 걸린다)."""
    latest = latest_collection()
    if latest is None:
        raise HTTPException(503, "수집된 관측이 없다")
    today = service_date(pd.Series([latest])).iloc[0]
    with _history_lock:
        if _history["day"] != today:
            observations = read_observations(engine, today - pd.Timedelta(days=HISTORY_DAYS), today - pd.Timedelta(days=1))
            _history.update(day=today, events=arrival_events(assign_trips(observations), artifacts.stops))
        return _history["events"], latest


@app.get("/history")
def history(route: RouteName, station_seq: int):
    events, latest = history_events()
    return history_view(events, route, station_seq, latest)
