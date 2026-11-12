import { Direction, SeatDistribution, Selection } from "./types";
export const directions: Record<Direction, string> = {
  TO_CAMPUS: "국제캠퍼스 방면",
  TO_SEOUL: "서울 방면",
};
export function probabilities(
  d: SeatDistribution | null,
): [number, number, number] | null {
  if (d === null) return null;
  const values = [d.zero, d.oneToFour, d.fiveToNine, d.tenPlus];
  if (
    values.some(
      (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1,
    ) ||
    Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.001
  )
    throw new Error("좌석 분포 데이터 오류");
  return [
    d.oneToFour + d.fiveToNine + d.tenPlus,
    d.fiveToNine + d.tenPlus,
    d.tenPlus,
  ];
}
export const selectionKey = (s: Selection) =>
  [s.routeId, s.direction, s.stationId, s.stationSequence] as const;
export const favoriteKey = (s: Selection) => JSON.stringify(selectionKey(s));
export const seatBand = (n: number | null) =>
  n === null || n < 0 || !Number.isInteger(n)
    ? "정보 없음"
    : n === 0
      ? "0석"
      : n < 5
        ? "1–4석"
        : n < 10
          ? "5–9석"
          : "10석 이상";
export const dateInSeoul = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
export const timeInSeoul = (iso: string) =>
  Number.isFinite(Date.parse(iso))
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso))
    : "시간 정보 오류";
export const hourInSeoul = (iso: string) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso)),
  );
export function changeSelection(
  s: Selection,
  routeId: string,
  direction: Direction,
): Selection | null {
  return s.routeId === routeId && s.direction === direction ? s : null;
}
export function validSelection(v: unknown): v is Selection {
  if (!v || typeof v !== "object") return false;
  const s = v as Selection;
  return (
    typeof s.routeId === "string" &&
    s.routeId.length > 0 &&
    typeof s.stationId === "string" &&
    s.stationId.length > 0 &&
    ["TO_CAMPUS", "TO_SEOUL"].includes(s.direction) &&
    Number.isInteger(s.stationSequence) &&
    s.stationSequence > 0
  );
}
export function decodeFavorites(raw: string | null): Selection[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (
      !v ||
      v.version !== 1 ||
      !Array.isArray(v.items) ||
      !v.items.every(validSelection)
    )
      throw new Error("Invalid storage");
    return v.items.filter(
      (s: Selection, i: number, all: Selection[]) =>
        all.findIndex((x) => favoriteKey(x) === favoriteKey(s)) === i,
    );
  } catch {
    throw new Error(
      "저장된 즐겨찾기를 복구하지 못했습니다. 다시 추가해 주세요.",
    );
  }
}
export function toggleFavorite(items: Selection[], s: Selection): Selection[] {
  return items.some((x) => favoriteKey(x) === favoriteKey(s))
    ? items.filter((x) => favoriteKey(x) !== favoriteKey(s))
    : [...items, s];
}
