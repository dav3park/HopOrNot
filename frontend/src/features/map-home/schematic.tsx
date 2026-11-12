import { Pressable, StyleSheet, Text, View } from "react-native";
import { BusIcon } from "./icons";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { Selection, Station, VehiclePrediction } from "../../domain/types";
import {
  probabilityColor,
  probabilityText,
  probabilityValue,
  SeatThreshold,
  stationDistribution,
} from "../../domain/presentation";
import { theme as t } from "../../theme";

export function SchematicMap({
  stations,
  vehicles,
  selectedVehicle,
  selection,
  threshold,
  color,
  compare,
  onStation,
  onVehicle,
}: {
  stations: Station[];
  vehicles: VehiclePrediction[];
  selectedVehicle?: VehiclePrediction;
  selection: Selection;
  threshold: SeatThreshold;
  color: string;
  compare: boolean;
  onStation: (s: Station) => void;
  onVehicle: (v: VehiclePrediction) => void;
}) {
  const target = stations.findIndex(
    (s) => s.sequence === selection.stationSequence,
  );
  const rows = stations
    .slice(
      Math.max(0, Math.min(target - 4, stations.length - 5)),
      Math.max(5, target + 1),
    )
    .slice(-5);
  const anchors = rows.map((station, i) => ({
    station,
    x: 128 + i * 48,
    y: selectedVehicle ? 445 - i * 66 : 448 - i * 53.5,
  }));
  const path = anchors
    .map((a, i) => `${i ? "L" : "M"} ${a.x} ${a.y}`)
    .join(" ");
  return (
    <View style={s.map} accessibilityLabel="예시 노선도 · 실제 지도 위치 아님">
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 390 500"
        preserveAspectRatio="none"
      >
        <Rect width="390" height="500" fill="#EFF0ED" />
        <Rect x="30" y="200" width="80" height="65" fill={t.colors.sky} />
        <Rect x="247" y="350" width="80" height="95" fill={t.colors.sky} />
        <Rect x="80" y="52" width="65" height="90" fill="#E3E7E1" />
        {[45, 115, 215, 300, 355].map((x, i) => (
          <Line
            key={`v${x}`}
            x1={x}
            y1="0"
            x2={x + 30}
            y2="500"
            stroke="white"
            strokeWidth={i === 2 ? 10 : 5}
          />
        ))}
        {[145, 245, 355, 465].map((y) => (
          <Line
            key={`h${y}`}
            x1="0"
            y1={y - 45}
            x2="390"
            y2={y + 35}
            stroke="white"
            strokeWidth="7"
          />
        ))}
        <Path
          d="M 43 490 Q 180 330 275 160 L 330 0"
          stroke={t.colors.madrid}
          strokeWidth="3"
          fill="none"
          opacity=".32"
        />
        <Path
          d="M 137 500 Q 235 325 320 200 L 375 0"
          stroke={t.colors.primary}
          strokeWidth="3"
          fill="none"
          opacity=".28"
        />
        <Path
          d={`${path} L 375 5`}
          stroke="white"
          strokeWidth="9"
          fill="none"
        />
        <Path
          d={`${path} L 375 5`}
          stroke={color}
          strokeWidth="5"
          fill="none"
        />
        {compare && (
          <Path
            d="M 330 160 Q 365 220 258 247"
            stroke={t.colors.primary}
            strokeWidth="3"
            strokeDasharray="3 7"
            fill="none"
          />
        )}
        {anchors.map((a) => (
          <Circle
            key={a.station.sequence}
            cx={a.x}
            cy={a.y}
            r="5.5"
            fill="white"
            stroke={color}
            strokeWidth="3"
          />
        ))}
      </Svg>
      {anchors.map((a) => {
        const v = selectedVehicle ?? vehicles[0];
        const p = probabilityValue(
          v ? stationDistribution(v, a.station, selection) : null,
          threshold,
        );
        const bg = probabilityColor(p);
        const low = p.kind === "value" && p.value < 0.4;
        return (
          <Pressable
            key={a.station.sequence}
            accessibilityRole="button"
            accessibilityLabel={`${a.station.name} ${probabilityText(p)} 정류장 선택`}
            onPress={() => onStation(a.station)}
            style={[
              s.station,
              {
                left: `${((a.x - 120) / 390) * 100}%`,
                top: `${((a.y - 42) / 500) * 100}%`,
                backgroundColor: bg,
              },
            ]}
          >
            {a.station.sequence === selection.stationSequence && (
              <Text style={s.mine}>내 정류장</Text>
            )}
            <Text
              numberOfLines={1}
              style={[
                s.stationName,
                {
                  color: low
                    ? "#990000"
                    : p.kind === "value" && p.value >= 0.7
                      ? "white"
                      : "#000000",
                },
              ]}
            >
              {a.station.name}
            </Text>
            <Text
              style={[
                s.prob,
                {
                  color: low
                    ? "#990000"
                    : p.kind === "value" && p.value >= 0.7
                      ? "white"
                      : "#000000",
                },
              ]}
            >
              {probabilityText(p)}
            </Text>
          </Pressable>
        );
      })}
      {vehicles.slice(0, 4).map((v, i) => {
        const x = 292 - i * 48,
          y = selectedVehicle ? 179 + i * 66 : 232 + i * 53.5;
        const seats = v.currentObservation?.remainingSeats;
        return (
          <Pressable
            key={v.vehicleId}
            accessibilityRole="button"
            accessibilityLabel={`${v.arrivalOrder}번째 버스 선택`}
            onPress={() => onVehicle(v)}
            style={[
              s.bus,
              {
                left: `${(x / 390) * 100}%`,
                top: `${(y / 500) * 100}%`,
                opacity:
                  selectedVehicle && v.vehicleId !== selectedVehicle.vehicleId
                    ? 0.45
                    : 1,
              },
            ]}
          >
            <View
              style={[
                s.busIcon,
                { backgroundColor: color },
                selectedVehicle?.vehicleId === v.vehicleId && {
                  boxShadow: "0 0 0 6px rgba(236,0,0,.15)",
                },
              ]}
            >
              <BusIcon size={19} />
            </View>
            <Text style={s.seats}>
              {seats === null || seats === undefined ? "—" : seats}석
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  map: { flex: 1, minHeight: 280, overflow: "hidden" },
  station: {
    position: "absolute",
    width: 88,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "white",
    paddingHorizontal: 5,
    paddingVertical: 5,
    alignItems: "center",
    boxShadow: "0 3px 12px #0002",
  },
  stationName: { fontSize: 11, fontWeight: "600" },
  prob: { fontSize: 22, fontWeight: "700", lineHeight: 25 },
  mine: {
    position: "absolute",
    top: -23,
    backgroundColor: t.colors.primaryPressed,
    color: "white",
    fontSize: 10,
    fontWeight: "700",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  bus: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
  },
  busIcon: {
    width: 33,
    height: 33,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  seats: {
    color: "white",
    backgroundColor: "#202020",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: "700",
  },
});
