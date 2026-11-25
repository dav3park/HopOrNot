"""HopOrNot 추론 서버 (README 10장). 수집 DB를 읽기만 하고, 예측은 src/live.py 가 만든다.

    cd ml && uvicorn serve.app:app --port 8000

GET /health                                   마지막 수집 시각, 모델 정보
GET /stops?route=M5107                        예측 대상 정류장 목록
GET /predict?route=M5107&station_seq=40       다가오는 버스들의 좌석 확률 + 버스별 "이 버스까지 내가 탈 확률"
    &arrived_at=2026-11-12T18:05:00+09:00     (선택) 내가 정류장에 도착한 시각. 없으면 지금
GET /route?route=M5107&direction=영통행          정류장 목록: 한 방향의 정류장 전체 + 지금 달리는 버스 위치
GET /history?route=M5107&station_seq=40       지난 7일 이 정류장 도착 잔여석, 30분 단위 (하루 한 번 계산)
GET /line?route=M5107&station_seq=40          노선도·지도: 앞쪽 정류장, 버스 위치, 버스별 정류장별 1석 이상 확률, 경로
GET /recommend?route=M5107&station_seq=40     가까운 승차 정류장을 내가 탈 확률 순으로

새 수집이 들어왔을 때만 다시 계산한다 (수집 간격 2–7분, 계산 1–2초).
"""
import threading
from datetime import datetime
from typing import Literal

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import text

from src.config import ROUTES, TIMEZONE
from src.export_db import make_engine, read_observations
from src.build_trips import arrival_events, assign_trips
from src.live import HISTORY_DAYS, history_view, line_view, load_artifacts, recommend, route_view, snapshot, stop_prediction
from src.split import service_date

app = FastAPI(title="HopOrNot 추론 서버")
engine = make_engine()
artifacts = load_artifacts()
_lock = threading.Lock()
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
def route_stops(route: RouteName, direction: Literal["서울행", "영통행"]):
    try:
        return route_view(current_snapshot(), artifacts, route, direction)
    except KeyError as error:
        raise HTTPException(404, str(error)) from error


def history_events():
    """지난 HISTORY_DAYS 운행일의 도착 이벤트. 운행일이 바뀔 때 한 번 다시 계산한다 (수십 초 걸린다)."""
    latest = latest_collection()
    if latest is None:
        raise HTTPException(503, "수집된 관측이 없다")
    today = service_date(pd.Series([latest])).iloc[0]
    with _lock:
        if _history["day"] != today:
            observations = read_observations(engine, today - pd.Timedelta(days=HISTORY_DAYS), today - pd.Timedelta(days=1))
            _history.update(day=today, events=arrival_events(assign_trips(observations), artifacts.stops))
        return _history["events"], latest


@app.get("/history")
def history(route: RouteName, station_seq: int):
    events, latest = history_events()
    return history_view(events, route, station_seq, latest)
