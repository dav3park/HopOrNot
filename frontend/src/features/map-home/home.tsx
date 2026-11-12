import { directionLabel } from "../../domain/station-display";
import { s } from "./styles";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQueries } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { config } from "../../config";
import { dateInSeoul, timeInSeoul } from "../../domain/logic";
import {
  probabilityColor,
  probabilityText,
  probabilityValue,
  SeatThreshold,
  stationDistribution,
} from "../../domain/presentation";
import {
  Direction,
  Selection,
  Station,
  VehiclePrediction,
} from "../../domain/types";
import { useRoutes, useSection, useStations } from "../queries";
import { useBus } from "../provider";
import {
  fetchRouteMap,
  locatedStations,
  recentVehicles,
} from "../../maps/data";
import RouteMap from "../../maps/route-map";
import { theme as t } from "../../theme";
import { BusIcon } from "./icons";
import { demoForecast, demoVehicles, MAP_DEMO_NOW } from "./demo";
import {
  chooseVehicle,
  eligibleAlternatives,
  firstComfortableSlot,
  minutesUntil,
  routeColors,
  thresholdName,
} from "./model";

type Panel = "home" | "vehicle" | "compare" | "forecast";
const EMPTY: never[] = [];
function Action({
  title,
  onPress,
  primary = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[s.action, primary && s.primary]}
    >
      <Text style={[s.actionText, primary && { color: "white" }]}>{title}</Text>
    </Pressable>
  );
}
function Pill({ value }: { value: ReturnType<typeof probabilityValue> }) {
  return (
    <View style={[s.pill, { backgroundColor: probabilityColor(value) }]}>
      <Text
        style={{
          fontWeight: "700",
          fontSize: 12,
          color:
            value.kind === "value" && value.value >= 0.7
              ? "white"
              : t.colors.primaryPressed,
        }}
      >
        {probabilityText(value)}
      </Text>
    </View>
  );
}
export function MapHome() {
  const params = useLocalSearchParams<{
    routeId?: string;
    direction?: string;
    stationId?: string;
    stationSequence?: string;
  }>();
  const { width, height } = useWindowDimensions();
  const [routeOverride, setRoute] = useState<string>();
  const [direction, setDirection] = useState<Direction>(
    params.direction === "TO_CAMPUS" ? "TO_CAMPUS" : "TO_SEOUL",
  );
  const [picked, setPicked] = useState<Station>();
  const [ignoreParams, setIgnoreParams] = useState(false);
  const [threshold, setThreshold] = useState<SeatThreshold>(1);
  const [panel, setPanel] = useState<Panel>("home");
  const [vehicleId, setVehicleId] = useState<string>();
  const [menu, setMenu] = useState(false);
  const [focusVersion, setFocusVersion] = useState(0);
  const [focused, setFocused] = useState(false);
  const [clock, setClock] = useState(Date.now);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    if (!focused) return;
    const id = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(id);
  }, [focused]);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panel !== "home") {
        setPanel("home");
        setVehicleId(undefined);
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [panel]);
  const { scenario, toggle, favorites, ready } = useBus();
  const demo = config.mode === "mock" && scenario === "normal";
  const now = demo
    ? Date.parse(MAP_DEMO_NOW)
    : config.mode === "mock"
      ? Date.parse("2026-11-04T08:00:00+09:00")
      : clock;
  const routes = useRoutes();
  const routeId =
    routeOverride ??
    params.routeId ??
    routes.data?.data.find((r) => r.name === "M5107")?.routeId ??
    routes.data?.data[0]?.routeId ??
    "";
  const route = routes.data?.data.find((r) => r.routeId === routeId);
  const stationQuery = useStations(routeId, direction);
  const stations = stationQuery.data?.data ?? EMPTY;
  const fromParams =
    !ignoreParams && params.stationId
      ? stations.find(
          (st) =>
            st.stationId === params.stationId &&
            st.sequence === Number(params.stationSequence),
        )
      : undefined;
  const stop =
    picked ??
    (!ignoreParams && params.stationId
      ? fromParams
      : (stations.find((st) => st.name.includes("청명역")) ??
        stations.find((st) => st.name.includes("경희대학교")) ??
        stations[0]));
  const selection: Selection = {
    routeId,
    direction,
    stationId: stop?.stationId ?? "",
    stationSequence: stop?.sequence ?? 1,
  };
  const predictions = useSection(
    "getPredictions",
    selection,
    "",
    !!stop && !demo && focused,
  );
  const alternatives = useSection(
    "getAlternatives",
    selection,
    "",
    !!stop && !demo && focused,
  );
  const forecast = useSection(
    "getForecast",
    selection,
    dateInSeoul(new Date(now).toISOString()),
    !!stop && !demo && focused && panel === "forecast",
  );
  const vehicles = (
    demo ? demoVehicles(selection, stations) : (predictions.data?.data ?? EMPTY)
  )
    .slice()
    .sort((a, b) => a.arrivalOrder - b.arrivalOrder);
  const active = vehicles.find((v) => v.vehicleId === vehicleId);
  const recommended = predictions.data?.isStale
    ? undefined
    : chooseVehicle(vehicles, threshold, now);
  const first = vehicles[0];
  const candidates = demo ? EMPTY : (alternatives.data?.data ?? EMPTY);
  const eligible = eligibleAlternatives(
    alternatives.data?.isStale ? [] : candidates,
    now,
  )
    .filter((a) => {
      const p = probabilityValue(a.candidate?.distribution ?? null, threshold);
      return (
        p.kind === "value" &&
        p.value >= 0.7 &&
        (!recommended?.etaAt ||
          Date.parse(a.candidate!.etaAt!) < Date.parse(recommended.etaAt))
      );
    })
    .sort(
      (a, b) =>
        Date.parse(a.candidate!.etaAt!) - Date.parse(b.candidate!.etaAt!),
    );
  const best = eligible[0];
  const slots = demo ? demoForecast : (forecast.data?.data ?? EMPTY);
  const comfortable = firstComfortableSlot(slots, threshold, now);
  const snapshots = useQueries({
    queries: (routes.data?.data ?? []).map((r) => ({
      queryKey: [
        "route-map",
        config.mode,
        config.baseUrl,
        r.routeId,
        direction,
      ],
      queryFn: () => fetchRouteMap(r.routeId, direction),
      enabled: focused,
      refetchInterval:
        config.mode === "api" && focused ? 15000 : (false as const),
      refetchIntervalInBackground: false,
    })),
  });
  const routeIndex =
    routes.data?.data.findIndex((r) => r.routeId === routeId) ?? -1;
  const snapshot = snapshots[routeIndex];
  const geographic = locatedStations(stations);
  const mapVehicles = recentVehicles(snapshot?.data, clock);
  const color = routeColors[route?.name ?? "M5107"];
  const invalidStop = !stop && !stationQuery.isPending;
  const loading =
    !demo &&
    (routes.isPending ||
      stationQuery.isPending ||
      (predictions.isPending && !!stop));
  const error = routes.error ?? stationQuery.error ?? predictions.error;
  const saved = favorites.some(
    (f) =>
      f.routeId === routeId &&
      f.direction === direction &&
      f.stationId === stop?.stationId &&
      f.stationSequence === stop?.sequence,
  );
  const openBus = (v: VehiclePrediction) => {
    setVehicleId(v.vehicleId);
    setPanel("vehicle");
  };
  const selectStop = (station: Station) => {
    setPicked(station);
    setIgnoreParams(true);
    setVehicleId(undefined);
    setPanel("home");
  };
  const go = (pathname: "/manual" | "/history" | "/tools") => {
    setMenu(false);
    router.push({
      pathname,
      params: {
        ...selection,
        stationSequence: String(selection.stationSequence),
      },
    });
  };
  const back = () => {
    setPanel("home");
    setVehicleId(undefined);
  };
  const eta = (v: VehiclePrediction) =>
    v.etaAt ? timeInSeoul(v.etaAt) : "시간 미정";
  const chartStart = slots.length
    ? Math.min(...slots.map((slot) => Date.parse(slot.startsAt)))
    : now;
  const chartEnd = slots.length
    ? Math.max(...slots.map((slot) => Date.parse(slot.endsAt)))
    : now;
  const nowFraction =
    chartEnd > chartStart && now >= chartStart && now <= chartEnd
      ? (now - chartStart) / (chartEnd - chartStart)
      : null;
  const changeDirection = (next: Direction) => {
    if (next === direction) return;
    setDirection(next);
    setPicked(undefined);
    setIgnoreParams(true);
    setVehicleId(undefined);
    setPanel("home");
    setFocusVersion(0);
    setMenu(false);
  };
  const mainPanel = panel === "home";
  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={[s.app, { maxWidth: width > 700 ? 520 : undefined }]}>
        <View style={s.mapArea}>
          <RouteMap
            key={`${routeId}:${direction}`}
            stations={geographic}
            path={snapshot?.data?.data.path ?? EMPTY}
            vehicles={mapVehicles}
            selectedSequence={stop?.sequence ?? 0}
            focusVersion={focusVersion}
            focusCoordinate={geographic.find(
              (st) =>
                st.stationId === stop?.stationId &&
                st.sequence === stop?.sequence,
            )}
            routeColor={color}
            controlsInset={mainPanel ? 195 : 140}
            routeLines={(routes.data?.data ?? []).flatMap((r, i) =>
              r.routeId !== routeId && snapshots[i]?.data
                ? [
                    {
                      id: r.routeId,
                      color: routeColors[r.name],
                      path: snapshots[i].data!.data.path,
                    },
                  ]
                : [],
            )}
            stationLabels={Object.fromEntries(
              stations.map((st) => {
                const value = probabilityValue(
                  (active ?? first)
                    ? stationDistribution((active ?? first)!, st, selection)
                    : null,
                  threshold,
                );
                return [
                  st.sequence,
                  {
                    probability: probabilityText(value),
                    color: probabilityColor(value),
                    tag:
                      st.sequence === stop?.sequence ? "내 정류장" : undefined,
                  },
                ];
              }),
            )}
            onStation={selectStop}
            onVehicle={(v) => {
              const match = vehicles.find(
                (row) => row.vehicleId === v.vehicleId,
              );
              if (match) openBus(match);
            }}
          />
          <View style={s.mapTop} pointerEvents="box-none">
            <View style={s.brandRow}>
              <Text style={s.brand}>
                HopOrNot<Text style={{ color: t.colors.primary }}>·</Text>
              </Text>
              <View style={s.brandActions}>
                <Text style={s.micro}>
                  {config.mode === "mock"
                    ? "실제 노선 · 예시 확률"
                    : snapshot?.data?.mode === "replay"
                      ? "과거 재생"
                      : "도착 좌석 예측"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="더보기"
                  onPress={() => setMenu(true)}
                  style={s.iconButton}
                >
                  <Text style={{ fontSize: 22 }}>···</Text>
                </Pressable>
              </View>
            </View>
            {mainPanel ? (
              <View style={s.routeTabs}>
                {["5100", "M5107", "1112"].map((name) => {
                  const item = routes.data?.data.find((r) => r.name === name);
                  const selected = route?.name === name;
                  return (
                    <Pressable
                      key={name}
                      accessibilityRole="button"
                      accessibilityLabel={`${name} 노선`}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        if (!item) return;
                        setRoute(item.routeId);
                        setPicked(undefined);
                        setIgnoreParams(true);
                        back();
                        setFocusVersion(0);
                      }}
                      style={[
                        s.routeTab,
                        selected && { backgroundColor: routeColors[name] },
                      ]}
                    >
                      <View
                        style={[
                          s.routeDot,
                          {
                            backgroundColor: selected
                              ? "white"
                              : routeColors[name],
                          },
                        ]}
                      />
                      <Text
                        style={[s.routeText, selected && { color: "white" }]}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {mainPanel ? (
              <View style={s.directionTabs}>
                {(["TO_SEOUL", "TO_CAMPUS"] as Direction[]).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={directionLabel(route?.name, value)}
                    accessibilityState={{ selected: direction === value }}
                    onPress={() => changeDirection(value)}
                    style={[
                      s.directionTab,
                      direction === value && s.directionActive,
                    ]}
                  >
                    <Text
                      style={[
                        s.directionText,
                        direction === value && {
                          color: t.colors.primaryPressed,
                          fontWeight: "700",
                        },
                      ]}
                    >
                      {directionLabel(route?.name, value)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={s.filters}>
              {!mainPanel ? <Action title="‹ 지도" onPress={back} /> : null}
              {(mainPanel ? [1, 5, 10] : [threshold]).map((n) => (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={`${n}석 이상 기준`}
                  accessibilityState={{ selected: threshold === n }}
                  onPress={() => setThreshold(n as SeatThreshold)}
                  style={[
                    s.filter,
                    threshold === n && { backgroundColor: "#202020" },
                  ]}
                >
                  <Text
                    style={[
                      s.filterText,
                      threshold === n && { color: "white" },
                    ]}
                  >
                    {n}석 이상
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={s.mapBottom} pointerEvents="box-none">
            <View style={s.mapButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="전체 노선 보기"
                onPress={() => setFocusVersion((v) => v + 1)}
                style={s.recenter}
              >
                <Text style={{ color: t.colors.primary, fontSize: 21 }}>⌖</Text>
              </Pressable>
            </View>
            {snapshot?.error ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void snapshot.refetch();
                }}
                style={s.dataNotice}
              >
                <Text style={s.micro}>운행 지도 요청 실패 · 다시 시도</Text>
              </Pressable>
            ) : null}
            {!geographic.length ? (
              <View style={s.dataNotice}>
                <Text style={s.micro}>정류장·운행 위치 연결 대기</Text>
              </View>
            ) : null}
            <View style={s.legend}>
              <Text style={s.legendTitle}>좌석 확률</Text>
              {[
                [t.colors.primary, "70% 이상"],
                [t.colors.madrid, "40–69%"],
                [t.colors.rio, "40% 미만"],
              ].map(([c, label]) => (
                <View key={label} style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: c }]} />
                  <Text style={s.micro}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View
          style={[
            s.sheet,
            {
              maxHeight: mainPanel
                ? "48%"
                : panel === "forecast"
                  ? "68%"
                  : "60%",
              minHeight: mainPanel ? Math.min(330, height * 0.45) : undefined,
            },
          ]}
        >
          <View style={s.handle} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.sheetContent}
          >
            {loading ? <ActivityIndicator color={t.colors.primary} /> : null}
            {error ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void routes.refetch();
                  void stationQuery.refetch();
                  void predictions.refetch();
                }}
              >
                <Text style={s.error}>{error.message} · 다시 시도</Text>
              </Pressable>
            ) : null}
            {predictions.data?.isStale || snapshot?.data?.isStale ? (
              <Text style={s.error}>최신 정보 아님</Text>
            ) : null}
            {invalidStop ? (
              <>
                <Text style={s.heading}>정류장을 선택해 주세요</Text>
                <Action title="정류장 선택" onPress={() => go("/manual")} />
              </>
            ) : null}
            {mainPanel && stop ? (
              <>
                <View style={s.sectionHeader}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.muted}>
                      내 정류장 · {directionLabel(route?.name, direction)} ·{" "}
                      {vehicles.length}대 오는 중
                    </Text>
                    <Text style={s.stationTitle}>{stop.name}</Text>
                  </View>
                  <Action title="정류장 변경" onPress={() => go("/manual")} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="추천 버스 상세"
                  onPress={() => {
                    if (recommended) openBus(recommended);
                  }}
                  disabled={!recommended}
                  style={s.recommendation}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.eyebrow}>
                      도착 좌석 예측 · {thresholdName(threshold)}
                    </Text>
                    <Text style={s.recommendTitle}>
                      {recommended
                        ? recommended.arrivalOrder === 1
                          ? "이번 버스가 여유로워요"
                          : `${recommended.arrivalOrder - 1}대 뒤, ${recommended.arrivalOrder}번째 버스`
                        : "여유 있는 버스가 없어요"}
                    </Text>
                    <Text style={s.muted}>
                      {recommended
                        ? `${eta(recommended)} 도착${recommended.etaSource === "ESTIMATED" ? " 예상" : ""} · 지금 ${recommended.currentObservation?.remainingSeats === null || recommended.currentObservation?.remainingSeats === undefined ? "좌석 정보 없음" : `${recommended.currentObservation.remainingSeats}석`}`
                        : vehicles.length
                          ? "70% 이상 예측이 없어요"
                          : "도착 예정 버스가 없어요"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    <Text style={s.micro}>
                      도착 시 {thresholdName(threshold)}
                    </Text>
                    <Text style={s.heroProbability}>
                      {probabilityText(
                        probabilityValue(
                          recommended?.distribution ?? null,
                          threshold,
                        ),
                      )}
                    </Text>
                  </View>
                </Pressable>
                {best ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="정류장 비교"
                    onPress={() => setPanel("compare")}
                    style={s.alternative}
                  >
                    <View style={s.walkIcon}>
                      <Text style={{ color: "white", fontSize: 20 }}>↗</Text>
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={s.alternativeTitle}>
                        {best.stationName}도 비교해 보세요
                      </Text>
                      <Text style={s.muted}>
                        도보 {Math.ceil(best.walkSeconds! / 60)}분 ·{" "}
                        {best.candidate?.etaAt
                          ? timeInSeoul(best.candidate.etaAt)
                          : "시간 미정"}{" "}
                        ·{" "}
                        {probabilityText(
                          probabilityValue(
                            best.candidate?.distribution ?? null,
                            threshold,
                          ),
                        )}
                      </Text>
                    </View>
                    <Text style={s.chevron}>›</Text>
                  </Pressable>
                ) : null}
                <View style={s.arrivals}>
                  {vehicles.slice(0, 4).map((v) => {
                    const recommendedBus =
                      recommended?.vehicleId === v.vehicleId;
                    const min = minutesUntil(v.etaAt, now);
                    return (
                      <Pressable
                        key={v.vehicleId}
                        accessibilityRole="button"
                        accessibilityLabel={`${v.arrivalOrder}번째 버스 상세`}
                        onPress={() => openBus(v)}
                        style={[s.arrival, recommendedBus && s.arrivalSelected]}
                      >
                        <Text
                          style={[
                            s.arrivalLabel,
                            recommendedBus && { color: t.colors.primary },
                          ]}
                        >
                          {recommendedBus ? "추천 · " : ""}
                          {v.arrivalOrder === 1
                            ? "이번"
                            : v.arrivalOrder === 2
                              ? "다음"
                              : `${v.arrivalOrder}번째`}
                        </Text>
                        <Text style={s.arrivalTime}>
                          {min === null ? "—" : `${min}분`}
                        </Text>
                        <Text style={s.seatChip}>
                          지금{" "}
                          {v.currentObservation?.remainingSeats === null ||
                          v.currentObservation?.remainingSeats === undefined
                            ? "—"
                            : `${v.currentObservation.remainingSeats}석`}
                        </Text>
                        <Pill
                          value={probabilityValue(v.distribution, threshold)}
                        />
                      </Pressable>
                    );
                  })}
                </View>
                <View style={s.footerActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setPanel("compare")}
                    style={s.footerLink}
                  >
                    <Text style={s.footerText}>정류장 비교 ›</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setPanel("forecast")}
                    style={s.footerLink}
                  >
                    <Text style={s.footerText}>언제 여유로울까 ›</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
            {panel === "vehicle" ? (
              active ? (
                <>
                  <View style={s.sectionHeader}>
                    <View style={[s.largeBus, { backgroundColor: color }]}>
                      <BusIcon size={27} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={s.heading}>
                        {route?.name} · {active.arrivalOrder}번째 버스
                      </Text>
                      <Text style={s.muted}>
                        {eta(active)}{" "}
                        {active.etaSource === "ESTIMATED"
                          ? "도착 예상"
                          : "도착 예정"}{" "}
                        · {stop?.name}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="버스 상세 닫기"
                      onPress={back}
                      style={s.iconButton}
                    >
                      <Text style={s.close}>×</Text>
                    </Pressable>
                  </View>
                  <View style={s.currentSeats}>
                    <Text style={{ color: "white", fontSize: 15 }}>
                      지금 잔여석
                    </Text>
                    <Text
                      style={{
                        color: "white",
                        fontSize: 25,
                        fontWeight: "700",
                      }}
                    >
                      {active.currentObservation?.remainingSeats === null ||
                      active.currentObservation?.remainingSeats === undefined
                        ? "정보 없음"
                        : `${active.currentObservation.remainingSeats}석`}
                    </Text>
                  </View>
                  <View style={s.distribution}>
                    <Text style={s.distributionTitle}>
                      {stop?.name} 도착 시 남을 확률
                    </Text>
                    <Text style={s.muted}>
                      {eta(active)} ·{" "}
                      {active.source === "HISTORICAL_FREQUENCY"
                        ? "과거 빈도"
                        : "예측"}
                    </Text>
                    {([1, 5, 10] as SeatThreshold[]).map((n) => {
                      const p = probabilityValue(active.distribution, n);
                      return (
                        <View key={n} style={s.barRow}>
                          <Text style={s.barLabel}>{n}석 이상</Text>
                          <View style={s.track}>
                            {p.kind === "value" ? (
                              <View
                                style={[
                                  s.fill,
                                  {
                                    width: `${p.value * 100}%`,
                                    backgroundColor: probabilityColor(p),
                                  },
                                ]}
                              />
                            ) : null}
                          </View>
                          <Text style={s.barValue}>{probabilityText(p)}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={s.subheading}>정류장별 도착 좌석 예측</Text>
                  {stations
                    .slice(
                      Math.max(
                        0,
                        stations.findIndex(
                          (st) => st.sequence === stop?.sequence,
                        ) - 3,
                      ),
                      stations.findIndex(
                        (st) => st.sequence === stop?.sequence,
                      ) + 1,
                    )
                    .map((st) => (
                      <Pressable
                        accessibilityRole="button"
                        key={st.sequence}
                        onPress={() => selectStop(st)}
                        style={s.stopRow}
                      >
                        <View style={s.stopDot} />
                        <Text
                          style={[
                            s.stopName,
                            st.sequence === stop?.sequence && {
                              fontWeight: "700",
                            },
                          ]}
                        >
                          {st.name}
                        </Text>
                        {st.sequence === stop?.sequence ? (
                          <Text style={s.myTag}>내 정류장</Text>
                        ) : null}
                        <Pill
                          value={probabilityValue(
                            stationDistribution(active, st, selection),
                            threshold,
                          )}
                        />
                      </Pressable>
                    ))}
                  <Text style={s.micro}>
                    현재 좌석은 관측값 · 도착 좌석은 예측값
                  </Text>
                </>
              ) : (
                <>
                  <Text style={s.heading}>버스 정보가 변경됐어요</Text>
                  <Action title="지도" onPress={back} />
                </>
              )
            ) : null}
            {panel === "compare" ? (
              <>
                <Text style={s.stationTitle}>어디서 타면 좋을까요</Text>
                <Text style={s.muted}>
                  이동 시간 포함 · {thresholdName(threshold)} · 70% 이상 기준
                </Text>
                {alternatives.isFetching && !demo ? (
                  <ActivityIndicator color={t.colors.primary} />
                ) : null}
                {alternatives.error ? (
                  <Text style={s.error}>정류장 비교를 불러오지 못했어요</Text>
                ) : null}
                {eligible.map((a, i) => (
                  <Pressable
                    key={`${a.target.stationId}:${a.target.stationSequence}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${a.stationName} 대안 선택`}
                    onPress={() => {
                      const target = stations.find(
                        (st) =>
                          st.stationId === a.target.stationId &&
                          st.sequence === a.target.stationSequence,
                      );
                      if (target) selectStop(target);
                    }}
                    style={[s.compareRow, i === 0 && s.compareRecommended]}
                  >
                    <Text style={[s.rank, i === 0 && s.rankFirst]}>
                      {i + 1}
                    </Text>
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text style={s.compareName}>
                        {a.stationName}
                        {i === 0 ? " · 추천" : ""}
                      </Text>
                      <Text style={s.muted}>
                        도보 {Math.ceil(a.walkSeconds! / 60)}분 ·{" "}
                        {a.candidate!.arrivalOrder}번째 버스
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 5 }}>
                      <Text style={s.compareTime}>
                        {timeInSeoul(a.candidate!.etaAt!)}
                      </Text>
                      <Pill
                        value={probabilityValue(
                          a.candidate!.distribution,
                          threshold,
                        )}
                      />
                    </View>
                  </Pressable>
                ))}
                <View style={s.compareRow}>
                  <Text style={s.rank}>{eligible.length + 1}</Text>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={s.compareName}>
                      {stop?.name ?? "내 정류장"}{" "}
                      <Text style={s.micro}>내 정류장</Text>
                    </Text>
                    <Text style={s.muted}>
                      {recommended
                        ? `${recommended.arrivalOrder}번째 버스까지 대기`
                        : "좌석 여유 예측 없음"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 5 }}>
                    <Text style={s.compareTime}>
                      {recommended ? eta(recommended) : "—"}
                    </Text>
                    <Pill
                      value={probabilityValue(
                        recommended?.distribution ?? null,
                        threshold,
                      )}
                    />
                  </View>
                </View>
                {!eligible.length ? (
                  <Text style={s.muted}>
                    도보로 도착 가능한 대안 정류장이 아직 없어요.
                  </Text>
                ) : null}
                {best ? (
                  <Action
                    title={`${best.stationName} 정류장 선택`}
                    primary
                    onPress={() => {
                      const target = stations.find(
                        (st) =>
                          st.stationId === best.target.stationId &&
                          st.sequence === best.target.stationSequence,
                      );
                      if (target) selectStop(target);
                    }}
                  />
                ) : (
                  <Action title="지도 돌아가기" onPress={back} />
                )}
              </>
            ) : null}
            {panel === "forecast" ? (
              <>
                <Text style={s.muted}>
                  {stop?.name} · {thresholdName(threshold)}
                </Text>
                <Text style={s.stationTitle}>
                  {comfortable
                    ? `${timeInSeoul(comfortable.startsAt)}부터 여유가 생겨요`
                    : "언제 여유로울까요"}
                </Text>
                <Text style={s.muted}>
                  같은 요일·시간대 기록에 따른 좌석 예측
                </Text>
                {forecast.isFetching && !demo ? (
                  <ActivityIndicator color={t.colors.primary} />
                ) : null}
                {forecast.error ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      void forecast.refetch();
                    }}
                  >
                    <Text style={s.error}>
                      시간대 전망 요청 실패 · 다시 시도
                    </Text>
                  </Pressable>
                ) : null}
                <View style={s.chart}>
                  <View style={s.chartHeading}>
                    <Text style={s.subheading}>시간대별 좌석 확률</Text>
                    <Text style={s.micro}>70% 기준</Text>
                  </View>
                  <View style={s.chartPlot}>
                    <View style={s.guide} />
                    {nowFraction !== null ? (
                      <View
                        pointerEvents="none"
                        style={{
                          position: "absolute",
                          left: `${nowFraction * 100}%`,
                          top: 4,
                          bottom: 25,
                          width: 1.5,
                          backgroundColor: t.colors.primaryPressed,
                          zIndex: 2,
                        }}
                      >
                        <Text
                          style={{
                            position: "absolute",
                            width: 28,
                            textAlign: "center",
                            top: -15,
                            left: -13,
                            fontSize: 8,
                            color: "white",
                            backgroundColor: t.colors.primaryPressed,
                            paddingHorizontal: 5,
                            paddingVertical: 2,
                            borderRadius: 8,
                          }}
                        >
                          지금
                        </Text>
                      </View>
                    ) : null}
                    {slots.map((slot) => {
                      const p = probabilityValue(slot.distribution, threshold);
                      return (
                        <View key={slot.startsAt} style={s.chartColumn}>
                          <View
                            style={[
                              s.chartBar,
                              {
                                height:
                                  p.kind === "value"
                                    ? Math.max(2, p.value * 120)
                                    : 2,
                                backgroundColor: probabilityColor(p),
                              },
                            ]}
                          />
                          {slots.length <= 6 ||
                          slots.indexOf(slot) % 3 === 0 ? (
                            <Text style={s.chartTime}>
                              {timeInSeoul(slot.startsAt)}
                            </Text>
                          ) : (
                            <Text style={s.chartTime}> </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                  {!slots.length && !forecast.isFetching ? (
                    <Text style={s.muted}>조회된 시간대 기록이 없어요.</Text>
                  ) : null}
                </View>
                <Text style={s.subheading}>다가오는 버스</Text>
                {vehicles.map((v) => (
                  <Pressable
                    key={v.vehicleId}
                    accessibilityRole="button"
                    onPress={() => openBus(v)}
                    style={s.forecastRow}
                  >
                    <Text style={s.forecastTime}>{eta(v)}</Text>
                    <Text style={[s.muted, { flex: 1 }]}>
                      {v.arrivalOrder}번째
                    </Text>
                    <Text style={s.seatChip}>
                      지금 {v.currentObservation?.remainingSeats ?? "—"}석
                    </Text>
                    <Pill value={probabilityValue(v.distribution, threshold)} />
                  </Pressable>
                ))}
                <Action title="지도에서 버스 확인" primary onPress={back} />
              </>
            ) : null}
          </ScrollView>
        </View>
        <Modal
          transparent
          visible={menu}
          animationType="slide"
          onRequestClose={() => setMenu(false)}
        >
          <Pressable style={s.scrim} onPress={() => setMenu(false)}>
            <Pressable style={s.menu} onPress={() => {}}>
              <Text style={s.heading}>HopOrNot</Text>
              <Text style={s.muted}>
                확률은 도착 시 남는 좌석의 예측입니다. 대기 인원은 반영하지
                않습니다.
              </Text>
              <Action
                title={saved ? "즐겨찾기 삭제" : "즐겨찾기 추가"}
                onPress={() => {
                  if (stop && ready) toggle(selection);
                  setMenu(false);
                }}
              />
              <Action
                title={
                  direction === "TO_SEOUL"
                    ? "국제캠퍼스 방면으로"
                    : "서울 방면으로"
                }
                onPress={() => {
                  changeDirection(
                    direction === "TO_SEOUL" ? "TO_CAMPUS" : "TO_SEOUL",
                  );
                }}
              />
              <Action title="과거 기록" onPress={() => go("/history")} />
              <Action
                title="즐겨찾기 · 개발 도구"
                onPress={() => go("/tools")}
              />
              <Action title="닫기" onPress={() => setMenu(false)} />
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </SafeAreaView>
  );
}
