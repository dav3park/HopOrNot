"""HopOrNot 추론 서버 (README 10장). 수집 DB를 읽기만 하고, 예측은 src/live.py 가 만든다.

    cd ml && uvicorn serve.app:app --port 8000

GET /health                                   마지막 수집 시각, 모델 정보
GET /stops?route=M5107                        예측 대상 정류장 목록
GET /predict?route=M5107&station_seq=40       다가오는 버스들의 좌석 확률 + 다음 버스에 내가 앉을 확률
    &arrived_at=2026-11-12T18:05:00+09:00     (선택) 내가 정류장에 도착한 시각. 없으면 지금

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
from src.live import load_artifacts, snapshot, stop_prediction
from src.split import service_date

app = FastAPI(title="HopOrNot 추론 서버")
engine = make_engine()
artifacts = load_artifacts()
_lock = threading.Lock()
_cache: dict = {"latest": None, "snapshot": None}
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
