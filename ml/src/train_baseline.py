"""기준선 모델 (README 6장 모델 0).

입력: data/interim/samples.parquet
출력: data/predictions/{frequency,current_stage}.parquet

frequency      같은 노선·정류장·요일유형·30분 구간의 과거 단계 비율. 칸이 비면 상위 묶음으로 메운다
current_stage  지금 잔여석의 단계가 도착 때도 그대로라고 답한다
"""
import argparse
from datetime import date

import numpy as np
import pandas as pd

from .build_trips import stage_of
from .config import INTERIM_DIR, SPLITS, STAGE_MIN_SEATS
from .evaluate import save_predictions
from .split import train_eval

N_STAGES = len(STAGE_MIN_SEATS)
SMOOTHING = 5  # 상위 묶음의 비율을 표본 몇 개만큼으로 칠지
LEVELS = (
    ["route"],
    ["route", "target_seq"],
    ["route", "target_seq", "day_type"],
    ["route", "target_seq", "day_type", "half_hour"],
)
CURRENT_STAGE_CONFIDENCE = 0.97


def frequency_probabilities(train: pd.DataFrame, evaluation: pd.DataFrame) -> np.ndarray:
    # 같은 운행의 같은 도착이 관측마다 여러 번 세어지지 않게 한다
    events = train.drop_duplicates(["trip_id", "target_seq", "half_hour"])
    stages = events["stage"].astype(int)
    probabilities = np.tile(np.bincount(stages, minlength=N_STAGES) / len(stages), (len(evaluation), 1))
    for keys in LEVELS:
        counts = pd.crosstab([events[key] for key in keys], stages).reindex(columns=range(N_STAGES), fill_value=0)
        matched = evaluation[keys].merge(counts.reset_index(), how="left", on=keys)[list(range(N_STAGES))]
        matched = matched.fillna(0).to_numpy()
        totals = matched.sum(axis=1, keepdims=True)
        probabilities = (matched + SMOOTHING * probabilities) / (totals + SMOOTHING)
    return probabilities


def current_stage_probabilities(evaluation: pd.DataFrame) -> np.ndarray:
    rest = (1 - CURRENT_STAGE_CONFIDENCE) / (N_STAGES - 1)
    probabilities = np.full((len(evaluation), N_STAGES), rest)
    probabilities[np.arange(len(evaluation)), stage_of(evaluation["current_seats"])] = CURRENT_STAGE_CONFIDENCE
    return probabilities


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-end", type=date.fromisoformat, default=SPLITS["train"][1])
    args = parser.parse_args()

    samples = pd.read_parquet(INTERIM_DIR / "samples.parquet")
    train, evaluation = train_eval(samples, args.train_end)
    print(f"학습 {len(train):,}개, 평가 {len(evaluation):,}개")
    if evaluation.empty:
        raise SystemExit("평가할 데이터가 없습니다. --train-end 를 앞당기세요")

    save_predictions("frequency", evaluation, frequency_probabilities(train, evaluation))
    save_predictions("current_stage", evaluation, current_stage_probabilities(evaluation))


if __name__ == "__main__":
    main()
