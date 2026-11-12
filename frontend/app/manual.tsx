import { stationDisplayNumber } from "../src/domain/station-display";
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, Text, TextInput, View } from "react-native";
import { QueryState, Screen, Segments, styles } from "../src/components/ui";
import { useRoutes, useStations } from "../src/features/queries";
import { Direction } from "../src/domain/types";
import { directions } from "../src/domain/logic";
import { theme as t } from "../src/theme";
import { useBus } from "../src/features/provider";
export default function Manual() {
  const params = useLocalSearchParams();
  const [routeId, setRoute] = useState(
    typeof params.routeId === "string" ? params.routeId : "",
  );
  const [direction, setDirection] = useState<Direction>(
    params.direction === "TO_SEOUL" ? "TO_SEOUL" : "TO_CAMPUS",
  );
  const [search, setSearch] = useState("");
  const routes = useRoutes();
  const stations = useStations(routeId, direction);
  const { scenario } = useBus();
  const route = routes.data?.data.find((r) => r.routeId === routeId);
  const rows =
    stations.data?.data.filter((s) =>
      s.name.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? [];
  return (
    <Screen title="정류장 선택">
      <QueryState
        loading={routes.isPending}
        error={routes.error}
        retry={() => {
          void routes.refetch();
        }}
        empty={routes.data?.data.length === 0}
      />
      <Segments
        items={(routes.data?.data ?? [])
          .slice()
          .sort(
            (a, b) =>
              ["5100", "M5107", "1112"].indexOf(a.name) -
              ["5100", "M5107", "1112"].indexOf(b.name),
          )
          .map((r) => ({
            value: r.routeId,
            label: r.name,
          }))}
        value={routeId}
        onChange={(id) => {
          setRoute(id);
          setSearch("");
          const r = routes.data?.data.find((r) => r.routeId === id);
          if (r && !r.directions.includes(direction))
            setDirection(r.directions[0]);
        }}
      />
      <Segments
        items={(
          route?.directions ?? (["TO_CAMPUS", "TO_SEOUL"] as Direction[])
        ).map((d) => ({ value: d, label: directions[d] }))}
        value={direction}
        onChange={(d) => {
          setDirection(d);
          setSearch("");
        }}
      />
      {scenario === "denied" && (
        <Text style={styles.muted}>위치 권한 없이 선택할 수 있어요.</Text>
      )}
      {routeId ? (
        <>
          <TextInput
            accessibilityLabel="정류장 이름 검색"
            placeholder="정류장 검색"
            value={search}
            onChangeText={setSearch}
            style={styles.input}
          />
          <QueryState
            loading={stations.isPending}
            error={stations.data ? null : stations.error}
            retry={() => {
              void stations.refetch();
            }}
            empty={!rows.length}
            message={search ? "검색 결과가 없어요." : "정류장이 없어요."}
          />
          <View
            style={{
              borderRadius: 16,
              borderWidth: rows.length ? 1 : 0,
              borderColor: t.colors.line,
              overflow: "hidden",
            }}
          >
            {rows.map((s, i) => (
              <Pressable
                key={`${s.stationId}-${s.sequence}`}
                accessibilityRole="button"
                accessibilityLabel={`${s.name} ${s.stationId} 방문 순번 ${s.sequence} 선택`}
                onPress={() =>
                  router.push({
                    pathname: "/",
                    params: {
                      routeId,
                      direction,
                      stationId: s.stationId,
                      stationSequence: String(s.sequence),
                    },
                  })
                }
                style={({ pressed }) => ({
                  flexDirection: "row",
                  gap: 16,
                  alignItems: "center",
                  padding: 16,
                  minHeight: 64,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: t.colors.line,
                  backgroundColor: pressed ? t.colors.lisbon : t.colors.surface,
                })}
              >
                <Text
                  style={{ fontSize: 12, color: t.colors.muted, minWidth: 20 }}
                >
                  {String(
                    stationDisplayNumber(stations.data?.data ?? [], s) ?? "—",
                  ).padStart(2, "0")}
                </Text>
                <Text style={[styles.body, { flex: 1 }]}>{s.name}</Text>
                <Text style={{ fontSize: 22, color: t.colors.muted }}>›</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <Text style={styles.muted}>노선을 선택해 주세요.</Text>
      )}
    </Screen>
  );
}
