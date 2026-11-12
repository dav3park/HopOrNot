import {
  SeatDistribution,
  Selection,
  Station,
  VehiclePrediction,
} from "./types";
import { probabilities } from "./logic";
import { theme } from "../theme";
export type SeatThreshold = 1 | 5 | 10;
export const levels: SeatThreshold[] = [1, 5, 10];
export type ProbabilityValue =
  { kind: "value"; value: number } | { kind: "missing" } | { kind: "invalid" };
export function probabilityValue(
  distribution: SeatDistribution | null,
  threshold: SeatThreshold,
): ProbabilityValue {
  try {
    const values = probabilities(distribution);
    return values
      ? { kind: "value", value: values[levels.indexOf(threshold)] }
      : { kind: "missing" };
  } catch {
    return { kind: "invalid" };
  }
}
export const probabilityText = (p: ProbabilityValue) =>
  p.kind === "value"
    ? `${Math.round(p.value * 100)}%`
    : p.kind === "invalid"
      ? "오류"
      : "—";
export const probabilityColor = (p: ProbabilityValue) =>
  p.kind !== "value"
    ? theme.colors.line
    : p.value >= 0.7
      ? theme.colors.accent
      : p.value >= 0.4
        ? theme.colors.mediumProbability
        : theme.colors.lowProbability;
export const currentSeatsText = (n: number | null | undefined) =>
  typeof n === "number" && Number.isInteger(n) && n >= 0
    ? `${n}석`
    : "정보 없음";
export function stationDistribution(
  vehicle: VehiclePrediction,
  station: Station,
  selected: Selection,
): SeatDistribution | null {
  // 선택 정류장은 핵심 응답이 유일한 기준. 부가 경로 데이터로 오류/결측을 덮지 않는다.
  if (
    station.stationId === selected.stationId &&
    station.sequence === selected.stationSequence
  )
    return vehicle.distribution;
  return (
    vehicle.stationPredictions?.find(
      (p) =>
        p.stationId === station.stationId &&
        p.stationSequence === station.sequence,
    )?.distribution ?? null
  );
}
export function referenceVehicle(
  vehicles: VehiclePrediction[],
  threshold: SeatThreshold,
) {
  return (
    vehicles
      .slice()
      .sort((a, b) => a.arrivalOrder - b.arrivalOrder)
      .slice(0, 3)
      .find((v) => {
        const p = probabilityValue(v.distribution, threshold);
        return (
          v.source !== "UNAVAILABLE" &&
          v.quality !== "NO_DATA" &&
          p.kind === "value" &&
          p.value >= 0.7
        );
      }) ?? null
  );
}
