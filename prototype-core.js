export const SEOUL_BOUNDS = Object.freeze({
  west: 126.76,
  south: 37.42,
  east: 127.18,
  north: 37.7,
});

export const DEFAULT_VIEW = Object.freeze({
  latitude: 37.5665,
  longitude: 126.978,
  zoom: 12,
  layer: "auto",
});

export const VALID_LAYERS = new Set(["auto", "weather", "imagery", "traffic"]);
export const SEARCH_ENDPOINT = "/api/search";
export const CCTV_OPEN_ENDPOINT = "/api/cctv/open";
export const SEARCH_INTERVAL_MS = 1100;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function parseFiniteNumber(rawValue, fallback) {
  if (rawValue === null || String(rawValue).trim() === "") return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeLayer(rawLayer) {
  return VALID_LAYERS.has(rawLayer) ? rawLayer : "auto";
}

export function normalizeQuery(query) {
  return String(query ?? "").trim().replace(/\s+/g, " ");
}

export function parseViewState(search = "") {
  const params = new URLSearchParams(search);
  const latitude = clamp(
    parseFiniteNumber(params.get("lat"), DEFAULT_VIEW.latitude),
    SEOUL_BOUNDS.south,
    SEOUL_BOUNDS.north,
  );
  const longitude = clamp(
    parseFiniteNumber(params.get("lng"), DEFAULT_VIEW.longitude),
    SEOUL_BOUNDS.west,
    SEOUL_BOUNDS.east,
  );
  const zoom = clamp(parseFiniteNumber(params.get("z"), DEFAULT_VIEW.zoom), 7, 18);

  return {
    latitude,
    longitude,
    zoom,
    layer: normalizeLayer(params.get("layer")),
  };
}

export function buildShareUrl(baseUrl, viewState) {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("lat", clamp(viewState.latitude, SEOUL_BOUNDS.south, SEOUL_BOUNDS.north).toFixed(5));
  url.searchParams.set("lng", clamp(viewState.longitude, SEOUL_BOUNDS.west, SEOUL_BOUNDS.east).toFixed(5));
  url.searchParams.set("z", clamp(viewState.zoom, 7, 18).toFixed(2));
  url.searchParams.set("layer", normalizeLayer(viewState.layer));
  return url;
}

export function buildSearchUrl(query, baseUrl = "http://127.0.0.1") {
  const normalizedQuery = normalizeQuery(query);
  const url = new URL(SEARCH_ENDPOINT, baseUrl);
  url.searchParams.set("q", normalizedQuery);
  return url;
}

export function buildCctvOpenUrl(cameraId, baseUrl = "http://127.0.0.1") {
  const id = String(cameraId ?? "").trim();
  if (!id) return null;
  const url = new URL(CCTV_OPEN_ENDPOINT, baseUrl);
  url.searchParams.set("id", id);
  return url;
}

export function parseSearchResult(rawResult) {
  const latitude = Number(rawResult?.latitude ?? rawResult?.lat);
  const longitude = Number(rawResult?.longitude ?? rawResult?.lon);
  const displayName = normalizeText(rawResult?.displayName ?? rawResult?.display_name);
  const shortName = normalizeText(rawResult?.shortName) || displayName.split(",")[0].trim();

  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || !displayName
    || !shortName
    || latitude < SEOUL_BOUNDS.south
    || latitude > SEOUL_BOUNDS.north
    || longitude < SEOUL_BOUNDS.west
    || longitude > SEOUL_BOUNDS.east
  ) {
    return null;
  }

  const boundingBox = parseBoundingBox(rawResult?.boundingBox ?? rawResult?.boundingbox);
  return {
    latitude,
    longitude,
    displayName,
    shortName,
    boundingBox,
  };
}

export function parseBoundingBox(rawBoundingBox) {
  if (Array.isArray(rawBoundingBox) && rawBoundingBox.length === 2) {
    const [[west, south], [east, north]] = rawBoundingBox.map((point) => Array.isArray(point) ? point.map(Number) : []);
    if (![south, north, west, east].every(Number.isFinite)) return null;
    if (south > north || west > east) return null;
    return [
      [clamp(west, SEOUL_BOUNDS.west, SEOUL_BOUNDS.east), clamp(south, SEOUL_BOUNDS.south, SEOUL_BOUNDS.north)],
      [clamp(east, SEOUL_BOUNDS.west, SEOUL_BOUNDS.east), clamp(north, SEOUL_BOUNDS.south, SEOUL_BOUNDS.north)],
    ];
  }

  if (!Array.isArray(rawBoundingBox) || rawBoundingBox.length !== 4) return null;
  const [south, north, west, east] = rawBoundingBox.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  if (south > north || west > east) return null;

  return [
    [clamp(west, SEOUL_BOUNDS.west, SEOUL_BOUNDS.east), clamp(south, SEOUL_BOUNDS.south, SEOUL_BOUNDS.north)],
    [clamp(east, SEOUL_BOUNDS.west, SEOUL_BOUNDS.east), clamp(north, SEOUL_BOUNDS.south, SEOUL_BOUNDS.north)],
  ];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function remainingSearchDelay(lastStartedAt, now = Date.now()) {
  return Math.max(0, SEARCH_INTERVAL_MS - (now - lastStartedAt));
}
