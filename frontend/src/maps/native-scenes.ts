import type { LabelScene, RouteScene } from "@react-native-kakao/map";
import { stationAnchor } from "./station-anchor";
import type { RouteMapProps } from "./types";
export function nativeLabels(props: RouteMapProps): LabelScene {
  return {
    styles: ["stop", "selected", "bus", "medium", "low", "pin"].map((id) => ({
      id,
      levels: [
        {
          level: 0,
          textLines: [
            {
              fontSize: id === "pin" ? 24 : id === "bus" ? 15 : 13,
              color:
                id === "pin" || id === "bus"
                  ? `${props.routeColor ?? "#EC0000"}FF`
                  : id === "stop"
                    ? "#000000FF"
                    : id === "medium"
                      ? "#EA6F5DFF"
                      : id === "low"
                        ? "#990000FF"
                        : "#EC0000FF",
              strokeColor: "#FFFFFFFF",
              strokeWidth: 3,
            },
          ],
        },
      ],
    })),
    layers: [
      { id: "markers", zOrder: 1000, clickable: true, competition: "none" },
    ],
    labels: [
      ...props.stations.flatMap((s, index) => {
        const label = props.stationLabels?.[s.sequence];
        const coordinate = stationAnchor(s, props.path);
        return [
          {
            id: `stop:${s.sequence}`,
            layerId: "markers",
            styleId: "pin",
            coordinate,
            text: [{ value: "●" }],
            clickable: true,
          },
          {
            id: `card:${s.sequence}`,
            layerId: "markers",
            styleId:
              label?.color === "#F5DECF"
                ? "low"
                : label?.color === "#EA6F5D"
                  ? "medium"
                  : s.sequence === props.selectedSequence
                    ? "selected"
                    : "stop",
            coordinate,
            pixelOffset: { x: -44, y: -24 },
            text: [
              {
                value: `${index + 1}. ${s.name}${label ? ` ${label.probability}` : ""}${s.sequence === props.selectedSequence ? " · 내 정류장" : ""}`,
              },
            ],
            clickable: true,
          },
        ];
      }),
      ...props.vehicles.map((v, i) => ({
        id: `bus:${v.vehicleId}`,
        layerId: "markers",
        styleId: "bus",
        coordinate: v,
        text: [
          {
            value: `▣ 버스 ${i + 1} · ${v.remainingSeats === null ? "좌석 —" : `${v.remainingSeats}석`}`,
          },
        ],
        clickable: true,
      })),
    ],
  };
}
export function nativeRoutes(props: RouteMapProps): RouteScene {
  return {
    styleSets: [
      {
        id: "route",
        styles: [
          {
            levels: [
              {
                level: 0,
                width: 6,
                color: `${props.routeColor ?? "#EC0000"}FF`,
              },
            ],
          },
        ],
      },
      ...(props.routeLines ?? []).map((line, i) => ({
        id: `other-${i}`,
        styles: [
          { levels: [{ level: 0, width: 3, color: `${line.color}A6` }] },
        ],
      })),
    ],
    layers: [{ id: "routes" }],
    routes: [
      ...props.path.map((coordinates, i) => ({
        id: `path:${i}`,
        layerId: "routes",
        styleSetId: "route",
        segments: [{ coordinates }],
      })),
      ...(props.routeLines ?? []).flatMap((line, i) =>
        line.path.map((coordinates, j) => ({
          id: `other:${i}:${j}`,
          layerId: "routes",
          styleSetId: `other-${i}`,
          segments: [{ coordinates }],
        })),
      ),
    ],
  };
}
