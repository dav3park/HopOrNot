"""노선 정류장 분류: 체크포인트, 경희대 안쪽, 방향, 구역, 예측 대상.

입력: data/raw/route_station.parquet, data/interim/boarding_profile.parquet
출력: data/interim/stops.parquet

방향은 회차 지점이 아니라 고속도로로 나눈다. 퇴근길 신논현처럼 회차 전 서울 정류장의
승객도 영통으로 가기 때문이다.
"""
import pandas as pd

from .config import (CAMPUS_END_STOP, CAMPUS_START_STOP, CHECKPOINT_MAX_DAILY, INTERIM_DIR, RAW_DIR, ROUTES,
                     SEOUL_BOUND, VIA_MARK, YEONGTONG_BOUND)


def daily_totals(profile: pd.DataFrame) -> pd.DataFrame:
    """요일유형별 일수로 가중해 노선 × 정류장 일평균 승차·하차를 구한다."""
    days = profile.drop_duplicates("day_type").set_index("day_type")["days"]
    weighted = profile.assign(on=profile["boardings"] * profile["days"], off=profile["alightings"] * profile["days"])
    totals = weighted.groupby(["route", "station_id"])[["on", "off"]].sum() / days.sum()
    return totals.reset_index()


def longest_run(flags: pd.Series) -> tuple[int, int]:
    """True가 가장 길게 이어지는 구간의 (시작, 끝) 위치."""
    best, start = (0, -1), None
    for position, flag in enumerate(list(flags) + [False]):
        if flag and start is None:
            start = position
        elif not flag and start is not None:
            if position - start > best[1] - best[0] + 1:
                best = (start, position - 1)
            start = None
    return best


def classify_route(stops: pd.DataFrame, turn_seq: int) -> pd.DataFrame:
    stops = stops.sort_values("station_seq").reset_index(drop=True)
    stops["is_checkpoint"] = stops["station_name"].str.contains(VIA_MARK, regex=False) & \
                             (stops["on"] + stops["off"] < CHECKPOINT_MAX_DAILY)

    seq = stops["station_seq"]
    first = seq[stops["station_name"] == CAMPUS_START_STOP].iloc[0]
    last = seq[stops["station_name"] == CAMPUS_END_STOP].iloc[-1]
    stops["is_campus"] = (seq < first) | (seq > last)

    out_start, out_end = longest_run(stops["is_checkpoint"] & (seq <= turn_seq))
    back_start, back_end = longest_run(stops["is_checkpoint"] & (seq > turn_seq))
    highway_in, seoul_start = seq[out_start], seq[out_end] + 1
    seoul_end, home_start = seq[back_start] - 1, seq[back_end] + 1

    stops["direction"] = None
    stops.loc[(seq >= first) & (seq < highway_in), "direction"] = SEOUL_BOUND
    stops.loc[(seq >= seoul_start) & (seq <= last), "direction"] = YEONGTONG_BOUND
    stops["zone"] = None
    stops.loc[(seq >= first) & (seq < highway_in), "zone"] = "출발권"
    stops.loc[(seq >= seoul_start) & (seq <= seoul_end), "zone"] = "서울권"
    stops.loc[(seq >= home_start) & (seq <= last), "zone"] = "도착권"

    stops["is_target"] = ~stops["is_checkpoint"] & ~stops["is_campus"] & stops["direction"].notna()
    return stops


def main():
    stations = pd.read_parquet(RAW_DIR / "route_station.parquet")
    totals = daily_totals(pd.read_parquet(INTERIM_DIR / "boarding_profile.parquet"))

    frames = []
    for route in ROUTES:
        stops = stations[stations["route_id"] == route.route_id].assign(route=route.name)
        stops = stops.merge(totals, how="left", on=["route", "station_id"]).fillna({"on": 0.0, "off": 0.0})
        frames.append(classify_route(stops, route.turn_seq))
    result = pd.concat(frames, ignore_index=True)
    result.to_parquet(INTERIM_DIR / "stops.parquet", index=False)
    print(result.groupby("route")[["is_checkpoint", "is_campus", "is_target"]].sum())


if __name__ == "__main__":
    main()
