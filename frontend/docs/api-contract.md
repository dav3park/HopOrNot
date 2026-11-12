# 프론트용 API 계약 초안

실제 서버가 존재한다는 의미가 아닙니다. 타입 원본은 `src/domain/types.ts`, HTTP 구조 검증은 `src/data/repository.ts`입니다. 확정 계약이 다르면 adapter에서 매핑합니다.

## 공통

GET, JSON 응답. 시각은 ISO 8601 + offset, 표시는 Asia/Seoul. 확률은 0~1. API 주소는 공개 서비스 주소이며 앱에 비밀키를 넣지 않습니다. HTTP 비정상 상태·10초 타임아웃·잘못된 응답은 오류이며 예시로 대체하지 않습니다.

```json
{
  "data": [],
  "mode": "live",
  "generatedAt": "2026-11-04T08:00:00+09:00",
  "lastObservedAt": "2026-11-04T07:59:00+09:00",
  "isStale": false
}
```

`mode`: mock(예시), live(서비스 데이터), replay(과거 기록 재현). 실제 기록·모델·과거 빈도의 구분은 내부 항목 출처로 별도 표시합니다. `lastObservedAt`은 null 가능, `isStale`은 서버가 판단합니다. 클라이언트 query 갱신 시각과 별개입니다. HTTP 오류 때 보존한 캐시도 최신 정보 아님으로 표시합니다.

## 요청

| 경로                                             | query                         | data                                               |
| ------------------------------------------------ | ----------------------------- | -------------------------------------------------- |
| `/routes`                                        | 없음                          | `Route[]`                                          |
| `/routes/{encodeURIComponent(routeId)}/stations` | `direction`                   | `Station[]`                                        |
| `/predictions`                                   | 선택 정보                     | `VehiclePrediction[]` (0~3개, 차량 없으면 빈 배열) |
| `/forecast`                                      | 선택 정보 + `date=YYYY-MM-DD` | `ForecastSlot[]`                                   |
| `/history`                                       | 선택 정보 + `date=YYYY-MM-DD` | `HistoryRecord[]`                                  |
| `/alternatives`                                  | 선택 정보                     | `Alternative[]`                                    |

선택 정보는 `routeId`, `direction=TO_CAMPUS|TO_SEOUL`, `stationId`, `stationSequence`(양의 정수)입니다. 방문 순번은 동일 정류장 재방문 구분에 필수입니다. 날짜는 서울의 달력 날짜이며 과거 기록의 시간 필터는 받은 날짜 자료에 대해 클라이언트에서 00–12/12–24시로 적용합니다.

```text
GET /history?routeId=mock-route-5100&direction=TO_CAMPUS&stationId=mock-station-01&stationSequence=1&date=2026-11-04
GET /routes/mock-route-5100/stations?direction=TO_CAMPUS
```

위 ID는 예시에만 사용하며 실제 ID를 추측한 값이 아닙니다.

## data 항목별 응답 예시

아래 항목들을 공통 envelope의 data 배열에 넣습니다.

```json
{
  "routeId": "mock-route-5100",
  "name": "5100",
  "directions": ["TO_CAMPUS", "TO_SEOUL"]
}
```

노선 name은 1112/5100/M5107만 지원합니다.

```json
{
  "stationId": "mock-station-01",
  "name": "예시 정류장 A",
  "sequence": 1,
  "latitude": null,
  "longitude": null
}
```

목록은 방문 순서대로 반환합니다. 동일 stationId가 다른 sequence로 존재할 수 있습니다. 위치가 없으면 null이며 앱은 좌표를 생성하지 않습니다.

```json
{
  "vehicleId": "mock-vehicle-1",
  "tripId": "mock-trip-1",
  "arrivalOrder": 1,
  "etaAt": "2026-11-04T08:05:00+09:00",
  "etaSource": "ESTIMATED",
  "distribution": {
    "zero": 0.08,
    "oneToFour": 0.21,
    "fiveToNine": 0.33,
    "tenPlus": 0.38
  },
  "source": "MODEL",
  "quality": "SUFFICIENT",
  "sampleCount": 120
}
```

`etaSource`: PROVIDER/ESTIMATED/UNKNOWN, `etaAt`: null 가능(임의 ETA 표시 금지). `source`: MODEL/HISTORICAL_FREQUENCY/UNAVAILABLE. 서버가 fallback 출처를 결정합니다. `quality`: SUFFICIENT/LIMITED/NO_DATA. `sampleCount`: null 가능. 차량은 arrivalOrder 순으로 최대 3대 표시합니다.

`distribution` null은 예측 없음. 네 값은 각각 유한한 0~1이며 합 오차는 **0.001 이하**입니다. 앱은 임의 정규화하지 않습니다. 숫자 분포의 합/범위 오류는 해당 카드의 데이터 오류로 표시합니다. 구조가 깨진 응답은 요청 오류입니다. 누적값은 1석 이상=oneToFour+fiveToNine+tenPlus, 5석 이상=fiveToNine+tenPlus, 10석 이상=tenPlus입니다.

```json
{
  "startsAt": "2026-11-04T08:00:00+09:00",
  "endsAt": "2026-11-04T09:00:00+09:00",
  "distribution": null,
  "sampleCount": 0,
  "quality": "NO_DATA"
}
```

시간대 전망은 특정 차량을 의미하지 않습니다. 결측 분포는 null로 반환해야 합니다.

```json
{
  "eventId": "mock-event-1",
  "vehicleId": "mock-vehicle-1",
  "observedAt": "2026-11-04T07:15:00+09:00",
  "remainingSeats": 3,
  "observationKind": "ARRIVAL"
}
```

`observationKind`: ARRIVAL/DEPARTURE/NEAR_STATION. remainingSeats는 정수 또는 null. 외부 API -1은 정보 없음이며 0과 다릅니다. 직접 관측만 기록 목록에 넣습니다. 없는 날짜에는 가상 행을 반환하지 않습니다.

```json
{
  "target": {
    "routeId": "mock-route-5100",
    "direction": "TO_CAMPUS",
    "stationId": "mock-station-02",
    "stationSequence": 2
  },
  "stationName": "예시 정류장 B",
  "distanceMeters": 420,
  "distanceKind": "STRAIGHT_LINE",
  "walkSeconds": null,
  "recommendation": "REFERENCE_ONLY",
  "reason": "직선거리만 있어 도보 도달 가능성을 판단할 수 없습니다.",
  "candidate": null
}
```

`distanceKind`: WALKING_ROUTE/STRAIGHT_LINE/UNKNOWN. `recommendation`: ELIGIBLE/REFERENCE_ONLY/UNAVAILABLE. distanceMeters/walkSeconds/candidate는 null 가능. 후보는 동일 노선·방향이어야 합니다. 서버가 경로와 ETA의 비교를 판단합니다. 직선거리를 도보거리로 표현하거나 도보시간을 추정하지 않습니다. 현재 위치 좌표/최대 도보시간 요청 필드는 아직 없습니다.

## 미합의 항목

- 실제 서버 URL, 인증 및 오류 코드/메시지 형식(현재 HTTP 상태와 일반 안내 사용).
- 운영 노선 ID, 방향 코드 매핑, 정류장 방문 순번 안정성 및 공식 좌표.
- 데이터 수집 시작/끝·날짜별 가용성 메타데이터 확장: 현재 인터페이스에는 없으므로 live의 빈 기록은 ‘기록 없음 또는 수집 범위 밖’으로 안내. 구체적인 live 수집 기간은 추측하지 않음.
- 시간대 전망 출처/모델 버전·품질 기준·최소 표본·오래됨 판단 임계값.
- ETA freshness, 운행/차량 식별자 수명, pagination(초안은 날짜당 전체 기록), 실시간 갱신 주기(초안 30초).
- 대안 비교의 출발 위치 기준, 실제 보행 경로 제공자, 이동시간/ETA 불확실성, 추천 조건과 보류 reason 코드.
- 구조가 깨진 일부 항목의 서버 격리/부분 응답 형식. 현재 숫자 분포 오류는 카드 단위 격리, 구조 오류는 섹션 단위 오류.

## 2026-11-06 디자인 연동용 선택 필드 제안

`VehiclePrediction`에 아래 선택 필드를 추가했습니다. 기존 필드만 반환해도 정상 동작합니다. API 확정 사항이 아니며 서버와 합의해야 합니다.

```json
{
  "currentObservation": {
    "remainingSeats": 12,
    "observedAt": "2026-11-04T07:59:00+09:00"
  },
  "stationPredictions": [
    {
      "stationId": "mock-station-02",
      "stationSequence": 2,
      "distribution": {
        "zero": 0.08,
        "oneToFour": 0.21,
        "fiveToNine": 0.33,
        "tenPlus": 0.38
      },
      "source": "MODEL",
      "quality": "LIMITED"
    }
  ]
}
```

currentObservation은 공공 제공자의 직접 관측이어야 하며 모델 추정치를 넣지 않습니다. -1/null은 정보 없음입니다. stationPredictions는 **같은 차량·운행·노선·방향**의 각 방문 시 도착 좌석 분포입니다. 현재 선택 정류장의 최상위 distribution이 우선이며 부가 필드로 null/오류를 덮어쓰지 않습니다. 누락된 위치·정류장별 분포를 보간하거나 생성하지 않습니다.

실시간 위치와 차량별 과거 정류장 관측은 별도 계약이 필요합니다. 자세한 모델 계획 정합성 및 미합의 항목은 [디자인·모델 연결 기록](design-model-integration.md)을 참고하세요.

# 지도 확장 계약

선택적으로 추가한 `GET /routes/{routeId}/map?direction=...`의 응답과 운행 데이터 수집 요구사항은 [카카오맵 연결 안내](kakao-map.md)에 정의했습니다. 프론트에서 새로 제안한 API이며, 서버에 이미 구현되어 있다는 의미는 아닙니다.
