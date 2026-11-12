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

# 이름에 (경유)가 붙고 2025 일평균 승하차가 이보다 적으면 고속도로 체크포인트로 본다
VIA_MARK = "(경유)"
CHECKPOINT_MAX_DAILY = 10

# 경희대 안쪽 정류장은 학생만 쓰므로 예측 대상에서 뺀다
CAMPUS_START_STOP = "경희대학교"  # 서울행의 시작
CAMPUS_END_STOP = "경희대정문"    # 영통행의 끝

SEOUL_BOUND = "서울행"    # 경희대학교 → 고속도로 진입 전
YEONGTONG_BOUND = "영통행"  # 고속도로를 나온 뒤 서울 구간(회차 전 포함) → 경희대정문

# 평일 시간대별 핵심 구간: 이름, 방향, 구역, 시작 시, 끝 시 (끝 시 미포함)
KEY_SEGMENTS = (
    ("출근", SEOUL_BOUND, "출발권", 7, 9),
    ("퇴근", YEONGTONG_BOUND, "서울권", 17, 22),
)

# 운행 나누기: 순번이 이만큼 줄거나, 공백이 길거나, 불가능하게 뛰면 새 운행
TRIP_MAX_BACKSTEP = 5
TRIP_MAX_GAP_MINUTES = 30
TRIP_MAX_JUMP = 30

# 범위 라벨: 구간의 승차·하차 중 작은 쪽이 큰 쪽의 이 비율 이하면 한 방향으로만 변한다고 본다
ONE_WAY_RATIO = 0.2

# 2025 공휴일 (대체·임시 포함)
HOLIDAYS = frozenset(date.fromisoformat(d) for d in (
    "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30",
    "2025-03-03", "2025-05-05", "2025-05-06", "2025-06-03", "2025-06-06",
    "2025-08-15", "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08",
    "2025-10-09", "2025-12-25",
))

NO_SEAT_INFO = -1  # remain_seat_cnt 정보 없음. 0석(만석)과 다르다

# 단계별 최소 잔여석: 0석 / 1–4석 / 5–9석 / 10–19석 / 20석 이상
STAGE_MIN_SEATS = (0, 1, 5, 10, 20)

MAX_STOPS_AHEAD = 20  # 실제 정류장 기준 몇 개 앞까지 예측할지 (열린 질문, README 13장)
KEY_WEIGHT = 3  # 학습에서 핵심 구간 샘플의 가중치
LEAD_MAX_AGE_MINUTES = 120  # 이보다 오래된 앞차 기록은 특징으로 쓰지 않는다

# 양 끝 날짜 포함. 하루의 경계는 DAY_BOUNDARY_HOUR
SPLITS = {
    "train": (date(2026, 11, 5), date(2026, 11, 19)),
    "val": (date(2026, 11, 20), date(2026, 11, 23)),
    "test": (date(2026, 11, 24), date(2026, 11, 27)),
}
