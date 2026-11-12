import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  dateInSeoul,
  hourInSeoul,
  seatBand,
  timeInSeoul,
} from "../domain/logic";
import { HistoryRecord } from "../domain/types";
import { theme as t } from "../theme";
import { Button, QueryState, Segments, styles } from "./ui";
export function DateField({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  const [draft, setDraft] = useState(date);
  const [error, setError] = useState(false);
  function apply() {
    const parsed = new Date(`${draft}T12:00:00+09:00`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(draft) ||
      !Number.isFinite(parsed.getTime()) ||
      dateInSeoul(parsed.toISOString()) !== draft
    ) {
      setError(true);
      return;
    }
    setError(false);
    onChange(draft);
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          accessibilityLabel="조회 날짜 YYYY-MM-DD"
          placeholder="YYYY-MM-DD"
          value={draft}
          onChangeText={setDraft}
          style={[styles.input, { flex: 1 }]}
        />
        <Button title="조회" onPress={apply} />
      </View>
      {error && (
        <Text accessibilityRole="alert" style={styles.muted}>
          날짜 형식을 확인해 주세요.
        </Text>
      )}
    </View>
  );
}
export function HistoryList({ records }: { records: HistoryRecord[] }) {
  const [period, setPeriod] = useState("all");
  const rows = records
    .filter(
      (r) =>
        period === "all" ||
        (period === "morning"
          ? hourInSeoul(r.observedAt) < 12
          : hourInSeoul(r.observedAt) >= 12),
    )
    .slice()
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  return (
    <View style={{ gap: 16 }}>
      <Segments
        value={period}
        onChange={setPeriod}
        items={[
          { value: "all", label: "전체" },
          { value: "morning", label: "오전" },
          { value: "afternoon", label: "오후" },
        ]}
      />
      <QueryState
        loading={false}
        error={null}
        retry={() => {}}
        empty={!rows.length}
        message="기록이 없어요."
      />
      {rows.length > 0 && (
        <View
          style={{
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          {rows.map((r, i) => (
            <View
              key={r.eventId}
              accessibilityLabel={`${timeInSeoul(r.observedAt)} ${seatBand(r.remainingSeats)} ${r.observationKind}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 16,
                borderTopWidth: i ? 1 : 0,
                borderColor: t.colors.line,
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  fontVariant: ["tabular-nums"],
                  color: t.colors.ink,
                }}
              >
                {timeInSeoul(r.observedAt)}
              </Text>
              <Text style={[styles.muted, { flex: 1 }]}>
                {r.observationKind === "ARRIVAL"
                  ? "도착"
                  : r.observationKind === "DEPARTURE"
                    ? "출발"
                    : "정류장 근처"}
              </Text>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: t.colors.history,
                }}
              >
                {seatBand(r.remainingSeats)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
