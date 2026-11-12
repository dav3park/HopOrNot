import {
  Envelope,
  Route,
  Station,
  VehiclePrediction,
  ForecastSlot,
  HistoryRecord,
  Alternative,
  Selection,
} from "../domain/types";
export const DEMO_NOW = "2026-11-04T08:00:00+09:00";
export const DEMO_DATE = "2026-11-04";
export const scenarios = {
  normal: "정상 3대",
  one: "차량 1대",
  two: "차량 2대",
  empty: "차량 없음",
  zeroNull: "확률 0 / null",
  partial: "일부 카드 오류",
  stale: "오래된 데이터",
  httpError: "HTTP 실패",
  noHistory: "과거 기록 없음",
  invalid: "잘못된 확률 합",
  noAlternative: "대안 없음 / ETA 불명",
  straight: "직선거리만 존재",
  denied: "위치 권한 거부",
  corrupt: "저장 데이터 손상",
  forecastError: "시간대 전망 실패",
} as const;
export type Scenario = keyof typeof scenarios;
export const routes: Route[] = ["1112", "5100", "M5107"].map((name) => ({
  routeId: `mock-route-${name}`,
  name: name as Route["name"],
  directions: ["TO_CAMPUS", "TO_SEOUL"],
}));
export const stations: Station[] = [
  {
    stationId: "mock-station-01",
    name: "예시 정류장 A",
    sequence: 1,
    latitude: null,
    longitude: null,
  },
  {
    stationId: "mock-station-02",
    name: "예시 정류장 B · 긴 이름의 중앙 환승 정류장",
    sequence: 2,
    latitude: null,
    longitude: null,
  },
  {
    stationId: "mock-station-01",
    name: "예시 정류장 A",
    sequence: 3,
    latitude: null,
    longitude: null,
  },
  ...["C", "D", "E", "F", "G"].map((name, i) => ({
    stationId: `mock-station-${i + 4}`,
    name: `예시 정류장 ${name}`,
    sequence: i + 4,
    latitude: null,
    longitude: null,
  })),
];
export const distribution = {
  zero: 0.08,
  oneToFour: 0.21,
  fiveToNine: 0.33,
  tenPlus: 0.38,
};
export function envelope<T>(
  data: T,
  stale = false,
  now = DEMO_NOW,
): Envelope<T> {
  return {
    data,
    mode: "mock",
    generatedAt: now,
    lastObservedAt: stale
      ? "2026-11-04T07:10:00+09:00"
      : "2026-11-04T07:59:00+09:00",
    isStale: stale,
  };
}
export function vehicles(scenario: Scenario): VehiclePrediction[] {
  const rows: VehiclePrediction[] = [5, 12, 21].map((minute, i) => ({
    vehicleId: `mock-vehicle-${i + 1}`,
    tripId: `mock-trip-${i + 1}`,
    arrivalOrder: i + 1,
    etaAt: `2026-11-04T08:${String(minute).padStart(2, "0")}:00+09:00`,
    etaSource: i === 0 ? "PROVIDER" : "ESTIMATED",
    distribution: { ...distribution },
    source: "MODEL",
    quality: "SUFFICIENT",
    sampleCount: 120,
    currentObservation: {
      remainingSeats: [12, 3, null][i],
      observedAt: "2026-11-04T07:59:00+09:00",
    },
    stationPredictions: stations.map((station) => ({
      stationId: station.stationId,
      stationSequence: station.sequence,
      distribution: station.sequence === 5 ? null : { ...distribution },
      source: i === 2 ? "HISTORICAL_FREQUENCY" : "MODEL",
      quality: "LIMITED",
    })),
  }));
  if (scenario === "empty") return [];
  if (scenario === "one") return rows.slice(0, 1);
  if (scenario === "two") return rows.slice(0, 2);
  if (scenario === "zeroNull") {
    rows[0].distribution = { zero: 1, oneToFour: 0, fiveToNine: 0, tenPlus: 0 };
    rows[1].distribution = null;
    rows[1].source = "UNAVAILABLE";
    rows[1].quality = "NO_DATA";
    rows[1].sampleCount = null;
  }
  if (scenario === "partial")
    rows[1].distribution = { ...distribution, zero: 0.9 };
  if (scenario === "invalid")
    rows.forEach((v) => {
      v.distribution = { ...distribution, tenPlus: 0.9 };
    });
  if (scenario === "noAlternative") rows[0].etaAt = null;
  rows[2].source = "HISTORICAL_FREQUENCY";
  rows[2].quality = "LIMITED";
  return rows;
}
export const forecast: ForecastSlot[] = [0, 1, 2].map((i) => ({
  startsAt: `2026-11-04T${8 + i}:00:00+09:00`
    .replace("T8:", "T08:")
    .replace("T9:", "T09:"),
  endsAt: `2026-11-04T${9 + i}:00:00+09:00`.replace("T9:", "T09:"),
  distribution: i === 1 ? null : distribution,
  quality: i === 1 ? "NO_DATA" : "LIMITED",
  sampleCount: i === 1 ? 0 : 24,
}));
export const history: HistoryRecord[] = [0, 3, 7, 14, null, -1].map((n, i) => ({
  eventId: `mock-event-${i}`,
  vehicleId: `mock-vehicle-${i}`,
  observedAt: `2026-11-04T07:${10 + i * 5}:00+09:00`,
  remainingSeats: n,
  observationKind: (["ARRIVAL", "DEPARTURE", "NEAR_STATION"] as const)[i % 3],
}));
export function alternatives(s: Selection, scenario: Scenario): Alternative[] {
  if (scenario === "noAlternative") return [];
  return stations
    .filter(
      (x) => x.stationId !== s.stationId || x.sequence !== s.stationSequence,
    )
    .map((station, i) => ({
      target: {
        ...s,
        stationId: station.stationId,
        stationSequence: station.sequence,
      },
      stationName: station.name,
      distanceMeters: i === 0 ? 420 : null,
      distanceKind:
        scenario === "straight"
          ? "STRAIGHT_LINE"
          : i === 0
            ? "WALKING_ROUTE"
            : "UNKNOWN",
      walkSeconds: scenario === "straight" || i !== 0 ? null : 360,
      recommendation:
        scenario === "straight" || i !== 0 ? "REFERENCE_ONLY" : "ELIGIBLE",
      reason:
        scenario === "straight"
          ? "도보 경로 미확인"
          : i === 0
            ? "예시 경로에서 도보 6분, 후보 도착까지 12분으로 도달 가능. 실제 보행 환경은 미검증입니다."
            : "경로·도착 정보 부족",
      candidate: i === 0 ? vehicles("normal")[1] : null,
    }));
}
