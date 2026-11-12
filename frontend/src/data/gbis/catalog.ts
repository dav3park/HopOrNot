import data from "./routes.json";
import type { Direction, Envelope, Route, Station } from "../../domain/types";
import type { Coordinate, MapEnvelope } from "../../maps/data";

interface RouteGeometry {
  routeId: string;
  name: Route["name"];
  directions: Record<Direction, { stations: Station[]; path: Coordinate[][] }>;
}
export const gbisCatalog = data as unknown as {
  source: string;
  sourceUrl: string;
  collectedAt: string;
  coordinateSystem: string;
  routes: RouteGeometry[];
};
export const officialRoutes: Route[] = gbisCatalog.routes.map((route) => ({
  routeId: route.routeId,
  name: route.name,
  directions: ["TO_SEOUL", "TO_CAMPUS"],
}));
export function officialGeometry(routeId: string, direction: Direction) {
  return gbisCatalog.routes.find((route) => route.routeId === routeId)
    ?.directions[direction];
}
export function staticEnvelope<T>(value: T): Envelope<T> {
  return {
    data: value,
    mode: "replay",
    generatedAt: gbisCatalog.collectedAt,
    lastObservedAt: null,
    isStale: false,
  };
}
export function officialMap(
  routeId: string,
  direction: Direction,
): MapEnvelope {
  const geometry = officialGeometry(routeId, direction);
  if (!geometry) throw new Error("공식 노선 자료를 찾을 수 없습니다.");
  return staticEnvelope({
    routeId,
    direction,
    path: geometry.path,
    vehicles: [],
  });
}
