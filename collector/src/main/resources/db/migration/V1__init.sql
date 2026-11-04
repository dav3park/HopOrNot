-- 노선별 정류장 (시작 시 1회 적재)
CREATE TABLE route_station (
    route_id     BIGINT           NOT NULL,
    station_seq  INT              NOT NULL,
    station_id   BIGINT           NOT NULL,
    station_name TEXT,
    mobile_no    TEXT,
    region_name  TEXT,
    center_yn    TEXT,
    turn_yn      TEXT,
    x            DOUBLE PRECISION,
    y            DOUBLE PRECISION,
    loaded_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (route_id, station_seq)
);

-- 버스위치 관측값: 호출 1회 x 차량 1대 = 1행
CREATE TABLE bus_observation (
    id              BIGSERIAL   PRIMARY KEY,
    collected_at    TIMESTAMPTZ NOT NULL,   -- 수집기 기준 시각
    query_time      TIMESTAMP,              -- API 응답 헤더의 조회 시각 (KST)
    route_id        BIGINT      NOT NULL,
    veh_id          BIGINT,
    plate_no        TEXT,
    station_id      BIGINT,
    station_seq     INT,
    state_cd        SMALLINT,               -- 0 교차로 통과, 1 정류소 도착, 2 정류소 출발
    remain_seat_cnt SMALLINT,               -- -1 정보 없음
    crowded         SMALLINT,               -- 1 여유 ~ 4 매우 혼잡
    low_plate       SMALLINT
);
CREATE INDEX idx_obs_route_time ON bus_observation (route_id, collected_at);
CREATE INDEX idx_obs_vehicle_time ON bus_observation (veh_id, collected_at);

-- 응답 원문 (초기 2주 보관, 파싱 오류 복구용)
CREATE TABLE raw_response (
    id           BIGSERIAL   PRIMARY KEY,
    collected_at TIMESTAMPTZ NOT NULL,
    api          TEXT        NOT NULL,
    route_id     BIGINT,
    body         JSONB
);

-- API별 일일 호출 수 (재시작해도 유지)
CREATE TABLE api_call_count (
    day   DATE NOT NULL,
    api   TEXT NOT NULL,
    calls INT  NOT NULL,
    PRIMARY KEY (day, api)
);

-- 수집 이벤트 로그 (실패, 한도 도달, 일일 요약)
CREATE TABLE collector_event (
    id        BIGSERIAL   PRIMARY KEY,
    at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    level     TEXT        NOT NULL,
    event_key TEXT,
    message   TEXT
);
