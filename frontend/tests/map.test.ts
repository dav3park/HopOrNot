import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config";
import {
  fetchRouteMap,
  locatedStations,
  mapEnvelopeSchema,
  recentVehicles,
} from "../src/maps/data";

const payload = () => ({
  data: {
    routeId: "200000115",
    direction: "TO_SEOUL" as const,
    path: [
      [
        { latitude: 37.2, longitude: 127.1 },
        { latitude: 37.3, longitude: 127.2 },
      ],
    ],
    vehicles: [
      {
        vehicleId: "bus-1",
        latitude: 37.25,
        longitude: 127.15,
        observedAt: "2026-11-12T08:00:00+09:00",
        remainingSeats: 0,
      },
    ],
  },
  mode: "live" as "live" | "replay",
  generatedAt: "2026-11-12T08:00:00+09:00",
  lastObservedAt: "2026-11-12T08:00:00+09:00",
  isStale: false,
});
test("지도는 좌표가 없는 정류장을 만들지 않고 회차 순서를 보존한다", () => {
  const stations = [1, 3].map((sequence) => ({
    stationId: "same-stop",
    name: "회차 정류장",
    sequence,
    latitude: 37.2,
    longitude: 127.1,
  }));
  assert.deepEqual(
    locatedStations([
      ...stations,
      { ...stations[0], latitude: null },
      { ...stations[0], longitude: 181 },
    ]),
    stations,
  );
});
test("지도 계약은 잘못된 GPS·시각·좌석값·끊긴 경로 조각을 거부한다", () => {
  const data = payload();
  assert.ok(mapEnvelopeSchema.safeParse(data).success);
  assert.ok(
    !mapEnvelopeSchema.safeParse({
      ...data,
      data: { ...data.data, path: [[{ latitude: 37, longitude: 127 }]] },
    }).success,
  );
  for (const override of [
    { latitude: 91 },
    { longitude: NaN },
    { observedAt: "어제" },
    { remainingSeats: -1 },
  ]) {
    assert.ok(
      !mapEnvelopeSchema.safeParse({
        ...data,
        data: {
          ...data.data,
          vehicles: [{ ...data.data.vehicles[0], ...override }],
        },
      }).success,
    );
  }
});
test("만석 0석은 유지하고 오래되거나 미래의 버스 위치는 숨긴다", () => {
  const data = payload();
  const time = Date.parse(data.generatedAt);
  assert.equal(recentVehicles(data, time)[0].remainingSeats, 0);
  assert.equal(recentVehicles(data, time + 120001).length, 0);
  assert.equal(recentVehicles(data, time - 60001).length, 0);
  assert.equal(recentVehicles({ ...data, isStale: true }, time).length, 0);
});
test("과거 재생에서는 재생 시각을 기준으로 위치를 판정한다", () => {
  const data = payload();
  data.mode = "replay";
  assert.equal(recentVehicles(data, Date.now() + 86400000).length, 1);
});
test("지도 HTTP 요청은 노선·방향을 전달하며 다른 방향과 중복 차량을 거부한다", async (t) => {
  const oldBase = config.baseUrl;
  const oldMode = config.mode;
  config.mode = "api";
  config.baseUrl = "https://example.test/api";
  t.after(() => {
    config.baseUrl = oldBase;
    config.mode = oldMode;
  });
  let body = payload();
  const mocked = t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(
      url,
      "https://example.test/api/routes/200000115/map?direction=TO_SEOUL",
    );
    return new Response(JSON.stringify(body));
  });
  assert.equal(
    (await fetchRouteMap("200000115", "TO_SEOUL")).data.vehicles.length,
    1,
  );
  body = { ...payload(), data: { ...payload().data, routeId: "other-route" } };
  await assert.rejects(
    () => fetchRouteMap("200000115", "TO_SEOUL"),
    /노선·방향/,
  );
  body = payload();
  body.data.vehicles.push(body.data.vehicles[0]);
  await assert.rejects(() => fetchRouteMap("200000115", "TO_SEOUL"), /중복/);
  mocked.mock.restore();
});
test("서버 오류를 가짜 위치로 대체하지 않는다", async (t) => {
  const oldBase = config.baseUrl;
  const oldMode = config.mode;
  config.mode = "api";
  config.baseUrl = "https://example.test";
  t.after(() => {
    config.baseUrl = oldBase;
    config.mode = oldMode;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 503 }),
  );
  await assert.rejects(() => fetchRouteMap("200000115", "TO_SEOUL"), /503/);
});
