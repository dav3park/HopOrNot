"""경로, 노선, 단계, 날짜 분할 등 파이프라인 공통 설정. 값의 근거는 ml/README.md."""
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ML_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
BOARDING_DIR = RAW_DIR / "boarding2025"    # 경기데이터드림 2025 승하차 원본
INTERIM_DIR = DATA_DIR / "interim"         # 운행, 도착 이벤트, 학습 샘플
PREDICTIONS_DIR = DATA_DIR / "predictions" # 모델별 예측 결과 (evaluate.py 입력)
MODELS_DIR = ML_DIR / "models"

TIMEZONE = "Asia/Seoul"
DAY_BOUNDARY_HOUR = 3  # 자정 넘어 운행하는 막차를 전날로 묶는다


@dataclass(frozen=True)
class Route:
    name: str
    route_id: int
    turn_seq: int  # 회차 순번. 이하는 국제캠 → 서울, 초과는 서울 → 국제캠


ROUTES = (
    Route("1112", 234000016, 34),
    Route("M5107", 234001243, 32),
    Route("5100", 200000115, 29),
)

NO_SEAT_INFO = -1  # remain_seat_cnt 정보 없음. 0석(만석)과 다르다

# 단계별 최소 잔여석: 0석 / 1–4석 / 5–9석 / 10석 이상
STAGE_MIN_SEATS = (0, 1, 5, 10)

MAX_STOPS_AHEAD = 20  # 몇 정거장 앞까지 예측할지 (열린 질문, README 13장)

# 양 끝 날짜 포함. 하루의 경계는 DAY_BOUNDARY_HOUR
SPLITS = {
    "train": (date(2026, 11, 5), date(2026, 11, 19)),
    "val": (date(2026, 11, 20), date(2026, 11, 23)),
    "test": (date(2026, 11, 24), date(2026, 11, 27)),
}
