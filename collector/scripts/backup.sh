#!/usr/bin/env bash
# 매일 DB 백업. crontab 예시 (매일 04:10):
#   10 4 * * * /home/ubuntu/bus-collector/scripts/backup.sh >> /home/ubuntu/backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
source .env

BACKUP_DIR="$HOME/backups"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/bus_$(date +%F).sql.gz"

docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$FILE"
find "$BACKUP_DIR" -name 'bus_*.sql.gz' -mtime +14 -delete

echo "$(date '+%F %T') backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
