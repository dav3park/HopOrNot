import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  changeSelection,
  decodeFavorites,
  favoriteKey,
  probabilities,
  seatBand,
  toggleFavorite,
  dateInSeoul,
  timeInSeoul,
} from "../src/domain/logic";
import {
  createHttpRepository,
  createMockRepository,
  requestKey,
  schemas,
} from "../src/data/repository";
import { distribution, scenarios, DEMO_DATE } from "../src/mocks/fixtures";
import { Selection } from "../src/domain/types";
const s: Selection = {
  routeId: "mock-route-5100",
  direction: "TO_CAMPUS",
  stationId: "mock-station-01",
  stationSequence: 1,
};
test("누적 확률 92/71/38, null과 유효한 0 구분", () => {
  assert.deepEqual(
    probabilities(distribution)?.map((v) => Math.round(v * 100)),
    [92, 71, 38],
  );
  assert.equal(probabilities(null), null);
  assert.deepEqual(
    probabilities({ zero: 1, oneToFour: 0, fiveToNine: 0, tenPlus: 0 }),
    [0, 0, 0],
  );
  for (const invalid of [
    { ...distribution, zero: NaN },
    { ...distribution, zero: -0.1 },
    { ...distribution, zero: 1.1 },
    { ...distribution, zero: 0.8 },
  ])
    assert.throws(() => probabilities(invalid));
});
test("관측 좌석 -1/null은 정보 없음; 경계값 구분", () => {
  assert.deepEqual([null, -1, 0, 1, 4, 5, 9, 10].map(seatBand), [
    "정보 없음",
    "정보 없음",
    "0석",
    "1–4석",
    "1–4석",
    "5–9석",
    "5–9석",
    "10석 이상",
  ]);
});
test("즐겨찾기 저장/복원/중복 제거/방문 순번 구분/손상 차단", () => {
  const items = toggleFavorite([], s);
  assert.equal(items.length, 1);
  assert.deepEqual(
    decodeFavorites(JSON.stringify({ version: 1, items: [...items, s] })),
    [s],
  );
  assert.deepEqual(toggleFavorite(items, s), []);
  assert.equal(toggleFavorite(items, { ...s, stationSequence: 3 }).length, 2);
  assert.notEqual(favoriteKey(s), favoriteKey({ ...s, direction: "TO_SEOUL" }));
  for (const raw of [
    "{broken",
    '{"version":2,"items":[]}',
    '{"version":1,"items":[{}]}',
    "null",
  ])
    assert.throws(() => decodeFavorites(raw));
  assert.deepEqual(decodeFavorites(null), []);
});
test("노선/방향 변경은 선택 해제; 요청 키에는 방문 순번/날짜 포함", () => {
  assert.equal(changeSelection(s, s.routeId, "TO_SEOUL"), null);
  assert.equal(changeSelection(s, "mock-route-1112", s.direction), null);
  assert.equal(changeSelection(s, s.routeId, s.direction), s);
  assert.notDeepEqual(
    requestKey("history", s, DEMO_DATE),
    requestKey("history", { ...s, stationSequence: 3 }, DEMO_DATE),
  );
  assert.notDeepEqual(
    requestKey("history", s, DEMO_DATE),
    requestKey("history", s, "2026-11-03"),
  );
});
test("이전 요청이 늦게 끝나도 다른 선택의 query cache를 덮어쓰지 않음", async () => {
  const client = new QueryClient();
  const newer = { ...s, direction: "TO_SEOUL" as const };
  let release!: (value: string) => void;
  const old = client.fetchQuery({
    queryKey: requestKey("predictions", s),
    queryFn: () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  });
  await client.fetchQuery({
    queryKey: requestKey("predictions", newer),
    queryFn: async () => "new",
  });
  release("old");
  await old;
  assert.equal(client.getQueryData(requestKey("predictions", newer)), "new");
  client.clear();
});
test("0/1/2/3대와 부분 오류는 정상 카드 보존", async () => {
  for (const [scenario, count] of [
    ["empty", 0],
    ["one", 1],
    ["two", 2],
    ["normal", 3],
  ] as const)
    assert.equal(
      (await createMockRepository(scenario).getPredictions(s)).data.length,
      count,
    );
  const rows = (await createMockRepository("partial").getPredictions(s)).data;
  assert.doesNotThrow(() => probabilities(rows[0].distribution));
  assert.throws(() => probabilities(rows[1].distribution));
  assert.doesNotThrow(() => probabilities(rows[2].distribution));
});
test("모든 fixture 응답은 계약 스키마 통과, 시나리오 확률/상태 보장", async () => {
  for (const scenario of Object.keys(scenarios) as (keyof typeof scenarios)[]) {
    const r = createMockRepository(scenario);
    if (scenario !== "httpError") {
      const response = await r.getPredictions(s);
      assert.ok(schemas.predictions.safeParse(response.data).success);
    }
  }
  const r = createMockRepository("normal");
  for (const [schema, response] of [
    [schemas.routes, await r.getRoutes()],
    [schemas.stations, await r.getStations(s.routeId, s.direction)],
    [schemas.forecast, await r.getForecast(s, DEMO_DATE)],
    [schemas.history, await r.getHistory(s, DEMO_DATE)],
    [schemas.alternatives, await r.getAlternatives(s)],
  ] as const)
    assert.ok(schema.safeParse(response.data).success);
  const zero = (await createMockRepository("zeroNull").getPredictions(s)).data;
  assert.deepEqual(probabilities(zero[0].distribution), [0, 0, 0]);
  assert.equal(probabilities(zero[1].distribution), null);
});
test("오래된 시각/빈 과거 기록/미수집 날짜/부분 요청 실패", async () => {
  assert.equal(
    (await createMockRepository("stale").getPredictions(s)).isStale,
    true,
  );
  assert.equal(
    (await createMockRepository("noHistory").getHistory(s, DEMO_DATE)).data
      .length,
    0,
  );
  assert.equal(
    (await createMockRepository("normal").getHistory(s, "2026-11-03")).data
      .length,
    0,
  );
  const r = createMockRepository("forecastError");
  await assert.rejects(r.getForecast(s, DEMO_DATE));
  assert.equal((await r.getPredictions(s)).data.length, 3);
  await assert.rejects(createMockRepository("httpError").getPredictions(s));
});
test("직선거리 후보에 도보시간 없음; 대안 없음/ETA 불명", async () => {
  const straight = (await createMockRepository("straight").getAlternatives(s))
    .data;
  assert.ok(
    straight.every(
      (a) => a.walkSeconds === null && a.recommendation === "REFERENCE_ONLY",
    ),
  );
  assert.equal(
    (await createMockRepository("noAlternative").getAlternatives(s)).data
      .length,
    0,
  );
  assert.equal(
    (await createMockRepository("noAlternative").getPredictions(s)).data[0]
      .etaAt,
    null,
  );
});
test("서울 날짜/시간은 기기 시간대와 무관", () => {
  assert.equal(dateInSeoul("2026-11-03T23:00:00Z"), DEMO_DATE);
  assert.equal(timeInSeoul("2026-11-03T23:00:00Z"), "08:00");
});
test("HTTP adapter 설정 오류, 요청 필드, 실패/스키마 오류를 mock으로 숨기지 않음", async () => {
  await assert.rejects(createHttpRepository("").getRoutes(), /설정 오류/);
  const original = globalThis.fetch;
  try {
    let requested = "";
    globalThis.fetch = (async (url) => {
      requested = String(url);
      return new Response(
        JSON.stringify({
          data: [],
          mode: "live",
          generatedAt: "2026-11-04T08:00:00+09:00",
          lastObservedAt: null,
          isStale: false,
        }),
      );
    }) as typeof fetch;
    const result = await createHttpRepository(
      "https://example.test",
    ).getHistory(s, DEMO_DATE);
    assert.equal(result.mode, "live");
    const url = new URL(requested);
    assert.equal(url.pathname, "/history");
    assert.equal(url.searchParams.get("stationSequence"), "1");
    assert.equal(url.searchParams.get("date"), DEMO_DATE);
    globalThis.fetch = (async () =>
      new Response("", { status: 503 })) as typeof fetch;
    await assert.rejects(
      createHttpRepository("https://example.test").getPredictions(s),
      /503/,
    );
    globalThis.fetch = (async () =>
      new Response('{"data":[]}')) as typeof fetch;
    await assert.rejects(
      createHttpRepository("https://example.test").getRoutes(),
      /응答|응답/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("디자인 기준: 0/null/오류 색상과 70% 참고 판단", async () => {
  const {
    probabilityValue,
    probabilityColor,
    probabilityText,
    currentSeatsText,
    referenceVehicle,
  } = await import("../src/domain/presentation");
  const { vehicles } = await import("../src/mocks/fixtures");
  assert.equal(probabilityText(probabilityValue(null, 1)), "—");
  assert.equal(
    probabilityText(probabilityValue({ ...distribution, zero: 0.9 }, 1)),
    "오류",
  );
  assert.equal(
    probabilityText(
      probabilityValue({ zero: 1, oneToFour: 0, fiveToNine: 0, tenPlus: 0 }, 1),
    ),
    "0%",
  );
  assert.notEqual(
    probabilityColor({ kind: "value", value: 0 }),
    probabilityColor({ kind: "missing" }),
  );
  assert.equal(currentSeatsText(-1), "정보 없음");
  assert.equal(currentSeatsText(0), "0석");
  assert.equal(currentSeatsText(undefined), "정보 없음");
  assert.equal(referenceVehicle(vehicles("normal"), 5)?.arrivalOrder, 1);
  assert.equal(referenceVehicle(vehicles("normal"), 10), null);
  assert.equal(referenceVehicle(vehicles("invalid"), 1), null);
});
test("선택 정류장의 결측/오류를 경로의 다른 예측으로 덮지 않으며 재방문은 구분", async () => {
  const { stationDistribution } = await import("../src/domain/presentation");
  const { vehicles, stations } = await import("../src/mocks/fixtures");
  const v = vehicles("zeroNull")[1];
  assert.equal(stationDistribution(v, stations[0], s), null);
  assert.notEqual(stationDistribution(v, stations[2], s), null);
  delete v.stationPredictions;
  assert.equal(stationDistribution(v, stations[2], s), null);
});
