#!/usr/bin/env bash
# 정류장 도착 즉시 예측을 저장한다: ./capture.sh M5107 36
# 추론 서버가 localhost:8000 에 있어야 한다 (서버 밖이면 ssh -N -L 8000:127.0.0.1:8000 bus)
set -euo pipefail
cd "$(dirname "$0")"
[[ $# -eq 2 ]] || { echo "사용법: $0 <노선> <station_seq>" >&2; exit 2; }
ROUTE="$1"; SEQ="$2"
NOW="$(date +%Y-%m-%dT%H:%M:%S%z)"
mkdir -p captures
FILE="captures/$(date +%Y%m%d-%H%M%S)-${ROUTE}-${SEQ}.json"
curl -sf --get "${HOPORNOT_API:-http://localhost:8000}/predict" \
  --data-urlencode "route=${ROUTE}" --data-urlencode "station_seq=${SEQ}" --data-urlencode "arrived_at=${NOW}" > "$FILE"
python3 - "$FILE" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
seat = d.get("my_seat") or {}
bus = (d.get("buses") or [{}])[0]
print(f"{sys.argv[1]} 저장")
print(f"  {d['station_name']} · 수집 {d['generated_at'][11:19]}{' (오래됨)' if d['stale'] else ''}")
print(f"  다음 버스 {bus.get('plate_no')} · {bus.get('stops_ahead')}정거장 앞 · 1석 이상 {bus.get('p_at_least', {}).get('1')}")
print(f"  내가 앉을 확률 {seat.get('probability')} · 예상 앞 인원 {seat.get('expected_people_ahead')}")
EOF
