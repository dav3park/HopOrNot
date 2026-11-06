"""2025 승하차 → 노선 × 정류장 × 요일유형 × 시간대 일평균 (README 2장, 5장).

입력: data/raw/boarding2025/ (경기데이터드림에서 받은 원본, 구분자 |)
출력: data/interim/boarding_profile.parquet

노선번호가 정확히 일치하는 행만 쓰므로 예약 노선(1112(예약) 등)은 제외된다.
시간대 24~26은 자정을 넘긴 운행이고 전날 운행일에 그대로 묶여 있다.
"""
import re

import pandas as pd

from .config import BOARDING_DIR, HOLIDAYS, INTERIM_DIR, ROUTES

COLUMNS = {
    "운행일자": "day",
    "시간대": "hour",
    "노선번호": "route",
    "정류소아이디": "station_id",
    "승차인원합계": "boardings",
    "하차인원합계": "alightings",
}


def read_month(path) -> pd.DataFrame | None:
    """한 달 파일에서 대상 노선만 읽는다. 파일명과 내용의 달이 다르면 건너뛴다."""
    expected = "20" + re.search(r"_(\d{4})\.csv$", path.name).group(1)
    routes = {route.name for route in ROUTES}
    chunks = pd.read_csv(path, sep="|", usecols=list(COLUMNS), dtype={"운행일자": "str", "노선번호": "str"},
                         chunksize=1_000_000)
    parts, months = [], set()
    for chunk in chunks:
        months.update(chunk["운행일자"].str[:6].unique())
        parts.append(chunk[chunk["노선번호"].isin(routes)])
    if months != {expected}:
        print(f"건너뜀: {path.name} 내용이 {sorted(months)}월")
        return None
    return pd.concat(parts).rename(columns=COLUMNS)


def day_type(days: pd.Series) -> pd.Series:
    """평일 / 토요일 / 일요일·공휴일."""
    dates = pd.to_datetime(days, format="%Y%m%d")
    result = pd.Series("평일", index=days.index)
    result[dates.dt.day_of_week == 5] = "토요일"
    result[(dates.dt.day_of_week == 6) | dates.dt.date.isin(HOLIDAYS)] = "일요일·공휴일"
    return result


def main():
    frames = [read_month(path) for path in sorted(BOARDING_DIR.glob("*.csv"))]
    rows = pd.concat([frame for frame in frames if frame is not None])
    rows["day_type"] = day_type(rows["day"])

    # 그날 승하차가 없어 행이 없는 시간대도 0으로 쳐야 하므로 행 수가 아니라 달력 일수로 나눈다
    days = rows.groupby("day_type")["day"].nunique().rename("days")
    profile = rows.groupby(["route", "station_id", "day_type", "hour"])[["boardings", "alightings"]].sum().reset_index()
    profile = profile.join(days, on="day_type")
    profile["boardings"] /= profile["days"]
    profile["alightings"] /= profile["days"]

    INTERIM_DIR.mkdir(parents=True, exist_ok=True)
    profile.to_parquet(INTERIM_DIR / "boarding_profile.parquet", index=False)
    months = sorted(rows["day"].str[:6].unique())
    print(f"boarding_profile {len(profile):,}행, {len(months)}개월 {months[0]}~{months[-1]}, 일수 {days.to_dict()}")


if __name__ == "__main__":
    main()
