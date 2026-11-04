#!/usr/bin/env bash
# 수집 상태 확인: ./scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source .env

docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
\echo '--- 오늘 호출 수'
SELECT api, calls FROM api_call_count WHERE day = current_date;

\echo '--- 최근 1시간 노선별 관측'
SELECT route_id, count(*) AS obs, count(DISTINCT veh_id) AS vehicles,
       min(remain_seat_cnt) AS min_seat, max(collected_at) AS last_at
FROM bus_observation
WHERE collected_at > now() - interval '1 hour'
GROUP BY route_id ORDER BY route_id;

\echo '--- 정류장 목록 적재'
SELECT route_id, count(*) AS stations FROM route_station GROUP BY route_id ORDER BY route_id;

\echo '--- 최근 이벤트'
SELECT at, level, message FROM collector_event ORDER BY at DESC LIMIT 10;
SQL
