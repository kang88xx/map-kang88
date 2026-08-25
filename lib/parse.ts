import type { ParseResult, TrackPoint } from "./types";

/** "37.42°, -122.08°" | "geo:37.42,-122.08" | "37.42, -122.08" → [lat, lng] */
function parseLatLngString(s: string): [number, number] | null {
  const cleaned = s.replace(/^geo:/, "").replace(/°/g, "");
  const parts = cleaned.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat, lng] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

function toMs(v: unknown): number | null {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v !== "string") return null;
  if (/^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    return n > 1e12 ? n : n * 1000;
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function valid(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Takeout Records.json: { locations: [{ latitudeE7, longitudeE7, timestamp | timestampMs }] } */
function parseRecords(obj: any): TrackPoint[] | null {
  if (!Array.isArray(obj?.locations)) return null;
  const points: TrackPoint[] = [];
  for (const loc of obj.locations) {
    const t = toMs(loc.timestamp ?? loc.timestampMs);
    if (t == null) continue;
    const lat = loc.latitudeE7 / 1e7;
    const lng = loc.longitudeE7 / 1e7;
    if (valid(lat, lng)) points.push({ lat, lng, t, kind: "path" });
  }
  return points;
}

/** Takeout Semantic Location History: { timelineObjects: [{ activitySegment | placeVisit }] } */
function parseTimelineObjects(obj: any): TrackPoint[] | null {
  if (!Array.isArray(obj?.timelineObjects)) return null;
  const points: TrackPoint[] = [];
  for (const item of obj.timelineObjects) {
    const seg = item.activitySegment;
    if (seg) {
      const t0 = toMs(seg.duration?.startTimestamp);
      const t1 = toMs(seg.duration?.endTimestamp);
      if (t0 == null || t1 == null) continue;
      const raw: { lat: number; lng: number; t?: number }[] = [];
      if (seg.startLocation?.latitudeE7 != null)
        raw.push({ lat: seg.startLocation.latitudeE7 / 1e7, lng: seg.startLocation.longitudeE7 / 1e7 });
      const waypoints = seg.waypointPath?.waypoints;
      if (Array.isArray(waypoints))
        for (const w of waypoints) raw.push({ lat: w.latE7 / 1e7, lng: w.lngE7 / 1e7 });
      const rawPath = seg.simplifiedRawPath?.points;
      if (Array.isArray(rawPath))
        for (const p of rawPath)
          raw.push({ lat: p.latE7 / 1e7, lng: p.lngE7 / 1e7, t: toMs(p.timestamp) ?? undefined });
      if (seg.endLocation?.latitudeE7 != null)
        raw.push({ lat: seg.endLocation.latitudeE7 / 1e7, lng: seg.endLocation.longitudeE7 / 1e7 });
      // interpolate missing times across the segment duration
      raw.forEach((p, i) => {
        const t = p.t ?? t0 + ((t1 - t0) * i) / Math.max(1, raw.length - 1);
        if (valid(p.lat, p.lng)) points.push({ lat: p.lat, lng: p.lng, t, kind: "path" });
      });
    }
    const visit = item.placeVisit;
    if (visit?.location?.latitudeE7 != null) {
      const t = toMs(visit.duration?.startTimestamp);
      const lat = visit.location.latitudeE7 / 1e7;
      const lng = visit.location.longitudeE7 / 1e7;
      if (t != null && valid(lat, lng))
        points.push({ lat, lng, t, kind: "visit", name: visit.location.name ?? visit.location.address });
    }
  }
  return points;
}

/** One segment of the on-device export (Android object form or iOS array element). */
function parseSemanticSegment(seg: any, points: TrackPoint[]) {
  const t0 = toMs(seg.startTime);
  const t1 = toMs(seg.endTime);
  if (Array.isArray(seg.timelinePath)) {
    seg.timelinePath.forEach((p: any, i: number, arr: any[]) => {
      const ll = typeof p.point === "string" ? parseLatLngString(p.point) : null;
      if (!ll) return;
      let t = toMs(p.time);
      if (t == null && t0 != null && p.durationMinutesOffsetFromStartTime != null)
        t = t0 + parseFloat(p.durationMinutesOffsetFromStartTime) * 60_000;
      if (t == null && t0 != null && t1 != null)
        t = t0 + ((t1 - t0) * i) / Math.max(1, arr.length - 1);
      if (t != null) points.push({ lat: ll[0], lng: ll[1], t, kind: "path" });
    });
  }
  if (seg.visit) {
    const locStr =
      seg.visit.topCandidate?.placeLocation?.latLng ?? seg.visit.topCandidate?.placeLocation;
    const ll = typeof locStr === "string" ? parseLatLngString(locStr) : null;
    if (ll && t0 != null)
      points.push({
        lat: ll[0],
        lng: ll[1],
        t: t0,
        kind: "visit",
        name: seg.visit.topCandidate?.semanticType ?? undefined,
      });
  }
  if (seg.activity) {
    for (const [key, tt] of [
      ["start", t0],
      ["end", t1],
    ] as const) {
      const locStr = seg.activity[key]?.latLng ?? seg.activity[key];
      const ll = typeof locStr === "string" ? parseLatLngString(locStr) : null;
      if (ll && tt != null) points.push({ lat: ll[0], lng: ll[1], t: tt, kind: "path" });
    }
  }
}

/** Android on-device export: { semanticSegments: [...], rawSignals?: [...] } */
function parseOnDevice(obj: any): TrackPoint[] | null {
  if (!Array.isArray(obj?.semanticSegments)) return null;
  const points: TrackPoint[] = [];
  for (const seg of obj.semanticSegments) parseSemanticSegment(seg, points);
  if (Array.isArray(obj.rawSignals)) {
    for (const sig of obj.rawSignals) {
      const pos = sig.position;
      const ll = typeof pos?.LatLng === "string" ? parseLatLngString(pos.LatLng) : null;
      const t = toMs(pos?.timestamp);
      if (ll && t != null) points.push({ lat: ll[0], lng: ll[1], t, kind: "path" });
    }
  }
  return points;
}

/** iOS Google Maps export: a top-level array of segments. */
function parseIosArray(obj: any): TrackPoint[] | null {
  if (!Array.isArray(obj)) return null;
  const points: TrackPoint[] = [];
  for (const seg of obj) parseSemanticSegment(seg, points);
  return points.length > 0 ? points : null;
}

export function parseGpx(text: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const points: TrackPoint[] = [];
  doc.querySelectorAll("trkpt, rtept, wpt").forEach((el) => {
    const lat = parseFloat(el.getAttribute("lat") ?? "");
    const lng = parseFloat(el.getAttribute("lon") ?? "");
    const t = toMs(el.querySelector("time")?.textContent ?? undefined);
    if (valid(lat, lng) && t != null) points.push({ lat, lng, t, kind: "path" });
  });
  return points;
}

/** Google 포토 테이크아웃 메타데이터 JSON 한 개 → 포인트 (아니면 null) */
export function parsePhotosTakeoutJson(text: string): TrackPoint | null {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  const ts = obj?.photoTakenTime?.timestamp ?? obj?.creationTime?.timestamp;
  if (ts == null) return null;
  // geoData가 존재하지만 (0,0) 같은 무효 좌표일 수 있으므로 유효한 후보를 고른다
  const geo = [obj?.geoData, obj?.geoDataExif].find(
    (g) => g && valid(Number(g.latitude), Number(g.longitude)),
  );
  if (!geo) return null;
  const lat = Number(geo.latitude);
  const lng = Number(geo.longitude);
  const t = toMs(String(ts));
  if (t == null || !Number.isFinite(t)) return null;
  return { lat, lng, t, kind: "visit", name: obj.title ? `📷 ${obj.title}` : "📷 사진" };
}

export function parseFile(name: string, text: string): ParseResult {
  if (/\.gpx$/i.test(name)) {
    const points = parseGpx(text).filter(
      (p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
    if (points.length === 0) throw new Error("GPX에서 시간 정보가 있는 좌표를 찾지 못했습니다.");
    return { points, format: "GPX" };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("JSON 파일을 읽을 수 없습니다. Google 타임라인 내보내기(.json) 또는 GPX 파일을 올려주세요.");
  }

  const attempts: [string, TrackPoint[] | null][] = [
    ["Google 타임라인 (Records)", parseRecords(obj)],
    ["Google 타임라인 (Semantic)", parseTimelineObjects(obj)],
    ["Google 타임라인 (기기 내보내기)", parseOnDevice(obj)],
    ["Google 타임라인 (iOS)", parseIosArray(obj)],
  ];
  for (const [format, points] of attempts) {
    if (points && points.length > 0) {
      // 파서별 방어에 더해 마지막으로 한 번 더: NaN 시각·좌표 제거
      const clean = points.filter(
        (p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng),
      );
      if (clean.length > 0) return { points: clean, format };
    }
  }
  throw new Error(
    "지원하는 형식이 아닙니다. Google 지도 타임라인 내보내기 JSON(Records.json, Timeline.json 등) 또는 GPX 파일을 올려주세요.",
  );
}
