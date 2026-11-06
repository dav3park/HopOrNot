"""관측 → 운행 → 정류장 도착 이벤트 (README 3장).

입력: data/raw/bus_observation.parquet, data/interim/stops.parquet
출력: data/interim/arrival_events.parquet

한 행은 (운행, 예측 대상 정류장)이고 그 정류장에 도착할 때의 잔여석 범위를 담는다.
known_at은 도착했다는 사실과 그 값을 함께 알 수 있게 된 시각이다. 도착을 직접 보지 못했으면 다음 관측 시각이다.
source 값:
  arrival  그 정류장에서 도착(state_cd = 1)으로 관측
  leg      직전 실제 정류장을 떠난 뒤의 관측. 문이 안 열리는 구간이라 도착 잔여석과 같다
  range    앞뒤 관측의 범위. 사이 구간이 승차 또는 하차 한 방향뿐일 때만 믿는다
  mixed    앞뒤 관측의 범위지만 승차·하차가 섞여 범위를 벗어날 수 있다. 항상 애매한 라벨
"""
import numpy as np
import pandas as pd

from .config import (HOLIDAYS, INTERIM_DIR, KEY_SEGMENTS, NO_SEAT_INFO, ONE_WAY_RATIO, RAW_DIR, ROUTES,
                     STAGE_MIN_SEATS, TIMEZONE, TRIP_MAX_BACKSTEP, TRIP_MAX_GAP_MINUTES, TRIP_MAX_JUMP)
from .split import service_date

STATE_ARRIVED = 1


def stage_of(seats) -> np.ndarray:
    return np.searchsorted(STAGE_MIN_SEATS, seats, side="right") - 1


def assign_trips(observations: pd.DataFrame) -> pd.DataFrame:
    """차량별 시간순 관측을 운행으로 나누고, 운행 안에서 순번이 되돌아간 관측을 뺀다."""
    df = observations[observations["remain_seat_cnt"] > NO_SEAT_INFO]
    df = df.sort_values(["veh_id", "collected_at"]).reset_index(drop=True)
    by_vehicle = df.groupby("veh_id")
    step = by_vehicle["station_seq"].diff()
    gap = by_vehicle["collected_at"].diff().dt.total_seconds() / 60
    new_trip = step.isna() | (step < -TRIP_MAX_BACKSTEP) | (step > TRIP_MAX_JUMP) | (gap > TRIP_MAX_GAP_MINUTES)
    df["trip_id"] = new_trip.cumsum()
    furthest = df.groupby("trip_id")["station_seq"].cummax()
    return df[df["station_seq"] >= furthest].reset_index(drop=True)


def one_way(stops: pd.DataFrame, after_seq: int, until_seq: int) -> bool:
    between = stops[(stops["station_seq"] > after_seq) & (stops["station_seq"] <= until_seq)]
    on, off = between["on"].sum(), between["off"].sum()
    return min(on, off) <= ONE_WAY_RATIO * max(on, off)


def interpolate_time(seq, before, after):
    if after is None or after.station_seq == before.station_seq:
        return before.collected_at
    share = (seq - before.station_seq) / (after.station_seq - before.station_seq)
    return before.collected_at + (after.collected_at - before.collected_at) * share


def trip_events(trip: pd.DataFrame, stops: pd.DataFrame) -> list[dict]:
    rows = list(trip.itertuples(index=False))
    real = stops.loc[~stops["is_checkpoint"], "station_seq"].to_numpy()
    events = []
    for stop in stops[stops["is_target"]].itertuples(index=False):
        seq = stop.station_seq
        if not rows[0].station_seq <= seq <= rows[-1].station_seq:
            continue
        earlier = real[real < seq]
        previous = earlier[-1] if len(earlier) else None

        before = next((r for r in reversed(rows) if r.station_seq < seq), None)
        after = next((r for r in rows if r.station_seq >= seq), None)
        arrived = next((r for r in rows if r.station_seq == seq and r.state_cd == STATE_ARRIVED), None)
        on_leg = before is not None and previous is not None and (
            before.station_seq > previous or (before.station_seq == previous and before.state_cd != STATE_ARRIVED))

        if arrived is not None:
            low = high = arrived.remain_seat_cnt
            source, at, known = "arrival", arrived.collected_at, arrived.collected_at
        elif on_leg:
            low = high = before.remain_seat_cnt
            source, at, known = "leg", interpolate_time(seq, before, after), after.collected_at
        elif before is not None and after is not None:
            low, high = sorted((before.remain_seat_cnt, after.remain_seat_cnt))
            source = "range" if one_way(stops, before.station_seq, after.station_seq) else "mixed"
            at, known = interpolate_time(seq, before, after), after.collected_at
        else:
            continue
        events.append({
            "route": stop.route, "veh_id": trip["veh_id"].iloc[0], "trip_id": trip["trip_id"].iloc[0],
            "station_seq": seq, "station_id": stop.station_id, "station_name": stop.station_name,
            "direction": stop.direction, "zone": stop.zone, "arrived_at": at, "known_at": known,
            "seats_low": low, "seats_high": high, "source": source,
        })
    return events


def key_segment(events: pd.DataFrame) -> pd.Series:
    """평일 출근·퇴근 핵심 구간 이름. 해당 없으면 NaN."""
    weekday = (events["arrived_at"].dt.day_of_week < 5) & ~events["service_date"].isin(HOLIDAYS)
    hour = events["arrived_at"].dt.hour
    result = pd.Series(pd.NA, index=events.index, dtype="object")
    for name, direction, zone, start, end in KEY_SEGMENTS:
        matched = (events["direction"] == direction) & (events["zone"] == zone) & (hour >= start) & (hour < end)
        result[weekday & matched] = name
    return result


def main():
    observations = pd.read_parquet(RAW_DIR / "bus_observation.parquet")
    stops = pd.read_parquet(INTERIM_DIR / "stops.parquet")

    trips = assign_trips(observations)
    events = []
    for route in ROUTES:
        route_stops = stops[stops["route"] == route.name]
        for _, trip in trips[trips["route_id"] == route.route_id].groupby("trip_id"):
            events.extend(trip_events(trip, route_stops))
    result = pd.DataFrame(events)

    for column in ("arrived_at", "known_at"):
        result[column] = pd.to_datetime(result[column]).dt.tz_convert(TIMEZONE)
    result["service_date"] = service_date(result["arrived_at"])
    result["key_segment"] = key_segment(result)
    low, high = stage_of(result["seats_low"]), stage_of(result["seats_high"])
    result["ambiguous"] = (low != high) | (result["source"] == "mixed")
    result["stage"] = pd.array(np.where(result["ambiguous"], -1, low), dtype="Int8")
    result.loc[result["ambiguous"], "stage"] = pd.NA

    result.to_parquet(INTERIM_DIR / "arrival_events.parquet", index=False)
    print(f"운행 {trips['trip_id'].nunique():,}개, 도착 이벤트 {len(result):,}개, 애매한 라벨 {result['ambiguous'].mean():.1%}")
    print(result["source"].value_counts(normalize=True).round(3).to_dict())


if __name__ == "__main__":
    main()
