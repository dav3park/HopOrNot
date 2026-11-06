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
