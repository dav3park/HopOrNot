"""실시간 추론: 오늘의 관측으로 다음 버스들의 도착 잔여석 확률과 내가 앉을 확률을 낸다.

학습과 같은 함수(assign_trips, arrival_events, candidate_targets, add_features, model_inputs)를 쓴다.
특징 계산이 학습과 달라지면 모델이 엉뚱한 값을 내므로, 아래 점검으로 둘이 같은지 확인한다.

    python -m src.live --check 2026-11-11T18:30   # 그 시각까지의 관측만으로 만든 특징 = 학습 샘플의 특징인지
"""
import argparse
import json
from dataclasses import dataclass
from datetime import datetime

import lightgbm as lgb
import numpy as np
import pandas as pd

from .build_trips import arrival_events, assign_trips
from .config import INTERIM_DIR, MODELS_DIR, RAW_DIR, ROUTES, STAGE_MIN_SEATS, TIMEZONE
from .evaluate import PROBABILITY_COLUMNS
from .features import (CATEGORICAL_FEATURES, NUMERIC_FEATURES, add_features, candidate_targets, model_inputs,
                       observed_rows, with_fleet)
from .split import service_date
from .waiting import (MAX_ELAPSED_MINUTES, MIN_RATE_PER_MINUTE, ZONES, day_type_of, design, mean_of, seat_distribution,
                      seat_probability)

STALE_MINUTES = 15  # 마지막 수집이 이보다 오래되면 실시간 값이 아니다 (01–06시 수집 중지)
SIMPLE_FROM_STOPS_AHEAD = 4  # 이만큼 앞부터는 중간 단계 예측이 약하므로 P(≥1), P(≥20)만 보여준다
EVENT_COLUMNS = {"route": "str", "trip_id": "int64", "station_seq": "int64", "arrived_at": f"datetime64[us, {TIMEZONE}]",
                 "known_at": f"datetime64[us, {TIMEZONE}]", "seats_low": "float64", "seats_high": "float64"}


@dataclass
class Artifacts:
    stops: pd.DataFrame
    profile: pd.DataFrame
    booster: lgb.Booster
    waiting_params: np.ndarray
    waiting_k: float
    cells: pd.DataFrame
    within_stage: dict[int, np.ndarray]


@dataclass
class Snapshot:
    generated_at: pd.Timestamp  # 가장 최근 수집 시각
    trips: pd.DataFrame
    events: pd.DataFrame
    predictions: pd.DataFrame   # 차량 × 앞으로 지날 정류장의 단계 확률


def load_artifacts() -> Artifacts:
    waiting = json.loads((MODELS_DIR / "waiting.json").read_text())
    params = np.array(list(waiting["params"].values()))
    return Artifacts(
        stops=pd.read_parquet(INTERIM_DIR / "stops.parquet"),
        profile=pd.read_parquet(INTERIM_DIR / "boarding_profile.parquet"),
        booster=lgb.Booster(model_file=str(MODELS_DIR / "lgbm.txt")),
        waiting_params=params,
        waiting_k=float(np.exp(params[-1])),
        cells=pd.read_parquet(MODELS_DIR / "waiting_cells.parquet").set_index(["route", "station_id", "hour"])["cell_ratio"],
        within_stage={int(s): np.array(v) for s, v in waiting["within_stage"].items()},
    )


def snapshot(observations: pd.DataFrame, art: Artifacts) -> Snapshot:
    """오늘(운행일)의 관측 전체 → 노선별 가장 최근 수집의 차량마다 예측."""
    names = {route.route_id: route.name for route in ROUTES}
    trips = assign_trips(observations)
    trips["route"] = trips["route_id"].map(names)
    trips = with_fleet(trips)
    events = arrival_events(trips, art.stops)
    if events.empty:
        events = pd.DataFrame({c: pd.Series(dtype=t) for c, t in EVENT_COLUMNS.items()})

    latest = trips[trips["collected_at"] == trips.groupby("route")["collected_at"].transform("max")]
    rows = add_features(candidate_targets(observed_rows(latest), art.stops), events, art.stops, art.profile)
    rows[PROBABILITY_COLUMNS] = art.booster.predict(model_inputs(rows, art.stops))
    plates = latest.drop_duplicates("veh_id").set_index("veh_id")["plate_no"]
    rows["plate_no"] = rows["veh_id"].map(plates)
    return Snapshot(trips["collected_at"].max(), trips, events, rows)


def previous_bus(snap: Snapshot, route: str, seq: int) -> dict | None:
    """이 정류장을 가장 최근에 지난 버스의 도착 시각과 만석 출발 여부 (지금까지 확인된 것만)."""
    passed = snap.events[(snap.events["route"] == route) & (snap.events["station_seq"] == seq)]
    if passed.empty:
        return None
    last = passed.sort_values("arrived_at").iloc[-1]
    trip = snap.trips[(snap.trips["trip_id"] == last["trip_id"]) & (snap.trips["station_seq"] > seq)]
    departure = int(trip.sort_values("collected_at")["remain_seat_cnt"].iloc[0]) if len(trip) else None
    return {"arrived_at": last["arrived_at"], "departure_seats": departure, "left_full": departure == 0}


def my_seat_probability(snap: Snapshot, art: Artifacts, route: str, seq: int, user_arrived_at: pd.Timestamp,
                        stage_probabilities: np.ndarray) -> dict:
    """P(내가 앉음) = Σ_s P(도착 잔여석 = s) × P(내 앞 인원 < s). 다음 버스 한 대 기준."""
    stop = art.stops[(art.stops["route"] == route) & (art.stops["station_seq"] == seq)].iloc[0]
    if stop["zone"] not in ZONES:
        return {"probability": None, "note": f"대기 인원 모델은 승차 구간({', '.join(ZONES)})에서만 학습했다"}
    previous = previous_bus(snap, route, seq)
    note = None
    if previous is None:
        elapsed, prev_full = MAX_ELAPSED_MINUTES, False
        note = f"오늘 이 정류장을 지난 버스 기록이 없어 앞차 이후 {MAX_ELAPSED_MINUTES}분으로 가정"
    else:
        elapsed = (user_arrived_at - previous["arrived_at"]).total_seconds() / 60
        elapsed = float(np.clip(elapsed, 0.5, MAX_ELAPSED_MINUTES))
        prev_full = bool(previous["left_full"])
        if previous["departure_seats"] is None:
            note = "앞차가 아직 정류장을 떠난 것이 확인되지 않아 만석 출발 여부를 모름 (아니라고 가정)"

    local = pd.Series([user_arrived_at]).dt.tz_convert(TIMEZONE)
    hour, day_type = int(local.dt.hour.iloc[0]), day_type_of(local)[0]
    usual = art.profile[(art.profile["route"] == route) & (art.profile["station_id"] == stop["station_id"])
                        & (art.profile["day_type"] == day_type) & (art.profile["hour"] == hour)]["boardings"]
    rate = max(float(usual.iloc[0]) / 60 if len(usual) else 0.0, MIN_RATE_PER_MINUTE)
    cell = float(art.cells.get((route, stop["station_id"], hour), 1.0))
    frame = pd.DataFrame({"zone": [stop["zone"]], "rate": [rate], "elapsed": [elapsed], "prev_left_full": [prev_full],
                          "cell_ratio": [cell]})
    mu = mean_of(art.waiting_params, design(frame))
    seats = seat_distribution(stage_probabilities[None, :], art.within_stage)
    probability = float(seat_probability(seats, mu, art.waiting_k)[0])
    return {
        "probability": round(probability, 3),
        "expected_people_ahead": round(float(mu[0]), 1),
        "minutes_since_previous_bus": round(elapsed, 1),
        "previous_bus": None if previous is None else {
            "arrived_at": previous["arrived_at"].isoformat(), "left_full": prev_full,
            "departure_seats": previous["departure_seats"]},
        "note": note,
    }


def stop_prediction(snap: Snapshot, art: Artifacts, route: str, seq: int, user_arrived_at: pd.Timestamp | None = None,
                    now: pd.Timestamp | None = None) -> dict:
    """정류장 하나에 대해 다가오는 버스들의 좌석 확률과, 다음 버스에 내가 앉을 확률."""
    now = now or pd.Timestamp.now(tz=TIMEZONE)
    stop = art.stops[(art.stops["route"] == route) & (art.stops["station_seq"] == seq)]
    if stop.empty or not bool(stop["is_target"].iloc[0]):
        raise KeyError(f"{route} {seq}번 정류장은 예측 대상이 아니다")
    stop = stop.iloc[0]
    coming = snap.predictions[(snap.predictions["route"] == route) & (snap.predictions["target_seq"] == seq)]
    # 같은 정류장에 있으면 이미 출발한(state_cd 2) 차가 도착한(1)·통과 중인(0) 차보다 앞서 있다
    coming = coming.sort_values(["stops_ahead", "state_cd"], ascending=[True, False])
    probabilities = coming[PROBABILITY_COLUMNS].to_numpy()
    buses = []
    for row, p in zip(coming.itertuples(index=False), probabilities):
        at_least = {f"{STAGE_MIN_SEATS[k]}": round(float(p[k:].sum()), 3) for k in range(1, len(STAGE_MIN_SEATS))}
        simple = row.stops_ahead >= SIMPLE_FROM_STOPS_AHEAD
        buses.append({
            "veh_id": int(row.veh_id), "plate_no": row.plate_no, "stops_ahead": int(row.stops_ahead),
            "current_seats": int(row.current_seats), "observed_at": row.observed_at.isoformat(),
            "p_at_least": {k: v for k, v in at_least.items() if not simple or k in ("1", f"{STAGE_MIN_SEATS[-1]}")},
            "detail": "simple" if simple else "full",
        })
    stale = (now - snap.generated_at).total_seconds() / 60 > STALE_MINUTES
    result = {
        "route": route, "station_seq": seq, "station_name": stop["station_name"], "direction": stop["direction"],
        "zone": stop["zone"], "generated_at": snap.generated_at.isoformat(), "stale": stale, "buses": buses,
        "my_seat": None,
    }
    if buses:
        result["my_seat"] = my_seat_probability(snap, art, route, seq, user_arrived_at or now, probabilities[0])
    return result


def check(at: datetime):
    """그 시각까지의 관측만으로 만든 실시간 특징이 학습 샘플의 특징과 같은지 본다."""
    at = pd.Timestamp(at, tz=TIMEZONE)
    observations = pd.read_parquet(RAW_DIR / "bus_observation.parquet")
    day = service_date(pd.Series([at])).iloc[0]
    observations = observations[(service_date(observations["collected_at"]) == day) & (observations["collected_at"] <= at)]
    snap = snapshot(observations, load_artifacts())
    print(f"수집 시각 {snap.generated_at}, 차량 × 정류장 {len(snap.predictions):,}개")

    keys = ["veh_id", "observed_at", "target_seq"]
    features = [c for c in NUMERIC_FEATURES + CATEGORICAL_FEATURES if c not in keys]
    samples = pd.read_parquet(INTERIM_DIR / "samples.parquet", columns=keys + features)
    joined = snap.predictions[keys + features].merge(samples, on=keys, suffixes=("", "_train"))
    print(f"학습 샘플과 겹치는 행 {len(joined):,}개 (학습 샘플은 정답이 있는 행만 있어서 일부만 겹친다)")
    different = {}
    for column in features:
        live, train = joined[column], joined[f"{column}_train"]
        same = (live == train) | (live.isna() & train.isna())
        if column in NUMERIC_FEATURES:
            same |= np.isclose(live.astype(float), train.astype(float), equal_nan=True)
        if (~same).any():
            different[column] = int((~same).sum())
    print("모든 특징이 같다 ✔" if not different else f"다른 특징: {different}")
    return not different


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", type=datetime.fromisoformat, required=True)
    args = parser.parse_args()
    raise SystemExit(0 if check(args.check) else 1)


if __name__ == "__main__":
    main()
