#!/usr/bin/env bash
# 전체 파이프라인을 한 번에 다시 돌린다: DB 추출 → 라벨 → 특징 → 모델 7개 → 평가 → 대기 인원 모델
#
#   ./run_pipeline.sh --end 2026-11-23 --train-end 2026-11-19     # 11/20–23 검증 기간 평가
#   ./run_pipeline.sh --train-end 2026-11-19 --skip-export        # 이미 받은 데이터로
#
# --end 는 DB에서 받을 마지막 날 (양 끝 포함). 테스트 기간(11/24–27)은 받아도 평가에 쓰이지 않는다.
# DB 추출에는 SSH 터널이 필요하다: ssh -N -L 5432:127.0.0.1:5432 bus
# torch와 LightGBM을 한 프로세스에서 쓰면 macOS에서 멈추므로 모델마다 따로 실행한다.
set -euo pipefail
cd "$(dirname "$0")"

START=2026-11-05
END=""
TRAIN_END=""
SKIP_EXPORT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --end) END="$2"; shift 2 ;;
    --train-end) TRAIN_END="$2"; shift 2 ;;
    --skip-export) SKIP_EXPORT=1; shift ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$TRAIN_END" ]] || { echo "--train-end 가 필요하다" >&2; exit 2; }
PY="${PYTHON:-python}"
step() { echo; echo "== $*"; }

if [[ $SKIP_EXPORT -eq 0 ]]; then
  [[ -n "$END" ]] || { echo "--end 가 필요하다 (또는 --skip-export)" >&2; exit 2; }
  nc -z 127.0.0.1 5432 || { echo "SSH 터널이 없다: ssh -N -L 5432:127.0.0.1:5432 bus" >&2; exit 1; }
  step "DB 추출 $START ~ $END"
  "$PY" -m src.export_db --start "$START" --end "$END"
fi

step "2025 승하차, 정류장 분류, 도착 이벤트, 특징"
"$PY" -m src.boarding2025
"$PY" -m src.stops
"$PY" -m src.build_trips
"$PY" -m src.features

rm -f data/predictions/*.parquet
for model in train_baseline train_sklearn train_lgbm train_delta train_mlp; do
  step "$model (학습 끝 $TRAIN_END)"
  "$PY" -m "src.$model" --train-end "$TRAIN_END"
done

step "평가"
"$PY" -m src.evaluate

step "대기 인원 모델"
"$PY" -m src.waiting --train-end "$TRAIN_END"

echo
echo "완료. 지표: data/metrics.csv, 모델: models/. 서버 반영은 serve/README.md 의 scp 부터."
