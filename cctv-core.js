import { createHash } from "node:crypto";

export const CCTV_BOUNDS = Object.freeze({ west: 126.76, south: 37.42, east: 127.18, north: 37.7 });

export function normalizeItsPayload(payload) {
  const response = payload?.response ?? payload;
  const rawItems = Array.isArray(response?.data) ? response.data : [];
  const cameras = rawItems.map(normalizeCamera).filter(Boolean);
  return {
    coordType: typeof response?.coordtype === "string" ? response.coordtype : null,
    count: cameras.length,
    cameras,
  };
}

export function normalizeCamera(raw, index) {
  const name = typeof raw?.cctvname === "string" ? raw.cctvname.replace(/;+$/, "").trim() : "";
  const longitude = Number(String(raw?.coordx ?? "").replace(/;+$/, ""));
  const latitude = Number(String(raw?.coordy ?? "").replace(/;+$/, ""));
  const media = normalizeMediaUrl(raw?.cctvurl);
  if (
    !name
    || !Number.isFinite(longitude)
    || !Number.isFinite(latitude)
    || longitude < CCTV_BOUNDS.west
    || longitude > CCTV_BOUNDS.east
    || latitude < CCTV_BOUNDS.south
    || latitude > CCTV_BOUNDS.north
    || !media
  ) return null;

  const identity = `${name}|${longitude.toFixed(6)}|${latitude.toFixed(6)}|${index}`;
  return {
    id: createHash("sha256").update(identity).digest("hex").slice(0, 16),
    name,
    longitude,
    latitude,
    mediaUrl: media.url,
    mediaHost: media.host,
    format: typeof raw?.cctvformat === "string" ? raw.cctvformat : null,
    resolution: typeof raw?.cctvresolution === "string" && raw.cctvresolution ? raw.cctvresolution : null,
    observedAt: typeof raw?.filecreatetime === "string" && raw.filecreatetime ? raw.filecreatetime : null,
  };
}

export function normalizeMediaUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return null;
    return { url: url.toString(), host: url.host };
  } catch {
    return null;
  }
}
