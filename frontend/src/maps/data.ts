import { z } from "zod";
import { config } from "../config";
import { Direction, Station } from "../domain/types";
import { officialMap } from "../data/gbis/catalog";

export const coordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
const iso = z.string().datetime({ offset: true });
export const mapEnvelopeSchema = z.object({
  data: z.object({
    routeId: z.string().min(1),
    direction: z.enum(["TO_CAMPUS", "TO_SEOUL"]),
    // Separate segments preserve gaps; never connect unrelated path pieces.
    path: z.array(z.array(coordinateSchema).min(2)),
    vehicles: z.array(
      coordinateSchema.extend({
        vehicleId: z.string().min(1),
        observedAt: iso,
        remainingSeats: z.number().int().nonnegative().nullable(),
      }),
    ),
  }),
  mode: z.enum(["live", "replay", "mock"]),
  generatedAt: iso,
  lastObservedAt: iso.nullable(),
  isStale: z.boolean(),
});
export type Coordinate = z.infer<typeof coordinateSchema>;
export type MapEnvelope = z.infer<typeof mapEnvelopeSchema>;
export type MapVehicle = MapEnvelope["data"]["vehicles"][number];
export type MapStation = Station & Coordinate;
export function locatedStations(stations: Station[]): MapStation[] {
  return stations.filter(
    (s): s is MapStation => coordinateSchema.safeParse(s).success,
  );
}
export function recentVehicles(
  envelope: MapEnvelope | undefined,
  now: number,
): MapVehicle[] {
  if (!envelope || envelope.isStale) return [];
  const clock =
    envelope.mode === "live" ? now : Date.parse(envelope.generatedAt);
  return envelope.data.vehicles.filter((v) => {
    const age = clock - Date.parse(v.observedAt);
    return age >= -60000 && age <= 120000;
  });
}
export async function fetchRouteMap(
  routeId: string,
  direction: Direction,
): Promise<MapEnvelope> {
  if (config.mode === "mock") return officialMap(routeId, direction);
  if (!/^https?:\/\//.test(config.baseUrl))
    throw new Error("지도 데이터 서버 주소를 설정해 주세요.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/$/, "")}/routes/${encodeURIComponent(routeId)}/map?direction=${direction}`,
      { signal: controller.signal },
    );
    if (!response.ok)
      throw new Error(`지도 데이터 요청 실패 (${response.status})`);
    const parsed = mapEnvelopeSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("지도 좌표 응답을 확인해 주세요.");
    if (
      parsed.data.data.routeId !== routeId ||
      parsed.data.data.direction !== direction
    )
      throw new Error("요청한 노선·방향과 지도 데이터가 다릅니다.");
    const ids = parsed.data.data.vehicles.map((v) => v.vehicleId);
    if (new Set(ids).size !== ids.length)
      throw new Error("버스 위치가 중복되었습니다.");
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}
