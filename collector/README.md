# bus-collector

경기도 버스위치정보 API(v2)로 광역버스 1112 · M5107 · 5100의 차량 위치와 잔여좌석을 주기적으로 수집해 PostgreSQL에 저장한다.

| 노선 | routeId | 회차 순번 |
| --- | --- | --- |
| 1112 | 234000016 | 34 (강변역) |
| M5107 | 234001243 | 32 (서울역환승센터) |
| 5100 | 200000115 | 29 (신분당선강남역) |

## 구성

- `collector` (Spring Boot 3.5, Java 21, 웹 서버 없음): 10초마다 깨어나 수집 간격이 지났으면 노선 3개를 호출
- `db` (PostgreSQL 16): 서버 안에서만 접속 가능 (`127.0.0.1:5432`)
- 시작 시 `route_station` 이 비어 있으면 정류장 목록을 노선 조회 API로 1회 적재
- API별 하루 호출 수를 DB(`api_call_count`)에 세서 `DAILY_LIMIT`(기본 990)에서 멈춤. 재시작해도 유지
- 연속 3회 실패, 한도 도달, 매일 23:55 요약을 `collector_event`에 기록하고 디스코드 웹훅(선택)으로 알림

수집 스케줄은 `src/main/resources/application.yml` 의 `collector.windows` 에서 바꾼다.
기본값은 기획서의 단계 A(피크 2분, 그 외 6분, 00~06시 중지, 약 840회/일)다.

## 서버에 배포

맥에서 서버로 폴더 복사:

```bash
scp -r "/Users/davepark/Documents/2-2/인공지능프로그래밍/bus-collector" bus:~/
```

서버에서:

```bash
cd ~/HopOrNot/collector
cp .env.example .env
chmod 600 .env
nano .env            # GBIS_KEY, POSTGRES_PASSWORD 채우기 (디스코드는 선택)

docker compose up -d --build
docker compose logs -f collector     # Ctrl+C 로 로그 보기 종료 (수집은 계속됨)
```

첫 빌드는 Gradle 의존성을 받느라 몇 분 걸린다.
로그에 `수집 스케줄 5개 구간, 노선 3개, 예상 호출 840회/일` 과 `정류장 N개 저장` 이 보이면 정상이다.

## 상태 확인

```bash
./scripts/check.sh
```

오늘 호출 수, 최근 1시간 노선별 관측 수, 정류장 적재 여부, 최근 이벤트를 보여준다.

## 백업

```bash
crontab -e
# 아래 줄 추가 (매일 04:10)
10 4 * * * /home/ubuntu/HopOrNot/collector/scripts/backup.sh >> /home/ubuntu/backups/backup.log 2>&1
```

`~/backups/bus_YYYY-MM-DD.sql.gz` 로 저장되고 14일 지난 파일은 지워진다.
AWS Free Plan 계정이면 만료 전에 백업 파일을 맥으로 내려받아 둔다:

```bash
scp "bus:~/backups/*.sql.gz" ~/Downloads/
```

## 맥에서 DB 보기 (SSH 터널)

```bash
ssh -N -L 5432:127.0.0.1:5432 bus
```

터널을 켜 둔 채로 DBeaver, DataGrip 등에서 `localhost:5432`, `.env` 의 DB 이름·계정으로 접속한다.

## 자주 쓰는 명령

```bash
docker compose ps                    # 상태
docker compose restart collector     # 재시작
docker compose up -d --build         # 코드 수정 후 다시 빌드해서 실행
docker compose down                  # 중지 (데이터는 볼륨에 남음)
```

`docker compose down -v` 는 DB 볼륨까지 지우므로 쓰지 않는다.

## 주의

- `.env` 와 키 파일(`*.pem`)은 Git 에 올리지 않는다 (`.gitignore` 에 포함).
- 수동으로 curl 테스트를 하면 그만큼 포털 한도를 쓰지만 수집기 카운터에는 안 잡힌다. 테스트를 많이 한 날은 `DAILY_LIMIT` 을 낮춘다.
- 인증키를 재발급하면 `.env` 의 `GBIS_KEY` 만 바꾸고 `docker compose up -d` 로 다시 띄운다.
