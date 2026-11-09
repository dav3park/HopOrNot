"""지표, 혼동행렬, 보정, 나눠서 보기 (README 9장).

입력: data/predictions/*.parquet. 모델을 직접 불러오지 않고 예측 결과만 읽는다.
출력: data/metrics.csv

테스트 기간은 --final 을 줘야 열린다. 모델을 확정한 뒤 한 번만 쓴다.
"""
import argparse

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, log_loss

from .config import DATA_DIR, PREDICTIONS_DIR, STAGE_MIN_SEATS

STAGES = list(range(len(STAGE_MIN_SEATS)))
PROBABILITY_COLUMNS = [f"p{stage}" for stage in STAGES]
CARRIED_COLUMNS = ["route", "veh_id", "observed_at", "target_seq", "direction", "zone", "key_segment", "stops_ahead",
                   "ambiguous", "split", "stage"]


def save_predictions(name: str, samples: pd.DataFrame, probabilities: np.ndarray):
    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    frame = samples[CARRIED_COLUMNS].reset_index(drop=True)
    frame[PROBABILITY_COLUMNS] = probabilities
    frame.to_parquet(PREDICTIONS_DIR / f"{name}.parquet", index=False)


def ranked_probability_score(actual: np.ndarray, probabilities: np.ndarray) -> float:
    predicted = probabilities.cumsum(axis=1)[:, :-1]
    observed = (actual[:, None] <= np.array(STAGES[:-1])).astype(float)
    return float(((predicted - observed) ** 2).sum(axis=1).mean() / (len(STAGES) - 1))


def brier_at_least(actual: np.ndarray, probabilities: np.ndarray, stage: int) -> float:
    return float(((probabilities[:, stage:].sum(axis=1) - (actual >= stage)) ** 2).mean())


def scores(frame: pd.DataFrame) -> dict:
    actual = frame["stage"].astype(int).to_numpy()
    probabilities = frame[PROBABILITY_COLUMNS].to_numpy()
    predicted = probabilities.argmax(axis=1)
    result = {
        "n": len(frame),
        "accuracy": accuracy_score(actual, predicted),
        "macro_f1": f1_score(actual, predicted, labels=STAGES, average="macro", zero_division=0),
        "log_loss": log_loss(actual, probabilities, labels=STAGES),
        "rps": ranked_probability_score(actual, probabilities),
    }
    for stage in STAGES[1:]:
        result[f"brier_{STAGE_MIN_SEATS[stage]}"] = brier_at_least(actual, probabilities, stage)
    return result


def groups(frame: pd.DataFrame) -> dict[str, pd.Series]:
    ahead = frame["stops_ahead"]
    result = {"전체": pd.Series(True, index=frame.index)}
    result |= {name: frame["key_segment"] == name for name in ("출근", "퇴근")}
    result["핵심 구간 밖"] = frame["key_segment"].isna()
    result |= {direction: frame["direction"] == direction for direction in frame["direction"].unique()}
    result |= {"1–3개 앞": ahead <= 3, "4–10개 앞": ahead.between(4, 10), "11개 이상 앞": ahead >= 11}
    result["실제 만석"] = frame["stage"] == 0
    return result


def calibration(frame: pd.DataFrame, stage: int = 1) -> pd.DataFrame:
    """P(단계 ≥ stage)를 10% 구간으로 나눠 예측 평균과 실제 비율을 비교한다."""
    predicted = frame[PROBABILITY_COLUMNS[stage:]].sum(axis=1)
    actual = frame["stage"].astype(int) >= stage
    bins = pd.cut(predicted, np.linspace(0, 1, 11), include_lowest=True)
    table = pd.DataFrame({"predicted": predicted, "actual": actual}).groupby(bins, observed=True)
    return table.agg(n=("actual", "size"), predicted=("predicted", "mean"), actual=("actual", "mean")).round(3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--final", action="store_true", help="테스트 기간을 연다")
    args = parser.parse_args()

    rows = []
    for path in sorted(PREDICTIONS_DIR.glob("*.parquet")):
        frame = pd.read_parquet(path)
        frame = frame[~frame["ambiguous"]]
        if not args.final:
            frame = frame[frame["split"] != "test"]
        for name, mask in groups(frame).items():
            if mask.sum():
                rows.append({"model": path.stem, "group": name} | scores(frame[mask]))
        for name in ("출근", "퇴근"):
            part = frame[frame["key_segment"] == name]
            if len(part):
                predicted = part[PROBABILITY_COLUMNS].to_numpy().argmax(axis=1)
                print(f"\n[{path.stem}] {name} 혼동행렬 (행 실제, 열 예측)")
                print(confusion_matrix(part["stage"].astype(int), predicted, labels=STAGES))
                print(f"P(≥{STAGE_MIN_SEATS[1]}석) 보정\n{calibration(part)}")

    metrics = pd.DataFrame(rows)
    metrics.to_csv(DATA_DIR / "metrics.csv", index=False)
    with pd.option_context("display.width", 170, "display.max_rows", 200, "display.max_columns", 20):
        print(metrics.round(3).to_string(index=False))


if __name__ == "__main__":
    main()
