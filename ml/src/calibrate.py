"""확률 보정 (README 6장 클래스 불균형 대응, 8장 검증 기간).

입력: data/predictions/<model>.parquet (보정일과 평가 기간을 모두 포함한 예측. 학습 끝 = 보정일 전날)
출력: data/predictions/<model>_{raw,temp,iso}.parquet (평가 기간만), models/calibration_<model>.pkl

보정일 하루의 예측과 실제 단계로 보정 규칙을 배우고, 그 뒤 기간에 적용한다.
규칙은 구간(출근 / 퇴근 / 그 외)마다 따로 배운다. 과신하는 정도가 구간마다 다르기 때문이다.

- temp: 온도 조정. p_k ∝ p_k^(1/T) 로 확률 전체를 고르게 펴거나 모은다. 구간당 값 하나 (T)라 과적합이 적다.
- iso:  누적 확률 P(≥1석), P(≥5석), P(≥10석), P(≥20석)마다 isotonic 회귀로 "모델이 말한 확률 → 실제 비율"
        단조 함수를 배운다. 모양에 제한이 없어 더 정확할 수 있지만 표본이 적으면 계단이 거칠다.
        보정 뒤 P(≥1) ≥ P(≥5) ≥ P(≥10) ≥ P(≥20) 순서를 다시 맞춘다.

    python -m src.train_lgbm --train-end 2026-11-08
    python -m src.calibrate --model lgbm --calib-date 2026-11-09
"""
import argparse
import pickle
from datetime import date

import numpy as np
import pandas as pd
from scipy import optimize
from sklearn.isotonic import IsotonicRegression

from .config import MODELS_DIR, PREDICTIONS_DIR, STAGE_MIN_SEATS
from .evaluate import PROBABILITY_COLUMNS, scores
from .split import service_date

GROUPS = ("출근", "퇴근", "그 외")
EPS = 1e-6


def group_of(frame: pd.DataFrame) -> pd.Series:
    return frame["key_segment"].fillna("그 외")


def temperature_scale(probabilities: np.ndarray, t: float) -> np.ndarray:
    logits = np.log(np.clip(probabilities, EPS, 1)) / t
    logits -= logits.max(axis=1, keepdims=True)
    scaled = np.exp(logits)
    return scaled / scaled.sum(axis=1, keepdims=True)


def fit_temperature(probabilities: np.ndarray, actual: np.ndarray) -> float:
    def loss(log_t):
        p = temperature_scale(probabilities, np.exp(log_t))
        return -np.log(np.clip(p[np.arange(len(actual)), actual], EPS, 1)).mean()
    return float(np.exp(optimize.minimize_scalar(loss, bounds=(-2, 2), method="bounded").x))


def to_cumulative(probabilities: np.ndarray) -> np.ndarray:
    """P(단계 ≥ k), k = 1..K−1"""
    return probabilities[:, ::-1].cumsum(axis=1)[:, ::-1][:, 1:]


def from_cumulative(at_least: np.ndarray) -> np.ndarray:
    at_least = np.minimum.accumulate(np.clip(at_least, 0, 1), axis=1)  # 순서 보장
    full = np.column_stack([np.ones(len(at_least)), at_least, np.zeros(len(at_least))])
    return full[:, :-1] - full[:, 1:]


def fit_isotonic(probabilities: np.ndarray, actual: np.ndarray) -> list[IsotonicRegression]:
    at_least = to_cumulative(probabilities)
    models = []
    for k in range(at_least.shape[1]):
        model = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip")
        model.fit(at_least[:, k], (actual >= k + 1).astype(float))
        models.append(model)
    return models


def apply_isotonic(probabilities: np.ndarray, models: list[IsotonicRegression]) -> np.ndarray:
    at_least = to_cumulative(probabilities)
    return from_cumulative(np.column_stack([m.predict(at_least[:, k]) for k, m in enumerate(models)]))


def reliability(frame: pd.DataFrame, stage: int) -> pd.DataFrame:
    predicted = frame[PROBABILITY_COLUMNS[stage:]].sum(axis=1)
    actual = frame["stage"].astype(int) >= stage
    bins = pd.cut(predicted, [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0], include_lowest=True)
    return pd.DataFrame({"n": actual.groupby(bins, observed=False).size(),
                         "예측": predicted.groupby(bins, observed=False).mean().round(2),
                         "실제": actual.groupby(bins, observed=False).mean().round(2)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="lgbm")
    parser.add_argument("--calib-date", type=date.fromisoformat, required=True)
    args = parser.parse_args()

    frame = pd.read_parquet(PREDICTIONS_DIR / f"{args.model}.parquet")
    days = service_date(frame["observed_at"].dt.tz_convert("Asia/Seoul"))
    if days.min() != args.calib_date:
        raise SystemExit(f"예측이 {days.min()}부터 시작합니다. --train-end {args.calib_date} 전날로 다시 학습하세요")
    groups = group_of(frame)
    calib = (days == args.calib_date) & ~frame["ambiguous"]
    evaluation = frame[days > args.calib_date].copy()
    eval_groups = groups[days > args.calib_date]

    raw = evaluation[PROBABILITY_COLUMNS].to_numpy()
    temp, iso = raw.copy(), raw.copy()
    rules = {}
    for g in GROUPS:
        fit_rows, apply_rows = calib & (groups == g), (eval_groups == g).to_numpy()
        p = frame.loc[fit_rows, PROBABILITY_COLUMNS].to_numpy()
        y = frame.loc[fit_rows, "stage"].astype(int).to_numpy()
        t, models = fit_temperature(p, y), fit_isotonic(p, y)
        temp[apply_rows] = temperature_scale(raw[apply_rows], t)
        iso[apply_rows] = apply_isotonic(raw[apply_rows], models)
        rules[g] = {"temperature": t, "isotonic": models}
        print(f"{g}: 보정 표본 {len(y):,}개, 온도 T = {t:.2f} ({'과신 → 확률을 폄' if t > 1 else '소심 → 확률을 모음'})")

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODELS_DIR / f"calibration_{args.model}.pkl", "wb") as f:
        pickle.dump({"calib_date": str(args.calib_date), "rules": rules}, f)

    versions = {"raw": raw, "temp": temp, "iso": iso}
    for name, probabilities in versions.items():
        out = evaluation.copy()
        out[PROBABILITY_COLUMNS] = probabilities
        out.to_parquet(PREDICTIONS_DIR / f"{args.model}_{name}.parquet", index=False)
        versions[name] = out[~out["ambiguous"]]

    rows = []
    for name, out in versions.items():
        for g in ("출근", "퇴근"):
            part = out[group_of(out) == g]
            s = scores(part)
            full = part[part["stage"].astype(int) == 0]
            rows.append({"보정": name, "구간": g, "rps": s["rps"], "log_loss": s["log_loss"], "macro_f1": s["macro_f1"],
                         "brier_1": s["brier_1"], "brier_20": s[f"brier_{STAGE_MIN_SEATS[-1]}"],
                         "만석에 P(≥1)": full[PROBABILITY_COLUMNS[1:]].sum(axis=1).mean(),
                         "만석을 10석+로": (full[PROBABILITY_COLUMNS].to_numpy().argmax(axis=1) >= 3).mean()})
    table = pd.DataFrame(rows).sort_values(["구간", "보정"])
    print("\n" + table.round(3).to_string(index=False))
    for g in ("출근", "퇴근"):
        for name in versions:
            part = versions[name][group_of(versions[name]) == g]
            print(f"\n{g} P(≥1석) 보정 곡선 [{name}]\n{reliability(part, 1).T.to_string()}")


if __name__ == "__main__":
    main()
