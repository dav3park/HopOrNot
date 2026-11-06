"""PostgreSQL → parquet. 먼저 SSH 터널을 켜고 ml/.env 를 채운다.

    python -m src.export_db --start 2026-11-05 --end 2026-11-27

--start, --end 는 양 끝 포함이고 하루의 경계는 새벽 3시다. 생략하면 해당 쪽 제한이 없다.
"""
import argparse
import os
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import URL, create_engine, text

from .config import DAY_BOUNDARY_HOUR, ML_DIR, RAW_DIR, TIMEZONE


def make_engine():
    load_dotenv(ML_DIR / ".env")
    url = URL.create(
        "postgresql+psycopg",
        username=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "5432")),
        database=os.environ["POSTGRES_DB"],
    )
    # 수집 DB는 읽기만 한다
    return create_engine(url, connect_args={"options": "-c default_transaction_read_only=on"})


def day_start(day: date) -> datetime:
    return datetime.combine(day, time(DAY_BOUNDARY_HOUR), tzinfo=ZoneInfo(TIMEZONE))


def read_observations(engine, start: date | None, end: date | None) -> pd.DataFrame:
    conditions, params = [], {}
    if start:
        conditions.append("collected_at >= :start")
        params["start"] = day_start(start)
    if end:
        conditions.append("collected_at < :end")
        params["end"] = day_start(end + timedelta(days=1))
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = text(f"SELECT * FROM bus_observation {where} ORDER BY collected_at, id")

    df = pd.read_sql(query, engine, params=params)
    df["collected_at"] = pd.to_datetime(df["collected_at"], utc=True).dt.tz_convert(TIMEZONE)
    return df


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat)
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    engine = make_engine()

    observations = read_observations(engine, args.start, args.end)
    observations.to_parquet(RAW_DIR / "bus_observation.parquet", index=False)
    print(f"bus_observation {len(observations):,}행")

    stations = pd.read_sql(text("SELECT * FROM route_station ORDER BY route_id, station_seq"), engine)
    stations.to_parquet(RAW_DIR / "route_station.parquet", index=False)
    print(f"route_station {len(stations):,}행")


if __name__ == "__main__":
    main()
