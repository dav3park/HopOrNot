"""iOS 앱 데모 데이터: 과거 한 시각의 실제 관측으로 추론 서버 응답(/stops, /predict, /line, /recommend)을 만든다.

    cd ml && python -m serve.demo_fixtures --at 2026-11-20T18:10

추론 서버가 배포되기 전에도 앱을 시뮬레이터에서 돌려 보려고 쓴다. 그 시각까지의 관측만 쓰므로 응답은
그 시각에 서버가 냈을 값과 같다. 출력: ../ios/HopOrNot/Demo/*.json
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from src.config import RAW_DIR, ROUTES, TIMEZONE
from src.live import line_view, load_artifacts, recommend, snapshot, stop_prediction
from src.split import service_date

OUT = Path(__file__).resolve().parents[2] / "ios" / "HopOrNot" / "Demo"


def write(name: str, value) -> None:
    (OUT / f"{name}.json").write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--at", type=datetime.fromisoformat, required=True)
    args = parser.parse_args()
    at = pd.Timestamp(args.at, tz=TIMEZONE)

    art = load_artifacts()
    observations = pd.read_parquet(RAW_DIR / "bus_observation.parquet")
    day = service_date(pd.Series([at])).iloc[0]
    observations = observations[(service_date(observations["collected_at"]) == day) & (observations["collected_at"] <= at)]
    snap = snapshot(observations, art)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    count = 0
    for route in (r.name for r in ROUTES):
        stops = art.stops[(art.stops["route"] == route) & art.stops["is_target"]]
        write(f"stops_{route}", [{"station_seq": int(r.station_seq), "station_name": r.station_name,
                                  "direction": r.direction, "zone": r.zone} for r in stops.itertuples(index=False)])
        for seq in stops["station_seq"]:
            seq = int(seq)
            write(f"predict_{route}_{seq}", stop_prediction(snap, art, route, seq, now=at))
            write(f"line_{route}_{seq}", line_view(snap, art, route, seq))
            write(f"recommend_{route}_{seq}", recommend(snap, art, route, seq, now=at))
            count += 1
    write("demo_meta", {"generated_at": snap.generated_at.isoformat(), "label": f"{at:%m/%d %H:%M} 실제 데이터"})
    size = sum(f.stat().st_size for f in OUT.glob("*.json")) / 1024
    print(f"정류장 {count}개, 파일 {len(list(OUT.glob('*.json')))}개, {size:.0f}KB → {OUT}")


if __name__ == "__main__":
    main()
