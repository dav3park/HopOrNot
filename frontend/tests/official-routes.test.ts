import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  gbisCatalog,
  officialGeometry,
  officialMap,
  officialRoutes,
} from "../src/data/gbis/catalog";
import { mapEnvelopeSchema } from "../src/maps/data";
import { demoVehicles } from "../src/features/map-home/demo";
import { probabilities } from "../src/domain/logic";
import type { Coordinate } from "../src/maps/data";

function distanceToSegment(point: Coordinate, a: Coordinate, b: Coordinate) {
  const scale = 111320 * Math.cos((point.latitude * Math.PI) / 180);
  const ax = (a.longitude - point.longitude) * scale,
    ay = (a.latitude - point.latitude) * 111320;
  const bx = (b.longitude - point.longitude) * scale,
    by = (b.latitude - point.latitude) * 111320;
  const dx = bx - ax,
    dy = by - ay;
  const ratio =
    dx * dx + dy * dy
      ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
      : 0;
  return Math.hypot(ax + ratio * dx, ay + ratio * dy);
}
test("공식 세 노선 ID와 방향별 실제 정류장·도로 경로를 포함한다", () => {
  assert.deepEqual(
    Object.fromEntries(officialRoutes.map((r) => [r.name, r.routeId])),
    { "5100": "200000115", "1112": "234000016", M5107: "234001243" },
  );
  for (const route of officialRoutes)
    for (const direction of route.directions) {
      const geometry = officialGeometry(route.routeId, direction)!;
      assert.ok(geometry.stations.length >= 10);
      assert.ok(geometry.path[0].length > 200);
      assert.equal(
        new Set(geometry.stations.map((s) => s.sequence)).size,
        geometry.stations.length,
      );
      assert.deepEqual(
        geometry.stations.map((s) => s.sequence),
        geometry.stations.map((s) => s.sequence).sort((a, b) => a - b),
      );
      assert.ok(
        geometry.stations.every(
          (s) =>
            s.latitude! > 37 &&
            s.latitude! < 38 &&
            s.longitude! > 126 &&
            s.longitude! < 128 &&
            !s.name.includes("경유") &&
            !s.name.includes("미정차"),
        ),
      );
      for (const station of geometry.stations) {
        const distances = geometry.path.flatMap((segment) =>
          segment
            .slice(1)
            .map((b, i) =>
              distanceToSegment(station as Coordinate, segment[i], b),
            ),
        );
        assert.ok(
          Math.min(...distances) < 150,
          `${route.name} ${direction} ${station.name} is too far from official road geometry`,
        );
      }
      assert.ok(
        mapEnvelopeSchema.safeParse(officialMap(route.routeId, direction))
          .success,
      );
      assert.deepEqual(officialMap(route.routeId, direction).data.vehicles, []);
    }
});
test("왕복은 다른 정류장과 경로를 쓰며 회차 정류장을 귀환 방향에서도 선택할 수 있다", () => {
  for (const route of officialRoutes) {
    const up = officialGeometry(route.routeId, "TO_SEOUL")!,
      down = officialGeometry(route.routeId, "TO_CAMPUS")!;
    assert.notDeepEqual(up.path, down.path);
    assert.equal(up.stations.at(-1)!.stationId, down.stations[0].stationId);
    assert.ok(up.stations.some((s) => s.name.includes("청명역3번출구")));
    assert.ok(down.stations.some((s) => s.name.includes("청명역4번출구")));
  }
});
test("실제 정류장 ID·방문 순번으로 예시 확률을 연결하고 지리 좌표를 합성하지 않는다", () => {
  for (const route of officialRoutes) {
    const stations = officialGeometry(route.routeId, "TO_SEOUL")!.stations;
    const selected = stations.find((s) => s.name.includes("청명역"))!;
    const rows = demoVehicles(
      {
        routeId: route.routeId,
        direction: "TO_SEOUL",
        stationId: selected.stationId,
        stationSequence: selected.sequence,
      },
      stations,
    );
    for (const row of rows) {
      assert.deepEqual(
        row.stationPredictions!.map((s) => [s.stationId, s.stationSequence]),
        stations.map((s) => [s.stationId, s.sequence]),
      );
      row.stationPredictions!.forEach((s) =>
        assert.doesNotThrow(() => probabilities(s.distribution)),
      );
      assert.equal("latitude" in row, false);
    }
  }
});
test("기본 화면은 실제 카카오맵이며 보관한 예시 노선도를 렌더링하지 않는다", () => {
  const home = readFileSync("src/features/map-home/home.tsx", "utf8");
  assert.match(home, /<RouteMap/);
  assert.doesNotMatch(home, /SchematicMap|setActualMap|예시 노선도/);
  assert.match(gbisCatalog.sourceUrl, /gbis\.go\.kr/);
  assert.ok(Number.isFinite(Date.parse(gbisCatalog.collectedAt)));
});
