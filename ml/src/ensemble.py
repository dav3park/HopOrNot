"""LightGBM + 좌석 변화량 회귀 앙상블.

입력: data/predictions/{lgbm,delta}.parquet, --select-dir 의 같은 파일 (가중치 고르기용 이전 실행)
출력: data/predictions/ensemble.parquet

두 모델의 단계 확률을 몇 정거장 앞 구간별 가중치로 섞는다 (선형 혼합).
가중치는 평가 기간이 아니라, 더 이른 학습 끝 날짜로 돌린 이전 실행의 --select-date 하루에서
핵심 구간 RPS가 가장 낮은 값으로 고른다. 평가 기간을 보고 고르면 점수가 부풀려진다.

    python -m src.train_lgbm --train-end 2026-11-06 && python -m src.train_delta --train-end 2026-11-06
    mkdir -p data/ensemble_select && cp data/predictions/{lgbm,delta}.parquet data/ensemble_select/
    (본 실행 학습) → python -m src.ensemble --select-dir data/ensemble_select --select-date 2026-11-09
"""
import argparse
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from .config import PREDICTIONS_DIR
from .evaluate import PROBABILITY_COLUMNS, ranked_probability_score
from .split import service_date

KEYS = ["route", "veh_id", "observed_at", "target_seq"]
AHEAD_BINS = [0, 3, 10, np.inf]  # 1–3 / 4–10 / 11 이상
AHEAD_NAMES = ["1–3개 앞", "4–10개 앞", "11개 이상 앞"]
WEIGHTS = np.round(np.arange(0, 1.01, 0.1), 1)  # LightGBM 쪽 가중치 후보


def ahead_bin(frame: pd.DataFrame) -> np.ndarray:
    return np.digitize(frame["stops_ahead"].to_numpy(), AHEAD_BINS[1:-1], right=True)


def paired(directory: Path) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    lgbm = pd.read_parquet(directory / "lgbm.parquet")
    delta = pd.read_parquet(directory / "delta.parquet")
    if not lgbm[KEYS].equals(delta[KEYS]):
        raise SystemExit(f"{directory}: 두 예측의 샘플이 다릅니다. 같은 --train-end 로 다시 돌리세요")
    return lgbm, lgbm[PROBABILITY_COLUMNS].to_numpy(), delta[PROBABILITY_COLUMNS].to_numpy()


def select_weights(directory: Path, day: date) -> dict[int, float]:
    frame, lgbm, delta = paired(directory)
    rows = ((service_date(frame["observed_at"].dt.tz_convert("Asia/Seoul")) == day)
            & frame["key_segment"].notna() & ~frame["ambiguous"]).to_numpy()
    actual, bins = frame["stage"].fillna(0).astype(int).to_numpy(), ahead_bin(frame)  # 애매한 라벨은 rows에서 빠진다
    chosen = {}
    for b, name in enumerate(AHEAD_NAMES):
        part = rows & (bins == b)
        if part.sum() < 100:
            chosen[b] = 1.0  # 표본이 적으면 주 모델만 쓴다
            print(f"{name}: 표본 {part.sum()}개뿐이라 LightGBM만 씀")
            continue
        scores = [ranked_probability_score(actual[part], w * lgbm[part] + (1 - w) * delta[part]) for w in WEIGHTS]
        chosen[b] = float(WEIGHTS[int(np.argmin(scores))])
        print(f"{name}: 표본 {part.sum():,}개, LightGBM 가중치 {chosen[b]} (RPS {min(scores):.4f}, "
              f"LightGBM만 {scores[-1]:.4f}, 변화량 회귀만 {scores[0]:.4f})")
    return chosen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--select-dir", type=Path, required=True)
    parser.add_argument("--select-date", type=date.fromisoformat, required=True)
    args = parser.parse_args()

    weights = select_weights(args.select_dir, args.select_date)
    frame, lgbm, delta = paired(PREDICTIONS_DIR)
    w = np.vectorize(weights.get)(ahead_bin(frame))[:, None]
    frame[PROBABILITY_COLUMNS] = w * lgbm + (1 - w) * delta
    frame.to_parquet(PREDICTIONS_DIR / "ensemble.parquet", index=False)
    print(f"ensemble {len(frame):,}개 저장")


if __name__ == "__main__":
    main()
