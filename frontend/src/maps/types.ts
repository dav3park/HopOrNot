import type { Coordinate, MapStation, MapVehicle } from "./data";
export interface RouteMapProps {
  stations: MapStation[];
  path: Coordinate[][];
  vehicles: MapVehicle[];
  selectedSequence: number;
  focusVersion: number;
  focusCoordinate?: Coordinate;
  routeColor?: string;
  controlsInset?: number;
  routeLines?: { id: string; color: string; path: Coordinate[][] }[];
  stationLabels?: Record<
    number,
    { probability: string; color: string; tag?: string }
  >;
  onStation: (station: MapStation) => void;
  onVehicle: (vehicle: MapVehicle) => void;
}
// Viewport only. This does not assign coordinates to any station or vehicle.
export const DEFAULT_CENTER = { latitude: 37.5665, longitude: 126.978 };
