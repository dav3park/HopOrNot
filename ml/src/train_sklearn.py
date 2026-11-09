"""로지스틱 회귀, 랜덤 포레스트 (README 6장 모델 1, 2).

입력: data/interim/samples.parquet, data/interim/stops.parquet
출력: data/predictions/{logreg,random_forest}.parquet
"""
import argparse
from datetime import date

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler

from .config import INTERIM_DIR, SPLITS, STAGE_MIN_SEATS
from .evaluate import save_predictions
from .features import CATEGORICAL_FEATURES, NUMERIC_FEATURES, model_inputs
from .split import sample_weights, train_eval

FOREST_MAX_SAMPLES = 200_000  # 학습 시간을 줄이려고 트리마다 이만큼만 뽑는다


def logistic_regression():
    columns = ColumnTransformer([
        ("numeric", make_pipeline(SimpleImputer(add_indicator=True), StandardScaler()), NUMERIC_FEATURES),
        ("categorical", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
    ])
    return make_pipeline(columns, LogisticRegression(C=1.0, max_iter=2000))


def random_forest():
    columns = ColumnTransformer([
        ("numeric", SimpleImputer(strategy="constant", fill_value=-1), NUMERIC_FEATURES),
        ("categorical", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1), CATEGORICAL_FEATURES),
    ])
    forest = RandomForestClassifier(n_estimators=200, max_depth=16, min_samples_leaf=20,
                                    max_samples=FOREST_MAX_SAMPLES, n_jobs=-1, random_state=0)
    return make_pipeline(columns, forest)


def full_probabilities(model, inputs: pd.DataFrame) -> np.ndarray:
    """학습에 없던 단계도 열을 갖도록 넓힌다."""
    probabilities = np.zeros((len(inputs), len(STAGE_MIN_SEATS)))
    probabilities[:, model.classes_] = model.predict_proba(inputs)
    return probabilities


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-end", type=date.fromisoformat, default=SPLITS["train"][1])
    args = parser.parse_args()

    samples = pd.read_parquet(INTERIM_DIR / "samples.parquet")
    stops = pd.read_parquet(INTERIM_DIR / "stops.parquet")
    train, evaluation = train_eval(samples, args.train_end)
    if evaluation.empty:
        raise SystemExit("평가할 데이터가 없습니다. --train-end 를 앞당기세요")

    inputs, labels = model_inputs(train, stops), train["stage"].astype(int)
    evaluation_inputs = model_inputs(evaluation, stops)
    for name, model in (("logreg", logistic_regression()), ("random_forest", random_forest())):
        model.fit(inputs, labels, **{f"{model.steps[-1][0]}__sample_weight": sample_weights(train)})
        save_predictions(name, evaluation, full_probabilities(model, evaluation_inputs))
        print(f"{name} 완료")


if __name__ == "__main__":
    main()
