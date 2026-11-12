# 카카오맵 연결

지도는 앱의 기본 홈입니다. 노선·정류장 확률을 지도 위에 표시하고 아래 패널에서 버스 상세·정류장 비교·시간대 전망을 엽니다. 모든 모드에서 실제 카카오 지도가 기본입니다. 기본 모드는 GBIS에서 확보한 실제 노선·정류장 스냅샷을 사용하고 확률만 예시임을 표시합니다. 예시 노선도 전환은 제거했습니다.

## 키 설정

카카오 Developers 계정에서 앱을 만들고 카카오맵 사용을 활성화합니다. `.env.example`을 참고해 `.env.local`에 다음 값을 입력한 뒤 Expo 서버를 다시 시작합니다.

```dotenv
EXPO_PUBLIC_KAKAO_JAVASCRIPT_KEY=발급받은_JavaScript_키
EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=발급받은_Native_앱_키
```

JavaScript/Native 앱 키는 클라이언트용입니다. REST API 키, Admin 키, GBIS 서비스 키는 앱에 넣지 않습니다.

- 웹: JavaScript 키의 SDK 도메인에 실제 실행 origin을 등록합니다. 예: `http://localhost:8081`. 다른 포트·배포 주소도 각각 등록합니다. `npx expo start --web --port 8081`로 실행합니다.
- Android: `app.json`의 package `com.hopornot.app`과 실제 빌드 서명 키 해시를 등록합니다. 개발/출시 서명이 다르면 각각 등록합니다.
- iOS: bundle ID `com.hopornot.app`을 등록합니다. 이미 팀에서 쓰는 앱 ID가 있다면 `app.json`과 카카오 설정 양쪽을 동일하게 변경합니다.
- 네이티브 SDK는 Expo Go에 포함되지 않습니다. 개발 환경을 설치한 뒤 `npx expo run:android` 또는 `npx expo run:ios`로 개발 빌드합니다. 키가 없어도 기존 화면은 실행됩니다.

키 발급·플랫폼 등록은 계정 소유자가 해야 합니다. JavaScript 키는 로컬 `.env.local`에 설정되어 있으며 Git에서 제외됩니다. Native 앱 키는 별도로 설정해야 합니다.

## 운행 데이터 연결

카카오 지도 SDK는 배경 지도를 제공합니다. 5100·1112·M5107의 실제 노선·정류장 좌표는 GBIS 공개 자료에서 수집해 앱에 포함했습니다. 추가 키 없이 노선과 정류장을 표시하며, [데이터 출처와 갱신 방법](gbis-routes.md)을 참고하세요. 실제 차량 GPS와 모델 확률은 서버 연결이 필요합니다.

```dotenv
EXPO_PUBLIC_DATA_MODE=api
EXPO_PUBLIC_API_BASE_URL=https://팀의-서버주소
```

기존 정류장 API가 `latitude`, `longitude`를 내려주어야 정류장 마커가 표시됩니다. 아래 지도 전용 API는 **프론트에서 새로 정의한 계약이며 서버 구현이 필요합니다.** 기존 예측 API를 변경하지 않습니다.

`GET /routes/{routeId}/map?direction=TO_SEOUL` (`TO_CAMPUS`도 지원)

응답 형식 예시(좌표는 계약 설명용이며 앱의 실제 노선 데이터로 사용하지 않습니다):

```json
{
  "data": {
    "routeId": "200000115",
    "direction": "TO_SEOUL",
    "path": [
      [
        { "latitude": 37.2, "longitude": 127.1 },
        { "latitude": 37.3, "longitude": 127.2 }
      ]
    ],
    "vehicles": [
      {
        "vehicleId": "stable-provider-vehicle-id",
        "latitude": 37.25,
        "longitude": 127.15,
        "observedAt": "2026-11-12T08:00:00+09:00",
        "remainingSeats": 0
      }
    ]
  },
  "mode": "live",
  "generatedAt": "2026-11-12T08:00:05+09:00",
  "lastObservedAt": "2026-11-12T08:00:00+09:00",
  "isStale": false
}
```

- WGS84 위도·경도(숫자)를 사용합니다. `path`는 방향별 도로 경로의 좌표열 배열입니다. 떨어진 구간은 별도 배열로 보내며, 정류장 간 직선을 도로 경로로 간주하지 않습니다. 경로가 없으면 `[]`입니다.
- `vehicles`에는 요청한 노선·방향의 차량만 포함합니다. `vehicleId`는 응답 내에서 유일하고 갱신 사이에도 동일해야 합니다. 차량 없으면 `[]`, 좌석 정보 없으면 `null`입니다. 만석은 `0`입니다.
- `observedAt`은 위치 수집 시각이며 응답 생성 시각으로 대체하지 않습니다. 120초 이상 지난 위치, 60초 이상 미래 위치, `isStale: true` 응답의 차량은 숨깁니다. 갱신이 끊겨도 계속 움직이는 것처럼 보간하지 않습니다.
- 앱이 활성화되고 지도 화면을 보고 있을 때 15초마다 갱신합니다. 웹은 탭이 숨겨졌을 때 갱신하지 않습니다. 전체 노선 버튼으로 다시 범위를 맞추기 전에는 갱신마다 지도를 재중앙화하지 않습니다.
- `mode: replay`는 응답 `generatedAt`을 재생 시각으로 사용하고 화면에 과거 재생을 표시합니다.
- 웹 서버는 앱 origin에 대해 CORS를 허용해야 합니다. 실제 모바일 기기에서 API 주소로 `localhost`를 쓰면 개발 PC가 아닌 휴대폰 자체를 가리킵니다.

## 참고 문서

- [카카오 지도 Web API 가이드](https://apis.map.kakao.com/web/guide/)
- [카카오 지도 JavaScript API](https://apis.map.kakao.com/web/documentation/)
- [React Native Kakao 지도 SDK 설치·사용법](https://rnkakao.mjstudio.net/en/docs/map/intro) — 공식 네이티브 SDK를 감싸는 커뮤니티 패키지

검증: 타입 검사·린트 통과, 데이터/회귀 테스트 21개 및 UI 테스트 29개 통과, 웹·iOS·Android 번들 생성 통과. Chrome에서 모의 SDK/HTTP 응답으로 마커 표시, 정류장 선택, 만석 0석 표시, 15초 GPS 갱신, 갱신 중 지도 범위 유지, 전체 노선 재맞춤을 확인했습니다(페이지 오류 없음). 모의 SDK 검증은 실제 지도 타일·인증 확인이 아닙니다. 실제 지도 인증과 iOS/Android 지도 구동은 키 등록 및 네이티브 빌드 후 확인해야 합니다.

2026-11-12 실제 웹 연결 확인: 제공된 JavaScript 키를 로컬 환경에 설정한 뒤 `http://localhost:8081/map`에서 SDK 응답 HTTP 200, 지도 초기화, 지도 이미지 13개 로딩을 확인했습니다. 브라우저 오류와 카카오 관련 요청 실패는 없었습니다. 실제 버스 GPS와 노선 경로는 아직 연결되지 않았습니다.
