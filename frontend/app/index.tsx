import { useLocalSearchParams } from "expo-router";
import { MapHome } from "../src/features/map-home/home";
export default function Index() {
  const p = useLocalSearchParams();
  return (
    <MapHome
      key={[p.routeId, p.direction, p.stationId, p.stationSequence].join("/")}
    />
  );
}
