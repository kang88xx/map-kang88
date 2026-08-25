export interface TrackPoint {
  lat: number;
  lng: number;
  /** epoch ms */
  t: number;
  /** 사진 asset id (있으면 사진 포인트) */
  photoId?: string;
}

const R = 6371;

export function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  let dLngDeg = b.lng - a.lng;
  if (dLngDeg > 180) dLngDeg -= 360;
  if (dLngDeg < -180) dLngDeg += 360;
  const dLng = (dLngDeg * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 사진처럼 드문드문한 기록을 시간순으로 잇는 경로.
 * 48시간 초과 공백에서 세그먼트를 끊는다 — 선이 끊긴 곳은 기록이 끊긴 곳.
 */
export function buildVisitRoute(points: TrackPoint[], gapHours = 48): TrackPoint[][] {
  const GAP = gapHours * 3_600_000;
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

export const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
