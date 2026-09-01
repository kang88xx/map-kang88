import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { CCTV_BOUNDS, normalizeItsPayload } from "./cctv-core.js";
import { findLatestKmaTimestamp, readPngDimensions } from "./weather-core.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const ITS_ENDPOINT = "https://openapi.its.go.kr:9443/cctvInfo";
const CACHE_TTL_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const KMA_LIST_ENDPOINT = "https://apihub.kma.go.kr/api/typ05/api/GK2A/LE1B/IR105/KO/imageList";
const KMA_IMAGE_ENDPOINT = "https://apihub.kma.go.kr/api/typ05/api/GK2A/LE1B/IR105/KO/image";
const KMA_CACHE_TTL_MS = 120_000;
const KMA_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const STATIC_FILES = new Set([
  "/", "/index.html", "/styles.css", "/app.js", "/bootstrap.js", "/prototype-core.js",
  "/vendor/pretext.js", "/vendor/maplibre-gl.css", "/vendor/maplibre-gl.mjs",
  "/vendor/maplibre-gl-shared.mjs", "/vendor/maplibre-gl-worker.mjs", "/vendor/MAPLIBRE_LICENSE.txt",
]);
const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

let cache = null;
let weatherCache = null;

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator > 0) result[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return result;
}

async function loadEnvironment() {
  try {
    return { ...parseEnv(await readFile(join(ROOT, ".env.local"), "utf8")), ...process.env };
  } catch {
    return { ...process.env };
  }
}

async function fetchCameras(apiKey) {
  if (cache && Date.now() - cache.createdAt < CACHE_TTL_MS) return cache.value;
  const url = new URL(ITS_ENDPOINT);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("type", "all");
  url.searchParams.set("cctvType", "4");
  url.searchParams.set("minX", String(CCTV_BOUNDS.west));
  url.searchParams.set("maxX", String(CCTV_BOUNDS.east));
  url.searchParams.set("minY", String(CCTV_BOUNDS.south));
  url.searchParams.set("maxY", String(CCTV_BOUNDS.north));
  url.searchParams.set("getType", "json");

  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`ITS_HTTP_${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error("ITS_TOO_LARGE");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("ITS_TOO_LARGE");
  const normalized = normalizeItsPayload(JSON.parse(text));
  const value = { ...normalized, attribution: "국토교통부 국가교통정보센터", cachedAt: new Date().toISOString() };
  cache = { createdAt: Date.now(), value };
  return value;
}

function utcMinute(date) {
  return date.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

async function fetchLatestWeather(apiKey) {
  if (weatherCache && Date.now() - weatherCache.createdAt < KMA_CACHE_TTL_MS) return weatherCache.value;
  const end = new Date();
  end.setUTCSeconds(0, 0);
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const listUrl = new URL(KMA_LIST_ENDPOINT);
  listUrl.searchParams.set("sDate", utcMinute(start));
  listUrl.searchParams.set("eDate", utcMinute(end));
  listUrl.searchParams.set("format", "json");
  listUrl.searchParams.set("authKey", apiKey);
  const listResponse = await fetch(listUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!listResponse.ok) throw new Error(`KMA_LIST_HTTP_${listResponse.status}`);
  const listText = await listResponse.text();
  if (Buffer.byteLength(listText) > MAX_RESPONSE_BYTES) throw new Error("KMA_LIST_TOO_LARGE");
  const observedAt = findLatestKmaTimestamp(listText);
  if (!observedAt) throw new Error("KMA_TIMESTAMP_MISSING");

  const imageUrl = new URL(KMA_IMAGE_ENDPOINT);
  imageUrl.searchParams.set("date", observedAt);
  imageUrl.searchParams.set("authKey", apiKey);
  const imageResponse = await fetch(imageUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!imageResponse.ok) throw new Error(`KMA_IMAGE_HTTP_${imageResponse.status}`);
  const declaredLength = Number(imageResponse.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > KMA_MAX_IMAGE_BYTES) throw new Error("KMA_IMAGE_TOO_LARGE");
  const image = Buffer.from(await imageResponse.arrayBuffer());
  if (image.length > KMA_MAX_IMAGE_BYTES) throw new Error("KMA_IMAGE_TOO_LARGE");
  const dimensions = readPngDimensions(image);
  if (!dimensions) throw new Error("KMA_IMAGE_NOT_PNG");
  const value = { observedAt, image, dimensions, contentType: "image/png" };
  weatherCache = { createdAt: Date.now(), value };
  return value;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, max-age=30",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function serveStatic(requestPath, response) {
  if (!STATIC_FILES.has(requestPath)) return false;
  const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = normalize(join(ROOT, relative));
  if (!filePath.startsWith(ROOT)) return false;
  const body = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES.get(extname(filePath)) ?? "application/octet-stream",
    "Cache-Control": requestPath.startsWith("/vendor/") ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
  return true;
}

const environment = await loadEnvironment();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
    if (url.pathname === "/api/cctv") {
      if (!environment.ITS_CCTV_API_KEY) return sendJson(response, 503, { error: "cctv_key_missing" });
      return sendJson(response, 200, await fetchCameras(environment.ITS_CCTV_API_KEY));
    }
    if (url.pathname === "/api/weather") {
      if (!environment.KMA_API_AUTH_KEY) return sendJson(response, 503, { error: "weather_key_missing" });
      const weather = await fetchLatestWeather(environment.KMA_API_AUTH_KEY);
      return sendJson(response, 200, {
        observedAt: weather.observedAt,
        width: weather.dimensions.width,
        height: weather.dimensions.height,
        imageUrl: "/api/weather/image",
        attribution: "기상청 API Hub · 천리안 2A",
        overlayReady: false,
      });
    }
    if (url.pathname === "/api/weather/image") {
      if (!environment.KMA_API_AUTH_KEY) return sendJson(response, 503, { error: "weather_key_missing" });
      const weather = await fetchLatestWeather(environment.KMA_API_AUTH_KEY);
      response.writeHead(200, {
        "Content-Type": weather.contentType,
        "Content-Length": weather.image.length,
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(weather.image);
      return;
    }
    if (await serveStatic(url.pathname, response)) return;
    return sendJson(response, 404, { error: "not_found" });
  } catch {
    return sendJson(response, 502, { error: "upstream_unavailable" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Seoul map prototype: http://127.0.0.1:${PORT}`);
});
