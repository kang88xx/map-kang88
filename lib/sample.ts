import type { TrackPoint } from "./types";

interface City {
  name: string;
  lat: number;
  lng: number;
}

const SEOUL: City = { name: "서울", lat: 37.5665, lng: 126.978 };
const TOKYO: City = { name: "도쿄", lat: 35.6762, lng: 139.6503 };
const SF: City = { name: "샌프란시스코", lat: 37.7749, lng: -122.4194 };

function jitter(scale: number) {
  return (Math.random() - 0.5) * scale;
}

/** A wandering day inside one city: a few outings from a "home" point. */
function cityDay(points: TrackPoint[], city: City, dayStart: number) {
  const home = { lat: city.lat + jitter(0.01), lng: city.lng + jitter(0.01) };
  points.push({ ...home, t: dayStart + 8 * 3.6e6, kind: "visit", name: `${city.name} 숙소` });
  let cur = home;
  let t = dayStart + 9 * 3.6e6;
  const outings = 2 + Math.floor(Math.random() * 2);
  for (let o = 0; o < outings; o++) {
    const dest = { lat: city.lat + jitter(0.09), lng: city.lng + jitter(0.11) };
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      points.push({
        lat: cur.lat + (dest.lat - cur.lat) * f + jitter(0.002),
        lng: cur.lng + (dest.lng - cur.lng) * f + jitter(0.002),
        t: t + i * 4 * 60_000,
        kind: "path",
      });
    }
    t += steps * 4 * 60_000 + 90 * 60_000; // stay ~1.5h
    points.push({ ...dest, t: t - 45 * 60_000, kind: "visit" });
    cur = dest;
  }
  // back home
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    points.push({
      lat: cur.lat + (home.lat - cur.lat) * f + jitter(0.002),
      lng: cur.lng + (home.lng - cur.lng) * f + jitter(0.002),
      t: t + i * 4 * 60_000,
      kind: "path",
    });
  }
}

/** Great-circle-ish flight line between two cities over `hours`. */
function flight(points: TrackPoint[], from: City, to: City, start: number, hours: number) {
  const steps = 24;
  // cross the antimeridian the short way (e.g. Tokyo → SF goes over the Pacific)
  let dLng = to.lng - from.lng;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    // slight arc for looks
    const arc = Math.sin(f * Math.PI) * 3;
    points.push({
      lat: from.lat + (to.lat - from.lat) * f + arc,
      lng: from.lng + dLng * f,
      t: start + f * hours * 3.6e6,
      kind: "path",
    });
  }
}

/** ~2주 여행 샘플: 서울 → 도쿄 → 샌프란시스코 → 서울 */
export function generateSample(): TrackPoint[] {
  const points: TrackPoint[] = [];
  const DAY = 24 * 3.6e6;
  const start = Date.now() - 16 * DAY;

  let d = 0;
  for (; d < 4; d++) cityDay(points, SEOUL, start + d * DAY);
  flight(points, SEOUL, TOKYO, start + d * DAY + 10 * 3.6e6, 2.5);
  for (d += 1; d < 9; d++) cityDay(points, TOKYO, start + d * DAY);
  flight(points, TOKYO, SF, start + d * DAY + 17 * 3.6e6, 9.5);
  for (d += 1; d < 13; d++) cityDay(points, SF, start + d * DAY);
  flight(points, SF, SEOUL, start + d * DAY + 11 * 3.6e6, 12);
  for (d += 1; d < 16; d++) cityDay(points, SEOUL, start + d * DAY);

  return points.sort((a, b) => a.t - b.t);
}
