import type { Direction, RouteName, Station } from "./types";

export function stationDisplayNumber(
  stations: Station[],
  station: Pick<Station, "stationId" | "sequence">,
): number | null {
  const index = stations.findIndex(
    (item) =>
      item.stationId === station.stationId &&
      item.sequence === station.sequence,
  );
  return index < 0 ? null : index + 1;
}
export function directionLabel(
  routeName: RouteName | undefined,
  direction: Direction,
) {
  if (direction === "TO_CAMPUS") return "국제캠퍼스 방면";
  return routeName === "5100"
    ? "강남역 방면"
    : routeName === "1112"
      ? "강변역 방면"
      : routeName === "M5107"
        ? "서울역 방면"
        : "서울 방면";
}
