import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (path: string) => readFileSync(path, "utf8");
const reference = read("design-reference/prototype.html");
const current = read("src/design/prototype-canvas.js");
function section(text: string, start: string, end: string) {
  return text.slice(
    text.indexOf(start),
    text.indexOf(end, text.indexOf(start)),
  );
}
function bounds(text: string) {
  return [
    ...text.matchAll(
      /(?<![-\w])(left|right|top|bottom|width|height):\s*(-?[\d.]+)px/g,
    ),
  ].map((m) => `${m[1]}:${m[2]}`);
}
test("기본 진입은 사용자가 제공한 지도 중심 화면", () => {
  const entry = read("app/index.tsx");
  assert.match(entry, /MapHome/);
  assert.doesNotMatch(entry, /FlameApp/);
});
test("보관된 원본의 표·기타줄·가로 노선 좌표 유지", () => {
  for (const [start, end] of [
    ["renderForecast(v) {", "renderHistory(v) {"],
    ["renderLive() {", "  render() {"],
  ])
    assert.deepEqual(
      bounds(section(current, start, end)),
      bounds(section(reference, start, end)),
    );
  for (const anchor of [
    "FB = 788, FT = 462, SX0 = 146, SXW = 228",
    "SP = 110, C = 195",
  ])
    assert.ok(current.includes(anchor));
});
