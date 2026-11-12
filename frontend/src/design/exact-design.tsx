import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBus } from "../features/provider";
import { useRoutes, useSection, useStations } from "../features/queries";
import { dateInSeoul, directions, favoriteKey } from "../domain/logic";
import { Direction, Selection } from "../domain/types";
import { config } from "../config";
import { DEMO_DATE, DEMO_NOW } from "../mocks/fixtures";
import { PrototypeCanvas } from "./prototype-canvas";
import { Button } from "../components/ui";
const EMPTY: never[] = [];
export function ExactDesign() {
  const params = useLocalSearchParams();
  const { width, height } = useWindowDimensions();
  const pad = width < 500 ? 0 : 32;
  const scale = Math.min((width - pad) / 390, (height - pad) / 844, 1.25);
  const [pickedRoute, setRouteName] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>(
    params.direction === "TO_CAMPUS" ? "TO_CAMPUS" : "TO_SEOUL",
  );
  const [stationIndex, setStationIndex] = useState(-1);
  const [activeHistory, setActiveHistory] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState("today");
  const [menu, setMenu] = useState(false);

  const routes = useRoutes();
  const routeName =
    pickedRoute ??
    routes.data?.data.find((r) => r.routeId === params.routeId)?.name ??
    "5100";
  const routeIds = Object.fromEntries(
    routes.data?.data.map((r) => [r.name, r.routeId]) ?? [],
  );
  const a = useStations(routeIds["5100"] ?? "", direction);
  const b = useStations(routeIds["M5107"] ?? "", direction);
  const c = useStations(routeIds["1112"] ?? "", direction);
  const allStations = { "5100": a, M5107: b, "1112": c };
  const current = allStations[routeName as keyof typeof allStations];
  const stops = current.data?.data ?? EMPTY;
  const requestedIndex = stops.findIndex(
    (s) =>
      s.stationId === params.stationId &&
      s.sequence === Number(params.stationSequence),
  );
  const invalidSaved =
    (!!params.stationId && !!current.data && requestedIndex < 0) ||
    (!!params.routeId &&
      !!routes.data &&
      !routes.data.data.some((r) => r.routeId === params.routeId));
  const myIndex =
    stationIndex < 0
      ? requestedIndex >= 0
        ? requestedIndex
        : Math.round(Math.max(0, stops.length - 1) * 0.55)
      : Math.min(stationIndex, stops.length - 1);
  const stop = stops[myIndex];
  const selection: Selection = {
    routeId: routeIds[routeName] ?? "",
    direction,
    stationId: stop?.stationId ?? "",
    stationSequence: stop?.sequence ?? 1,
  };
  const predictions = useSection("getPredictions", selection, "", !!stop);
  const today =
    config.mode === "mock" ? DEMO_DATE : dateInSeoul(new Date().toISOString());
  const date =
    historyPeriod === "week"
      ? dateInSeoul(
          new Date(
            Date.parse(`${today}T12:00:00+09:00`) - 7 * 86400000,
          ).toISOString(),
        )
      : today;
  const history = useSection(
    "getHistory",
    selection,
    date,
    !!stop && activeHistory,
  );
  const { favorites, toggle, ready, storageError } = useBus();
  const canvas = useRef<PrototypeCanvas>(null);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () =>
      menu ? (setMenu(false), true) : (canvas.current?.handleBack() ?? false),
    );
    return () => sub.remove();
  }, [menu]);
  const routeViews = Object.fromEntries(
    ["5100", "M5107", "1112"].map((no) => {
      const stations = allStations[no as keyof typeof allStations].data?.data;
      return [
        no,
        {
          kind: no === "M5107" ? "광역급행 M" : "직행좌석",
          color: no === "M5107" ? "#EC0000" : "#EC0000",
          soft: no === "M5107" ? "#FBF1EA" : "#FBF1EA",
          trail: no === "M5107" ? "rgba(236,0,0,0.45)" : "rgba(236,0,0,0.45)",
          stops: stations?.length
            ? stations.map((s) => s.name)
            : ["정류장 정보 없음"],
        },
      ];
    }),
  );
  const error = routes.error ?? current.error ?? predictions.error;
  const loading =
    routes.isPending ||
    (!!routeIds[routeName] && current.isPending) ||
    (!!stop && predictions.isPending);
  const vehicles = predictions.data?.data ?? EMPTY;
  const mode =
    predictions.data?.mode ?? (config.mode === "mock" ? "mock" : "live");
  const saved = favorites.some(
    (s) => favoriteKey(s) === favoriteKey(selection),
  );
  const go = (path: "/forecast" | "/alternatives" | "/results" | "/map") => {
    setMenu(false);
    router.push({
      pathname: path,
      params: {
        ...selection,
        stationSequence: String(selection.stationSequence),
        details: "1",
      },
    });
  };
  return (
    <View style={s.viewport}>
      <View
        style={{
          width: 390 * scale,
          height: 844 * scale,
          overflow: "hidden",
          borderRadius: width >= 500 ? 44 : 0,
          boxShadow: width >= 500 ? "0 20px 60px rgba(0,0,0,0.18)" : undefined,
          backgroundColor: "#FFFFFF",
        }}
      >
        <View
          style={{
            width: 390,
            height: 844,
            transform: [{ scale }],
            transformOrigin: "top left",
          }}
        >
          {stops.length > 0 && !invalidSaved ? (
            <PrototypeCanvas
              ref={canvas}
              route={routeName}
              routeViews={routeViews}
              vehicles={vehicles}
              stations={stops}
              selection={selection}
              mode={mode}
              scale={scale}
              now={mode === "mock" ? DEMO_NOW : new Date().toISOString()}
              stationIndex={myIndex}
              initialScreen={
                params.screen === "select"
                  ? "select"
                  : params.stationId
                    ? "live"
                    : "loading"
              }
              historyLoading={history.isFetching && !history.data}
              historyRecords={
                history.data?.data.filter(
                  (r) => r.observationKind === "ARRIVAL",
                ) ?? EMPTY
              }
              onRoute={(name) => {
                setRouteName(name);
                setStationIndex(-1);
              }}
              onStation={setStationIndex}
              onHistory={(active, period) => {
                setActiveHistory(active);
                setHistoryPeriod(period);
              }}
              onScreen={() => {}}
            />
          ) : (
            <View style={s.loading}>
              <Text style={s.brand}>HopOrNot</Text>
              {loading ? (
                <ActivityIndicator />
              ) : (
                <Text style={s.message}>
                  {invalidSaved
                    ? "저장한 정류장을 찾을 수 없습니다. 더보기에서 다시 선택해 주세요."
                    : (error?.message ?? "정류장 정보가 없습니다.")}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void routes.refetch();
                  void current.refetch();
                  if (stop) void predictions.refetch();
                }}
              >
                <Text style={s.link}>다시 시도</Text>
              </Pressable>
            </View>
          )}
          <Text
            accessibilityLabel={
              mode === "mock" ? "예시 데이터 · 실제 운행정보 아님" : undefined
            }
            style={s.badge}
          >
            {mode === "mock"
              ? "예시 데이터"
              : mode === "replay"
                ? "과거 기록 재현"
                : "서비스 데이터"}
            {predictions.data?.isStale || predictions.error
              ? " · 최신 정보 아님"
              : ""}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="즐겨찾기 및 더보기"
            style={s.more}
            onPress={() => setMenu(true)}
          >
            <Text style={{ fontSize: 22, color: "#696969" }}>···</Text>
          </Pressable>
          {error && predictions.data && (
            <Pressable
              onPress={() => {
                void predictions.refetch();
              }}
              style={s.error}
            >
              <Text style={{ fontSize: 11 }}>
                {error.message} · 캐시 표시 · 눌러 재시도
              </Text>
            </Pressable>
          )}
          {activeHistory && history.error && (
            <Text style={s.historyError}>
              기록 요청 실패 · 더보기에서 다시 시도
            </Text>
          )}
        </View>
      </View>
      <Modal
        visible={menu}
        transparent
        animationType="slide"
        onRequestClose={() => setMenu(false)}
      >
        <View style={s.shade}>
          <ScrollView
            style={{
              maxHeight: "92%",
              width: "100%",
              maxWidth: 600,
              alignSelf: "center",
              backgroundColor: "white",
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
            }}
            contentContainerStyle={s.sheet}
          >
            <Text style={{ fontSize: 20, fontWeight: "700" }}>더보기</Text>
            <Text>
              {directions[direction]} · {stop?.name ?? "정류장 선택 전"}
            </Text>
            {storageError ? <Text>{storageError}</Text> : null}
            <Text style={s.message}>
              도착 시 남아 있을 좌석의 확률입니다. 앞에서 기다리는 사람 수는
              반영하지 않습니다.
            </Text>
            <Button
              title="지도 보기"
              disabled={!stop}
              onPress={() => go("/map")}
            />
            <Button
              title={saved ? "즐겨찾기 삭제" : "즐겨찾기 추가"}
              disabled={!ready || !stop}
              onPress={() => toggle(selection)}
            />
            <Button
              title="방향 바꾸기"
              onPress={() => {
                setDirection(
                  direction === "TO_SEOUL" ? "TO_CAMPUS" : "TO_SEOUL",
                );
                setStationIndex(-1);
                setMenu(false);
              }}
            />
            <Button
              title="정류장 검색"
              onPress={() => {
                setMenu(false);
                router.push({
                  pathname: "/manual",
                  params: {
                    ...selection,
                    stationSequence: String(selection.stationSequence),
                  },
                });
              }}
            />
            <Button
              title="시간대 전망"
              disabled={!stop}
              onPress={() => go("/forecast")}
            />
            <Button
              title="대안 정류장"
              disabled={!stop}
              onPress={() => go("/alternatives")}
            />
            <Button
              title="데이터 정보"
              disabled={!stop}
              onPress={() => go("/results")}
            />
            <Button
              title="즐겨찾기"
              onPress={() => {
                setMenu(false);
                router.push("/tools");
              }}
            />
            <Button title="닫기" onPress={() => setMenu(false)} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  viewport: {
    flex: 1,
    backgroundColor: "#E9E9E9",
    alignItems: "center",
    justifyContent: "center",
  },
  loading: {
    width: 390,
    height: 844,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    backgroundColor: "white",
  },
  brand: { fontSize: 40, lineHeight: 46, fontWeight: "700", color: "#000000" },
  badge: {
    position: "absolute",
    top: 18,
    left: 50,
    right: 50,
    fontSize: 10,
    color: "#696969",
    textAlign: "center",
  },
  more: {
    position: "absolute",
    right: 12,
    top: 6,
    width: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  link: { color: "#EC0000", padding: 14, fontSize: 16 },
  message: { fontSize: 13, color: "#696969", lineHeight: 19 },
  error: {
    position: "absolute",
    top: 30,
    left: 40,
    right: 40,
    padding: 5,
    backgroundColor: "#FBF1EA",
  },
  historyError: {
    position: "absolute",
    top: 365,
    left: 30,
    fontSize: 12,
    color: "#990000",
  },
  shade: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.25)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "white",
    padding: 24,
    paddingBottom: 36,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    gap: 8,
    maxWidth: 600,
    width: "100%",
    alignSelf: "center",
  },
});
