import { useEffect, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useBus } from "../features/provider";
import { useRoutes, useSection, useStations } from "../features/queries";
import {
  dateInSeoul,
  directions,
  favoriteKey,
  timeInSeoul,
} from "../domain/logic";
import { Direction, Selection } from "../domain/types";
import { config } from "../config";
import { DEMO_DATE, DEMO_NOW } from "../mocks/fixtures";
import { theme as t } from "../theme";
import {
  Button,
  IconButton,
  ModeBadge,
  QueryState,
  Segments,
  Sheet,
  Status,
  styles,
} from "../components/ui";
import {
  BusGlyph,
  SeatProbabilityView,
} from "../components/seat-probability-view";
import { DateField, HistoryList } from "../components/data-panels";
export function FlameApp() {
  const params = useLocalSearchParams();
  const [stage, setStage] = useState(params.stationId ? "live" : "routes");
  const [pickedRoute, setRoute] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>(
    params.direction === "TO_CAMPUS" ? "TO_CAMPUS" : "TO_SEOUL",
  );
  const [stationIndex, setStation] = useState(-1);
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState("predictions");
  const [menu, setMenu] = useState(false);
  const [info, setInfo] = useState(false);
  const today =
    config.mode === "mock" ? DEMO_DATE : dateInSeoul(new Date().toISOString());
  const [date, setDate] = useState(today);
  const routes = useRoutes();
  const routeItems = (routes.data?.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        ["5100", "M5107", "1112"].indexOf(a.name) -
        ["5100", "M5107", "1112"].indexOf(b.name),
    );
  const initialRoute = routes.data?.data.find(
    (r) => r.routeId === params.routeId,
  );
  const route = routes.data?.data.find(
    (r) => r.name === (pickedRoute ?? initialRoute?.name ?? "5100"),
  );
  const stations = useStations(route?.routeId ?? "", direction);
  const stops = stations.data?.data ?? [];
  const requested = !touched
    ? stops.findIndex(
        (s) =>
          s.stationId === params.stationId &&
          s.sequence === Number(params.stationSequence),
      )
    : -1;
  const invalidSaved =
    !touched &&
    !!params.stationId &&
    !!stations.data &&
    (requested < 0 || (!!params.routeId && !initialRoute));
  const index =
    stationIndex < 0
      ? requested >= 0
        ? requested
        : Math.round(Math.max(0, stops.length - 1) * 0.55)
      : Math.min(stationIndex, stops.length - 1);
  const station = stops[index];
  const selection: Selection = {
    routeId: route?.routeId ?? "",
    direction,
    stationId: station?.stationId ?? "",
    stationSequence: station?.sequence ?? 1,
  };
  const predictions = useSection(
    "getPredictions",
    selection,
    "",
    !!station && stage === "live" && tab === "predictions" && !invalidSaved,
  );
  const history = useSection(
    "getHistory",
    selection,
    date,
    !!station && stage === "live" && tab === "history" && !invalidSaved,
  );
  const { favorites, toggle, ready } = useBus();
  const saved = favorites.some(
    (s) => favoriteKey(s) === favoriteKey(selection),
  );
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (menu || info) {
        setMenu(false);
        setInfo(false);
        return true;
      }
      if (stage === "live") {
        setStage("routes");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stage, menu, info]);
  function choose(name: string) {
    setRoute(name);
    setTouched(true);
    setStation(-1);
    setTab("predictions");
    setStage("live");
  }
  function go(
    path: "/forecast" | "/alternatives" | "/results" | "/manual" | "/tools",
  ) {
    setMenu(false);
    router.push({
      pathname: path,
      params: {
        ...selection,
        stationSequence: String(selection.stationSequence),
        details: "1",
      },
    });
  }
  const q = tab === "predictions" ? predictions : history;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScrollView
        contentContainerStyle={look.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={look.header}>
          {stage === "routes" ? (
            <View style={styles.row}>
              <View style={look.brandIcon}>
                <BusGlyph />
              </View>
              <Text style={look.brand}>HopOrNot</Text>
            </View>
          ) : (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <IconButton
                label="노선 선택으로"
                icon="←"
                onPress={() => setStage("routes")}
              />
              <Text style={look.routeTitle}>{route?.name ?? "—"}</Text>
              <Text style={styles.muted}>{directions[direction]}</Text>
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <ModeBadge />
            {stage === "live" ? (
              <IconButton
                label={saved ? "즐겨찾기 삭제" : "즐겨찾기 추가"}
                icon={saved ? "★" : "☆"}
                active={saved}
                onPress={() => {
                  if (ready && station) toggle(selection);
                }}
              />
            ) : (
              <IconButton
                label="즐겨찾기"
                icon="☆"
                onPress={() => go("/tools")}
              />
            )}
            <IconButton label="더보기" icon="⋯" onPress={() => setMenu(true)} />
          </View>
        </View>
        {stage === "routes" ? (
          <>
            <View style={{ gap: 8, marginTop: 16, marginBottom: 8 }}>
              <Text style={look.headline}>노선 선택</Text>
              <Text style={styles.muted}>국제캠퍼스 ↔ 서울</Text>
            </View>
            <QueryState
              loading={routes.isPending}
              error={routes.error}
              retry={() => {
                void routes.refetch();
              }}
              empty={routes.data?.data.length === 0}
            />
            <View style={{ gap: 16 }}>
              {routeItems.map((r) => (
                <Pressable
                  key={r.routeId}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name} 노선 선택`}
                  onPress={() => choose(r.name)}
                  style={({ pressed }) => [
                    look.routeCard,
                    pressed && {
                      backgroundColor: t.colors.lisbon,
                      borderColor: t.colors.rio,
                    },
                  ]}
                >
                  <View style={look.routeIcon}>
                    <BusGlyph />
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={look.routeNumber}>{r.name}</Text>
                    <Text style={styles.muted}>
                      {r.name === "M5107" ? "광역급행" : "직행좌석"}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 24, color: t.colors.muted }}>›</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <QueryState
              loading={stations.isPending}
              error={stations.data ? null : stations.error}
              retry={() => {
                void stations.refetch();
              }}
              empty={(!stations.isPending && !stops.length) || invalidSaved}
              message={
                invalidSaved
                  ? "정류장을 다시 선택해 주세요."
                  : "정류장이 없어요."
              }
            />
            {station && !invalidSaved && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="정류장 변경"
                  onPress={() => go("/manual")}
                  style={look.station}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.muted}>내 정류장</Text>
                    <Text numberOfLines={2} style={styles.heading}>
                      {station.name}
                    </Text>
                    {stops.filter((s) => s.stationId === station.stationId)
                      .length > 1 && (
                      <Text style={styles.muted}>순번 {station.sequence}</Text>
                    )}
                  </View>
                  <Text style={{ fontSize: 24, color: t.colors.muted }}>›</Text>
                </Pressable>
                <Segments
                  value={tab}
                  onChange={setTab}
                  items={[
                    { value: "predictions", label: "도착 예측" },
                    { value: "history", label: "지난 기록" },
                  ]}
                />
                {tab === "history" && (
                  <DateField key={date} date={date} onChange={setDate} />
                )}
                <QueryState
                  loading={q.isPending}
                  error={q.data ? null : q.error}
                  retry={() => {
                    void q.refetch();
                  }}
                  empty={q.data?.data.length === 0}
                  message={
                    tab === "predictions"
                      ? "다가오는 버스가 없어요."
                      : "기록이 없어요."
                  }
                />
                {tab === "predictions" && predictions.data && (
                  <SeatProbabilityView
                    key={favoriteKey(selection)}
                    vehicles={predictions.data.data}
                    stations={stops}
                    selection={selection}
                    now={
                      predictions.data.mode === "mock"
                        ? DEMO_NOW
                        : predictions.data.mode === "replay"
                          ? predictions.data.generatedAt
                          : new Date().toISOString()
                    }
                    onSelectStation={(s) => {
                      setTouched(true);
                      setStation(
                        stops.findIndex(
                          (x) =>
                            x.stationId === s.stationId &&
                            x.sequence === s.sequence,
                        ),
                      );
                    }}
                  />
                )}
                {tab === "history" &&
                  history.data &&
                  history.data.data.length > 0 && (
                    <HistoryList records={history.data.data} />
                  )}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Status
                    data={q.data}
                    error={q.error}
                    fetching={q.isFetching}
                  />
                  <IconButton
                    label="새로고침"
                    icon="↻"
                    onPress={() => {
                      void q.refetch();
                    }}
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => go("/forecast")}
                    style={look.quick}
                  >
                    <Text style={look.quickText}>시간대 전망 ↗</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => go("/alternatives")}
                    style={look.quick}
                  >
                    <Text style={look.quickText}>대안 정류장 ↗</Text>
                  </Pressable>
                </View>
              </>
            )}
            {invalidSaved && (
              <Button title="정류장 선택" onPress={() => go("/manual")} />
            )}
          </>
        )}
      </ScrollView>
      <Sheet visible={menu} title="더보기" onClose={() => setMenu(false)}>
        <Segments
          value={direction}
          onChange={(d) => {
            setDirection(d);
            setTouched(true);
            setStation(-1);
            setMenu(false);
          }}
          items={[
            { value: "TO_SEOUL" as Direction, label: "서울 방면" },
            { value: "TO_CAMPUS" as Direction, label: "국제캠퍼스 방면" },
          ]}
        />
        <Button title="즐겨찾기" onPress={() => go("/tools")} />
        <Button title="정류장 검색" onPress={() => go("/manual")} />
        <Button
          title="데이터 정보"
          onPress={() => {
            setMenu(false);
            setInfo(true);
          }}
        />
      </Sheet>
      <Sheet visible={info} title="데이터 정보" onClose={() => setInfo(false)}>
        <Text style={styles.body}>
          도착 시 남아 있을 좌석의 확률입니다. 앞에서 기다리는 사람 수는
          반영하지 않습니다.
        </Text>
        <Text style={styles.muted}>
          {config.mode === "mock"
            ? "예시 데이터 · 실제 운행정보 아님"
            : "서비스 데이터"}
          {q.data?.lastObservedAt
            ? ` · ${timeInSeoul(q.data.lastObservedAt)} 관측`
            : ""}
        </Text>
        {q.error && <Text style={styles.muted}>{q.error.message}</Text>}
        {stage === "live" && (
          <Button
            title="예측 출처 · 품질"
            onPress={() => {
              setInfo(false);
              go("/results");
            }}
          />
        )}
      </Sheet>
    </SafeAreaView>
  );
}
const look = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 24,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    gap: 8,
  },
  brandIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: t.colors.lisbon,
  },
  brand: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.5,
    color: t.colors.ink,
  },
  headline: {
    fontSize: 40,
    fontWeight: "700",
    lineHeight: 46,
    letterSpacing: -1,
    color: t.colors.ink,
  },
  routeTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.7,
    color: t.colors.ink,
  },
  routeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: t.colors.line,
    padding: 24,
    borderRadius: 24,
    minHeight: 112,
  },
  routeIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: t.colors.lisbon,
    alignItems: "center",
    justifyContent: "center",
  },
  routeNumber: {
    fontSize: 28,
    fontWeight: "700",
    color: t.colors.ink,
    letterSpacing: -0.6,
  },
  station: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 4,
  },
  quick: {
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor: t.colors.neutral,
    padding: 12,
  },
  quickText: { fontSize: 13, fontWeight: "600", color: t.colors.ink },
});
