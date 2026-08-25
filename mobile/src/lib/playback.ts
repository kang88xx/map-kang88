import { haversineKm, localDay, type TrackPoint } from "./geo";
import { EARTH_KM } from "../theme";

export interface PlaybackFrame {
  /** 지나온 경로 (MultiLineString 좌표) */
  lines: number[][][];
  head: [number, number];
  camera: { center: [number, number]; zoom: number };
  date: string;
  km: number;
  pct: number;
  progress: number;
}

export interface PlaybackHandle {
  stop: () => void;
}

interface Options {
  durationMs: number;
  onFrame: (f: PlaybackFrame) => void;
  onDone: (bounds: { sw: [number, number]; ne: [number, number] }) => void;
}

const FLIGHT_STEP_KM = 40;
const FLY_SPEED = 1.3;

/**
 * 웹과 동일한 시네마틱 재생 규칙:
 * - 시간 가중 √km — 도시 안 이동에 시간을 더 배분해 디테일이 보이게
 * - 비행(40km+ 스텝)은 30% 빠르게
 * - 카메라 줌은 스텝 길이(≈속도)에 따라: 비행은 축소, 도시는 확대
 * - dt 기반 지수 평활로 프레임레이트와 무관하게 같은 감속 곡선
 */
export function runPlayback(rawSegments: TrackPoint[][], opts: Options): PlaybackHandle | null {
  interface Seg { coords: [number, number][]; times: number[]; cum: number[]; ecum: number[] }
  const segs: Seg[] = [];
  let total = 0, effTotal = 0;
  const segStart: number[] = [], segEffStart: number[] = [];
  let carryLng: number | null = null;

  for (const seg of rawSegments) {
    if (seg.length < 2) continue;
    const coords: [number, number][] = [];
    const times: number[] = [];
    const cum: number[] = [0];
    const ecum: number[] = [0];
    let prevLng: number = carryLng ?? seg[0].lng;
    let dist = 0, eff = 0;
    seg.forEach((p, i) => {
      let lng = p.lng;
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
      prevLng = lng;
      coords.push([lng, p.lat]);
      times.push(p.t);
      if (i > 0) {
        const km = haversineKm(seg[i - 1], p);
        dist += km;
        const w = Math.sqrt(km);
        eff += km >= FLIGHT_STEP_KM ? w / FLY_SPEED : w;
        cum.push(dist);
        ecum.push(eff);
      }
    });
    segStart.push(total);
    segEffStart.push(effTotal);
    total += dist;
    effTotal += eff;
    segs.push({ coords, times, cum, ecum });
    carryLng = prevLng;
  }
  if (segs.length === 0 || total <= 0) return null;

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const s of segs)
    for (const [lng, lat] of s.coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

  let raf = 0;
  let stopped = false;
  let elapsed = 0;
  let prevNow: number | null = null;
  let camLng = segs[0].coords[0][0];
  let camLat = segs[0].coords[0][1];
  let camZoom = 10.5;
  let segPtr = 0, ptPtr = 1;
  const doneLines: [number, number][][] = [];

  function frame(now: number) {
    if (stopped) return;
    if (prevNow != null) elapsed += Math.min(100, Math.max(0, now - prevNow));
    const dt = prevNow != null ? Math.min(0.1, (now - prevNow) / 1000) : 0.016;
    prevNow = now;
    const p = Math.min(1, elapsed / opts.durationMs);
    const sEff = effTotal * p;

    while (
      segPtr < segs.length - 1 &&
      sEff >= segEffStart[segPtr] + segs[segPtr].ecum[segs[segPtr].ecum.length - 1]
    ) { segPtr++; ptPtr = 1; }
    const seg = segs[segPtr];
    const local = sEff - segEffStart[segPtr];
    while (ptPtr < seg.ecum.length - 1 && seg.ecum[ptPtr] < local) ptPtr++;
    const c0 = seg.coords[ptPtr - 1], c1 = seg.coords[ptPtr];
    const e0 = seg.ecum[ptPtr - 1], e1 = seg.ecum[ptPtr];
    const d0 = seg.cum[ptPtr - 1], d1 = seg.cum[ptPtr];
    const f = e1 > e0 ? Math.min(1, Math.max(0, (local - e0) / (e1 - e0))) : 1;
    const lng = c0[0] + (c1[0] - c0[0]) * f;
    const lat = c0[1] + (c1[1] - c0[1]) * f;
    const t = seg.times[ptPtr - 1] + (seg.times[ptPtr] - seg.times[ptPtr - 1]) * f;
    const s = segStart[segPtr] + d0 + (d1 - d0) * f;

    while (doneLines.length < segPtr) doneLines.push(segs[doneLines.length].coords);
    const lines: number[][][] = [
      ...doneLines,
      [...seg.coords.slice(0, ptPtr), [lng, lat]],
    ];

    const stepKm = d1 - d0;
    const targetZoom = stepKm > FLIGHT_STEP_KM ? 3 : stepKm > 8 ? 5.8 : stepKm > 1.5 ? 9.5 : 12.5;
    const aZoom = 1 - Math.exp(-4.4 * dt);
    const aPan = 1 - Math.exp(-12 * dt);
    camZoom += (targetZoom - camZoom) * aZoom;
    camLng += (lng - camLng) * aPan;
    camLat += (lat - camLat) * aPan;

    opts.onFrame({
      lines,
      head: [lng, lat],
      camera: { center: [camLng, camLat], zoom: camZoom },
      date: localDay(t),
      km: s,
      pct: (s / EARTH_KM) * 100,
      progress: p,
    });

    if (p >= 1) {
      stopped = true;
      opts.onDone({ sw: [minLng - 0.02, minLat - 0.02], ne: [maxLng + 0.02, maxLat + 0.02] });
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
