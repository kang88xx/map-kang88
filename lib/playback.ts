import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import type { TrackPoint } from "./types";
import { haversineKm } from "./geo";

export const EARTH_KM = 40075;

export interface PlaybackInfo {
  date: string;
  km: number;
  pct: number;
  progress: number;
}

export interface PlaybackHandle {
  stop: () => void;
  /** 녹화가 실제로 시작됐는지 — false면 이 브라우저에서 녹화 미지원 */
  recording: boolean;
}

interface Options {
  record: boolean;
  onProgress: (info: PlaybackInfo) => void;
  onDone: (video: { blob: Blob; ext: string } | null) => void;
  /** 녹화가 시작된 뒤 레코더 오류로 중단됐을 때 (onDone(null)과 별개로 호출) */
  onRecordError?: () => void;
}

const PLAY_MS = 16000;
const RECORD_MS = 20000;
const HOLD_MS = 1800;

interface SegData {
  coords: [number, number][]; // 언랩된 경도
  times: number[];
  cum: number[]; // 세그먼트 시작 기준 누적 km
  ecum: number[]; // 시간 가중 누적(비행 구간은 30% 빠르게 지나감)
}

/** 한 스텝이 비행(대양 횡단급 점프)인지 — 재생 속도 가중치 기준 */
const FLIGHT_STEP_KM = 40;
const FLY_SPEED = 1.3;

/** 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 한국에선 하루 전으로 보임) */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pickMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  // h264 mp4가 재생 호환성이 가장 좋고, 그다음 webm. 마지막 "video/mp4"는
  // Safari(레코더가 h264를 씀)용 — Chrome은 여기 오기 전에 webm으로 걸러진다.
  const candidates: [string, string][] = [
    ["video/mp4;codecs=avc1.42E01E", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm", "webm"],
    ["video/mp4", "mp4"],
  ];
  for (const [mime, ext] of candidates)
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

export function runPlayback(map: MLMap, rawSegments: TrackPoint[][], opts: Options): PlaybackHandle | null {
  // 경도 언랩(±180 경계에서 연속되게) + 누적 거리 테이블
  const segs: SegData[] = [];
  let total = 0;
  let effTotal = 0;
  const segStart: number[] = [];
  const segEffStart: number[] = [];
  // 언랩 기준 경도를 세그먼트 사이에도 이어가야 날짜변경선 근처에서
  // 인접 세그먼트가 +179/-181로 갈라져 카메라가 지구 반대편으로 돌지 않는다
  let carryLng: number | null = null;
  for (const seg of rawSegments) {
    if (seg.length < 2) continue;
    const coords: [number, number][] = [];
    const times: number[] = [];
    const cum: number[] = [0];
    const ecum: number[] = [0];
    let prevLng: number = carryLng ?? seg[0].lng;
    let dist = 0;
    let eff = 0;
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
        // 시간 가중 = √km: 도시 안 이동(수백 m~수 km)에 상대적으로 더 많은 시간을
        // 배분해 디테일이 보이게 하고, 비행은 추가로 30% 빠르게 지나간다
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

  // 전체 bbox (완료 후 큰 화면)
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const s of segs)
    for (const [lng, lat] of s.coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

  // 재생용 레이어
  const empty = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;
  if (!map.getSource("pb-progress")) {
    map.addSource("pb-progress", { type: "geojson", data: empty });
    map.addSource("pb-head", { type: "geojson", data: empty });
    map.addLayer({
      id: "pb-casing", type: "line", source: "pb-progress",
      paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.9 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: "pb-line", type: "line", source: "pb-progress",
      paint: { "line-color": "#F59E0B", "line-width": 3.5 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: "pb-head-dot", type: "circle", source: "pb-head",
      paint: {
        "circle-radius": 7, "circle-color": "#F59E0B",
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5,
      },
    });
  }
  // 전체 경로는 흐리게(고스트)
  for (const [layer, prop, dim] of [
    ["routes-line", "line-opacity", 0.2],
    ["routes-casing", "line-opacity", 0.15],
    ["visits-circle", "circle-opacity", 0.25],
  ] as const) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, dim);
  }

  // 녹화 준비: 지도 캔버스 + 자막을 합성 캔버스로
  let recorder: MediaRecorder | null = null;
  let comp: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let ext = "webm";
  const chunks: Blob[] = [];
  const mapCanvas = map.getCanvas();
  let stream: MediaStream | null = null;
  if (opts.record) {
    const picked = pickMime();
    if (picked) {
      try {
        ext = picked.ext;
        comp = document.createElement("canvas");
        comp.width = mapCanvas.width;
        comp.height = mapCanvas.height;
        ctx = comp.getContext("2d");
        stream = comp.captureStream(30);
        recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 6_000_000 });
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onerror = () => {
          opts.onRecordError?.();
          finalize(false);
        };
        recorder.start(250);
      } catch {
        recorder = null;
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    }
  }

  function drawOverlay(info: PlaybackInfo) {
    if (!ctx || !comp) return;
    ctx.drawImage(mapCanvas, 0, 0, comp.width, comp.height);
    const scale = comp.width / mapCanvas.clientWidth;
    const pad = 16 * scale, w = 300 * scale, h = 86 * scale, r = 14 * scale;
    const x = pad, y = comp.height - h - pad;
    ctx.fillStyle = "rgba(12,20,36,0.82)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.fillStyle = "#E9EEF7";
    ctx.font = `600 ${16 * scale}px -apple-system, sans-serif`;
    ctx.fillText(info.date, x + 16 * scale, y + 28 * scale);
    ctx.fillStyle = "#F5A623";
    ctx.font = `700 ${18 * scale}px -apple-system, sans-serif`;
    ctx.fillText(`${Math.round(info.km).toLocaleString()} km`, x + 16 * scale, y + 54 * scale);
    ctx.fillStyle = "#8CA0BC";
    ctx.font = `${12 * scale}px -apple-system, sans-serif`;
    ctx.fillText(`지구 한 바퀴의 ${info.pct.toFixed(1)}%  ·  kang-map`, x + 16 * scale, y + 74 * scale);
  }

  const DUR = opts.record ? RECORD_MS : PLAY_MS;
  const t0 = performance.now();
  let prevNow = t0;
  let raf = 0;
  let camLng = segs[0].coords[0][0];
  let camLat = segs[0].coords[0][1];
  let camZoom = 10.5;
  let segPtr = 0, ptPtr = 1;
  const doneLines: [number, number][][] = [];

  map.jumpTo({ center: [camLng, camLat], zoom: camZoom });

  function cleanup() {
    cancelAnimationFrame(raf);
    for (const id of ["pb-head-dot", "pb-line", "pb-casing"]) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of ["pb-progress", "pb-head"]) if (map.getSource(id)) map.removeSource(id);
    for (const [layer, prop, full] of [
      ["routes-line", "line-opacity", 0.9],
      ["routes-casing", "line-opacity", 0.6],
      ["visits-circle", "circle-opacity", 0.9],
    ] as const) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, full);
    }
  }

  // 종료는 단일 경로(finalize)로: 자연 완료든 사용자 중지든 항상 통하고, 두 번 실행되지 않는다
  let settled = false;
  function stopTracks() {
    stream?.getTracks().forEach((t) => t.stop());
  }
  function finalize(save: boolean) {
    if (settled) return;
    settled = true;
    cancelAnimationFrame(raf);
    cleanup();
    if (!recorder) { opts.onDone(null); return; }
    const rec = recorder;
    rec.onstop = () => {
      stopTracks();
      if (save && chunks.length > 0)
        opts.onDone({ blob: new Blob(chunks, { type: chunks[0].type }), ext });
      else opts.onDone(null);
    };
    try {
      rec.stop();
    } catch {
      stopTracks();
      opts.onDone(null);
    }
  }

  let elapsedMs = 0;
  function frame(now: number) {
    // 벽시계 대신 프레임 간 누적 시간 사용: 백그라운드 탭에서 rAF가 멈춘 동안
    // 진행이 한꺼번에 튀어 녹화가 스킵되는 것을 방지 (한 프레임 최대 100ms 인정)
    elapsedMs += Math.min(100, Math.max(0, now - prevNow));
    const p = Math.min(1, elapsedMs / DUR);
    // 시간 가중 거리로 위치 결정: 비행 구간은 30% 빠르게 지나간다
    const sEff = effTotal * p;

    // 현재 스텝 찾기 (단조 포인터, 가중 누적 기준)
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
    // HUD용 실제 누적 거리
    const s = segStart[segPtr] + d0 + (d1 - d0) * f;
    const lng = c0[0] + (c1[0] - c0[0]) * f;
    const lat = c0[1] + (c1[1] - c0[1]) * f;
    const t = seg.times[ptPtr - 1] + (seg.times[ptPtr] - seg.times[ptPtr - 1]) * f;

    // 진행 경로 지오메트리: 완료된 세그먼트는 캐시하고 현재 세그먼트만 매 프레임 갱신
    // (매 프레임 전체 복사는 포인트 수 × 프레임 수 만큼 비용이 커진다)
    while (doneLines.length < segPtr) doneLines.push(segs[doneLines.length].coords);
    const lines: [number, number][][] = [
      ...doneLines,
      [...seg.coords.slice(0, ptPtr), [lng, lat]],
    ];
    (map.getSource("pb-progress") as GeoJSONSource | undefined)?.setData({
      type: "Feature", properties: {},
      geometry: { type: "MultiLineString", coordinates: lines },
    } as GeoJSON.Feature);
    (map.getSource("pb-head") as GeoJSONSource | undefined)?.setData({
      type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lng, lat] },
    } as GeoJSON.Feature);

    // 시네마틱 카메라: 스텝 길이(≈속도)에 따라 목표 줌 결정, 지수 평활로 따라가기
    // 육지(도시 안) 이동은 더 확대해 디테일이 보이게, 비행은 크게 축소.
    // 평활 계수는 dt 기반이라 프레임레이트와 무관하게 같은 감속 곡선을 그린다.
    const dt = Math.min(0.1, (now - prevNow) / 1000);
    prevNow = now;
    const stepKm = d1 - d0;
    const targetZoom = stepKm > 40 ? 3.2 : stepKm > 8 ? 6.2 : stepKm > 1.5 ? 10 : 13;
    const aZoom = 1 - Math.exp(-4.4 * dt);
    const aPan = 1 - Math.exp(-12 * dt);
    camZoom += (targetZoom - camZoom) * aZoom;
    camLng += (lng - camLng) * aPan;
    camLat += (lat - camLat) * aPan;
    map.jumpTo({ center: [camLng, camLat], zoom: camZoom });

    const info: PlaybackInfo = {
      date: localDay(new Date(t)),
      km: s,
      pct: (s / EARTH_KM) * 100,
      progress: p,
    };
    opts.onProgress(info);
    drawOverlay(info);

    if (p >= 1) {
      // 완료: 전체 경로가 보이는 큰 화면으로 (이 홀드 중에도 중지는 여전히 동작)
      map.fitBounds(
        [[minLng - 0.02, minLat - 0.02], [maxLng + 0.02, maxLat + 0.02]],
        { padding: 60, maxZoom: 14, duration: 1200 },
      );
      const holdEnd = now + HOLD_MS;
      const hold = (n: number) => {
        if (settled) return;
        drawOverlay(info);
        if (n < holdEnd) raf = requestAnimationFrame(hold);
        else finalize(true);
      };
      raf = requestAnimationFrame(hold);
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      finalize(false);
    },
    recording: recorder != null,
  };
}
