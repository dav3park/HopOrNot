import {
  BusRepository,
  Selection,
  Envelope,
  Route,
  Station,
  VehiclePrediction,
  ForecastSlot,
  HistoryRecord,
  Alternative,
} from "../domain/types";
import { config } from "../config";
import * as fixture from "../mocks/fixtures";
import { z } from "zod";
const selection = z.object({
  routeId: z.string(),
  direction: z.enum(["TO_CAMPUS", "TO_SEOUL"]),
  stationId: z.string(),
  stationSequence: z.number().int().positive(),
});
const distribution = z
  .object({
    zero: z.number(),
    oneToFour: z.number(),
    fiveToNine: z.number(),
    tenPlus: z.number(),
  })
  .nullable();
const quality = z.enum(["SUFFICIENT", "LIMITED", "NO_DATA"]);
const iso = z.string().datetime({ offset: true });
const vehicle = z.object({
  vehicleId: z.string(),
  tripId: z.string(),
  arrivalOrder: z.number().int().positive(),
  etaAt: iso.nullable(),
  etaSource: z.enum(["PROVIDER", "ESTIMATED", "UNKNOWN"]),
  distribution,
  source: z.enum(["MODEL", "HISTORICAL_FREQUENCY", "UNAVAILABLE"]),
  quality,
  sampleCount: z.number().nonnegative().nullable(),
  currentObservation: z
    .object({ remainingSeats: z.number().int().nullable(), observedAt: iso })
    .nullable()
    .optional(),
  stationPredictions: z
    .array(
      z.object({
        stationId: z.string(),
        stationSequence: z.number().int().positive(),
        distribution,
        source: z.enum(["MODEL", "HISTORICAL_FREQUENCY", "UNAVAILABLE"]),
        quality,
      }),
    )
    .optional(),
});
export const schemas = {
  routes: z.array(
    z.object({
      routeId: z.string(),
      name: z.enum(["1112", "5100", "M5107"]),
      directions: z.array(z.enum(["TO_CAMPUS", "TO_SEOUL"])),
    }),
  ),
  stations: z.array(
    z.object({
      stationId: z.string(),
      name: z.string(),
      sequence: z.number().int().positive(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    }),
  ),
  predictions: z.array(vehicle),
  forecast: z.array(
    z.object({
      startsAt: iso,
      endsAt: iso,
      distribution,
      sampleCount: z.number().nonnegative(),
      quality,
    }),
  ),
  history: z.array(
    z.object({
      eventId: z.string(),
      vehicleId: z.string(),
      observedAt: iso,
      remainingSeats: z.number().int().nullable(),
      observationKind: z.enum(["ARRIVAL", "DEPARTURE", "NEAR_STATION"]),
    }),
  ),
  alternatives: z.array(
    z.object({
      target: selection,
      stationName: z.string(),
      distanceMeters: z.number().nonnegative().nullable(),
      distanceKind: z.enum(["WALKING_ROUTE", "STRAIGHT_LINE", "UNKNOWN"]),
      walkSeconds: z.number().nonnegative().nullable(),
      recommendation: z.enum(["ELIGIBLE", "REFERENCE_ONLY", "UNAVAILABLE"]),
      reason: z.string(),
      candidate: vehicle.nullable(),
    }),
  ),
};
export function createMockRepository(
  scenario: fixture.Scenario,
  now = () => fixture.DEMO_NOW,
): BusRepository {
  async function result<T>(data: T, section?: string): Promise<Envelope<T>> {
    await new Promise((resolve) => setTimeout(resolve, 240));
    if (scenario === "httpError" && section === "predictions")
      throw new Error("예시 HTTP 503 · 요청 실패");
    if (scenario === "forecastError" && section === "forecast")
      throw new Error("예시 시간대 전망 요청 실패");
    return fixture.envelope(data, scenario === "stale", now());
  }
  return {
    getRoutes: () => result(fixture.routes),
    getStations: (routeId, direction) =>
      result(
        fixture.routes.some(
          (r) => r.routeId === routeId && r.directions.includes(direction),
        )
          ? fixture.stations
          : [],
      ),
    getPredictions: () => result(fixture.vehicles(scenario), "predictions"),
    getForecast: (_, date) =>
      result(date === fixture.DEMO_DATE ? fixture.forecast : [], "forecast"),
    getHistory: (_, date) =>
      result(
        scenario !== "noHistory" && date === fixture.DEMO_DATE
          ? fixture.history
          : [],
      ),
    getAlternatives: (s) => result(fixture.alternatives(s, scenario)),
  };
}
export function createHttpRepository(baseUrl: string): BusRepository {
  async function get<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string | number> = {},
  ): Promise<Envelope<T>> {
    if (!baseUrl)
      throw new Error(
        "API 설정 오류: EXPO_PUBLIC_API_BASE_URL을 입력해 주세요.",
      );
    if (!/^https?:\/\//.test(baseUrl))
      throw new Error("API 주소는 http:// 또는 https://로 시작해야 합니다.");
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, "")}${path}?${query}`,
        { signal: controller.signal },
      );
      if (!response.ok)
        throw new Error(`서버 요청 실패 (HTTP ${response.status})`);
      const parsed = z
        .object({
          data: schema,
          mode: z.enum(["mock", "live", "replay"]),
          generatedAt: iso,
          lastObservedAt: iso.nullable(),
          isStale: z.boolean(),
        })
        .safeParse(await response.json());
      if (!parsed.success)
        throw new Error("API 응답 형식 오류 · 서버 계약을 확인해 주세요.");
      return parsed.data as Envelope<T>;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    getRoutes: () => get<Route[]>("/routes", schemas.routes),
    getStations: (routeId, direction) =>
      get<Station[]>(
        `/routes/${encodeURIComponent(routeId)}/stations`,
        schemas.stations,
        { direction },
      ),
    getPredictions: (s) =>
      get<VehiclePrediction[]>("/predictions", schemas.predictions, { ...s }),
    getForecast: (s, date) =>
      get<ForecastSlot[]>("/forecast", schemas.forecast, { ...s, date }),
    getHistory: (s, date) =>
      get<HistoryRecord[]>("/history", schemas.history, { ...s, date }),
    getAlternatives: (s) =>
      get<Alternative[]>("/alternatives", schemas.alternatives, { ...s }),
  };
}
export function repository(scenario: fixture.Scenario): BusRepository {
  if (config.mode === "mock") return createMockRepository(scenario);
  if (config.mode === "api") return createHttpRepository(config.baseUrl);
  const fail = async (): Promise<never> => {
    throw new Error("DATA_MODE 설정 오류: mock 또는 api를 사용하세요.");
  };
  return {
    getRoutes: fail,
    getStations: fail,
    getPredictions: fail,
    getForecast: fail,
    getHistory: fail,
    getAlternatives: fail,
  };
}
export const requestKey = (section: string, s: Selection, date?: string) => [
  section,
  s.routeId,
  s.direction,
  s.stationId,
  s.stationSequence,
  date ?? "",
];
