import { test } from "node:test";
import assert from "node:assert/strict";
import {
  directionLabel,
  stationDisplayNumber,
} from "../src/domain/station-display";
import { officialGeometry, officialRoutes } from "../src/data/gbis/catalog";

test("화면 정류장 번호는 방향별로 연속이며 원본 방문 순번은 유지한다", () => {
  for (const route of officialRoutes)
    for (const direction of route.directions) {
      const stations = officialGeometry(route.routeId, direction)!.stations;
      const source = stations.map((station) => station.sequence);
      assert.deepEqual(
        stations.map((station) => stationDisplayNumber(stations, station)),
        stations.map((_, i) => i + 1),
      );
      assert.deepEqual(
        stations.map((station) => station.sequence),
        source,
      );
    }
  const stops = officialGeometry("234001243", "TO_SEOUL")!.stations;
  const cityHall = stops.find((station) => station.sequence === 29)!;
  const bank = stops.find((station) => station.sequence === 31)!;
  assert.equal(cityHall.name, "서울시청");
  assert.equal(bank.name, "신한은행본점");
  assert.equal(stationDisplayNumber(stops, cityHall), 9);
  assert.equal(stationDisplayNumber(stops, bank), 10);
  assert.equal(
    stationDisplayNumber(
      stops.filter((station) => station === bank),
      cityHall,
    ),
    null,
  );
});
test("같은 정류장 ID의 재방문을 구분하고 서울 목적지를 노선별로 표시한다", () => {
  const stops = [
    {
      stationId: "same",
      sequence: 3,
      name: "왕복",
      latitude: null,
      longitude: null,
    },
    {
      stationId: "same",
      sequence: 7,
      name: "왕복",
      latitude: null,
      longitude: null,
    },
  ];
  assert.equal(stationDisplayNumber(stops, stops[0]), 1);
  assert.equal(stationDisplayNumber(stops, stops[1]), 2);
  assert.equal(directionLabel("M5107", "TO_SEOUL"), "서울역 방면");
  assert.equal(directionLabel("5100", "TO_SEOUL"), "강남역 방면");
  assert.equal(directionLabel("1112", "TO_SEOUL"), "강변역 방면");
  assert.equal(directionLabel("M5107", "TO_CAMPUS"), "국제캠퍼스 방면");
});
