import { useQuery } from "@tanstack/react-query";
import { useBus } from "./provider";
import { config } from "../config";
import {
  Direction,
  Selection,
  Envelope,
  VehiclePrediction,
  ForecastSlot,
  HistoryRecord,
  Alternative,
} from "../domain/types";
import { requestKey } from "../data/repository";
import {
  officialRoutes,
  officialGeometry,
  staticEnvelope,
} from "../data/gbis/catalog";
export function useRoutes() {
  const { repo, cacheScenario } = useBus();
  return useQuery({
    queryKey: ["routes", config.mode, cacheScenario],
    queryFn: () =>
      config.mode === "mock"
        ? Promise.resolve(staticEnvelope(officialRoutes))
        : repo.getRoutes(),
  });
}
export function useStations(routeId: string, direction: Direction) {
  const { repo, cacheScenario } = useBus();
  return useQuery({
    queryKey: ["stations", config.mode, cacheScenario, routeId, direction],
    queryFn: () => {
      const official =
        config.mode === "mock"
          ? officialGeometry(routeId, direction)
          : undefined;
      return official
        ? Promise.resolve(staticEnvelope(official.stations))
        : repo.getStations(routeId, direction);
    },
    enabled: !!routeId,
  });
}
type SectionData = {
  getPredictions: VehiclePrediction[];
  getForecast: ForecastSlot[];
  getHistory: HistoryRecord[];
  getAlternatives: Alternative[];
};
export function useSection<K extends keyof SectionData>(
  method: K,
  s: Selection,
  date = "",
  enabled = true,
) {
  const { repo, cacheScenario } = useBus();
  const fetchSection = repo[method] as (
    selection: Selection,
    date: string,
  ) => Promise<Envelope<SectionData[K]>>;
  return useQuery<Envelope<SectionData[K]>>({
    queryKey: [config.mode, cacheScenario, ...requestKey(method, s, date)],
    queryFn: () => fetchSection(s, date),
    enabled,
    refetchInterval:
      config.mode === "api" && method === "getPredictions" ? 30000 : false,
    refetchIntervalInBackground: false,
  });
}
