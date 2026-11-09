"""LightGBM 주 모델 (README 6장 모델 3).

입력: data/interim/samples.parquet, data/interim/stops.parquet
출력: models/lgbm.txt, data/predictions/lgbm.parquet

학습 기간의 마지막 날로 반복 횟수를 정한 뒤(조기 종료) 학습 기간 전체로 다시 학습한다.
학습 기간이 하루뿐이면 그날 늦게 시작한 운행을 대신 뗀다.
평가 기간은 반복 횟수를 정하는 데 쓰지 않는다.
"""
import argparse
from datetime import date

import lightgbm as lgb
import pandas as pd

from .config import INTERIM_DIR, MODELS_DIR, SPLITS, STAGE_MIN_SEATS
from .evaluate import save_predictions
from .features import model_inputs
from .split import sample_weights, train_eval

PARAMS = {
    "objective": "multiclass",
    "num_class": len(STAGE_MIN_SEATS),
    "learning_rate": 0.05,
    "num_leaves": 31,
    "min_data_in_leaf": 50,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "verbose": -1,
    "seed": 0,
}
MAX_ROUNDS = 2000
SAME_DAY_HOLDOUT = 0.25  # 학습 기간이 하루일 때 조기 종료용으로 뗄 운행 비율
EARLY_STOPPING_ROUNDS = 50


def dataset(samples: pd.DataFrame, stops: pd.DataFrame, reference=None) -> lgb.Dataset:
    return lgb.Dataset(model_inputs(samples, stops), samples["stage"].astype(int), weight=sample_weights(samples),
                       reference=reference)


def holdout(train: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """조기 종료용으로 학습 기간의 마지막 날, 하루뿐이면 늦게 시작한 운행을 뗀다."""
    last_day = train["service_date"].max()
    if train["service_date"].nunique() > 1:
        held = train["service_date"] == last_day
    else:
        starts = train.groupby("trip_id")["observed_at"].min().sort_values()
        late = starts.index[int(len(starts) * (1 - SAME_DAY_HOLDOUT)):]
        held = train["trip_id"].isin(late)
    return train[~held], train[held]


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
    history = {}
    booster = lgb.train(PARAMS, fit_set, MAX_ROUNDS, valid_sets=[fit_set, dataset(stop_part, stops, fit_set)],
                        valid_names=["train", "valid"],
                        callbacks=[lgb.early_stopping(EARLY_STOPPING_ROUNDS, verbose=False),
                                   lgb.record_evaluation(history)])
    rounds = booster.best_iteration
    print(f"조기 종료 기준 {stop_part['service_date'].min()}: 반복 {rounds}회, 학습 손실 {history['train']['multi_logloss'][rounds - 1]:.4f}, "
          f"검증 손실 {history['valid']['multi_logloss'][rounds - 1]:.4f}")

    booster = lgb.train(PARAMS, dataset(train, stops), rounds)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    booster.save_model(MODELS_DIR / "lgbm.txt")
    curve = pd.DataFrame(history["train"]).add_suffix("_train").join(pd.DataFrame(history["valid"]).add_suffix("_valid"))
    curve.to_csv(MODELS_DIR / "lgbm_curve.csv", index_label="round")

    save_predictions("lgbm", evaluation, booster.predict(model_inputs(evaluation, stops)))
    importance = pd.Series(booster.feature_importance("gain"), index=booster.feature_name())
    print("중요도 상위", (importance / importance.sum()).sort_values(ascending=False).head(6).round(3).to_dict())
    print(f"학습 {len(train):,}개, 평가 {len(evaluation):,}개")


if __name__ == "__main__":
    main()
