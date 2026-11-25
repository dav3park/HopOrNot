"""실시간 추론: 오늘의 관측으로 다음 버스들의 도착 잔여석 확률과 내가 앉을 확률을 낸다.

학습과 같은 함수(assign_trips, arrival_events, candidate_targets, add_features, model_inputs)를 쓴다.
특징 계산이 학습과 달라지면 모델이 엉뚱한 값을 내므로, 아래 점검으로 둘이 같은지 확인한다.

    python -m src.live --check 2026-11-11T18:30   # 그 시각까지의 관측만으로 만든 특징 = 학습 샘플의 특징인지
"""
import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime

import lightgbm as lgb
import numpy as np
import pandas as pd

from .build_trips import arrival_events, assign_trips
from .config import INTERIM_DIR, ML_DIR, MODELS_DIR, RAW_DIR, ROUTES, STAGE_MIN_SEATS, TIMEZONE
from .evaluate import PROBABILITY_COLUMNS
from .features import (CATEGORICAL_FEATURES, NUMERIC_FEATURES, add_features, candidate_targets, model_inputs,
                       observed_rows, with_fleet)
from .split import service_date
from .waiting import (FIRST_BUS_ELAPSED_MINUTES, MAX_ELAPSED_MINUTES, MIN_RATE_PER_MINUTE, ZONES, WaitingModel,
                      bunch_ids, day_type_of, expected_ahead, seat_distribution, seat_probability)

STALE_MINUTES = 15  # 마지막 수집이 이보다 오래되면 실시간 값이 아니다 (01–06시 수집 중지)
SIMPLE_FROM_STOPS_AHEAD = 4  # 이만큼 앞부터는 중간 단계 예측이 약하므로 P(≥1), P(≥20)만 보여준다
CUMULATIVE_BUSES = 4         # "이 버스까지 내가 탈 확률"을 계산할 다가오는 버스 수
LINE_STOPS_BEFORE = 10       # 노선도에 보여줄 내 정류장 앞쪽 실제 정류장 수
RECOMMEND_BEFORE, RECOMMEND_AFTER = 6, 3  # 추천 후보: 내 정류장 앞쪽·뒤쪽 실제 정류장 수
WALK_METERS_PER_MINUTE = 70
BUS_MINUTES_PER_STOP = 2  # 버스 도착 시간 대략값 (도착 시간은 모델로 예측하지 않는다)
EVENT_COLUMNS = {"route": "str", "trip_id": "int64", "station_seq": "int64", "arrived_at": f"datetime64[us, {TIMEZONE}]",
                 "known_at": f"datetime64[us, {TIMEZONE}]", "seats_low": "float64", "seats_high": "float64"}


# 경기버스 공식 지도의 도로 경로 (서울 방향 + 캠퍼스 방향, 운행 순서). frontend 브랜치에서 하성준이 수집
# (frontend/scripts/sync-gbis-routes.py, 2026-11-12). 정류장 ID·순번이 우리 정류장 표와 모두 같다.
ROUTE_LINES = ML_DIR / "serve" / "gbis_route_lines.json"


HIGHWAY_NAME = re.compile(r"IC|JC|TG|톨게이트|나들목|분기점")


def stop_kinds(stops: pd.DataFrame) -> pd.Series:
    """노선 순서로 정류장 종류.

    campus   경희대 안쪽 (예측하지 않음)
    highway  고속도로·자동차전용도로 구간. 문이 안 열리는 경유 지점이 이어진 구간(run)에 IC·JC·TG 이름이 하나라도
             있으면 그 구간 전체 (죽전·금곡·서울진입 같은 사이 지점 포함)
    via      고속도로 이름이 없는 도심 경유 지점 (SKT타워, 시청교차로 …)
    stop     승하차 정류장
    """
    kinds = pd.Series("stop", index=stops.index, dtype="object")
    for _, group in stops.groupby("route"):
        group = group.sort_values("station_seq")
        run: list = []

        def close():
            if run:
                named = any(HIGHWAY_NAME.search(stops.loc[i, "station_name"]) for i in run)
                kinds.loc[run] = "highway" if named else "via"
            run.clear()

        for index, row in group.iterrows():
            if row["is_campus"]:
                close()
                kinds.loc[index] = "campus"
            elif row["is_checkpoint"]:
                run.append(index)
            else:
                close()
        close()
    return kinds


@dataclass
class RoadPath:
    """노선 한 바퀴의 도로 경로와, 정류장 순번마다 경로 위 가장 가까운 점의 위치."""
    points: np.ndarray            # (N, 2) 위도, 경도
    index_of: dict[int, int]      # 정류장 순번 → points 위치 (순번이 커질수록 커진다)

    def between(self, first_seq: int, last_seq: int) -> np.ndarray:
        lo, hi = self.index_of[first_seq], self.index_of[last_seq]
        return self.points[min(lo, hi):max(lo, hi) + 1]


def road_paths(stops: pd.DataFrame) -> dict[str, RoadPath]:
    if not ROUTE_LINES.exists():
        return {}
    data = json.loads(ROUTE_LINES.read_text())
    paths = {}
    for route in data["routes"]:
        directions = route["directions"]
        points = np.array([[p["latitude"], p["longitude"]]
                           for direction in ("TO_SEOUL", "TO_CAMPUS")
                           for part in directions[direction]["path"] for p in part])
        index_of, start = {}, 0
        for row in stops[stops["route"] == route["name"]].sort_values("station_seq").itertuples(index=False):
            # 앞 정류장보다 뒤에서만 찾는다 (서울 도심 순환에서 같은 길을 두 번 지나도 순서를 지킨다)
            rest = points[start:]
            nearest = start + int(np.argmin((rest[:, 0] - row.y) ** 2 + (rest[:, 1] - row.x) ** 2))
            index_of[int(row.station_seq)] = start = nearest
        paths[route["name"]] = RoadPath(points, index_of)
    return paths


@dataclass
class Artifacts:
    stops: pd.DataFrame
    profile: pd.DataFrame
    booster: lgb.Booster
    waiting: WaitingModel
    cells: pd.Series
    within_stage: dict[int, np.ndarray]
    roads: dict[str, RoadPath]


@dataclass
class Snapshot:
    generated_at: pd.Timestamp  # 가장 최근 수집 시각
    trips: pd.DataFrame
    events: pd.DataFrame
    predictions: pd.DataFrame   # 차량 × 앞으로 지날 정류장의 단계 확률


def load_artifacts() -> Artifacts:
    waiting = json.loads((MODELS_DIR / "waiting.json").read_text())
    stops = pd.read_parquet(INTERIM_DIR / "stops.parquet")
    stops["kind"] = stop_kinds(stops)
    return Artifacts(
        stops=stops,
        profile=pd.read_parquet(INTERIM_DIR / "boarding_profile.parquet"),
        booster=lgb.Booster(model_file=str(MODELS_DIR / "lgbm.txt")),
        waiting=WaitingModel.from_json(waiting),
        cells=pd.read_parquet(MODELS_DIR / "waiting_cells.parquet").set_index(["route", "station_id", "hour"])["cell_ratio"],
        within_stage={int(s): np.array(v) for s, v in waiting["within_stage"].items()},
        roads=road_paths(stops),
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
    """이 정류장을 가장 최근에 지난 버스 묶음 (같은 노선, BUNCH_MINUTES 안에 연달아 온 차들, 학습과 같은 규칙).

    마지막 도착 시각, 도착 잔여석 합, 그 앞 묶음과의 간격, 모두 만석으로 떠났는지 (확인된 것만).
    """
    passed = snap.events[(snap.events["route"] == route) & (snap.events["station_seq"] == seq)].sort_values("arrived_at")
    if passed.empty:
        return None
    constant = pd.Series(0, index=passed.index)
    passed = passed.assign(bunch=bunch_ids(passed["arrived_at"], [constant]))
    group = passed[passed["bunch"] == passed["bunch"].iloc[-1]]
    before = passed[passed["bunch"] < group["bunch"].iloc[0]]
    gap = ((group["arrived_at"].iloc[0] - before["arrived_at"].iloc[-1]).total_seconds() / 60 if len(before)
           else FIRST_BUS_ELAPSED_MINUTES)
    departures = []
    for trip_id in group["trip_id"]:
        after = snap.trips[(snap.trips["trip_id"] == trip_id) & (snap.trips["station_seq"] > seq)]
        departures.append(int(after.sort_values("collected_at")["remain_seat_cnt"].iloc[0]) if len(after) else None)
    known = all(d is not None for d in departures)
    return {"arrived_at": group["arrived_at"].iloc[-1], "buses": len(group),
            "arrival_seats": float(group["seats_low"].sum()), "elapsed": float(np.clip(gap, 0.5, MAX_ELAPSED_MINUTES)),
            "departure_seats": departures, "departures_known": known,
            "left_full": known and all(d == 0 for d in departures)}


def my_seat_probability(snap: Snapshot, art: Artifacts, route: str, seq: int, user_arrived_at: pd.Timestamp,
                        stage_probabilities: np.ndarray) -> dict:
    """P(내가 앉음) = Σ_s P(도착 잔여석 = s) × P(내 앞 인원 < s).

    stage_probabilities는 다가오는 버스들(가까운 순)의 단계 확률이다. 앞 버스를 못 타면 그 버스 좌석만큼
    내 앞 인원이 줄어드니, k번째 버스까지 탈 확률 = P(내 앞 인원 < 1–k번 버스 좌석 합)이다.
    좌석 합의 분포는 버스별 분포의 합성곱이다 (버스끼리 독립이라고 가정). 내 뒤에 온 사람은 상관없다.
    """
    stage_probabilities = np.atleast_2d(stage_probabilities)
    stop = art.stops[(art.stops["route"] == route) & (art.stops["station_seq"] == seq)].iloc[0]
    if stop["zone"] not in ZONES:
        return {"probability": None, "note": f"대기 인원 모델은 승차 구간({', '.join(ZONES)})에서만 학습했다"}
    previous = previous_bus(snap, route, seq)
    note = None
    prev_seats, prev_elapsed = 0.0, FIRST_BUS_ELAPSED_MINUTES
    if previous is None:
        elapsed, prev_full = MAX_ELAPSED_MINUTES, False
        note = f"오늘 이 정류장을 지난 버스 기록이 없어 앞차 이후 {MAX_ELAPSED_MINUTES}분으로 가정"
    else:
        elapsed = (user_arrived_at - previous["arrived_at"]).total_seconds() / 60
        elapsed = float(np.clip(elapsed, 0.5, MAX_ELAPSED_MINUTES))
        prev_full = bool(previous["left_full"])
        prev_seats, prev_elapsed = previous["arrival_seats"], previous["elapsed"]
        if not previous["departures_known"]:
            note = "앞차가 아직 정류장을 떠난 것이 확인되지 않아 만석 출발 여부를 모름 (아니라고 가정)"

    def rate_and_cell(at: pd.Timestamp) -> tuple[float, float]:
        local = pd.Series([at]).dt.tz_convert(TIMEZONE)
        hour, day_type = int(local.dt.hour.iloc[0]), day_type_of(local)[0]
        usual = art.profile[(art.profile["route"] == route) & (art.profile["station_id"] == stop["station_id"])
                            & (art.profile["day_type"] == day_type) & (art.profile["hour"] == hour)]["boardings"]
        rate = max(float(usual.iloc[0]) / 60 if len(usual) else 0.0, MIN_RATE_PER_MINUTE)
        return rate, float(art.cells.get((route, stop["station_id"], hour), 1.0))

    rate, cell = rate_and_cell(user_arrived_at)
    prev_rate, prev_cell = rate_and_cell(previous["arrived_at"]) if previous else (rate, cell)
    frame = pd.DataFrame({"zone": [stop["zone"]], "rate": [rate], "elapsed": [elapsed], "cell_ratio": [cell],
                          "prev_left_full": [prev_full], "prev_seats": [prev_seats], "prev_rate": [prev_rate],
                          "prev_elapsed": [prev_elapsed], "prev_cell_ratio": [prev_cell]})
    mu = expected_ahead(art.waiting, frame)
    by_bus, total = [], None
    for per_bus in seat_distribution(stage_probabilities[:CUMULATIVE_BUSES], art.within_stage):
        total = per_bus if total is None else np.convolve(total, per_bus)
        by_bus.append(round(float(seat_probability(total[None, :], mu, art.waiting.k)[0]), 3))
    return {
        "probability": by_bus[0],
        "by_bus": by_bus,
        "expected_people_ahead": round(float(mu[0]), 1),
        "minutes_since_previous_bus": round(elapsed, 1),
        "previous_bus": None if previous is None else {
            "arrived_at": previous["arrived_at"].isoformat(), "buses": previous["buses"],
            "arrival_seats": previous["arrival_seats"], "left_full": prev_full,
            "departure_seats": previous["departure_seats"]},
        "note": note,
    }


def seat_estimate(stage_probabilities: np.ndarray, within: dict[int, np.ndarray]) -> dict:
    """단계 확률을 좌석 수 분포로 펴서 예상 잔여석(중앙값)과 10–90% 범위."""
    cdf = np.cumsum(seat_distribution(stage_probabilities[None, :], within)[0])
    quantile = lambda q: int(np.searchsorted(cdf, q))
    return {"expected_seats": quantile(0.5), "seats_range": [quantile(0.1), quantile(0.9)]}


def arrival_order(coming: pd.DataFrame) -> pd.DataFrame:
    """다가오는 버스를 도착 순서로. 남은 실제 정류장 수가 같으면 순번이 큰(체크포인트를 더 지난) 차가,
    같은 정류장이면 이미 출발한(state_cd 2) 차가 도착한(1)·통과 중인(0) 차보다 앞서 있다."""
    return coming.sort_values(["stops_ahead", "current_seq", "state_cd"], ascending=[True, False, False])


def stop_prediction(snap: Snapshot, art: Artifacts, route: str, seq: int, user_arrived_at: pd.Timestamp | None = None,
                    now: pd.Timestamp | None = None) -> dict:
    """정류장 하나에 대해 다가오는 버스들의 좌석 확률과, 다음 버스에 내가 앉을 확률."""
    now = now or pd.Timestamp.now(tz=TIMEZONE)
    stop = art.stops[(art.stops["route"] == route) & (art.stops["station_seq"] == seq)]
    if stop.empty or not bool(stop["is_target"].iloc[0]):
        raise KeyError(f"{route} {seq}번 정류장은 예측 대상이 아니다")
    stop = stop.iloc[0]
    coming = snap.predictions[(snap.predictions["route"] == route) & (snap.predictions["target_seq"] == seq)]
    coming = arrival_order(coming)
    probabilities = coming[PROBABILITY_COLUMNS].to_numpy()
    buses = []
    names = art.stops[art.stops["route"] == route].set_index("station_seq")["station_name"]
    for row, p in zip(coming.itertuples(index=False), probabilities):
        at_least = {f"{STAGE_MIN_SEATS[k]}": round(float(p[k:].sum()), 3) for k in range(1, len(STAGE_MIN_SEATS))}
        simple = row.stops_ahead >= SIMPLE_FROM_STOPS_AHEAD
        buses.append({
            "veh_id": int(row.veh_id), "plate_no": row.plate_no, "stops_ahead": int(row.stops_ahead),
            "current_seq": int(row.current_seq), "current_station_name": names.get(row.current_seq, ""),
            "state_cd": int(row.state_cd),
            "current_seats": int(row.current_seats), "observed_at": row.observed_at.isoformat(),
            "p_at_least": {k: v for k, v in at_least.items() if not simple or k in ("1", f"{STAGE_MIN_SEATS[-1]}")},
            "detail": "simple" if simple else "full",
            **seat_estimate(p, art.within_stage),
        })
    stale = (now - snap.generated_at).total_seconds() / 60 > STALE_MINUTES
    result = {
        "route": route, "station_seq": seq, "station_name": stop["station_name"], "direction": stop["direction"],
        "zone": stop["zone"], "generated_at": snap.generated_at.isoformat(), "stale": stale, "buses": buses,
        "my_seat": None,
    }
    if buses:
        result["my_seat"] = my_seat_probability(snap, art, route, seq, user_arrived_at or now, probabilities)
        for bus, value in zip(buses, result["my_seat"].get("by_bus") or []):
            bus["my_seat_by_here"] = value
    return result


def real_ranks(stops: pd.DataFrame) -> pd.Series:
    """노선 안에서 체크포인트를 뺀 실제 정류장 순서."""
    return (~stops["is_checkpoint"]).groupby(stops["route"]).cumsum()


def bus_position(stops: pd.DataFrame, road: RoadPath | None, seq: int, state_cd: int) -> tuple[float, float]:
    """버스 위치(위도, 경도). 정류장에 도착(state_cd 1)했으면 그 정류장, 아니면 다음 정류장까지 도로의 중간.

    stops는 station_seq가 인덱스인 한 노선의 정류장 표.
    """
    here = stops.loc[seq]
    later = stops[stops.index > seq]
    if state_cd == 1 or later.empty:
        return float(here["y"]), float(here["x"])
    if road is not None:
        middle = road.between(int(seq), int(later.index[0]))
        return tuple(float(v) for v in middle[len(middle) // 2])
    nxt = later.iloc[0]
    return float((here["y"] + nxt["y"]) / 2), float((here["x"] + nxt["x"]) / 2)


def line_view(snap: Snapshot, art: Artifacts, route: str, seq: int) -> dict:
    """내 정류장으로 오는 버스들: 위치와, 버스마다 정류장별 1석 이상 확률 (노선도·지도용).

    정류장 목록과 도로 경로는 /route, /path에서 받는다.
    """
    stops = art.stops[art.stops["route"] == route].set_index("station_seq")
    if seq not in stops.index or not bool(stops.loc[seq, "is_target"]):
        raise KeyError(f"{route} {seq}번 정류장은 예측 대상이 아니다")
    coming = snap.predictions[(snap.predictions["route"] == route) & (snap.predictions["target_seq"] == seq)]
    coming = arrival_order(coming).head(CUMULATIVE_BUSES)
    ahead = snap.predictions[(snap.predictions["route"] == route) & snap.predictions["veh_id"].isin(coming["veh_id"])
                             & (snap.predictions["target_seq"] <= seq)]
    road = art.roads.get(route)
    plates = snap.predictions.drop_duplicates("veh_id").set_index("veh_id")["plate_no"]
    buses = []
    for order, row in enumerate(coming.itertuples(index=False)):
        lat, lon = bus_position(stops, road, int(row.current_seq), int(row.state_cd))
        buses.append({
            "order": order, "veh_id": int(row.veh_id), "plate_no": plates.get(row.veh_id, ""),
            "current_seq": int(row.current_seq), "state_cd": int(row.state_cd), "current_seats": int(row.current_seats),
            "lat": lat, "lon": lon,
            "p_seat_at": {str(int(r.target_seq)): round(float(1 - r.p0), 3) for r in ahead[ahead["veh_id"] == row.veh_id].itertuples(index=False)},
        })
    return {"route": route, "station_seq": seq, "direction": stops.loc[seq, "direction"],
            "generated_at": snap.generated_at.isoformat(), "buses": buses}


def path_view(art: Artifacts, route: str) -> dict:
    """노선 한 바퀴의 도로 경로를 종류별 선분으로. 고속도로(회색)와 일반 도로를 나눠 그릴 수 있다.

    경기버스 공식 지도의 도로 경로가 있으면 그것을, 없으면 정류장 사이 직선을 쓴다.
    """
    stops = art.stops[art.stops["route"] == route].sort_values("station_seq")
    road = art.roads.get(route)
    segments: list[dict] = []
    for a, b in zip(stops.itertuples(index=False), stops.iloc[1:].itertuples(index=False)):
        kind = "highway" if "highway" in (a.kind, b.kind) else "road"
        points = road.between(int(a.station_seq), int(b.station_seq)).tolist() if road is not None \
            else [[float(a.y), float(a.x)], [float(b.y), float(b.x)]]
        if segments and segments[-1]["kind"] == kind:
            segments[-1]["points"].extend(points)
        else:
            segments.append({"kind": kind, "points": points})
    return {"route": route, "source": "gbis_road" if road is not None else "stop_to_stop", "segments": segments}


def route_view(snap: Snapshot, art: Artifacts, route: str) -> dict:
    """정류장 목록 화면 (네이버 버스처럼): 노선 한 바퀴를 순서대로 한 줄로, 지금 달리는 버스 전부.

    캠퍼스 → 출발권 정류장 → 고속도로(IC·JC·TG) → 서울 정류장 → 고속도로 → 도착권 정류장 → 캠퍼스.
    서울행·영통행으로 나누지 않는다. 예측 대상(is_target)만 내 정류장으로 고를 수 있다.
    버스는 가장 최근 수집의 위치다 (마지막으로 지난 순번 current_seq와 정류장 도착 여부 state_cd).
    """
    stops = art.stops[art.stops["route"] == route].sort_values("station_seq")
    if stops.empty:
        raise KeyError(f"{route} 노선이 없다")
    indexed = stops.set_index("station_seq")
    road = art.roads.get(route)
    trips = snap.trips[snap.trips["route"] == route]
    latest = trips[trips["collected_at"] == trips["collected_at"].max()].sort_values("station_seq")
    turn = next(r.turn_seq for r in ROUTES if r.name == route)
    buses = []
    for r in latest.itertuples(index=False):
        lat, lon = bus_position(indexed, road, int(r.station_seq), int(r.state_cd))
        buses.append({"veh_id": int(r.veh_id), "plate_no": r.plate_no, "current_seq": int(r.station_seq),
                      "state_cd": int(r.state_cd), "current_seats": int(r.remain_seat_cnt), "lat": lat, "lon": lon})
    return {
        "route": route, "generated_at": snap.generated_at.isoformat(), "turn_seq": int(turn),
        "stops": [{"station_seq": int(r.station_seq), "station_name": r.station_name, "lat": float(r.y), "lon": float(r.x),
                   "kind": r.kind, "is_target": bool(r.is_target), "zone": r.zone if isinstance(r.zone, str) else None,
                   "direction": r.direction if isinstance(r.direction, str) else None}
                  for r in stops.itertuples(index=False)],
        "buses": buses,
    }


HISTORY_DAYS = 7
HISTORY_SLOT_MINUTES = 30


def history_view(events: pd.DataFrame, route: str, seq: int, until: pd.Timestamp) -> dict:
    """지난 HISTORY_DAYS 운행일 동안 이 정류장에 도착한 버스의 잔여석 (30분 단위).

    events는 arrival_events (build_trips). 도착 잔여석은 라벨과 같은 값(범위면 가운데)이다.
    줄 선 사람은 빼지 않은 "도착할 때 남은 좌석"이다.
    """
    until_day = service_date(pd.Series([until])).iloc[0]
    first_day = until_day - pd.Timedelta(days=HISTORY_DAYS)
    on_route = events[(events["route"] == route) & (events["service_date"] >= first_day)
                      & (events["service_date"] < until_day)].sort_values(["trip_id", "station_seq"])
    # 떠날 때 잔여석 = 같은 운행의 다음 정류장 도착 잔여석 (둘 다 정확할 때만). 0이면 만석 출발 = 기다린 사람이 다 못 탐
    exact = on_route["seats_low"] == on_route["seats_high"]
    nxt = on_route.groupby("trip_id")["seats_low"].shift(-1).where(exact.groupby(on_route["trip_id"]).shift(-1, fill_value=False))
    on_route = on_route.assign(all_boarded=np.where(nxt.isna(), np.nan, (nxt > 0).astype(float)))
    here = on_route[(on_route["station_seq"] == seq) & (on_route["arrived_at"] < until)]
    local = here["arrived_at"].dt.tz_convert(TIMEZONE)
    minutes = local.dt.hour * 60 + local.dt.minute
    minutes = minutes + np.where(local.dt.hour < 3, 24 * 60, 0)  # 자정 넘긴 막차는 전날 운행일
    frame = pd.DataFrame({
        "day": here["service_date"].astype(str), "slot": (minutes // HISTORY_SLOT_MINUTES) * HISTORY_SLOT_MINUTES,
        "seats": (here["seats_low"] + here["seats_high"]) / 2, "has_seat": here["seats_low"] >= 1,
        "all_boarded": here["all_boarded"].to_numpy(),
    })
    days = sorted(frame["day"].unique())
    day_types = {d: day_type_of(pd.Series([pd.Timestamp(d, tz=TIMEZONE)]))[0] for d in days}
    cells = frame.groupby(["day", "slot"]).agg(buses=("seats", "size"), mean_seats=("seats", "mean"),
                                                 share=("has_seat", "mean"), all_boarded=("all_boarded", "mean")).reset_index()
    frame["day_type"] = frame["day"].map(day_types)
    summary = frame.groupby(["day_type", "slot"]).agg(buses=("seats", "size"), median_seats=("seats", "median"),
                                                       share=("has_seat", "mean"), all_boarded=("all_boarded", "mean"),
                                                       known=("all_boarded", "count")).reset_index()
    rounded = lambda v: None if pd.isna(v) else round(float(v), 3)
    return {
        "route": route, "station_seq": seq, "until": until.isoformat(), "slot_minutes": HISTORY_SLOT_MINUTES,
        "days": [{"day": d, "day_type": day_types[d]} for d in days],
        "cells": [{"day": r.day, "slot": int(r.slot), "buses": int(r.buses), "mean_seats": round(float(r.mean_seats), 1),
                   "share": round(float(r.share), 3), "all_boarded": rounded(r.all_boarded)}
                  for r in cells.itertuples(index=False)],
        # share: 도착할 때 1석 이상 남은 비율 / all_boarded: 만석으로 떠나지 않은(기다린 사람이 다 탄) 비율
        "summary": [{"day_type": r.day_type, "slot": int(r.slot), "buses": int(r.buses),
                     "median_seats": round(float(r.median_seats), 1), "share": round(float(r.share), 3),
                     "all_boarded": rounded(r.all_boarded) if r.known >= 3 else None}
                    for r in summary.itertuples(index=False)],
    }


def recommend(snap: Snapshot, art: Artifacts, route: str, seq: int, user_arrived_at: pd.Timestamp | None = None,
              now: pd.Timestamp | None = None) -> dict:
    """같은 노선·방향의 가까운 승차 정류장 중 다음 버스에 내가 탈 확률이 높은 순.

    "지금 그 정류장에 있다면"의 확률이다. 걸어가는 시간은 거리로만 보여주고 계산에 넣지 않는다.
    """
    stops = art.stops[art.stops["route"] == route].assign(rank=lambda s: real_ranks(s)).set_index("station_seq")
    if seq not in stops.index or not bool(stops.loc[seq, "is_target"]):
        raise KeyError(f"{route} {seq}번 정류장은 예측 대상이 아니다")
    mine = stops.loc[seq]
    near = stops[stops["is_target"] & (stops["direction"] == mine["direction"]) & stops["zone"].isin(ZONES)
                 & stops["rank"].between(mine["rank"] - RECOMMEND_BEFORE, mine["rank"] + RECOMMEND_AFTER)]
    lat0, lon0 = np.radians(mine["y"]), np.radians(mine["x"])
    candidates = []
    for s, r in near.iterrows():
        result = stop_prediction(snap, art, route, int(s), user_arrived_at, now)
        if not result["my_seat"] or result["my_seat"]["probability"] is None:
            continue
        lat, lon = np.radians(r["y"]), np.radians(r["x"])
        meters = 2 * 6_371_000 * np.arcsin(np.sqrt(np.sin((lat - lat0) / 2) ** 2
                                                   + np.cos(lat0) * np.cos(lat) * np.sin((lon - lon0) / 2) ** 2))
        walk = meters / WALK_METERS_PER_MINUTE
        bus_eta = result["buses"][0]["stops_ahead"] * BUS_MINUTES_PER_STOP
        candidates.append({
            "station_seq": int(s), "station_name": r["station_name"], "stops_from_mine": int(r["rank"] - mine["rank"]),
            "distance_m": int(round(meters)), "walk_minutes": int(np.ceil(walk)), "bus_eta_minutes": int(bus_eta),
            "reachable": bool(int(s) == seq or walk <= bus_eta), "my_seat": result["my_seat"]["probability"],
            "next_bus_stops_ahead": result["buses"][0]["stops_ahead"], "is_mine": int(s) == seq,
        })
    candidates.sort(key=lambda c: (not c["reachable"], -c["my_seat"]))  # 갈 수 있는 곳 먼저
    return {"route": route, "station_seq": seq, "generated_at": snap.generated_at.isoformat(), "candidates": candidates}


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
