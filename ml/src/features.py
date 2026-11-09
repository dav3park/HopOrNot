"""학습 샘플 + 특징. 예측 시점 t까지 알 수 있는 값만 쓴다 (README 4장, 5장).

입력: data/raw/bus_observation.parquet, data/interim/{arrival_events,stops,boarding_profile}.parquet
출력: data/interim/samples.parquet

한 행은 "시점 t에 정류장 p에 있는 차량이 앞쪽 정류장 s에 도착할 때"다.
날씨와 학기·시험기간 특징은 아직 없다 (README 5장).
"""
import numpy as np
import pandas as pd

from .boarding2025 import day_type
from .build_trips import assign_trips
from .config import (DAY_BOUNDARY_HOUR, INTERIM_DIR, LEAD_MAX_AGE_MINUTES, MAX_STOPS_AHEAD, RAW_DIR, ROUTES, TIMEZONE)
from .split import assign_split, service_date

TIME_DTYPE = f"datetime64[us, {TIMEZONE}]"

NUMERIC_FEATURES = [
    "current_seats", "current_seq", "state_cd", "active_buses", "front_seats", "front_seq_gap", "target_seq",
    "stops_ahead", "checkpoints_ahead", "day_of_week", "hour", "half_hour", "lead_seats", "lead_age_minutes",
    "target_boardings", "target_alightings", "between_boardings", "between_alightings",
]
CATEGORICAL_FEATURES = ["route", "direction", "zone", "day_type", "target_station_id"]


def model_inputs(samples: pd.DataFrame, stops: pd.DataFrame) -> pd.DataFrame:
    """모델 입력 열만 뽑고 범주형은 학습·평가에서 같은 범주 목록을 쓰게 한다."""
    categories = {
        "route": sorted(stops["route"].unique()),
        "direction": sorted(stops["direction"].dropna().unique()),
        "zone": sorted(stops["zone"].dropna().unique()),
        "day_type": ["평일", "토요일", "일요일·공휴일"],
        "target_station_id": sorted(stops.loc[stops["is_target"], "station_id"].unique()),
    }
    inputs = samples[NUMERIC_FEATURES + CATEGORICAL_FEATURES].copy()
    for column, values in categories.items():
        inputs[column] = pd.Categorical(inputs[column], categories=values)
    return inputs


def with_fleet(trips: pd.DataFrame) -> pd.DataFrame:
    """같은 호출(노선, 수집 시각)에 함께 잡힌 차량으로 운행 대수와 바로 앞차 상태를 붙인다."""
    trips = trips.sort_values(["route", "collected_at", "station_seq"]).reset_index(drop=True)
    batch = trips.groupby(["route", "collected_at"])
    trips["active_buses"] = batch["veh_id"].transform("size")
    trips["front_seats"] = batch["remain_seat_cnt"].shift(-1)
    trips["front_seq_gap"] = batch["station_seq"].shift(-1) - trips["station_seq"]
    return trips


def base_samples(trips: pd.DataFrame, events: pd.DataFrame, stops: pd.DataFrame) -> pd.DataFrame:
    """관측마다 같은 운행의 앞쪽 도착 이벤트를 붙인다."""
    observed = trips.rename(columns={
        "collected_at": "observed_at", "station_seq": "current_seq", "remain_seat_cnt": "current_seats",
    })[["trip_id", "veh_id", "route", "observed_at", "current_seq", "current_seats", "state_cd", "active_buses", "front_seats",
        "front_seq_gap"]]
    labels = events.rename(columns={"station_seq": "target_seq", "station_id": "target_station_id"}).drop(
        columns=["route", "veh_id", "known_at", "service_date", "station_name"])
    samples = observed.merge(labels, on="trip_id")
    samples = samples[(samples["target_seq"] > samples["current_seq"]) & (samples["arrived_at"] > samples["observed_at"])]

    ranks = stops.assign(real_rank=(~stops["is_checkpoint"]).groupby(stops["route"]).cumsum())
    ranks = ranks[["route", "station_seq", "real_rank"]]
    samples = samples.merge(ranks.rename(columns={"station_seq": "current_seq", "real_rank": "current_rank"}),
                            on=["route", "current_seq"])
    samples = samples.merge(ranks.rename(columns={"station_seq": "target_seq", "real_rank": "target_rank"}),
                            on=["route", "target_seq"])
    samples["stops_ahead"] = samples["target_rank"] - samples["current_rank"]
    samples["checkpoints_ahead"] = samples["target_seq"] - samples["current_seq"] - samples["stops_ahead"]
    samples = samples[samples["stops_ahead"] <= MAX_STOPS_AHEAD]
    return samples.drop(columns=["current_rank", "target_rank"]).reset_index(drop=True)


def add_time(samples: pd.DataFrame) -> pd.DataFrame:
    at = samples["observed_at"]
    samples["service_date"] = service_date(at)
    days = pd.to_datetime(samples["service_date"]).dt.strftime("%Y%m%d")
    samples["day_type"] = day_type(days)
    samples["day_of_week"] = pd.to_datetime(samples["service_date"]).dt.day_of_week
    # 승하차 자료와 같게 자정 넘긴 시각은 24시, 25시로 센다
    samples["hour"] = at.dt.hour + np.where(at.dt.hour < DAY_BOUNDARY_HOUR, 24, 0)
    samples["half_hour"] = samples["hour"] * 2 + (at.dt.minute >= 30)
    return samples


def add_lead(samples: pd.DataFrame, events: pd.DataFrame) -> pd.DataFrame:
    """t까지 목표 정류장을 지난 것이 확인된 가장 최근 차량의 기록을 붙인다.

    known_at은 도착 시각보다 빠르지 않으므로 아직 도착하지 않은 자기 운행은 뽑히지 않는다.
    """
    lead = events.assign(
        available_at=events["known_at"].astype(TIME_DTYPE),
        lead_arrived_at=events["arrived_at"],
        lead_seats=(events["seats_low"] + events["seats_high"]) / 2,
    ).rename(columns={"station_seq": "target_seq"})[["route", "target_seq", "available_at", "lead_arrived_at", "lead_seats"]]
    merged = pd.merge_asof(
        samples.assign(observed_at=samples["observed_at"].astype(TIME_DTYPE)).sort_values("observed_at"),
        lead.sort_values(["available_at", "lead_arrived_at"], kind="stable"),  # 동시에 확인되면 가장 최근 도착
        left_on="observed_at", right_on="available_at", by=["route", "target_seq"],
        tolerance=pd.Timedelta(minutes=LEAD_MAX_AGE_MINUTES),
    )
    merged["lead_age_minutes"] = (merged["observed_at"] - merged["lead_arrived_at"]).dt.total_seconds() / 60
    return merged.drop(columns=["available_at", "lead_arrived_at"])


def demand_table(stops: pd.DataFrame, profile: pd.DataFrame) -> pd.DataFrame:
    """노선 × 요일유형 × 시간대 × 순번의 평소 승하차와 그 누적합."""
    keys = profile[["day_type", "hour"]].drop_duplicates()
    grid = stops[["route", "station_seq", "station_id"]].merge(keys, how="cross")
    grid = grid.merge(profile[["route", "station_id", "day_type", "hour", "boardings", "alightings"]],
                      how="left", on=["route", "station_id", "day_type", "hour"]).fillna({"boardings": 0, "alightings": 0})
    grid = grid.sort_values(["route", "day_type", "hour", "station_seq"])
    running = grid.groupby(["route", "day_type", "hour"])
    grid["cum_boardings"] = running["boardings"].cumsum()
    grid["cum_alightings"] = running["alightings"].cumsum()
    return grid.drop(columns="station_id")


def add_demand(samples: pd.DataFrame, demand: pd.DataFrame) -> pd.DataFrame:
    """목표 정류장의 평소 승하차와 현재 위치 ~ 목표 직전 구간의 평소 승하차 합."""
    keys = ["route", "day_type", "hour"]
    at_target = demand.rename(columns={
        "station_seq": "target_seq", "boardings": "target_boardings", "alightings": "target_alightings",
        "cum_boardings": "target_cum_boardings", "cum_alightings": "target_cum_alightings"})
    at_current = demand.rename(columns={"station_seq": "current_seq", "cum_boardings": "current_cum_boardings",
                                        "cum_alightings": "current_cum_alightings"}).drop(columns=["boardings", "alightings"])
    samples = samples.merge(at_target, how="left", on=keys + ["target_seq"])
    samples = samples.merge(at_current, how="left", on=keys + ["current_seq"])
    # 도착 시 잔여석이므로 목표 정류장 자신의 승하차는 구간 합에서 뺀다
    samples["between_boardings"] = (samples["target_cum_boardings"] - samples["target_boardings"]
                                    - samples["current_cum_boardings"]).fillna(0)
    samples["between_alightings"] = (samples["target_cum_alightings"] - samples["target_alightings"]
                                     - samples["current_cum_alightings"]).fillna(0)
    samples[["target_boardings", "target_alightings"]] = samples[["target_boardings", "target_alightings"]].fillna(0)
    return samples.drop(columns=["target_cum_boardings", "target_cum_alightings", "current_cum_boardings",
                                 "current_cum_alightings"])


def add_targets(samples: pd.DataFrame) -> pd.DataFrame:
    samples["seats_mid"] = (samples["seats_low"] + samples["seats_high"]) / 2
    samples["seats_delta"] = samples["seats_mid"] - samples["current_seats"]
    samples["split"] = assign_split(samples["service_date"])
    return samples


def main():
    observations = pd.read_parquet(RAW_DIR / "bus_observation.parquet")
    events = pd.read_parquet(INTERIM_DIR / "arrival_events.parquet")
    stops = pd.read_parquet(INTERIM_DIR / "stops.parquet")
    profile = pd.read_parquet(INTERIM_DIR / "boarding_profile.parquet")

    names = {route.route_id: route.name for route in ROUTES}
    trips = assign_trips(observations)
    trips["route"] = trips["route_id"].map(names)
    trips = with_fleet(trips)

    samples = base_samples(trips, events, stops)
    samples = add_time(samples)
    samples = add_lead(samples, events)
    samples = add_demand(samples, demand_table(stops, profile))
    samples = add_targets(samples)

    samples.to_parquet(INTERIM_DIR / "samples.parquet", index=False)
    print(f"샘플 {len(samples):,}개, 특징 포함 {samples.shape[1]}열, 애매한 라벨 {samples['ambiguous'].mean():.1%}")
    print(samples["split"].value_counts(dropna=False).to_dict())


if __name__ == "__main__":
    main()
