#!/usr/bin/env bash
# 맥에서 실행: 추론 서버를 수집 서버(ssh 별칭 bus)의 ~/hopornot-serve 에 올린다.
#
#   ml/serve/deploy/deploy.sh            # 파일 복사 + 읽기 전용 계정 + 빌드·실행 (서버 안에서만 열림)
#   ml/serve/deploy/deploy.sh --public   # 위 + Caddy HTTPS (서버 .env 의 SITE_ADDRESS 필요)
#
# 수집기(~/HopOrNot)는 건드리지 않는다. 모델을 다시 학습했으면 같은 명령으로 다시 올린다.
set -euo pipefail
cd "$(dirname "$0")/../.."      # ml/
HOST="${DEPLOY_HOST:-bus}"
DIR="hopornot-serve"

for f in models/lgbm.txt models/waiting.json models/waiting_cells.parquet data/interim/stops.parquet data/interim/boarding_profile.parquet; do
  [[ -f "$f" ]] || { echo "학습 산출물이 없다: $f (run_pipeline.sh 로 만든다)" >&2; exit 1; }
done

ssh "$HOST" "mkdir -p ~/$DIR/ml/models ~/$DIR/ml/data/interim"
rsync -az --exclude __pycache__ serve/deploy/docker-compose.yml serve/deploy/Caddyfile serve/deploy/setup_server.sh "$HOST:$DIR/"
rsync -az --delete --exclude __pycache__ --exclude deploy src serve "$HOST:$DIR/ml/"
rsync -az .dockerignore "$HOST:$DIR/ml/"
rsync -az models/lgbm.txt models/waiting.json models/waiting_cells.parquet "$HOST:$DIR/ml/models/"
rsync -az data/interim/stops.parquet data/interim/boarding_profile.parquet "$HOST:$DIR/ml/data/interim/"

ssh "$HOST" "cd ~/$DIR && chmod +x setup_server.sh && ./setup_server.sh"
if [[ "${1:-}" == "--public" ]]; then
  ssh "$HOST" "cd ~/$DIR && docker compose --profile public up -d --build"
else
  ssh "$HOST" "cd ~/$DIR && docker compose up -d --build serve"
fi
ssh "$HOST" "cd ~/$DIR && docker compose ps"
