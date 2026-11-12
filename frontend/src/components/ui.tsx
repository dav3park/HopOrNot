import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Envelope, SeatDistribution, VehiclePrediction } from "../domain/types";
import { probabilities, timeInSeoul } from "../domain/logic";
import { config } from "../config";
import { theme as t } from "../theme";
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.colors.background },
  content: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.card,
    padding: t.spacing.sm,
    gap: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.colors.line,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: t.colors.ink,
  },
  heading: {
    fontSize: t.type.heading,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: t.colors.ink,
  },
  body: { fontSize: t.type.body, color: t.colors.ink, lineHeight: 24 },
  muted: { fontSize: t.type.caption, color: t.colors.muted, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  button: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.colors.line,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  active: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
  input: {
    borderWidth: 1,
    borderColor: t.colors.line,
    borderRadius: t.radius.control,
    backgroundColor: t.colors.neutral,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    fontSize: 16,
    color: t.colors.ink,
  },
  banner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: t.colors.lisbon,
    borderRadius: t.radius.sm,
    gap: 4,
  },
});
export function Button({
  title,
  onPress,
  selected = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && styles.active,
        pressed && {
          backgroundColor: selected ? t.colors.primaryPressed : t.colors.lisbon,
        },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text
        style={[
          styles.body,
          { fontWeight: "600" },
          selected && { color: t.colors.surface },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  label,
  icon,
  onPress,
  active = false,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 44,
        minHeight: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.colors.lisbon : "transparent",
      })}
    >
      <Text
        style={{
          fontSize: 24,
          color: active ? t.colors.primary : t.colors.ink,
        }}
      >
        {icon}
      </Text>
    </Pressable>
  );
}
export function Card({
  children,
  testID,
}: React.PropsWithChildren<{ testID?: string }>) {
  return (
    <View testID={testID} style={styles.card}>
      {children}
    </View>
  );
}
export function ModeBadge() {
  return config.mode === "mock" ? (
    <Text
      accessibilityLabel="예시 데이터 · 실제 운행정보 아님"
      style={{
        fontSize: 11,
        fontWeight: "600",
        color: t.colors.primaryPressed,
        backgroundColor: t.colors.lisbon,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 8,
      }}
    >
      예시
    </Text>
  ) : null;
}
export function Screen({
  title,
  children,
}: React.PropsWithChildren<{ title: string }>) {
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <ModeBadge />
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: React.PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
}>) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,.24)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: "88%",
            maxWidth: 640,
            width: "100%",
            alignSelf: "center",
            paddingBottom: 24,
          }}
        >
          <View
            style={[
              styles.row,
              {
                justifyContent: "space-between",
                paddingLeft: 24,
                paddingRight: 12,
                paddingTop: 8,
              },
            ]}
          >
            <Text style={styles.heading}>{title}</Text>
            <IconButton label="닫기" icon="×" onPress={onClose} />
          </View>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 24,
              paddingBottom: 16,
              gap: 16,
            }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function Segments<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        padding: 4,
        borderRadius: 16,
        backgroundColor: t.colors.neutral,
        gap: 4,
      }}
    >
      {items.map((item) => (
        <Pressable
          key={item.value}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: value === item.value }}
          onPress={() => onChange(item.value)}
          style={{
            flex: 1,
            minHeight: 42,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor:
              value === item.value ? t.colors.surface : "transparent",
            borderRadius: 12,
            paddingHorizontal: 8,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: value === item.value ? "700" : "500",
              color: value === item.value ? t.colors.primary : t.colors.muted,
            }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Status({
  data,
  error,
  fetching,
}: {
  data?: Envelope<unknown>;
  error?: Error | null;
  fetching?: boolean;
}) {
  if (!data) return null;
  return (
    <View
      style={[
        styles.row,
        { justifyContent: "space-between", paddingVertical: 4 },
      ]}
    >
      <Text
        accessibilityRole={error ? "alert" : undefined}
        style={styles.muted}
      >
        {error
          ? data
            ? "연결 실패 · 이전 정보"
            : "불러오지 못했어요"
          : data?.isStale
            ? "오래된 정보"
            : fetching
              ? "갱신 중"
              : data?.mode === "replay"
                ? "과거 기록 재현"
                : "최근 관측"}
        {data?.lastObservedAt ? ` · ${timeInSeoul(data.lastObservedAt)}` : ""}
      </Text>
    </View>
  );
}
export function QueryState({
  loading,
  error,
  retry,
  empty,
  message = "표시할 정보가 없어요.",
}: {
  loading: boolean;
  error: Error | null;
  retry: () => void;
  empty: boolean;
  message?: string;
}) {
  if (loading)
    return (
      <View style={{ padding: 32, alignItems: "center" }}>
        <ActivityIndicator
          color={t.colors.primary}
          accessibilityLabel="불러오는 중"
        />
      </View>
    );
  if (error)
    return (
      <Card>
        <Text accessibilityRole="alert" style={styles.body}>
          {error.message.includes("설정")
            ? "API 설정을 확인해 주세요."
            : "불러오지 못했어요."}
        </Text>
        <Button title="다시 시도" onPress={retry} />
      </Card>
    );
  if (empty)
    return (
      <View style={{ paddingVertical: 32, alignItems: "center" }}>
        <Text style={styles.muted}>{message}</Text>
      </View>
    );
  return null;
}
export function Probability({ value }: { value: SeatDistribution | null }) {
  let p: ReturnType<typeof probabilities>;
  try {
    p = probabilities(value);
  } catch {
    return (
      <Text accessibilityRole="alert" style={styles.muted}>
        데이터 오류
      </Text>
    );
  }
  if (!p) return <Text style={styles.muted}>예측 없음</Text>;
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      {p.map((v, i) => (
        <View
          key={i}
          accessible
          accessibilityLabel={`${[1, 5, 10][i]}석 이상 ${Math.round(v * 100)}퍼센트`}
          style={{ flex: 1, gap: 6 }}
        >
          <Text
            style={[
              styles.heading,
              { color: t.colors.primary, fontVariant: ["tabular-nums"] },
            ]}
          >
            {Math.round(v * 100)}%
          </Text>
          <Text style={styles.muted}>{[1, 5, 10][i]}석 이상</Text>
          <View
            accessibilityElementsHidden
            style={{
              height: 3,
              backgroundColor: t.colors.neutral,
              borderRadius: 3,
              marginTop: 2,
            }}
          >
            <View
              style={{
                height: 3,
                width: `${v * 100}%`,
                backgroundColor: t.colors.primary,
                borderRadius: 3,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export const predictionSource = (v: VehiclePrediction) =>
  v.source === "MODEL"
    ? "모델 예측"
    : v.source === "HISTORICAL_FREQUENCY"
      ? "과거 빈도"
      : "예측 없음";
export function VehicleCard({ vehicle: v }: { vehicle: VehiclePrediction }) {
  return (
    <Card testID={`vehicle-card-${v.arrivalOrder}`}>
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text style={styles.heading}>{v.arrivalOrder}번째 차량</Text>
        <Text style={styles.muted}>
          {v.etaAt
            ? `${timeInSeoul(v.etaAt)}${v.etaSource === "ESTIMATED" ? " 예상" : ""}`
            : "도착 시각 없음"}
        </Text>
      </View>
      <Probability value={v.distribution} />
      <Text style={styles.muted}>
        {predictionSource(v)} ·{" "}
        {v.quality === "LIMITED"
          ? "자료 제한"
          : v.quality === "NO_DATA"
            ? "자료 없음"
            : `표본 ${v.sampleCount ?? "—"}`}
      </Text>
    </Card>
  );
}
