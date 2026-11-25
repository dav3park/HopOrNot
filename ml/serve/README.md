# 추론 서버

수집 DB를 **읽기만** 해서, 정류장마다 다가오는 버스의 좌석 확률과 다음 버스에 내가 앉을 확률을 돌려준다.
예측은 `src/live.py`가 학습과 같은 특징 함수로 만든다. 새 수집이 들어올 때만 다시 계산한다 (첫 요청 약 1.4초, 그 뒤 0.04초).

## API

| 요청 | 응답 |
| --- | --- |
| `GET /health` | 마지막 수집 시각, 모델 |
| `GET /stops?route=M5107` | 예측 대상 정류장 (`station_seq`, 이름, 방향, 구역) |
| `GET /predict?route=M5107&station_seq=36` | 다가오는 버스 목록 + `my_seat` |
| `GET /predict?...&arrived_at=2026-11-12T18:05:00+09:00` | 내가 정류장에 도착한 시각을 지정 (없으면 지금) |
| `GET /route?route=M5107` | 정류장 목록: 노선 한 바퀴(캠퍼스 → 서울 → 캠퍼스)를 한 줄로 + 지금 달리는 버스 전부. 정류장 `kind`: stop / highway / via / campus |
| `GET /path?route=M5107` | 지도용 도로 경로. 일반 도로와 고속도로 선분 |
| `GET /line?route=M5107&station_seq=36` | 내 정류장으로 오는 버스: 위치, 버스별 정류장별 1석 이상 확률 |
| `GET /history?route=M5107&station_seq=36` | 지난 7일 도착 잔여석 (날짜 × 30분). 운행일이 바뀔 때 한 번 계산 |
| `GET /recommend?route=M5107&station_seq=36` | 같은 노선·방향의 가까운 승차 정류장을 다음 버스에 탈 확률 순으로 (거리, 도보 시간, 버스보다 먼저 갈 수 있는지) |
| `GET /docs` | 자동 생성된 API 문서 |

`/predict` 응답:

```json
{
  "station_name": "광교", "generated_at": "2026-11-12T17:04:08+09:00", "stale": false,
  "buses": [
    {"plate_no": "경기77바1191", "stops_ahead": 1, "current_seats": 6,
     "p_at_least": {"1": 0.804, "5": 0.621, "10": 0.18, "20": 0.035}, "detail": "full"},
    {"plate_no": "경기77바3508", "stops_ahead": 4, "current_seats": 14,
     "p_at_least": {"1": 0.999, "20": 0.875}, "detail": "simple"}
  ],
  "my_seat": {"probability": 0.297, "expected_people_ahead": 17.0, "minutes_since_previous_bus": 17.5,
              "previous_bus": {"arrived_at": "...", "arrival_seats": 13.0, "left_full": false, "departure_seats": 11}, "note": null}
}
```

- `p_at_least["k"]` = k석 이상 남아 도착할 확률. 4정거장 이상 앞(`detail: simple`)은 중간 단계 예측이 약해서 1석·20석만 준다.
- `my_seat.probability`는 다음 버스에 탈 확률, `my_seat.by_bus[k]`(버스별 `my_seat_by_here`)는 k번째 버스까지 탈 확률이다.
  앞 버스를 못 타면 그 버스 좌석만큼 내 앞 인원이 줄어드므로 P(내 앞 인원 < 1–k번 버스 좌석 합)으로 계산한다. 승차 구간(출발권·서울권)에서만 나온다.
  `expected_people_ahead` = 앞차 이후 새로 온 사람 + 앞차가 만석으로 떠났으면 남은 사람 (`src/waiting.py`).
- `stale: true`면 마지막 수집이 15분 넘게 지났다 (01–06시 수집 중지).
- 확률 보정은 아직 적용하지 않았다 (`ml/DECISIONS.md` 확률 보정 1차 시험).

## 맥에서 실행

```bash
cd ml
ssh -N -L 5432:127.0.0.1:5432 bus      # 다른 터미널
uvicorn serve.app:app --port 8000
curl "localhost:8000/predict?route=M5107&station_seq=36"
```

## 서버에 배포

수집 서버(ssh 별칭 `bus`)의 `~/hopornot-serve`에 **수집기와 별도 폴더·별도 컴포즈**로 올린다. 수집기(`~/HopOrNot/collector`)는 건드리지 않고 재시작하지도 않는다. 서버의 저장소는 ML 이전 커밋이라 `git pull`로 갱신하지 않는다.

```bash
ml/serve/deploy/deploy.sh            # 학습 산출물·코드 복사 → 읽기 전용 DB 계정·접근 키 생성 → 빌드·실행
```

- **읽기 전용 DB 계정** `hopornot_ro` (`bus_observation`, `route_station`에 SELECT만). 추론 서버는 밖에 열 서비스라 수집기의 쓰기 계정을 쓰지 않는다. 비밀번호와 접근 키(`API_KEY`)는 서버 `~/hopornot-serve/.env`에만 있다 (`setup_server.sh`, 이미 있으면 바꾸지 않는다).
- 컨테이너는 `127.0.0.1:8000`에만 열리고 수집기의 도커 네트워크(`collector_default`)로 DB(`db`)에 붙는다. CPU 1코어, 메모리 640MB로 제한한다.
- 서버 시작 직후 백그라운드에서 현재 스냅샷과 지난 7일을 미리 계산한다 (이 서버에서 지난 7일은 약 45초, 그 사이 `/route` 등은 0.5초에 응답).
- 모델을 다시 학습했으면 같은 명령으로 다시 올린다.
- 되돌리기: `ssh bus 'cd ~/hopornot-serve && docker compose down'` (DB 계정까지 지우려면 `DROP ROLE hopornot_ro;`).

### 시험 (서버 안에서만 열린 상태)

```bash
ssh -N -L 8000:127.0.0.1:8000 bus        # 다른 터미널
curl -H "X-API-Key: $(ssh bus 'grep ^API_KEY ~/hopornot-serve/.env | cut -d= -f2')" localhost:8000/route?route=M5107
```

앱은 설정에서 "추론 서버", 주소 `http://localhost:8000`, 접근 키를 넣는다 (시뮬레이터).

### 밖에 열기 (실기기 · 현장 검증)

iOS는 HTTP를 막으므로 HTTPS가 필요하다. 서버에 Caddy를 함께 띄우면 Let's Encrypt 인증서를 알아서 받고 갱신한다.

1. AWS 보안 그룹 인바운드에 **80, 443**(TCP, 0.0.0.0/0)을 연다. 8000과 5432는 열지 않는다.
2. 서버 IP가 바뀌지 않게 탄력적 IP를 연결한다.
3. 서버 `~/hopornot-serve/.env`의 `SITE_ADDRESS`에 주소를 넣는다. 도메인이 없으면 IP를 이름으로 바꿔 주는 무료 서비스를 쓴다. 예: IP가 `43.203.245.101`이면 `43-203-245-101.sslip.io`.
4. `ml/serve/deploy/deploy.sh --public` (또는 서버에서 `docker compose --profile public up -d`).
5. 앱 설정: 주소 `https://43-203-245-101.sslip.io`, 접근 키.

접근 키는 요청마다 `X-API-Key` 헤더로 확인한다 (`/health`만 열려 있다). 키가 없으면 문서 페이지도 닫힌다.

## 앱 연결 측정

맥에서 수집 DB에 SSH 터널로 붙여 시험한 값 (2026-11-25): `/route` 1.0초(첫 호출), `/path`·`/line`·`/predict`·`/recommend` 0.1초 이하, `/history` 첫 호출 12.5초, 프로세스 메모리 418MB.
수집 서버에 배포한 뒤 (서버 CPU 1코어 제한): 컨테이너 메모리 349MB, 서버 여유 메모리 약 850MB, 디스크 여유 8.3GB. 서버 안에서 모든 API 정상, 수집기·DB 가동 시간 그대로.
