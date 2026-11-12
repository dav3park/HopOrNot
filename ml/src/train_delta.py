"""좌석 변화량 회귀 (README 6장 모델 5).

입력: data/interim/samples.parquet, data/interim/stops.parquet
출력: data/predictions/delta.parquet

LightGBM 회귀로 현재 → 도착 잔여석 변화량(seats_delta)을 예측한다.
학습 기간 마지막 날(조기 종료용으로 뗀 부분)의 잔차를 몇 정거장 앞인지별로 모아,
예측 좌석 = 현재 잔여석 + 예측 변화량 + 잔차 분포로 단계별 확률을 구한다. 0 이하는 만석으로 모인다.
"""
import argparse
from datetime import date

import lightgbm as lgb
import numpy as np
import pandas as pd

from .config import INTERIM_DIR, SPLITS, STAGE_MIN_SEATS
from .evaluate import save_predictions
from .features import model_inputs
from .split import sample_weights, train_eval
from .train_lgbm import EARLY_STOPPING_ROUNDS, MAX_ROUNDS, holdout

PARAMS = {
    "objective": "huber",  # 승하차가 몰린 운행의 큰 변화량에 덜 끌려가게 한다
    "alpha": 5.0,
    "learning_rate": 0.05,
    "num_leaves": 31,
    "min_data_in_leaf": 50,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "verbose": -1,
    "seed": 0,
}
AHEAD_BINS = [0, 3, 10, np.inf]  # 잔차 분포를 나누는 몇 정거장 앞 구간 (1–3 / 4–10 / 11 이상)
# 단계 경계 (연속값 기준): 0.5 미만 0석, 4.5 미만 1–4석, 9.5 미만 5–9석
STAGE_EDGES = np.array(STAGE_MIN_SEATS[1:]) - 0.5


def dataset(samples, stops, reference=None):
    return lgb.Dataset(model_inputs(samples, stops), samples["seats_delta"], weight=sample_weights(samples),
                       reference=reference)


def ahead_bin(samples: pd.DataFrame) -> np.ndarray:
    return np.digitize(samples["stops_ahead"].to_numpy(), AHEAD_BINS[1:-1], right=True)


def stage_probabilities(predicted_seats: np.ndarray, bins: np.ndarray, residuals: dict[int, np.ndarray]) -> np.ndarray:
    """P(예측 좌석 + 잔차 < 경계)를 정렬된 잔차의 searchsorted로 구한다."""
    below = np.zeros((len(predicted_seats), len(STAGE_EDGES)))
    for b, errors in residuals.items():
        rows = bins == b
        for k, edge in enumerate(STAGE_EDGES):
            below[rows, k] = np.searchsorted(errors, edge - predicted_seats[rows], side="left") / len(errors)
    cumulative = np.column_stack([below, np.ones(len(predicted_seats))])
    return np.diff(cumulative, axis=1, prepend=0.0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-end", type=date.fromisoformat, default=SPLITS["train"][1])
    args = parser.parse_args()

    samples = pd.read_parquet(INTERIM_DIR / "samples.parquet")
    stops = pd.read_parquet(INTERIM_DIR / "stops.parquet")
    train, evaluation = train_eval(samples, args.train_end)
    if evaluation.empty:
        raise SystemExit("평가할 데이터가 없습니다. --train-end 를 앞당기세요")

    fit_part, stop_part = holdout(train)
    fit_set = dataset(fit_part, stops)
    booster = lgb.train(PARAMS, fit_set, MAX_ROUNDS, valid_sets=[dataset(stop_part, stops, fit_set)],
                        callbacks=[lgb.early_stopping(EARLY_STOPPING_ROUNDS, verbose=False)])
    rounds = booster.best_iteration

    # 잔차는 학습에 쓰지 않은 부분에서 잰다. 그래야 실제 오차 크기가 나온다
    held_pred = stop_part["current_seats"].to_numpy() + booster.predict(model_inputs(stop_part, stops))
    held_error = stop_part["seats_mid"].to_numpy() - held_pred
    held_bins = ahead_bin(stop_part)
    residuals = {b: np.sort(held_error[held_bins == b]) for b in np.unique(held_bins)}
    print(f"반복 {rounds}회, 뗀 부분 MAE {np.abs(held_error).mean():.2f}석, "
          + ", ".join(f"구간{b} 잔차 표준편차 {r.std():.2f}" for b, r in residuals.items()))

    booster = lgb.train(PARAMS, dataset(train, stops), rounds)
    predicted = evaluation["current_seats"].to_numpy() + booster.predict(model_inputs(evaluation, stops))
    print(f"평가 MAE {np.abs(evaluation['seats_mid'].to_numpy() - predicted).mean():.2f}석")
    save_predictions("delta", evaluation, stage_probabilities(predicted, ahead_bin(evaluation), residuals))
    print(f"학습 {len(train):,}개, 평가 {len(evaluation):,}개")


if __name__ == "__main__":
    main()
