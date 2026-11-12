"""MLP (README 6장 모델 4의 첫 단계, GRU 전).

입력: data/interim/samples.parquet, data/interim/stops.parquet
출력: data/predictions/mlp.parquet

수치 특징은 결측 표시 후 표준화, 범주형은 임베딩으로 넣는다.
LightGBM과 같은 프로세스에서 torch를 쓰면 macOS에서 멈추므로 lightgbm을 불러오지 않는다.
"""
import argparse
from datetime import date

import numpy as np
import pandas as pd
import torch
from torch import nn

from .config import INTERIM_DIR, SPLITS, STAGE_MIN_SEATS
from .evaluate import save_predictions
from .features import CATEGORICAL_FEATURES, NUMERIC_FEATURES, model_inputs
from .split import sample_weights, train_eval

HIDDEN = 128
DROPOUT = 0.2
LEARNING_RATE = 1e-3
BATCH_SIZE = 2048
MAX_EPOCHS = 30
PATIENCE = 3
EMBEDDING_DIM = 8


def holdout(train: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """조기 종료용으로 학습 기간의 마지막 날을 뗀다 (train_lgbm.holdout과 같은 규칙, lightgbm 없이)."""
    held = train["service_date"] == train["service_date"].max()
    return train[~held], train[held]


class Encoder:
    """학습 부분에서 평균·표준편차를 정하고, 범주형은 범주 코드(+1, 0은 결측)로 바꾼다."""

    def __init__(self, inputs: pd.DataFrame):
        numeric = inputs[NUMERIC_FEATURES].astype(float)
        self.mean = numeric.mean()
        self.std = numeric.std().replace(0, 1).fillna(1)
        self.sizes = [len(inputs[c].cat.categories) + 1 for c in CATEGORICAL_FEATURES]

    def __call__(self, inputs: pd.DataFrame) -> tuple[torch.Tensor, torch.Tensor]:
        numeric = inputs[NUMERIC_FEATURES].astype(float)
        missing = numeric.isna().to_numpy(np.float32)
        scaled = ((numeric - self.mean) / self.std).fillna(0).to_numpy(np.float32)
        codes = np.column_stack([inputs[c].cat.codes.to_numpy() + 1 for c in CATEGORICAL_FEATURES])
        return torch.from_numpy(np.hstack([scaled, missing])), torch.from_numpy(codes.astype(np.int64))


class MLP(nn.Module):
    def __init__(self, n_numeric: int, sizes: list[int]):
        super().__init__()
        self.embeddings = nn.ModuleList(nn.Embedding(size, EMBEDDING_DIM) for size in sizes)
        width = n_numeric + EMBEDDING_DIM * len(sizes)
        self.layers = nn.Sequential(
            nn.Linear(width, HIDDEN), nn.ReLU(), nn.Dropout(DROPOUT),
            nn.Linear(HIDDEN, HIDDEN), nn.ReLU(), nn.Dropout(DROPOUT),
            nn.Linear(HIDDEN, len(STAGE_MIN_SEATS)),
        )

    def forward(self, numeric, codes):
        embedded = [embedding(codes[:, i]) for i, embedding in enumerate(self.embeddings)]
        return self.layers(torch.cat([numeric, *embedded], dim=1))


def tensors(samples, stops, encoder):
    numeric, codes = encoder(model_inputs(samples, stops))
    labels = torch.from_numpy(samples["stage"].astype(int).to_numpy().copy())
    weights = torch.from_numpy(sample_weights(samples).astype(np.float32))
    return numeric, codes, labels, weights


def run_epoch(model, data, optimizer=None) -> float:
    numeric, codes, labels, weights = data
    order = torch.randperm(len(labels)) if optimizer else torch.arange(len(labels))
    model.train(optimizer is not None)
    total, weight_sum = 0.0, 0.0
    with torch.set_grad_enabled(optimizer is not None):
        for start in range(0, len(labels), BATCH_SIZE):
            idx = order[start:start + BATCH_SIZE]
            loss = nn.functional.cross_entropy(model(numeric[idx], codes[idx]), labels[idx], reduction="none")
            loss = (loss * weights[idx]).sum()
            if optimizer:
                optimizer.zero_grad()
                (loss / weights[idx].sum()).backward()
                optimizer.step()
            total += loss.item()
            weight_sum += weights[idx].sum().item()
    return total / weight_sum


def predict(model, numeric, codes) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        parts = [torch.softmax(model(numeric[s:s + BATCH_SIZE * 8], codes[s:s + BATCH_SIZE * 8]), dim=1)
                 for s in range(0, len(numeric), BATCH_SIZE * 8)]
    return torch.cat(parts).numpy().astype(float)


def fit(train_data, valid_data, n_numeric, sizes, epochs=None):
    """epochs가 없으면 검증 손실로 조기 종료하고, 있으면 그 횟수만큼 학습한다."""
    torch.manual_seed(0)
    model = MLP(n_numeric, sizes)
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    best, best_epoch, best_state = np.inf, 0, None
    for epoch in range(1, (epochs or MAX_EPOCHS) + 1):
        train_loss = run_epoch(model, train_data, optimizer)
        if epochs:
            continue
        valid_loss = run_epoch(model, valid_data)
        print(f"  에폭 {epoch}: 학습 {train_loss:.4f}, 검증 {valid_loss:.4f}")
        if valid_loss < best:
            best, best_epoch = valid_loss, epoch
        elif epoch - best_epoch >= PATIENCE:
            break
    return model, best_epoch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-end", type=date.fromisoformat, default=SPLITS["train"][1])
    args = parser.parse_args()
    torch.set_num_threads(8)

    samples = pd.read_parquet(INTERIM_DIR / "samples.parquet")
    stops = pd.read_parquet(INTERIM_DIR / "stops.parquet")
    train, evaluation = train_eval(samples, args.train_end)
    if evaluation.empty:
        raise SystemExit("평가할 데이터가 없습니다. --train-end 를 앞당기세요")

    fit_part, stop_part = holdout(train)
    encoder = Encoder(model_inputs(fit_part, stops))
    n_numeric = 2 * len(NUMERIC_FEATURES)
    _, epochs = fit(tensors(fit_part, stops, encoder), tensors(stop_part, stops, encoder), n_numeric, encoder.sizes)
    print(f"조기 종료 기준 {stop_part['service_date'].min()}: 에폭 {epochs}")

    encoder = Encoder(model_inputs(train, stops))
    model, _ = fit(tensors(train, stops, encoder), None, n_numeric, encoder.sizes, epochs=epochs)
    numeric, codes = encoder(model_inputs(evaluation, stops))
    save_predictions("mlp", evaluation, predict(model, numeric, codes))
    print(f"학습 {len(train):,}개, 평가 {len(evaluation):,}개")


if __name__ == "__main__":
    main()
