import type { Coordinate } from "./data";

// Official stop coordinates often describe a roadside platform. Align the visual
// route marker with the nearby route segment; keep the source Station untouched.
export function stationAnchor(
  station: Coordinate,
  path: Coordinate[][],
  maxOffsetMeters = 100,
): Coordinate {
  const longitudeScale = 111320 * Math.cos((station.latitude * Math.PI) / 180);
  let nearest: Coordinate = station;
  let distance = Infinity;
  for (const segment of path)
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1],
        b = segment[i];
      const ax = (a.longitude - station.longitude) * longitudeScale,
        ay = (a.latitude - station.latitude) * 111320;
      const dx = (b.longitude - a.longitude) * longitudeScale,
        dy = (b.latitude - a.latitude) * 111320;
      const lengthSquared = dx * dx + dy * dy;
      const fraction = lengthSquared
        ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared))
        : 0;
      const candidateDistance = Math.hypot(
        ax + dx * fraction,
        ay + dy * fraction,
      );
      if (candidateDistance < distance) {
        distance = candidateDistance;
        nearest = {
          latitude: a.latitude + (b.latitude - a.latitude) * fraction,
          longitude: a.longitude + (b.longitude - a.longitude) * fraction,
        };
      }
    }
  return distance <= maxOffsetMeters ? nearest : station;
}
