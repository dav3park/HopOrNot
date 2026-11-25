#!/usr/bin/env bash
# 서버에서 한 번 실행: 추론 서버용 DB 읽기 전용 계정과 접근 키를 만들어 .env 를 쓴다.
# 이미 .env 가 있으면 아무것도 바꾸지 않는다 (키·비밀번호를 돌리지 않는다).
set -euo pipefail
cd "$(dirname "$0")"
SOURCE="$HOME/HopOrNot/collector/.env"

if [[ -f .env ]]; then echo ".env 가 이미 있다: 유지"; exit 0; fi
[[ -f "$SOURCE" ]] || { echo "수집기 .env 가 없다: $SOURCE" >&2; exit 1; }
get() { grep -E "^$1=" "$SOURCE" | head -1 | cut -d= -f2-; }
ADMIN_USER="$(get POSTGRES_USER)"; DB_NAME="$(get POSTGRES_DB)"
RO_PASSWORD="$(openssl rand -hex 16)"; API_KEY="$(openssl rand -hex 12)"

# 추론 서버는 읽기만 하므로 SELECT 권한만 있는 계정을 따로 쓴다 (밖에 열 서비스에 쓰기 권한을 주지 않는다)
docker exec -i collector-db-1 psql -v ON_ERROR_STOP=1 -q -U "$ADMIN_USER" -d "$DB_NAME" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hopornot_ro') THEN CREATE ROLE hopornot_ro LOGIN; END IF;
END \$\$;
ALTER ROLE hopornot_ro PASSWORD '$RO_PASSWORD';
GRANT CONNECT ON DATABASE "$DB_NAME" TO hopornot_ro;
GRANT USAGE ON SCHEMA public TO hopornot_ro;
GRANT SELECT ON bus_observation, route_station TO hopornot_ro;
SQL

umask 177
cat > .env <<ENV
POSTGRES_USER=hopornot_ro
POSTGRES_PASSWORD=$RO_PASSWORD
POSTGRES_DB=$DB_NAME
DB_HOST=db
API_KEY=$API_KEY
SITE_ADDRESS=
ENV
echo ".env 를 만들었다 (읽기 전용 계정 hopornot_ro, 접근 키는 .env 의 API_KEY)"
