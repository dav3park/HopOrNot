import { Component } from "react";
import {
  HistoryRecord,
  Selection,
  Station,
  VehiclePrediction,
} from "../domain/types";
export interface PrototypeProps {
  route: string;
  routeViews: Record<
    string,
    {
      kind: string;
      color: string;
      soft: string;
      trail: string;
      stops: string[];
    }
  >;
  vehicles: VehiclePrediction[];
  stations: Station[];
  selection: Selection;
  mode: string;
  scale: number;
  now: string;
  stationIndex: number;
  initialScreen?: string;
  historyRecords: HistoryRecord[];
  historyLoading?: boolean;
  alternativeText?: string;
  onRoute: (route: string) => void;
  onStation: (index: number) => void;
  onHistory: (active: boolean, period: string) => void;
  onScreen: (screen: string) => void;
}
export class PrototypeCanvas extends Component<PrototypeProps> {
  handleBack(): boolean;
}
