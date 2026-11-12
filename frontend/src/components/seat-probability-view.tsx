import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { Selection, Station, VehiclePrediction } from "../domain/types";
import {
  levels,
  probabilityValue,
  probabilityText,
  probabilityColor,
  currentSeatsText,
  stationDistribution,
  SeatThreshold,
} from "../domain/presentation";
import { timeInSeoul } from "../domain/logic";
import { theme as t } from "../theme";
import { DEMO_NOW } from "../mocks/fixtures";
import { config } from "../config";
import { Button, IconButton, Sheet, predictionSource, styles } from "./ui";
export function BusGlyph({ color = t.colors.primary }: { color?: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={26} height={28} viewBox="0 0 24 26" fill="none">
        <Rect
          x="4"
          y="2"
          width="16"
          height="19"
          rx="5"
          stroke={color}
          strokeWidth="1.8"
        />
        <Path
          d="M5 11H19M7 21V24M17 21V24"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <Circle cx="8" cy="17" r="1" fill={color} />
        <Circle cx="16" cy="17" r="1" fill={color} />
      </Svg>
    </View>
  );
}
export function arrivalLabel(v: VehiclePrediction, now: string) {
  if (!v.etaAt) return "시간 없음";
  const minutes = Math.max(
    0,
    Math.ceil((Date.parse(v.etaAt) - Date.parse(now)) / 60000),
  );
  return `${v.etaSource === "ESTIMATED" ? "예상 " : ""}${minutes}분`;
}
export function SeatProbabilityView({
  vehicles,
  stations,
  selection,
  onSelectStation,
  now = config.mode === "mock" ? DEMO_NOW : new Date().toISOString(),
}: {
  vehicles: VehiclePrediction[];
  stations: Station[];
  selection: Selection;
  onSelectStation: (station: Station) => void;
  now?: string;
}) {
  const [threshold, setThreshold] = useState<SeatThreshold>(1);
  const [focused, setFocused] = useState("");
  const [help, setHelp] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const rows = vehicles
    .slice()
    .sort((a, b) => a.arrivalOrder - b.arrivalOrder)
    .slice(0, 3);
  const ordered = stations.slice().sort((a, b) => a.sequence - b.sequence);
  const selectedIndex = ordered.findIndex(
    (s) =>
      s.stationId === selection.stationId &&
      s.sequence === selection.stationSequence,
  );
  const start = Math.min(
    Math.max(0, selectedIndex - 2),
    Math.max(0, ordered.length - 5),
  );
  const visible = expanded ? ordered : ordered.slice(start, start + 5);
  const focus = rows.find((v) => `${v.tripId}/${v.vehicleId}` === focused);
  if (!rows.length) return null;
  return (
    <View style={{ gap: 24 }}>
      <View style={look.panel}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={styles.heading}>도착 시 좌석</Text>
          <IconButton
            label="확률 안내"
            icon="ⓘ"
            onPress={() => setHelp(true)}
          />
        </View>
        <View style={look.table}>
          <View style={look.row}>
            <View style={look.label}>
              <Text style={styles.muted}>도착 순서</Text>
            </View>
            {rows.map((v) => (
              <Pressable
                key={v.tripId + v.vehicleId}
                accessibilityRole="button"
                accessibilityLabel={`${v.arrivalOrder}번째 차량 정류장별 전망 보기`}
                onPress={() => setFocused(`${v.tripId}/${v.vehicleId}`)}
                style={look.cell}
              >
                <Text style={look.caption}>
                  {v.arrivalOrder === 1
                    ? "이번"
                    : v.arrivalOrder === 2
                      ? "다음"
                      : `${v.arrivalOrder}번째`}
                </Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={look.eta}>
                  {arrivalLabel(v, now).replace("예상 ", "")}
                </Text>
                <Text style={look.source}>
                  {v.etaSource === "ESTIMATED" ? "예상·" : ""}
                  {v.source === "MODEL"
                    ? "모델"
                    : v.source === "HISTORICAL_FREQUENCY"
                      ? "빈도"
                      : "예측 없음"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={[look.row, { backgroundColor: t.colors.neutral }]}>
            <View style={look.label}>
              <Text style={look.caption}>현재 좌석</Text>
            </View>
            {rows.map((v) => (
              <View key={v.tripId + v.vehicleId} style={look.cell}>
                <Text style={look.observed}>
                  {currentSeatsText(v.currentObservation?.remainingSeats)}
                </Text>
              </View>
            ))}
          </View>
          {levels.map((level) => (
            <View
              key={level}
              style={[
                look.row,
                threshold === level && { backgroundColor: t.colors.lisbon },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${level}석 이상 기준으로 보기`}
                accessibilityState={{ selected: threshold === level }}
                onPress={() => setThreshold(level)}
                style={look.label}
              >
                <Text
                  style={[
                    look.caption,
                    threshold === level && {
                      color: t.colors.primary,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {level}석 이상
                </Text>
              </Pressable>
              {rows.map((v) => (
                <View
                  key={v.tripId + v.vehicleId}
                  style={look.cell}
                  accessible
                  accessibilityLabel={`${v.arrivalOrder}번째 차량 도착 시 ${level}석 이상 ${probabilityText(probabilityValue(v.distribution, level))}`}
                >
                  <Text
                    style={[
                      look.probability,
                      threshold === level && { color: t.colors.primary },
                    ]}
                  >
                    {probabilityText(probabilityValue(v.distribution, level))}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            graphOpen ? "정류장별 비교 접기" : "정류장별 비교 펼치기"
          }
          accessibilityState={{ expanded: graphOpen }}
          onPress={() => setGraphOpen(!graphOpen)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: 48,
          }}
        >
          <Text style={styles.heading}>정류장별 비교</Text>
          <Text style={styles.muted}>
            {threshold}석 이상 {graphOpen ? "⌃" : "⌄"}
          </Text>
        </Pressable>
        {graphOpen && (
          <>
            <View style={look.graph}>
              <View style={[look.row, { minHeight: 40 }]}>
                <View style={look.stationLabel} />
                {rows.map((v) => (
                  <Pressable
                    key={v.tripId + v.vehicleId}
                    accessibilityRole="button"
                    accessibilityLabel={`${v.arrivalOrder}번째 차량 선택`}
                    onPress={() => setFocused(`${v.tripId}/${v.vehicleId}`)}
                    style={look.cell}
                  >
                    <Text style={look.caption}>
                      {v.arrivalOrder === 1
                        ? "이번"
                        : v.arrivalOrder === 2
                          ? "다음"
                          : `${v.arrivalOrder}번째`}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {visible.map((station) => {
                const selected =
                  station.stationId === selection.stationId &&
                  station.sequence === selection.stationSequence;
                return (
                  <View
                    key={station.stationId + station.sequence}
                    style={[
                      look.row,
                      look.graphRow,
                      selected && { backgroundColor: t.colors.lisbon },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${station.name} 방문 ${station.sequence} 내 정류장으로 설정`}
                      accessibilityState={{ selected }}
                      onPress={() => onSelectStation(station)}
                      style={look.stationLabel}
                    >
                      <Text
                        numberOfLines={2}
                        style={[
                          look.stationName,
                          selected && {
                            fontWeight: "700",
                            color: t.colors.primary,
                          },
                        ]}
                      >
                        {station.name}
                      </Text>
                    </Pressable>
                    {rows.map((v) => {
                      const p = probabilityValue(
                        stationDistribution(v, station, selection),
                        threshold,
                      );
                      return (
                        <View
                          key={v.tripId + v.vehicleId}
                          style={look.node}
                          accessible
                          accessibilityLabel={`${station.name} 방문 ${station.sequence}, ${v.arrivalOrder}번째 차량 도착 시 ${threshold}석 이상 ${probabilityText(p)}`}
                        >
                          <View style={look.string} />
                          <View
                            style={[
                              look.dot,
                              { backgroundColor: probabilityColor(p) },
                            ]}
                          />
                          <Text style={look.nodeText}>
                            {probabilityText(p)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
            {ordered.length > 5 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  expanded ? "정류장 접기" : "전체 정류장 보기"
                }
                onPress={() => setExpanded(!expanded)}
                style={{
                  padding: 8,
                  alignItems: "center",
                  minHeight: 44,
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 13, color: t.colors.muted }}>
                  {expanded ? "접기" : `전체 정류장 · ${ordered.length}개`}{" "}
                  {expanded ? "⌃" : "⌄"}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>
      <Text style={[styles.muted, { textAlign: "center" }]}>
        도착 시 좌석 예측 · 대기 인원 미반영
      </Text>
      <Sheet visible={help} title="좌석 확률" onClose={() => setHelp(false)}>
        <Text style={styles.body}>
          도착 시 남아 있을 좌석의 확률입니다. 앞에서 기다리는 사람 수는
          반영하지 않습니다.
        </Text>
        <Text style={styles.muted}>
          0%는 유효한 예측입니다. —는 정보 없음, 오류는 잘못된 응답입니다.
        </Text>
      </Sheet>
      <Sheet
        visible={!!focus}
        title={focus ? `${focus.arrivalOrder}번째 차량` : ""}
        onClose={() => setFocused("")}
      >
        {focus && (
          <>
            <View style={look.metrics}>
              <View>
                <Text style={styles.muted}>현재 좌석</Text>
                <Text style={look.big}>
                  {currentSeatsText(focus.currentObservation?.remainingSeats)}
                </Text>
              </View>
              <View>
                <Text style={styles.muted}>도착</Text>
                <Text style={look.big}>{arrivalLabel(focus, now)}</Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: "row",
                backgroundColor: t.colors.sky,
                borderRadius: 16,
                padding: 16,
              }}
            >
              {levels.map((level) => (
                <View key={level} style={{ flex: 1, gap: 4 }}>
                  <Text style={[look.probability, { color: t.colors.primary }]}>
                    {probabilityText(
                      probabilityValue(focus.distribution, level),
                    )}
                  </Text>
                  <Text style={styles.muted}>{level}석 이상</Text>
                </View>
              ))}
            </View>
            <Text style={styles.heading}>정류장별 예측</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ flexDirection: "row" }}>
                {ordered.map((station) => (
                  <View
                    key={station.stationId + station.sequence}
                    style={look.horizontalStation}
                  >
                    <View style={look.rail} />
                    <View
                      style={[look.dot, { backgroundColor: t.colors.primary }]}
                    />
                    <Text numberOfLines={2} style={look.stationName}>
                      {station.name}
                    </Text>
                    <Text style={look.probability}>
                      {probabilityText(
                        probabilityValue(
                          stationDistribution(focus, station, selection),
                          threshold,
                        ),
                      )}
                    </Text>
                    <Text style={styles.muted}>{threshold}석 이상</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text style={styles.muted}>
              {predictionSource(focus)} ·{" "}
              {focus.quality === "LIMITED"
                ? "자료 제한"
                : focus.quality === "NO_DATA"
                  ? "자료 없음"
                  : `표본 ${focus.sampleCount ?? "—"}`}
              {focus.currentObservation
                ? ` · ${timeInSeoul(focus.currentObservation.observedAt)} 관측`
                : ""}
            </Text>
            <Button title="닫기" onPress={() => setFocused("")} />
          </>
        )}
      </Sheet>
    </View>
  );
}
const look = StyleSheet.create({
  panel: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: t.colors.sky,
    gap: 8,
  },
  table: {
    backgroundColor: t.colors.surface,
    borderRadius: 16,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "stretch", minHeight: 42 },
  label: {
    width: 78,
    paddingLeft: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  cell: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 4,
    paddingHorizontal: 2,
  },
  caption: { fontSize: 12, color: t.colors.muted },
  eta: {
    fontSize: 16,
    fontWeight: "700",
    color: t.colors.ink,
    fontVariant: ["tabular-nums"],
  },
  source: { fontSize: 10, color: t.colors.muted },
  observed: { fontSize: 13, fontWeight: "600", color: t.colors.ink },
  probability: {
    fontSize: 20,
    fontWeight: "700",
    color: t.colors.ink,
    fontVariant: ["tabular-nums"],
  },
  graph: {
    borderWidth: 1,
    borderColor: t.colors.line,
    borderRadius: 16,
    overflow: "hidden",
  },
  graphRow: { borderTopWidth: 1, borderColor: t.colors.line, minHeight: 56 },
  stationLabel: {
    width: "40%",
    padding: 12,
    justifyContent: "center",
    minHeight: 44,
  },
  stationName: { fontSize: 12, lineHeight: 17, color: t.colors.ink },
  node: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
  },
  string: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: t.colors.line,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  nodeText: {
    fontSize: 11,
    fontWeight: "500",
    color: t.colors.ink,
    backgroundColor: t.colors.surface,
    paddingHorizontal: 3,
  },
  metrics: { flexDirection: "row", justifyContent: "space-between", gap: 24 },
  big: { fontSize: 32, fontWeight: "700", color: t.colors.ink, marginTop: 8 },
  horizontalStation: {
    width: 116,
    padding: 12,
    alignItems: "center",
    gap: 12,
    paddingTop: 24,
  },
  rail: {
    position: "absolute",
    top: 27,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: t.colors.rio,
  },
});
