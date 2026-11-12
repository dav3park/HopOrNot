export type RouteName = "1112" | "5100" | "M5107";
export type Direction = "TO_CAMPUS" | "TO_SEOUL";
export type DataMode = "mock" | "live" | "replay";
export type SeatBand = "ZERO" | "ONE_TO_FOUR" | "FIVE_TO_NINE" | "TEN_PLUS";
export type Quality = "SUFFICIENT" | "LIMITED" | "NO_DATA";

export interface Selection {
  routeId: string;
  direction: Direction;
  stationId: string;
  stationSequence: number; // 동일 정류장 재방문·회차 구분
}
export interface Route {
  routeId: string;
  name: RouteName;
  directions: Direction[];
}
export interface Station {
  stationId: string;
  name: string;
  sequence: number;
  latitude: number | null;
  longitude: number | null;
}
export interface SeatDistribution {
  zero: number;
  oneToFour: number;
  fiveToNine: number;
  tenPlus: number;
}
export interface VehiclePrediction {
  vehicleId: string;
  tripId: string;
  arrivalOrder: number;
  etaAt: string | null; // ISO 8601 + offset
  etaSource: "PROVIDER" | "ESTIMATED" | "UNKNOWN";
  distribution: SeatDistribution | null;
  source: "MODEL" | "HISTORICAL_FREQUENCY" | "UNAVAILABLE";
  quality: Quality;
  sampleCount: number | null;
  // 디자인 연동용 선택 필드. 없으면 관측값/경로를 추측하지 않는다.
  currentObservation?: {
    remainingSeats: number | null;
    observedAt: string;
  } | null;
  stationPredictions?: {
    stationId: string;
    stationSequence: number;
    distribution: SeatDistribution | null;
    source: VehiclePrediction["source"];
    quality: Quality;
  }[];
}
export interface ForecastSlot {
  startsAt: string;
  endsAt: string;
  distribution: SeatDistribution | null;
  sampleCount: number;
  quality: Quality;
}
export interface HistoryRecord {
  eventId: string;
  vehicleId: string;
  observedAt: string;
  remainingSeats: number | null;
  observationKind: "ARRIVAL" | "DEPARTURE" | "NEAR_STATION";
}
export interface Alternative {
  target: Selection;
  stationName: string;
  distanceMeters: number | null;
  distanceKind: "WALKING_ROUTE" | "STRAIGHT_LINE" | "UNKNOWN";
  walkSeconds: number | null;
  recommendation: "ELIGIBLE" | "REFERENCE_ONLY" | "UNAVAILABLE";
  reason: string;
  candidate: VehiclePrediction | null;
}
export interface Envelope<T> {
  data: T;
  mode: DataMode;
  generatedAt: string;
  lastObservedAt: string | null;
  isStale: boolean; // 서버 판단. 클라이언트 캐시 최신성과 별개
}
export interface BusRepository {
  getRoutes(): Promise<Envelope<Route[]>>;
  getStations(
    routeId: string,
    direction: Direction,
  ): Promise<Envelope<Station[]>>;
  getPredictions(selection: Selection): Promise<Envelope<VehiclePrediction[]>>;
  getForecast(
    selection: Selection,
    date: string,
  ): Promise<Envelope<ForecastSlot[]>>;
  getHistory(
    selection: Selection,
    date: string,
  ): Promise<Envelope<HistoryRecord[]>>;
  getAlternatives(selection: Selection): Promise<Envelope<Alternative[]>>;
}
