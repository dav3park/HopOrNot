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
              "previous_bus": {"arrived_at": "...", "left_full": false, "departure_seats": 11}, "note": null}
}
```

- `p_at_least["k"]` = k석 이상 남아 도착할 확률. 4정거장 이상 앞(`detail: simple`)은 중간 단계 예측이 약해서 1석·20석만 준다.
- `my_seat`는 다음 버스 한 대 기준이고, 승차 구간(출발권·서울권)에서만 나온다.
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

학습 산출물은 Git에 없으므로 맥에서 서버로 복사한다:

```bash
cd ml
ssh bus 'mkdir -p ~/HopOrNot/ml/models ~/HopOrNot/ml/data/interim'
scp models/lgbm.txt models/waiting.json models/waiting_cells.parquet bus:~/HopOrNot/ml/models/
scp data/interim/stops.parquet data/interim/boarding_profile.parquet bus:~/HopOrNot/ml/data/interim/
```

`collector/docker-compose.yml`의 `services:` 아래에 추가하면 같은 네트워크에서 DB(`db`)에 붙는다:

```yaml
  serve:
    build:
      context: ../ml
      dockerfile: serve/Dockerfile
    env_file: .env              # POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
    environment:
      TZ: Asia/Seoul
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:8000:8000"   # 서버 안에서만. 앱 연결 때 Spring Boot API나 리버스 프록시 뒤에 둔다
    mem_limit: 640m             # 모델 적재 약 290MB + 계산
    restart: unless-stopped
```

```bash
cd ~/HopOrNot/collector
docker compose up -d --build serve
curl localhost:8000/health
```

서버 메모리는 1.9GB이고 수집기·DB가 약 230MB를 쓴다 (2026-11-12). 이미지는 약 1GB다.
모델을 다시 학습하면 위 `scp`를 다시 하고 `docker compose up -d --build serve`.

## 학습과 같은 특징인지 점검

```bash
python -m src.live --check 2026-11-11T18:30
```

그 시각까지의 관측만으로 실시간 특징을 만들고 학습 샘플의 특징과 비교한다.
2026-11-08 13:00, 11-10 07:50, 11-11 18:30에서 모든 특징이 같았다.
