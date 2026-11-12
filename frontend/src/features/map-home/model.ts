import {
  Alternative,
  ForecastSlot,
  Selection,
  Station,
  VehiclePrediction,
} from "../../domain/types";
import { probabilityValue, SeatThreshold } from "../../domain/presentation";
import { theme } from "../../theme";

export const routeColors: Record<string, string> = {
  "5100": theme.colors.primary,
  M5107: "#245EC7",
  "1112": "#087F72",
};
export const thresholdName = (n: SeatThreshold) => `${n}석 이상`;
export function chooseVehicle(
  vehicles: VehiclePrediction[],
  threshold: SeatThreshold,
  now?: number,
) {
  return [...vehicles]
    .sort((a, b) => a.arrivalOrder - b.arrivalOrder)
    .find((v) => {
      const p = probabilityValue(v.distribution, threshold);
      return (
        (!now || !v.etaAt || Date.parse(v.etaAt) >= now) &&
        v.source !== "UNAVAILABLE" &&
        v.quality !== "NO_DATA" &&
        p.kind === "value" &&
        p.value >= 0.7
      );
    });
}
export function minutesUntil(eta: string | null, now: number) {
  if (!eta || !Number.isFinite(Date.parse(eta))) return null;
  return Math.max(0, Math.ceil((Date.parse(eta) - now) / 60000));
}
export function eligibleAlternatives(rows: Alternative[], now: number) {
  return rows.filter(
    (row) =>
      row.recommendation === "ELIGIBLE" &&
      row.distanceKind === "WALKING_ROUTE" &&
      row.walkSeconds !== null &&
      row.candidate?.etaAt &&
      now + row.walkSeconds * 1000 <= Date.parse(row.candidate.etaAt),
  );
}
export function firstComfortableSlot(
  rows: ForecastSlot[],
  threshold: SeatThreshold,
  now: number,
) {
  return rows
    .slice()
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .find((row) => {
      const p = probabilityValue(row.distribution, threshold);
      return (
        Date.parse(row.endsAt) > now &&
        row.quality !== "NO_DATA" &&
        p.kind === "value" &&
        p.value >= 0.7
      );
    });
}
export function selectionAt(
  routeId: string,
  direction: Selection["direction"],
  station: Station,
): Selection {
  return {
    routeId,
    direction,
    stationId: station.stationId,
    stationSequence: station.sequence,
  };
}
