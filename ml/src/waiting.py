"""대기 인원 모델과 "내가 앉을 확률" (DECISIONS.md 실제 탑승 확률 B안).

입력: data/interim/{arrival_events,boarding_profile,samples}.parquet, data/predictions/lgbm.parquet
출력: data/interim/boardings.parquet (버스 1대당 탑승 인원), models/waiting.json (모델 계수)

    P(내가 앉음) = Σ_s P(도착 잔여석 = s) × P(내 앞 인원 < s)

내 앞 인원은 앞차가 떠난 뒤 내가 오기 전까지 온 사람(+ 앞차가 만석으로 떠났으면 남은 사람)이다.
버스 1대당 탑승 인원 Y를 음이항 분포로 둔다.

    log E[Y] = a_구역 + γ·log(2025 분당 승차율 × 앞차 이후 경과 분) + b·앞차 만석 출발 + c·log(칸 보정)

칸 보정은 2026 학습 기간에 노선·정류장·시간대마다 실제 탑승 합 / 1단계 모델 예측 합이다.
관측이 적은 칸은 CELL_SMOOTHING 명만큼 1배 쪽으로 당긴다.

만석으로 떠난 버스는 기다린 사람을 다 태우지 못했으므로 Y ≥ 관측값으로 다룬다 (중도 절단).
탑승 인원은 도착 잔여석 − 다음 정류장 도착 잔여석이다. 하차가 섞이면 틀리므로
2025 하차가 승차의 ONE_WAY_RATIO 이하인 정류장·시간만 쓴다.
"""
import argparse
import json
from datetime import date

import numpy as np
import pandas as pd
from scipy import optimize, stats

from .config import INTERIM_DIR, MODELS_DIR, ONE_WAY_RATIO, PREDICTIONS_DIR, SPLITS, STAGE_MIN_SEATS
from .split import service_date

ZONES = ("출발권", "서울권")  # 승차가 대부분인 구역
MAX_ELAPSED_MINUTES = 60
MIN_RATE_PER_MINUTE = 0.005
CELL = ["route", "station_id", "hour"]
CELL_SMOOTHING = 20  # 칸 보정에서 1단계 예측을 몇 명분으로 칠지


def boarding_events() -> pd.DataFrame:
    """버스 1대 × 정류장마다 탑승 인원, 앞차 이후 경과 시간, 앞차 만석 출발 여부."""
    events = pd.read_parquet(INTERIM_DIR / "arrival_events.parquet").sort_values(["trip_id", "station_seq"])
    exact = events["seats_low"] == events["seats_high"]
    following = events.groupby("trip_id")[["seats_low"]].shift(-1)
    events["departure_seats"] = following["seats_low"].where(exact.groupby(events["trip_id"]).shift(-1, fill_value=False))
    events["boarded"] = events["seats_low"] - events["departure_seats"]
    events["left_full"] = events["departure_seats"] == 0

    # 같은 노선·정류장·운행일의 바로 앞 버스
    events = events.sort_values(["route", "station_seq", "arrived_at"])
    previous = events.groupby(["route", "station_seq", "service_date"])
    events["elapsed"] = (events["arrived_at"] - previous["arrived_at"].shift(1)).dt.total_seconds() / 60
    events["prev_left_full"] = previous["left_full"].shift(1).fillna(False).astype(bool)

    local = events["arrived_at"].dt.tz_convert("Asia/Seoul")
    events["hour"] = local.dt.hour
    events["day_type"] = np.where(local.dt.day_of_week < 5, "평일", np.where(local.dt.day_of_week == 5, "토요일", "일요일·공휴일"))
    profile = pd.read_parquet(INTERIM_DIR / "boarding_profile.parquet")
    events = events.merge(profile[["route", "station_id", "day_type", "hour", "boardings", "alightings"]],
                          how="left", on=["route", "station_id", "day_type", "hour"])
    events[["boardings", "alightings"]] = events[["boardings", "alightings"]].fillna(0)
    events["rate"] = np.maximum(events["boardings"] / 60, MIN_RATE_PER_MINUTE)

    usable = (exact & events["departure_seats"].notna() & events["zone"].isin(ZONES)
              & events["elapsed"].between(0.5, MAX_ELAPSED_MINUTES)
              & (events["alightings"] <= ONE_WAY_RATIO * events["boardings"]) & (events["boarded"] >= 0))
    return events[usable].reset_index(drop=True)


def design(frame: pd.DataFrame) -> np.ndarray:
    columns = [
        (frame["zone"] == ZONES[0]).astype(float),
        (frame["zone"] == ZONES[1]).astype(float),
        np.log(frame["rate"] * frame["elapsed"]),
        frame["prev_left_full"].astype(float),
    ]
    if "cell_ratio" in frame:
        columns.append(np.log(frame["cell_ratio"]))
    return np.column_stack(columns)


def with_cell_ratio(frame: pd.DataFrame, train: pd.DataFrame, params: np.ndarray) -> pd.DataFrame:
    """1단계 모델(칸 보정 없음)이 칸마다 얼마나 틀렸는지를 학습 기간에서 재서 붙인다."""
    expected = train.assign(mu=mean_of(params, design(train))).groupby(CELL)[["boarded", "mu"]].sum()
    ratio = (expected["boarded"] + CELL_SMOOTHING) / (expected["mu"] + CELL_SMOOTHING)
    frame = frame.join(ratio.rename("cell_ratio"), on=CELL)
    return frame.assign(cell_ratio=frame["cell_ratio"].fillna(1.0))


def mean_of(params: np.ndarray, x: np.ndarray) -> np.ndarray:
    return np.exp(x @ params[:-1])


def log_likelihood(params, x, y, censored) -> np.ndarray:
    mu, k = mean_of(params, x), np.exp(params[-1])
    p = k / (k + mu)
    exact = stats.nbinom.logpmf(y, k, p)
    at_least = stats.nbinom.logsf(y - 1, k, p)  # P(Y ≥ y)
    return np.where(censored, at_least, exact)


def fit(frame: pd.DataFrame) -> np.ndarray:
    x, y, censored = design(frame), frame["boarded"].to_numpy(), frame["left_full"].to_numpy()
    start = np.r_[np.log(max(y.mean(), 1)), np.log(max(y.mean(), 1)), 1.0, np.zeros(x.shape[1] - 3), 0.0]
    result = optimize.minimize(lambda p: -log_likelihood(p, x, y, censored).sum(), start, method="L-BFGS-B")
    return result.x


def naive_params(train: pd.DataFrame) -> pd.Series:
    """비교 기준: 노선·정류장·시간대별 과거 평균 탑승 인원 (경과 시간, 앞차 상태 무시)."""
    return train.groupby(["route", "station_id", "hour"])["boarded"].mean()


def seat_distribution(stage_probabilities: np.ndarray, within: dict[int, np.ndarray]) -> np.ndarray:
    """단계 확률을 좌석 수 분포로 편다. 단계 안의 모양은 학습 기간의 실제 분포를 쓴다."""
    width = max(len(v) for v in within.values())
    seats = np.zeros((len(stage_probabilities), width))
    for stage, shape in within.items():
        seats[:, :len(shape)] += stage_probabilities[:, [stage]] * shape
    return seats


def seat_probability(seat_probs: np.ndarray, ahead_mu: np.ndarray, k: float) -> np.ndarray:
    """P(도착 잔여석 > 내 앞 인원). 내 앞 인원 n명이면 좌석이 n+1개 이상 있어야 한다."""
    s = np.arange(seat_probs.shape[1])
    p = (k / (k + ahead_mu))[:, None]
    below = stats.nbinom.cdf(s[None, :] - 1, k, p)  # P(N ≤ s−1) = P(N < s)
    return (seat_probs * below).sum(axis=1)


def within_stage_shapes(train_events: pd.DataFrame, capacity: int) -> dict[int, np.ndarray]:
    seats = train_events["seats_low"].astype(int).clip(0, capacity)
    edges = list(STAGE_MIN_SEATS) + [capacity + 1]
    shapes = {}
    for stage in range(len(STAGE_MIN_SEATS)):
        counts = np.bincount(seats[(seats >= edges[stage]) & (seats < edges[stage + 1])], minlength=capacity + 1)
        shapes[stage] = counts / max(counts.sum(), 1)
    return shapes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-end", type=date.fromisoformat, default=SPLITS["train"][1])
    args = parser.parse_args()

    events = boarding_events()
    events.to_parquet(INTERIM_DIR / "boardings.parquet", index=False)
    open_days = events["service_date"] < SPLITS["test"][0]
    train = events[open_days & (events["service_date"] <= args.train_end)]
    evaluation = events[open_days & (events["service_date"] > args.train_end)]
    print(f"탑승 인원 표본: 학습 {len(train):,}개, 평가 {len(evaluation):,}개 (만석 출발 {events['left_full'].mean():.0%})")

    first = fit(train)
    train, evaluation = with_cell_ratio(train, train, first), with_cell_ratio(evaluation, train, first)
    params = fit(train)
    k = float(np.exp(params[-1]))
    names = ["a_출발권", "a_서울권", "γ (승차율×경과)", "b (앞차 만석)", "c (칸 보정)", "log k"]
    print("계수", {n: round(float(v), 3) for n, v in zip(names, params)}, f"→ 앞차 만석이면 평균 ×{np.exp(params[3]):.2f}, 분산 계수 k={k:.2f}")

    capacity = int(events["seats_low"].max())
    shapes = within_stage_shapes(train, capacity)
    naive_mu_train, naive_mu_eval = naive_means(train, train), naive_means(evaluation, train)
    naive_k = fit_k(train, naive_mu_train)
    candidates = {
        "대기 모델": (mean_of(params, design(evaluation)), k, lambda f: mean_of(params, design(f))),
        "과거 평균 (노선·정류장·시간)": (naive_mu_eval, naive_k, lambda f: naive_means(f, train)),
    }
    y, censored = evaluation["boarded"].to_numpy(), evaluation["left_full"].to_numpy()
    for name, (mu, kk, mean_fn) in candidates.items():
        p = kk / (kk + mu)
        ll = np.where(censored, stats.nbinom.logsf(y - 1, kk, p), stats.nbinom.logpmf(y, kk, p)).mean()
        lo, hi = stats.nbinom.ppf(0.1, kk, p), stats.nbinom.ppf(0.9, kk, p)
        inside = ((y >= lo) & (y <= hi))[~censored].mean()
        print(f"\n##### {name}: 평균 로그우도 {ll:.3f}, 만석 아닌 출발 MAE {np.abs(y - mu)[~censored].mean():.2f}명, 80% 구간 적중 {inside:.0%}")
        # 도착 잔여석을 알 때 만석 출발 확률 = P(Y ≥ 도착 잔여석)
        print_calibration("도착 잔여석을 알 때 만석 출발 확률", stats.nbinom.sf(evaluation["seats_low"].to_numpy() - 1, kk, p), censored)
        # 끝까지: LightGBM 1–3정거장 앞 단계 확률 + 대기 인원
        end_to_end(evaluation, mean_fn, kk, shapes)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    (MODELS_DIR / "waiting.json").write_text(json.dumps({
        "params": dict(zip(names, map(float, params))), "zones": ZONES, "train_end": str(args.train_end),
        "within_stage": {int(s): v.tolist() for s, v in shapes.items()}}, ensure_ascii=False, indent=1))

    # 예시: 광교 퇴근, 앞차가 떠난 지 e분 뒤 도착한 사용자
    example(evaluation, params, k, shapes)


def naive_means(frame: pd.DataFrame, train: pd.DataFrame) -> np.ndarray:
    means = frame.join(naive_params(train).rename("naive"), on=CELL)["naive"]
    return means.fillna(train["boarded"].mean()).clip(lower=0.1).to_numpy()


def fit_k(train: pd.DataFrame, mu: np.ndarray) -> float:
    y, censored = train["boarded"].to_numpy(), train["left_full"].to_numpy()

    def loss(log_k):
        k = np.exp(log_k)
        p = k / (k + mu)
        return -np.where(censored, stats.nbinom.logsf(y - 1, k, p), stats.nbinom.logpmf(y, k, p)).sum()
    return float(np.exp(optimize.minimize_scalar(loss, bounds=(-3, 5), method="bounded").x))


def print_calibration(title: str, predicted: np.ndarray, actual: np.ndarray):
    bins = pd.cut(predicted, [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0], include_lowest=True)
    table = pd.DataFrame({"n": pd.Series(actual).groupby(bins, observed=False).size(),
                          "예측": pd.Series(predicted).groupby(bins, observed=False).mean().round(2),
                          "실제": pd.Series(actual).groupby(bins, observed=False).mean().round(2)})
    brier = ((predicted - actual) ** 2).mean()
    base = ((actual.mean() - actual) ** 2).mean()
    print(f"\n{title}: Brier {brier:.3f} (평균 비율만 쓸 때 {base:.3f})\n{table.T.to_string()}")


def end_to_end(evaluation: pd.DataFrame, mean_fn, k, shapes):
    predictions = pd.read_parquet(PREDICTIONS_DIR / "lgbm.parquet")
    samples = pd.read_parquet(INTERIM_DIR / "samples.parquet", columns=["route", "veh_id", "observed_at", "target_seq", "trip_id"])
    predictions = predictions.merge(samples, on=["route", "veh_id", "observed_at", "target_seq"])
    near = predictions[predictions["stops_ahead"].between(1, 3)].sort_values("stops_ahead")
    near = near.drop_duplicates(["trip_id", "target_seq"])  # 도착 직전에 가장 가까이서 낸 예측
    columns = [f"p{s}" for s in range(len(STAGE_MIN_SEATS))]
    joined = evaluation.merge(near[["trip_id", "target_seq", *columns]],
                              left_on=["trip_id", "station_seq"], right_on=["trip_id", "target_seq"])
    seat_probs = seat_distribution(joined[columns].to_numpy(), shapes)
    mu = mean_fn(joined)
    # 버스 도착 직전에 온 마지막 사람: 앉으면 만석이 아니거나 딱 맞게 찬 경우
    p_full = 1 - seat_probability(seat_probs, mu, k)
    print_calibration(f"끝까지 (LightGBM 1–3정거장 앞 + 대기 모델, {len(joined):,}개) 만석 출발 확률",
                      p_full, joined["left_full"].to_numpy())


def example(evaluation, params, k, shapes):
    case = evaluation[(evaluation["station_name"] == "광교") & (evaluation["hour"] == 18)]
    if case.empty:
        return
    rate = case["rate"].iloc[0]
    print(f"\n예시: M5107 광교 18시 (2025 승차율 {rate * 60:.0f}명/시간), 버스가 10석 남아 도착할 때")
    seat_probs = np.zeros((1, 11)); seat_probs[0, 10] = 1
    for prev_full in (False, True):
        cells = []
        for elapsed in (2, 5, 10, 15):
            frame = pd.DataFrame({"zone": ["서울권"], "rate": [rate], "elapsed": [elapsed], "prev_left_full": [prev_full],
                                  "cell_ratio": [case["cell_ratio"].iloc[0]]})
            mu = mean_of(params, design(frame))
            cells.append(f"{elapsed}분 {seat_probability(seat_probs, mu, k)[0]:.0%}")
        print(f"  앞차 만석 출발 {'예' if prev_full else '아니오'}: 앞차가 떠난 뒤 " + ", ".join(cells) + " 에 도착하면 앉을 확률")


if __name__ == "__main__":
    main()
