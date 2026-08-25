import type { TrackPoint } from "./types";

const R = 6371; // km

export function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  let dLngDeg = b.lng - a.lng;
  if (dLngDeg > 180) dLngDeg -= 360;
  if (dLngDeg < -180) dLngDeg += 360;
  const dLng = (dLngDeg * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const GAP_MS = 3 * 60 * 60 * 1000; // start a new segment after a 3h silence
const MAX_SPEED_KMH = 1200; // faster than a jet → GPS glitch, drop the jump

/** Split sorted path points into polyline segments, filtering out teleport glitches. */
export function buildSegments(points: TrackPoint[]): TrackPoint[][] {
  const segments: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  let dropped = 0; // 연속으로 버린 글리치 수
  for (const p of points) {
    const prev = current[current.length - 1];
    if (prev) {
      const dtMs = p.t - prev.t;
      const km = haversineKm(prev, p);
      // 시간이 흐르지 않았는데 움직였으면 잘못된 샘플 → 버림 (50m 초과 기준)
      if (dtMs <= 0) {
        if (km > 0.05) continue;
      } else if (km / (dtMs / 3_600_000) > MAX_SPEED_KMH) {
        // 제트기보다 빠른 점프: 고립된 이상치는 버리고 정상 경로를 잇는다.
        // 연속으로 여러 개면 실제 데이터 단절로 보고 세그먼트를 끊는다.
        dropped++;
        if (dropped <= 3) continue;
        if (current.length >= 2) segments.push(current);
        current = [];
      } else if (dtMs > GAP_MS) {
        if (current.length >= 2) segments.push(current);
        current = [];
      }
    }
    dropped = 0;
    current.push(p);
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

/**
 * 사진·방문 지점처럼 드문드문한 기록을 시간순으로 잇는 경로.
 * 연속 GPS용 3시간 규칙 대신 48시간 이상 벌어질 때만 끊는다 (하루 몇 장의 사진도 이어지게).
 */
export function buildVisitRoute(points: TrackPoint[]): TrackPoint[][] {
  const GAP = 48 * 3_600_000;
  const segments: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  for (const p of points) {
    const prev = current[current.length - 1];
    if (prev && p.t - prev.t > GAP) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

export function totalDistanceKm(segments: TrackPoint[][]): number {
  let sum = 0;
  for (const seg of segments)
    for (let i = 1; i < seg.length; i++) sum += haversineKm(seg[i - 1], seg[i]);
  return sum;
}
