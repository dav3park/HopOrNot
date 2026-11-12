import { useState } from "react";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Button, Card, IconButton, Screen, styles } from "../src/components/ui";
import { useBus } from "../src/features/provider";
import { useRoutes, useStations } from "../src/features/queries";
import { directions, favoriteKey } from "../src/domain/logic";
import { Selection } from "../src/domain/types";
import { config } from "../src/config";
import { scenarios } from "../src/mocks/fixtures";
import { theme as t } from "../src/theme";
function Favorite({
  selection: s,
  onDelete,
}: {
  selection: Selection;
  onDelete: () => void;
}) {
  const routes = useRoutes();
  const stations = useStations(s.routeId, s.direction);
  const route = routes.data?.data.find((r) => r.routeId === s.routeId);
  const station = stations.data?.data.find(
    (x) => x.stationId === s.stationId && x.sequence === s.stationSequence,
  );
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
        borderBottomWidth: 1,
        borderColor: t.colors.line,
        paddingVertical: 16,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="저장한 조합 조회"
        onPress={() =>
          router.push({
            pathname: "/",
            params: { ...s, stationSequence: String(s.stationSequence) },
          })
        }
        style={{ flex: 1, gap: 6, minHeight: 48, justifyContent: "center" }}
      >
        <Text style={styles.heading}>{route?.name ?? "노선 확인 중"}</Text>
        <Text numberOfLines={2} style={styles.body}>
          {station?.name ??
            (stations.isPending ? "불러오는 중" : "정류장 재선택 필요")}
        </Text>
        <Text style={styles.muted}>{directions[s.direction]}</Text>
      </Pressable>
      <IconButton label="즐겨찾기 삭제" icon="×" onPress={onDelete} />
    </View>
  );
}
export default function Favorites() {
  const { favorites, toggle, ready, storageError, scenario, chooseScenario } =
    useBus();
  const [dev, setDev] = useState(false);
  return (
    <Screen title="즐겨찾기">
      {storageError && (
        <Text accessibilityRole="alert" style={styles.muted}>
          {storageError}
        </Text>
      )}
      {!ready ? (
        <Text style={styles.muted}>불러오는 중</Text>
      ) : !favorites.length ? (
        <View style={{ paddingVertical: 48, gap: 16, alignItems: "center" }}>
          <Text style={{ fontSize: 40, color: t.colors.rio }}>☆</Text>
          <Text style={styles.muted}>자주 쓰는 정류장을 저장해 보세요.</Text>
        </View>
      ) : (
        favorites.map((s) => (
          <Favorite
            key={favoriteKey(s)}
            selection={s}
            onDelete={() => toggle(s)}
          />
        ))
      )}
      <Button
        title="노선 선택"
        selected
        onPress={() => router.push("/select")}
      />
      {__DEV__ && config.mode === "mock" && (
        <>
          <Button
            title={dev ? "개발 도구 접기" : "개발 도구"}
            onPress={() => setDev(!dev)}
          />
          {dev && (
            <Card>
              <Text style={styles.muted}>데모 기준 11.04 · 08:00</Text>
              <View style={styles.row}>
                {Object.entries(scenarios).map(([key, label]) => (
                  <Button
                    key={key}
                    title={label}
                    selected={scenario === key}
                    onPress={() => {
                      void chooseScenario(key as keyof typeof scenarios);
                    }}
                  />
                ))}
              </View>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
