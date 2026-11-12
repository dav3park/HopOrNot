import { stations as original } from "../../mocks/fixtures";
import {
  Alternative,
  ForecastSlot,
  Selection,
  Station,
  SeatDistribution,
  VehiclePrediction,
} from "../../domain/types";
// Screen-design fixtures only. Schematic coordinates are pixels, never GPS.
export const MAP_DEMO_NOW = "2026-11-12T18:12:00+09:00";
const names = [
  "경희대차고지",
  "국제캠퍼스",
  "경희대차고지",
  "경희대학교",
  "경희대정문",
  "영통역",
  "청명역",
  "기흥IC입구",
];
export const demoStations = original.map((s, i) => ({ ...s, name: names[i] }));
export function demoDistribution(
  one: number,
  five = one * 0.77,
  ten = one * 0.41,
): SeatDistribution {
  return {
    zero: 1 - one,
    oneToFour: one - five,
    fiveToNine: five - ten,
    tenPlus: ten,
  };
}
export function demoVehicles(
  selection: Selection,
  stops: Station[] = demoStations,
): VehiclePrediction[] {
  return [0.12, 0.58, 0.92, 0.98].map((probability, i) => ({
    vehicleId: `mock-map-bus-${i + 1}`,
    tripId: `mock-map-trip-${i + 1}`,
    arrivalOrder: i + 1,
    etaAt: new Date(
      Date.parse(MAP_DEMO_NOW) + [1, 5, 11, 15][i] * 60000,
    ).toISOString(),
    etaSource: "ESTIMATED",
    distribution:
      i === 2
        ? { zero: 0.08, oneToFour: 0.21, fiveToNine: 0.33, tenPlus: 0.38 }
        : demoDistribution(probability),
    source: "MODEL",
    quality: "SUFFICIENT",
    sampleCount: 120,
    currentObservation: {
      remainingSeats: [4, 18, 37, 44][i],
      observedAt: MAP_DEMO_NOW,
    },
    stationPredictions: stops.map((s, index) => ({
      stationId: s.stationId,
      stationSequence: s.sequence,
      distribution:
        s.sequence === selection.stationSequence
          ? i === 2
            ? { zero: 0.08, oneToFour: 0.21, fiveToNine: 0.33, tenPlus: 0.38 }
            : demoDistribution(probability)
          : demoDistribution(
              Math.max(
                0,
                Math.min(
                  0.99,
                  probability +
                    (stops.findIndex(
                      (st) =>
                        st.stationId === selection.stationId &&
                        st.sequence === selection.stationSequence,
                    ) -
                      index) *
                      0.05,
                ),
              ),
            ),
      source: "MODEL",
      quality: "LIMITED",
    })),
  }));
}
export function demoAlternatives(selection: Selection): Alternative[] {
  if (selection.stationSequence === 1) return [];
  const s = demoStations.find(
    (s) => s.sequence === Math.max(1, selection.stationSequence - 1),
  )!;
  const candidate = demoVehicles(selection)[2];
  return [
    {
      target: {
        ...selection,
        stationId: s.stationId,
        stationSequence: s.sequence,
      },
      stationName: s.name,
      distanceMeters: 420,
      distanceKind: "WALKING_ROUTE",
      walkSeconds: 360,
      recommendation: "ELIGIBLE",
      reason: "예시 도보 경로",
      candidate: {
        ...candidate,
        etaAt: "2026-11-12T18:19:00+09:00",
        distribution: demoDistribution(0.97),
      },
    },
  ];
}
export const demoForecast: ForecastSlot[] = [
  0.55, 0.42, 0.3, 0.18, 0.12, 0.08, 0.2, 0.44, 0.63, 0.74, 0.82, 0.88, 0.91,
  0.94, 0.96, 0.97,
].map((p, i) => ({
  startsAt: new Date(
    Date.parse("2026-11-12T17:30:00+09:00") + i * 600000,
  ).toISOString(),
  endsAt: new Date(
    Date.parse("2026-11-12T17:30:00+09:00") + (i + 1) * 600000,
  ).toISOString(),
  distribution: demoDistribution(p),
  sampleCount: 24,
  quality: "LIMITED",
}));
