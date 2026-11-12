import assert from "node:assert/strict";
import { test } from "node:test";
import { stationAnchor } from "../src/maps/station-anchor";
import { gbisCatalog } from "../src/data/gbis/catalog";
import { nativeLabels } from "../src/maps/native-scenes";

test("도로 옆 정류장의 표시점만 노선에 정렬하며 공식 좌표는 변경하지 않는다", () => {
  const station = { latitude: 37.2501, longitude: 127.075 };
  const before = { ...station };
  const path = [
    [
      { latitude: 37.25, longitude: 127.07 },
      { latitude: 37.25, longitude: 127.08 },
    ],
  ];
  assert.deepEqual(stationAnchor(station, path), {
    latitude: 37.25,
    longitude: 127.075,
  });
  assert.deepEqual(station, before);
  assert.deepEqual(stationAnchor(station, []), station);
  assert.deepEqual(
    stationAnchor({ latitude: 37.3, longitude: 127.075 }, path),
    { latitude: 37.3, longitude: 127.075 },
  );
});
test("실제 노선의 정류장마다 고정된 점과 별도 이름 라벨이 존재한다", () => {
  for (const route of gbisCatalog.routes)
    for (const direction of Object.values(route.directions)) {
      const stations =
        direction.stations as ((typeof direction.stations)[number] & {
          latitude: number;
          longitude: number;
        })[];
      const scene = nativeLabels({
        stations,
        path: direction.path,
        vehicles: [],
        selectedSequence: stations[0].sequence,
        focusVersion: 0,
        routeColor: "#245EC7",
        onStation: () => {},
        onVehicle: () => {},
      });
      const pins = scene.labels!.filter((label) => label.styleId === "pin");
      const cards = scene.labels!.filter((label) =>
        label.id.startsWith("card:"),
      );
      assert.equal(pins.length, stations.length);
      assert.equal(cards.length, stations.length);
      pins.forEach((pin, i) =>
        assert.deepEqual(pin.coordinate, cards[i].coordinate),
      );
      assert.ok(
        pins.every((pin) => pin.clickable && pin.text![0].value === "●"),
      );
    }
});
