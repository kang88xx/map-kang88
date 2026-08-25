import { buildVisitRoute, haversineKm, localDay, type TrackPoint } from "./geo";

export interface Trip {
  id: string;
  points: TrackPoint[];
  startT: number;
  endT: number;
  km: number;
  days: number;
  label: string;
}

/** 48시간 공백 기준으로 끊긴 세그먼트를 "여행" 단위로 정리 */
export function buildTrips(points: TrackPoint[]): Trip[] {
  const segments = buildVisitRoute(points);
  return segments
    .map((seg, i) => {
      let km = 0;
      for (let j = 1; j < seg.length; j++) km += haversineKm(seg[j - 1], seg[j]);
      const startT = seg[0].t;
      const endT = seg[seg.length - 1].t;
      const days = new Set(seg.map((p) => localDay(p.t))).size;
      return {
        id: `trip-${i}-${startT}`,
        points: seg,
        startT,
        endT,
        km,
        days,
        label: `${localDay(startT).slice(5).replace("-", ".")} ~ ${localDay(endT).slice(5).replace("-", ".")}`,
      };
    })
    .filter((t) => t.km > 1)
    .sort((a, b) => b.startT - a.startT);
}
