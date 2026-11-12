import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseVehicle,
  eligibleAlternatives,
  firstComfortableSlot,
  minutesUntil,
  routeColors,
} from "../src/features/map-home/model";
import {
  demoAlternatives,
  demoForecast,
  demoStations,
  demoVehicles,
  MAP_DEMO_NOW,
} from "../src/features/map-home/demo";
import { nativeLabels, nativeRoutes } from "../src/maps/native-scenes";
import { probabilityText, probabilityValue } from "../src/domain/presentation";
import { Selection } from "../src/domain/types";
import type { RouteMapProps } from "../src/maps/types";
const selection: Selection = {
  routeId: "mock-route-M5107",
  direction: "TO_SEOUL",
  stationId: "mock-station-8",
  stationSequence: 8,
};
test("지도 추천은 좌석 기준·도착 순서·품질·만료 시각을 반영한다", () => {
  const rows = demoVehicles(selection);
  assert.equal(chooseVehicle(rows.reverse(), 1)?.arrivalOrder, 3);
  assert.equal(chooseVehicle(rows, 10), undefined);
  assert.equal(
    chooseVehicle(rows, 1, Date.parse(MAP_DEMO_NOW) + 12 * 60000)?.arrivalOrder,
    4,
  );
  rows.forEach((v) => (v.quality = "NO_DATA"));
  assert.equal(chooseVehicle(rows, 1), undefined);
});
test("같은 분포에서 1·5·10석 말풍선과 상세 값이 일치한다", () => {
  const third = demoVehicles(selection)[2];
  assert.deepEqual(
    ([1, 5, 10] as const).map((n) =>
      probabilityText(probabilityValue(third.distribution, n)),
    ),
    ["92%", "71%", "38%"],
  );
  assert.ok(
    demoStations.every((s) => s.latitude === null && s.longitude === null),
  );
  assert.equal(new Set(Object.values(routeColors)).size, 3);
});
test("이동 불가·직선거리·미확인 경로는 대안으로 추천하지 않는다", () => {
  const now = Date.parse(MAP_DEMO_NOW),
    row = demoAlternatives(selection)[0];
  assert.equal(eligibleAlternatives([row], now).length, 1);
  assert.equal(
    eligibleAlternatives([{ ...row, walkSeconds: 600 }], now).length,
    0,
  );
  assert.equal(
    eligibleAlternatives([{ ...row, distanceKind: "STRAIGHT_LINE" }], now)
      .length,
    0,
  );
  assert.equal(
    eligibleAlternatives([{ ...row, recommendation: "REFERENCE_ONLY" }], now)
      .length,
    0,
  );
  assert.equal(
    demoAlternatives({ ...selection, stationSequence: 1 }).length,
    0,
  );
});
test("시간대 전망은 과거 구간을 제외하고 가장 이른 여유 구간을 고른다", () => {
  assert.equal(
    firstComfortableSlot(
      [...demoForecast].reverse(),
      1,
      Date.parse(MAP_DEMO_NOW),
    )?.startsAt,
    "2026-11-12T10:00:00.000Z",
  );
  assert.equal(minutesUntil(null, Date.parse(MAP_DEMO_NOW)), null);
  assert.equal(
    minutesUntil("2026-11-12T18:23:00+09:00", Date.parse(MAP_DEMO_NOW)),
    11,
  );
});
test("네이티브 지도도 노선별 색과 방문 순번별 확률을 유지한다", () => {
  const props: RouteMapProps = {
    stations: [
      { ...demoStations[0], latitude: 37.2, longitude: 127.1 },
      { ...demoStations[2], latitude: 37.3, longitude: 127.2 },
    ],
    path: [
      [
        { latitude: 37.2, longitude: 127.1 },
        { latitude: 37.3, longitude: 127.2 },
      ],
    ],
    vehicles: [],
    selectedSequence: 3,
    focusVersion: 0,
    routeColor: routeColors.M5107,
    routeLines: [
      {
        id: "1112",
        color: routeColors["1112"],
        path: [
          [
            { latitude: 37.1, longitude: 127.1 },
            { latitude: 37.4, longitude: 127.4 },
          ],
        ],
      },
    ],
    stationLabels: {
      1: { probability: "0%", color: "#F5DECF" },
      3: { probability: "92%", color: "#EC0000" },
    },
    onStation: () => {},
    onVehicle: () => {},
  };
  const labels = nativeLabels(props).labels!;
  assert.notEqual(labels[0].id, labels[2].id);
  assert.equal(labels[0].text![0].value, "●");
  assert.match(labels[1].text![0].value, /0%/);
  assert.match(labels[3].text![0].value, /92%.*내 정류장/);
  const scene = nativeRoutes(props);
  assert.equal(scene.routes!.length, 2);
  assert.equal(scene.styleSets![0].styles[0].levels[0].color, "#245EC7FF");
  assert.equal(scene.styleSets![1].styles[0].levels[0].color, "#087F72A6");
});
