"""날짜 기준 학습·검증·테스트 분할과 롤링 평가 구간 (README 7장)."""
from datetime import date, timedelta

import pandas as pd

from .config import DAY_BOUNDARY_HOUR, SPLITS


def service_date(timestamps: pd.Series) -> pd.Series:
    """KST 시각을 운행일로 바꾼다. 새벽 3시 전 관측은 전날이다."""
    return (timestamps - pd.Timedelta(hours=DAY_BOUNDARY_HOUR)).dt.date


def assign_split(service_dates: pd.Series) -> pd.Series:
    """운행일별 train / val / test. 어느 구간에도 없으면 NaN."""
    result = pd.Series(pd.NA, index=service_dates.index, dtype="object")
    for name, (first, last) in SPLITS.items():
        result[(service_dates >= first) & (service_dates <= last)] = name
    return result


def train_eval(samples: pd.DataFrame, train_end: date) -> tuple[pd.DataFrame, pd.DataFrame]:
    """train_end까지 학습, 그 뒤를 평가에 쓴다. 테스트 기간은 어느 쪽에도 넣지 않는다.

    학습에서는 애매한 라벨을 뺀다. 평가 쪽은 evaluate.py가 거른다.
    """
    open_samples = samples[samples["split"] != "test"]
    train = open_samples[(open_samples["service_date"] <= train_end) & ~open_samples["ambiguous"]]
    return train, open_samples[open_samples["service_date"] > train_end]


def rolling_windows(train_days: list[int], eval_days: int = 4) -> list[tuple[date, date, date, date]]:
    """학습 시작일부터 n일 학습 → 다음 eval_days일 평가. test 기간은 쓰지 않는다.

    반환: (학습 시작, 학습 끝, 평가 시작, 평가 끝)
    """
    start = SPLITS["train"][0]
    last_allowed = SPLITS["val"][1]
    windows = []
    for days in train_days:
        train_end = start + timedelta(days=days - 1)
        eval_start = train_end + timedelta(days=1)
        eval_end = eval_start + timedelta(days=eval_days - 1)
        if eval_end <= last_allowed:
            windows.append((start, train_end, eval_start, eval_end))
    return windows
