"""대기 인원 모델과 "내가 앉을 확률" (DECISIONS.md 실제 탑승 확률 B안).

입력: data/interim/{arrival_events,boarding_profile,samples}.parquet, data/predictions/lgbm.parquet
출력: data/interim/boardings.parquet (버스 1대당 탑승 인원), models/waiting.json (모델 계수),
      models/waiting_cells.parquet (정류장·시간대별 칸 보정, 실시간 추론용)

    P(내가 앉음) = Σ_s P(도착 잔여석 = s) × P(내 앞 인원 < s)

내 앞 인원 = 앞차 이후 새로 온 사람 + 앞차가 만석으로 떠났으면 남은 사람. 음이항 분포로 둔다.

    E[새로 온 사람] = exp(a_구역 + γ·log(2025 분당 승차율 × 앞차 이후 경과 분)) × 칸 보정
    E[남은 사람]   = β × E[앞차 대기 인원 − 앞차 도착 잔여석 | 앞차 대기 인원 ≥ 앞차 도착 잔여석]
    E[내 앞 인원]  = E[새로 온 사람] + E[남은 사람]

- 앞차 대기 인원은 같은 "새로 온 사람" 모델로 앞차 자신의 경과 시간에서 구한다. 만석으로 떠났다는 것은
  대기 인원 ≥ 도착 잔여석이라는 뜻이므로 그 조건부 기댓값에서 잔여석을 뺀 만큼이 남는다.
  앞차의 앞차가 남긴 사람은 더 따지지 않는다 (한 단계만).
- β는 남은 사람 중 다음 차를 계속 기다리는 비율이다 (다른 노선, 포기). 0 ≤ β ≤ 1로 묶는다.
- 칸 보정은 관측/예측 비율이므로 그대로 곱한다 (지수 1). 지수를 자유롭게 두면 2.7이 나와 보정 1.5배가 3배로
  커지고, β도 1.76으로 1을 넘어 "내 앞 86명" 같은 값이 나왔다 (DECISIONS.md 남은 사람 더하기).
- 학습: (1) 앞차가 정상 출발한 경우만으로 새로 온 사람 모델과 칸 보정을 배운다 (남은 사람이 섞이지 않음).
        (2) 그 모델을 고정하고 전체로 β와 분산을 배운다.

칸 보정은 2026 학습 기간에 노선·정류장·시간대마다 실제 탑승 합 / 1단계 예측 합이고, 관측이 적은 칸은
CELL_SMOOTHING 명만큼 1배 쪽으로 당긴다. 만석으로 떠난 버스는 Y ≥ 관측값으로 다룬다 (중도 절단).
탑승 인원은 도착 잔여석 − 다음 정류장 도착 잔여석이므로, 2025 하차가 승차의 ONE_WAY_RATIO 이하인
정류장·시간만 쓴다.

이전 방식(앞차 만석이면 평균에 ×e^b를 곱함)은 혼잡 정류장에서 "내 앞 83명" 같은 값을 내서 바꿨다.
같은 평가에서 비교하려고 legacy_* 로 남긴다.
"""
import argparse
import json
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
from scipy import optimize, stats

from .config import INTERIM_DIR, MODELS_DIR, ONE_WAY_RATIO, PREDICTIONS_DIR, SPLITS, STAGE_MIN_SEATS

ZONES = ("출발권", "서울권")  # 승차가 대부분인 구역
MAX_ELAPSED_MINUTES = 60
FIRST_BUS_ELAPSED_MINUTES = 15  # 앞차가 그날 첫 차라 그 앞 간격을 모를 때
MIN_RATE_PER_MINUTE = 0.005
CELL = ["route", "station_id", "hour"]
CELL_SMOOTHING = 20  # 칸 보정에서 1단계 예측을 몇 명분으로 칠지
MAX_WAITING = 400    # 남은 사람 기댓값을 계산할 때 대기 인원 상한
BETA_BOUNDS = (0.0, 1.0)
THETA_NAMES = ["a_출발권", "a_서울권", "γ (승차율×경과)", "c (칸 보정, 1 고정)"]


@dataclass
class WaitingModel:
    theta: np.ndarray  # 새로 온 사람 모델 계수 (THETA_NAMES)
    k_arrival: float   # 새로 온 사람 분산 계수 (앞차 대기 인원 계산에 씀)
    beta: float        # 남은 사람 중 계속 기다리는 비율
    k: float           # 내 앞 인원 전체의 분산 계수

    def to_json(self) -> dict:
        return {"theta": dict(zip(THETA_NAMES, map(float, self.theta))), "k_arrival": self.k_arrival,
                "beta": self.beta, "k": self.k}

    @classmethod
    def from_json(cls, value: dict) -> "WaitingModel":
        return cls(np.array([value["theta"][n] for n in THETA_NAMES]), value["k_arrival"], value["beta"], value["k"])


def day_type_of(local: pd.Series) -> np.ndarray:
    """대기 모델의 요일유형. 학습과 실시간 추론이 같은 규칙을 쓴다."""
    return np.where(local.dt.day_of_week < 5, "평일", np.where(local.dt.day_of_week == 5, "토요일", "일요일·공휴일"))


def boarding_events() -> pd.DataFrame:
    """버스 1대 × 정류장마다 탑승 인원, 앞차 이후 경과 시간, 앞차의 상태(만석 출발, 도착 잔여석, 그 앞 간격)."""
    events = pd.read_parquet(INTERIM_DIR / "arrival_events.parquet").sort_values(["trip_id", "station_seq"])
    exact = events["seats_low"] == events["seats_high"]
    following = events.groupby("trip_id")[["seats_low"]].shift(-1)
    events["departure_seats"] = following["seats_low"].where(exact.groupby(events["trip_id"]).shift(-1, fill_value=False))
    events["exact"] = exact
    events["boarded"] = events["seats_low"] - events["departure_seats"]
    events["left_full"] = events["departure_seats"] == 0

    local = events["arrived_at"].dt.tz_convert("Asia/Seoul")
    events["hour"] = local.dt.hour
    events["day_type"] = day_type_of(local)
    profile = pd.read_parquet(INTERIM_DIR / "boarding_profile.parquet")
    events = events.merge(profile[["route", "station_id", "day_type", "hour", "boardings", "alightings"]],
                          how="left", on=["route", "station_id", "day_type", "hour"])
    events[["boardings", "alightings"]] = events[["boardings", "alightings"]].fillna(0)
    events["rate"] = np.maximum(events["boardings"] / 60, MIN_RATE_PER_MINUTE)

    # 같은 노선·정류장·운행일의 바로 앞 버스
    events = events.sort_values(["route", "station_seq", "arrived_at"]).reset_index(drop=True)
    previous = events.groupby(["route", "station_seq", "service_date"])
    events["elapsed"] = (events["arrived_at"] - previous["arrived_at"].shift(1)).dt.total_seconds() / 60
    events["prev_left_full"] = previous["left_full"].shift(1).fillna(False).astype(bool)
    events["prev_seats"] = previous["seats_low"].shift(1)
    events["prev_elapsed"] = previous["elapsed"].shift(1).fillna(FIRST_BUS_ELAPSED_MINUTES).clip(0.5, MAX_ELAPSED_MINUTES)
    events["prev_rate"] = previous["rate"].shift(1)
    events["prev_hour"] = previous["hour"].shift(1)

    usable = (exact & events["departure_seats"].notna() & events["zone"].isin(ZONES)
              & events["elapsed"].between(0.5, MAX_ELAPSED_MINUTES)
              & (events["alightings"] <= ONE_WAY_RATIO * events["boardings"]) & (events["boarded"] >= 0))
    return events[usable].reset_index(drop=True)


# ---------- 새로 온 사람 ----------

def arrival_design(zone, rate, elapsed, cell_ratio) -> np.ndarray:
    zone = np.asarray(zone)
    return np.column_stack([(zone == ZONES[0]).astype(float), (zone == ZONES[1]).astype(float),
                            np.log(np.asarray(rate, float) * np.asarray(elapsed, float)),
                            np.log(np.asarray(cell_ratio, float))])


def arrival_mean(theta: np.ndarray, frame: pd.DataFrame, prefix: str = "") -> np.ndarray:
    """prefix='prev_' 면 앞차가 도착할 때까지의 대기 인원."""
    cell = frame[f"{prefix}cell_ratio"] if f"{prefix}cell_ratio" in frame else np.ones(len(frame))
    return np.exp(arrival_design(frame["zone"], frame[f"{prefix}rate"], frame[f"{prefix}elapsed"], cell) @ theta)


def nb_loglik(mu, k, y, censored) -> np.ndarray:
    p = k / (k + mu)
    return np.where(censored, stats.nbinom.logsf(y - 1, k, p), stats.nbinom.logpmf(y, k, p))  # 절단이면 P(Y ≥ y)


def fit_arrival(frame: pd.DataFrame, with_cell: bool) -> tuple[np.ndarray, float]:
    """with_cell이면 칸 보정을 계수 1로 곱한다 (오프셋)."""
    y, censored = frame["boarded"].to_numpy(), frame["left_full"].to_numpy()
    x = arrival_design(frame["zone"], frame["rate"], frame["elapsed"],
                       frame["cell_ratio"] if with_cell else np.ones(len(frame)))
    offset, x = x[:, 3], x[:, :3]

    def loss(params):
        return -nb_loglik(np.exp(x @ params[:-1] + offset), np.exp(params[-1]), y, censored).sum()
    start = np.r_[np.log(max(y.mean(), 1)), np.log(max(y.mean(), 1)), 1.0, 0.0]
    params = optimize.minimize(loss, start, method="L-BFGS-B").x
    return np.r_[params[:-1], 1.0 if with_cell else 0.0], float(np.exp(params[-1]))


def cell_ratios(train: pd.DataFrame, theta: np.ndarray) -> pd.Series:
    """1단계 모델(칸 보정 없음)이 칸마다 얼마나 틀렸는지. 관측이 적으면 1배 쪽으로."""
    expected = train.assign(mu=arrival_mean(theta, train.drop(columns="cell_ratio", errors="ignore")))
    expected = expected.groupby(CELL)[["boarded", "mu"]].sum()
    return ((expected["boarded"] + CELL_SMOOTHING) / (expected["mu"] + CELL_SMOOTHING)).rename("cell_ratio")


def with_cells(frame: pd.DataFrame, ratios: pd.Series) -> pd.DataFrame:
    frame = frame.drop(columns=["cell_ratio", "prev_cell_ratio"], errors="ignore")
    frame = frame.join(ratios, on=CELL)
    prev = ratios.rename("prev_cell_ratio").rename_axis(["route", "station_id", "prev_hour"])
    frame = frame.join(prev, on=["route", "station_id", "prev_hour"])
    return frame.assign(cell_ratio=frame["cell_ratio"].fillna(1.0), prev_cell_ratio=frame["prev_cell_ratio"].fillna(1.0))


# ---------- 남은 사람 ----------

def expected_leftover(prev_mu: np.ndarray, prev_seats: np.ndarray, k: float) -> np.ndarray:
    """E[D − S | D ≥ S], D ~ 음이항(prev_mu, k): 앞차를 못 탄 인원의 기댓값."""
    d = np.arange(MAX_WAITING + 1)
    p = (k / (k + prev_mu))[:, None]
    pmf = stats.nbinom.pmf(d[None, :], k, p)
    tail = d[None, :] >= prev_seats[:, None]
    mass = (pmf * tail).sum(axis=1)
    mean_tail = (pmf * tail * d[None, :]).sum(axis=1) / np.where(mass > 0, mass, 1)
    return np.where(mass > 1e-12, np.maximum(mean_tail - prev_seats, 0), 0.5)


def leftover_term(model_theta: np.ndarray, k_arrival: float, frame: pd.DataFrame) -> np.ndarray:
    full = frame["prev_left_full"].to_numpy(bool)
    result = np.zeros(len(frame))
    if full.any():
        part = frame[full]
        result[full] = expected_leftover(arrival_mean(model_theta, part, "prev_"), part["prev_seats"].to_numpy(float), k_arrival)
    return result


def expected_ahead(model: WaitingModel, frame: pd.DataFrame) -> np.ndarray:
    """E[내 앞 인원] = 새로 온 사람 + β × 앞차가 남긴 사람."""
    return arrival_mean(model.theta, frame) + model.beta * leftover_term(model.theta, model.k_arrival, frame)


def fit(train: pd.DataFrame) -> tuple[WaitingModel, pd.Series]:
    clean = train[~train["prev_left_full"]]
    theta0, _ = fit_arrival(clean, with_cell=False)
    ratios = cell_ratios(clean, theta0)
    clean = with_cells(clean, ratios)
    theta, k_arrival = fit_arrival(clean, with_cell=True)

    train = with_cells(train, ratios)
    base = arrival_mean(theta, train)
    leftover = leftover_term(theta, k_arrival, train)
    y, censored = train["boarded"].to_numpy(), train["left_full"].to_numpy()

    def loss(params):
        return -nb_loglik(base + params[0] * leftover, np.exp(params[1]), y, censored).sum()
    beta, log_k = optimize.minimize(loss, [0.5, np.log(k_arrival)], method="L-BFGS-B",
                                    bounds=[BETA_BOUNDS, (-3, 5)]).x
    return WaitingModel(theta, k_arrival, float(beta), float(np.exp(log_k))), ratios


# ---------- 이전 방식 (비교용) ----------

def legacy_design(frame: pd.DataFrame) -> np.ndarray:
    columns = [(frame["zone"] == ZONES[0]).astype(float), (frame["zone"] == ZONES[1]).astype(float),
               np.log(frame["rate"] * frame["elapsed"]), frame["prev_left_full"].astype(float)]
    if "legacy_cell" in frame:
        columns.append(np.log(frame["legacy_cell"]))
    return np.column_stack(columns)


def legacy_fit(train: pd.DataFrame, evaluation: pd.DataFrame):
    """앞차 만석이면 평균에 ×e^b (이전 방식)."""
    def fit_once(frame):
        x, y, censored = legacy_design(frame), frame["boarded"].to_numpy(), frame["left_full"].to_numpy()
        start = np.r_[np.log(max(y.mean(), 1)), np.log(max(y.mean(), 1)), 1.0, np.zeros(x.shape[1] - 3), 0.0]
        return optimize.minimize(lambda p: -nb_loglik(np.exp(x @ p[:-1]), np.exp(p[-1]), y, censored).sum(),
                                 start, method="L-BFGS-B").x
    first = fit_once(train)
    sums = train.assign(mu=np.exp(legacy_design(train) @ first[:-1])).groupby(CELL)[["boarded", "mu"]].sum()
    ratio = ((sums["boarded"] + CELL_SMOOTHING) / (sums["mu"] + CELL_SMOOTHING)).rename("legacy_cell")
    add = lambda f: f.join(ratio, on=CELL).assign(legacy_cell=lambda g: g["legacy_cell"].fillna(1.0))
    params = fit_once(add(train))
    return (lambda f: np.exp(legacy_design(add(f)) @ params[:-1])), float(np.exp(params[-1])), params


# ---------- 좌석과 합치기 ----------

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


# ---------- 평가 ----------

def naive_means(frame: pd.DataFrame, train: pd.DataFrame) -> np.ndarray:
    means = frame.join(train.groupby(CELL)["boarded"].mean().rename("naive"), on=CELL)["naive"]
    return means.fillna(train["boarded"].mean()).clip(lower=0.1).to_numpy()


def fit_k(train: pd.DataFrame, mu: np.ndarray) -> float:
    y, censored = train["boarded"].to_numpy(), train["left_full"].to_numpy()
    loss = lambda log_k: -nb_loglik(mu, np.exp(log_k), y, censored).sum()
    return float(np.exp(optimize.minimize_scalar(loss, bounds=(-3, 5), method="bounded").x))


def calibration_table(predicted: np.ndarray, actual: np.ndarray) -> tuple[float, pd.DataFrame]:
    bins = pd.cut(predicted, [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0], include_lowest=True)
    table = pd.DataFrame({"n": pd.Series(actual).groupby(bins, observed=False).size(),
                          "예측": pd.Series(predicted).groupby(bins, observed=False).mean().round(2),
                          "실제": pd.Series(actual).groupby(bins, observed=False).mean().round(2)})
    return float(((predicted - actual) ** 2).mean()), table


def near_predictions(evaluation: pd.DataFrame) -> pd.DataFrame:
    """평가 도착마다 LightGBM이 1–3정거장 앞에서 낸 가장 가까운 예측."""
    predictions = pd.read_parquet(PREDICTIONS_DIR / "lgbm.parquet")
    samples = pd.read_parquet(INTERIM_DIR / "samples.parquet", columns=["route", "veh_id", "observed_at", "target_seq", "trip_id"])
    predictions = predictions.merge(samples, on=["route", "veh_id", "observed_at", "target_seq"])
    near = predictions[predictions["stops_ahead"].between(1, 3)].sort_values("stops_ahead")
    near = near.drop_duplicates(["trip_id", "target_seq"])
    columns = [f"p{s}" for s in range(len(STAGE_MIN_SEATS))]
    return evaluation.merge(near[["trip_id", "target_seq", *columns]],
                            left_on=["trip_id", "station_seq"], right_on=["trip_id", "target_seq"])


def report(name: str, evaluation: pd.DataFrame, joined: pd.DataFrame, mean_fn, k: float, shapes) -> dict:
    y, censored = evaluation["boarded"].to_numpy(), evaluation["left_full"].to_numpy()
    mu = mean_fn(evaluation)
    p = k / (k + mu)
    prev_full = evaluation["prev_left_full"].to_numpy()
    lo, hi = stats.nbinom.ppf(0.1, k, p), stats.nbinom.ppf(0.9, k, p)
    seat_probs = seat_distribution(joined[[f"p{s}" for s in range(len(STAGE_MIN_SEATS))]].to_numpy(), shapes)
    p_full = 1 - seat_probability(seat_probs, mean_fn(joined), k)
    brier, table = calibration_table(p_full, joined["left_full"].to_numpy())
    joined_prev = joined["prev_left_full"].to_numpy()
    brier_prev, table_prev = calibration_table(p_full[joined_prev], joined["left_full"].to_numpy()[joined_prev])
    print(f"\n##### {name}")
    print(f"  전체 {len(y):,}개: 로그우도 {nb_loglik(mu, k, y, censored).mean():.3f}, "
          f"MAE(만석 출발 제외) {np.abs(y - mu)[~censored].mean():.2f}명, 80% 구간 적중 {((y >= lo) & (y <= hi))[~censored].mean():.0%}")
    print(f"  앞차 만석 {prev_full.sum():,}개: 로그우도 {nb_loglik(mu, k, y, censored)[prev_full].mean():.3f}, "
          f"예측 평균 {mu[prev_full].mean():.1f}명 / 관측 평균 {y[prev_full].mean():.1f}명 (이 중 만석 출발 {censored[prev_full].mean():.0%}, 실제는 더 많음), "
          f"예측 최대 {mu[prev_full].max():.0f}명")
    print(f"  끝까지 만석 출발 확률 Brier {brier:.3f}\n{table.T.to_string()}")
    print(f"  └ 앞차 만석인 경우만 ({joined_prev.sum()}개) Brier {brier_prev:.3f}\n{table_prev.T.to_string()}")
    return {"name": name, "brier": brier, "brier_prev": brier_prev}


def example(model: WaitingModel, ratios: pd.Series, evaluation: pd.DataFrame, shapes):
    case = evaluation[(evaluation["station_name"] == "광교") & (evaluation["hour"] == 18)]
    if case.empty:
        return
    row = case.iloc[0]
    cell = float(ratios.get((row["route"], row["station_id"], 18), 1.0))
    print(f"\n예시: M5107 광교 18시 (2025 승차율 {row['rate'] * 60:.0f}명/시간), 버스가 10석 남아 도착할 때")
    seat_probs = np.zeros((1, 11)); seat_probs[0, 10] = 1
    cases = [("앞차 정상 출발", False, 0), ("앞차가 10석으로 와서 만석 출발", True, 10), ("앞차가 0석으로 와서 만석 출발", True, 0)]
    for label, full, prev_seats in cases:
        cells = []
        for elapsed in (2, 5, 10, 15):
            frame = pd.DataFrame({"zone": ["서울권"], "rate": [row["rate"]], "elapsed": [elapsed], "cell_ratio": [cell],
                                  "prev_left_full": [full], "prev_seats": [prev_seats], "prev_rate": [row["rate"]],
                                  "prev_elapsed": [10.0], "prev_cell_ratio": [cell]})
            mu = expected_ahead(model, frame)
            cells.append(f"{elapsed}분 {seat_probability(seat_probs, mu, model.k)[0]:.0%} (앞 {mu[0]:.0f}명)")
        print(f"  {label} (앞차 간격 10분): " + ", ".join(cells))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-end", type=date.fromisoformat, default=SPLITS["train"][1])
    args = parser.parse_args()

    events = boarding_events()
    events.to_parquet(INTERIM_DIR / "boardings.parquet", index=False)
    open_days = events["service_date"] < SPLITS["test"][0]
    train = events[open_days & (events["service_date"] <= args.train_end)]
    evaluation = events[open_days & (events["service_date"] > args.train_end)]
    print(f"탑승 인원 표본: 학습 {len(train):,}개 (앞차 만석 {train['prev_left_full'].sum():,}), "
          f"평가 {len(evaluation):,}개 (앞차 만석 {evaluation['prev_left_full'].sum():,})")

    model, ratios = fit(train)
    train, evaluation = with_cells(train, ratios), with_cells(evaluation, ratios)
    print("계수", {n: round(float(v), 3) for n, v in zip(THETA_NAMES, model.theta)},
          f"β {model.beta:.2f} (남은 사람 중 다음 차를 기다리는 비율), k {model.k:.2f}, 새로 온 사람 k {model.k_arrival:.2f}")

    capacity = int(events["seats_low"].max())
    shapes = within_stage_shapes(train, capacity)
    joined = near_predictions(evaluation)
    legacy_mean, legacy_k, legacy_params = legacy_fit(train, evaluation)
    print(f"이전 방식 계수: 앞차 만석이면 ×{np.exp(legacy_params[3]):.2f}")
    naive_k = fit_k(train, naive_means(train, train))
    report("남은 사람 더하기 (새 방식)", evaluation, joined, lambda f: expected_ahead(model, f), model.k, shapes)
    report("앞차 만석이면 곱하기 (이전 방식)", evaluation, joined, legacy_mean, legacy_k, shapes)
    report("과거 평균 (노선·정류장·시간)", evaluation, joined, lambda f: naive_means(f, train), naive_k, shapes)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    ratios.reset_index().to_parquet(MODELS_DIR / "waiting_cells.parquet", index=False)
    (MODELS_DIR / "waiting.json").write_text(json.dumps({
        **model.to_json(), "zones": ZONES, "train_end": str(args.train_end),
        "within_stage": {int(s): v.tolist() for s, v in shapes.items()}}, ensure_ascii=False, indent=1))
    example(model, ratios, evaluation, shapes)


if __name__ == "__main__":
    main()
