import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
import {
  Button,
  Card,
  IconButton,
  Probability,
  QueryState,
  Screen,
  Status,
  styles,
  VehicleCard,
} from "../components/ui";
import { DateField, HistoryList } from "../components/data-panels";
import { useSection, useStations, useRoutes } from "./queries";
import { useBus } from "./provider";
import {
  dateInSeoul,
  directions,
  favoriteKey,
  timeInSeoul,
  validSelection,
} from "../domain/logic";
import { Selection } from "../domain/types";
import { config } from "../config";
import { DEMO_DATE } from "../mocks/fixtures";
import { theme as t } from "../theme";
type Page = "results" | "forecast" | "history" | "alternatives";
const titles: Record<Page, string> = {
  results: "데이터 정보",
  forecast: "시간대 전망",
  history: "지난 기록",
  alternatives: "대안 정류장",
};
export function ResultScreen({ page }: { page: Page }) {
  const p = useLocalSearchParams();
  const s = {
    routeId: p.routeId,
    direction: p.direction,
    stationId: p.stationId,
    stationSequence: Number(p.stationSequence),
  };
  if (!validSelection(s))
    return (
      <Screen title="정류장 선택">
        <Text style={styles.muted}>정류장을 다시 선택해 주세요.</Text>
        <Button title="정류장 선택" onPress={() => router.replace("/manual")} />
      </Screen>
    );
  return <Validated key={favoriteKey(s)} selection={s} page={page} />;
}
function Validated({
  selection: s,
  page,
}: {
  selection: Selection;
  page: Page;
}) {
  const stations = useStations(s.routeId, s.direction);
  const station = stations.data?.data.find(
    (x) => x.stationId === s.stationId && x.sequence === s.stationSequence,
  );
  if (!station)
    return (
      <Screen title={titles[page]}>
        <QueryState
          loading={stations.isPending}
          error={stations.error}
          retry={() => {
            void stations.refetch();
          }}
          empty={!!stations.data}
          message="정류장을 다시 선택해 주세요."
        />
        <Button title="정류장 선택" onPress={() => router.replace("/manual")} />
      </Screen>
    );
  return <Content page={page} s={s} name={station.name} />;
}
function Content({
  page,
  s,
  name,
}: {
  page: Page;
  s: Selection;
  name: string;
}) {
  const routes = useRoutes();
  const route = routes.data?.data.find((r) => r.routeId === s.routeId);
  const { favorites, toggle, ready } = useBus();
  const [date, setDate] = useState(
    config.mode === "mock" ? DEMO_DATE : dateInSeoul(new Date().toISOString()),
  );
  const predictions = useSection("getPredictions", s, "", page === "results");
  const forecast = useSection("getForecast", s, date, page === "forecast");
  const history = useSection("getHistory", s, date, page === "history");
  const alternatives = useSection(
    "getAlternatives",
    s,
    "",
    page === "alternatives",
  );
  const q =
    page === "results"
      ? predictions
      : page === "forecast"
        ? forecast
        : page === "history"
          ? history
          : alternatives;
  const saved = favorites.some((x) => favoriteKey(x) === favoriteKey(s));
  return (
    <Screen title={titles[page]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.heading}>{name}</Text>
          <Text style={styles.muted}>
            {route?.name ?? "—"} · {directions[s.direction]}
          </Text>
        </View>
        <IconButton
          label={saved ? "즐겨찾기 삭제" : "즐겨찾기 추가"}
          icon={saved ? "★" : "☆"}
          active={saved}
          onPress={() => {
            if (ready) toggle(s);
          }}
        />
      </View>
      {(page === "forecast" || page === "history") && (
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
          page === "alternatives"
            ? "비교할 정류장이 없어요."
            : page === "forecast"
              ? "이 날짜의 전망이 없어요."
              : page === "history"
                ? "기록이 없어요."
                : "다가오는 버스가 없어요."
        }
      />
      {page === "results" &&
        predictions.data?.data
          .slice()
          .sort((a, b) => a.arrivalOrder - b.arrivalOrder)
          .slice(0, 3)
          .map((v) => (
            <VehicleCard key={`${v.tripId}-${v.vehicleId}`} vehicle={v} />
          ))}
      {page === "forecast" &&
        forecast.data?.data.map((slot) => (
          <Card key={slot.startsAt}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.heading}>
                {timeInSeoul(slot.startsAt)}–{timeInSeoul(slot.endsAt)}
              </Text>
              <Text style={styles.muted}>
                {slot.quality === "NO_DATA"
                  ? "자료 없음"
                  : slot.quality === "LIMITED"
                    ? "자료 제한"
                    : `표본 ${slot.sampleCount}`}
              </Text>
            </View>
            <Probability value={slot.distribution} />
          </Card>
        ))}
      {page === "history" && history.data && history.data.data.length > 0 && (
        <HistoryList records={history.data.data} />
      )}
      {page === "alternatives" &&
        alternatives.data?.data.map((a) => {
          const same =
            a.target.routeId === s.routeId &&
            a.target.direction === s.direction;
          const walking =
            a.distanceKind === "WALKING_ROUTE" && a.walkSeconds !== null;
          const eligible =
            same &&
            walking &&
            a.recommendation === "ELIGIBLE" &&
            !!a.candidate?.etaAt;
          if (!a.candidate)
            return (
              <Pressable
                key={favoriteKey(a.target)}
                accessibilityRole="button"
                accessibilityLabel={`${a.stationName} 결과 보기`}
                disabled={!same}
                onPress={() =>
                  router.push({
                    pathname: "/",
                    params: {
                      ...a.target,
                      stationSequence: String(a.target.stationSequence),
                    },
                  })
                }
                style={{
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  borderRadius: 16,
                  padding: 16,
                  gap: 8,
                }}
              >
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Text style={[styles.body, { flex: 1, fontWeight: "600" }]}>
                    {a.stationName}
                  </Text>
                  <Text style={styles.muted}>비교 보류</Text>
                </View>
                <Text numberOfLines={2} style={styles.muted}>
                  {a.reason}
                </Text>
              </Pressable>
            );
          return (
            <Card key={favoriteKey(a.target)}>
              <View style={[styles.row, { justifyContent: "space-between" }]}>
                <Text style={[styles.heading, { flex: 1 }]}>
                  {a.stationName}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: eligible ? t.colors.primary : t.colors.muted,
                    backgroundColor: eligible
                      ? t.colors.lisbon
                      : t.colors.neutral,
                    padding: 8,
                    borderRadius: 8,
                  }}
                >
                  {eligible ? "경로 확인" : "비교 보류"}
                </Text>
              </View>
              <Text style={styles.body}>
                {a.distanceKind === "STRAIGHT_LINE"
                  ? "직선 "
                  : a.distanceKind === "WALKING_ROUTE"
                    ? "도보 "
                    : ""}
                {a.distanceMeters !== null
                  ? `${a.distanceMeters}m`
                  : "거리 미확인"}{" "}
                ·{" "}
                {walking
                  ? `${Math.ceil(a.walkSeconds! / 60)}분`
                  : "도보 시간 미확인"}
              </Text>
              {!eligible && (
                <Text style={styles.muted}>
                  {!same ? "노선·방향을 확인해 주세요." : a.reason}
                </Text>
              )}
              {a.candidate && (
                <>
                  <Text style={styles.muted}>
                    {a.candidate.etaAt
                      ? `${timeInSeoul(a.candidate.etaAt)}${a.candidate.etaSource === "ESTIMATED" ? " 예상" : ""}`
                      : "도착 시각 미확인"}{" "}
                    ·{" "}
                    {a.candidate.source === "MODEL"
                      ? "모델 예측"
                      : a.candidate.source === "HISTORICAL_FREQUENCY"
                        ? "과거 빈도"
                        : "예측 없음"}
                  </Text>
                  <Probability value={a.candidate.distribution} />
                </>
              )}
              {same && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="이 정류장 결과 보기"
                  onPress={() =>
                    router.push({
                      pathname: "/",
                      params: {
                        ...a.target,
                        stationSequence: String(a.target.stationSequence),
                      },
                    })
                  }
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      color: t.colors.primary,
                      fontWeight: "600",
                    }}
                  >
                    이 정류장 보기 →
                  </Text>
                </Pressable>
              )}
            </Card>
          );
        })}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Status data={q.data} error={q.error} fetching={q.isFetching} />
        <IconButton
          label="새로고침"
          icon="↻"
          onPress={() => {
            void q.refetch();
          }}
        />
      </View>
      {page === "forecast" && (
        <Text style={styles.muted}>시간대별 전망 · 특정 차량 예측과 별도</Text>
      )}
    </Screen>
  );
}
