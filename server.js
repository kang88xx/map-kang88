import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CCTV_BOUNDS, normalizeItsPayload } from "./cctv-core.js";
import { normalizeQuery, parseSearchResult, SEOUL_BOUNDS } from "./prototype-core.js";
import { findLatestKmaTimestamp, readPngDimensions } from "./weather-core.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PORT = 4173;
const DEFAULT_HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const ITS_ENDPOINT = "https://openapi.its.go.kr:9443/cctvInfo";
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_USER_AGENT = "map.kang88.io seoul-now-map-prototype/0.1 (https://map.kang88.io)";
const DEFAULT_CCTV_CACHE_TTL_MS = 60 * 60_000;
const DEFAULT_CCTV_MAX_UPSTREAM_REFRESHES = 90;
const DEFAULT_CCTV_REQUEST_TIMEOUT_MS = 35_000;
const SEARCH_CACHE_TTL_MS = 60 * 60_000;
const SEARCH_INTERVAL_MS = 1_100;
const SEARCH_CACHE_MAX_ENTRIES = 100;
const SEARCH_QUEUE_MAX_PENDING = 20;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const KMA_LIST_ENDPOINT = "https://apihub.kma.go.kr/api/typ05/api/GK2A/LE1B/IR105/KO/imageList";
const KMA_IMAGE_ENDPOINT = "https://apihub.kma.go.kr/api/typ05/api/GK2A/LE1B/IR105/KO/image";
const KMA_CACHE_TTL_MS = 10 * 60_000;
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

export function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator > 0) result[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return result;
}

export async function loadEnvironment() {
  try {
    return { ...parseEnv(await readFile(join(ROOT, ".env.local"), "utf8")), ...process.env };
  } catch {
    return { ...process.env };
  }
}

export function publicCamera(camera) {
  const { mediaUrl, ...publicFields } = camera;
  return publicFields;
}

export function getAppServerStats(server) {
  return {
    cctvUpstreamRefreshes: server.appState?.cctvUpstreamRefreshes ?? 0,
    cctvMaxUpstreamRefreshes: server.appState?.cctvMaxUpstreamRefreshes ?? DEFAULT_CCTV_MAX_UPSTREAM_REFRESHES,
    cctvRequestTimeoutMs: server.appState?.cctvRequestTimeoutMs ?? DEFAULT_CCTV_REQUEST_TIMEOUT_MS,
    cctvRefreshBudgetScope: "process",
    cctvCacheTtlMs: server.appState?.cctvCacheTtlMs ?? DEFAULT_CCTV_CACHE_TTL_MS,
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function securityHeaders(extra = {}) {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: https://tile.openstreetmap.org",
      "connect-src 'self' https://tile.openstreetmap.org",
      "worker-src 'self' blob:",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

async function readCappedResponse(response, maxBytes) {
  const chunks = [];
  let total = 0;
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("RESPONSE_TOO_LARGE");
    return buffer;
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("RESPONSE_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function assertJsonLike(response, buffer, label) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/(^|[/+])json\b|text\/plain/i.test(contentType)) throw new Error(`${label}_BAD_CONTENT_TYPE`);
  if (!/^[\s\r\n]*[\[{]/.test(buffer.toString("utf8", 0, Math.min(buffer.length, 128)))) {
    throw new Error(`${label}_BAD_SIGNATURE`);
  }
}

function assertPng(response, buffer, label) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/image\/png|application\/octet-stream/i.test(contentType)) throw new Error(`${label}_BAD_CONTENT_TYPE`);
  if (!readPngDimensions(buffer)) throw new Error(`${label}_NOT_PNG`);
}

async function fetchJson(url, { fetchImpl, headers = {}, timeoutMs = 15_000, label }) {
  const response = await fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${label}_HTTP_${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error(`${label}_TOO_LARGE`);
  const buffer = await readCappedResponse(response, MAX_RESPONSE_BYTES);
  assertJsonLike(response, buffer, label);
  return JSON.parse(buffer.toString("utf8"));
}

export function classifyUpstreamError(error) {
  const message = String(error?.message || "");
  const causeCode = String(error?.cause?.code || error?.code || "").toUpperCase();
  const httpMatch = message.match(/^ITS_HTTP_(\d{3})$/);

  if (httpMatch) return `http_${httpMatch[1]}`;
  if (error?.name === "TimeoutError" || causeCode.includes("TIMEOUT")) return "timeout";
  if (["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH"].includes(causeCode)) {
    return causeCode.toLowerCase();
  }
  if (message === "ITS_BAD_CONTENT_TYPE") return "bad_content_type";
  if (message === "ITS_TOO_LARGE") return "response_too_large";
  if (error instanceof SyntaxError) return "invalid_json";
  if (message === "fetch failed") return "network_error";
  return "unknown";
}

async function fetchPng(url, { fetchImpl, timeoutMs = 15_000, label }) {
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${label}_HTTP_${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > KMA_MAX_IMAGE_BYTES) throw new Error(`${label}_TOO_LARGE`);
  const buffer = await readCappedResponse(response, KMA_MAX_IMAGE_BYTES);
  assertPng(response, buffer, label);
  return buffer;
}

function utcMinute(date) {
  return date.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

async function resolveSingleflight(state, key, producer, staleValue) {
  if (state.inflight.has(key)) return state.inflight.get(key);
  const request = producer().catch((error) => {
    if (staleValue) return { ...staleValue, stale: true, warning: "upstream_unavailable" };
    throw error;
  }).finally(() => {
    state.inflight.delete(key);
  });
  state.inflight.set(key, request);
  return request;
}

function ensureRuntimeState(state) {
  state.searchCache ??= new Map();
  state.inflight ??= new Map();
  state.searchQueue ??= [];
  state.searchQueueActive ??= false;
  state.now ??= Date.now;
  state.sleep ??= (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (!("lastSearchStartedAt" in state)) state.lastSearchStartedAt = null;
}

function getCacheEntry(cache, key, ttlMs, now) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (now - cached.createdAt >= ttlMs) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached.value;
}

function setLruCacheEntry(cache, key, value, maxEntries, now) {
  cache.delete(key);
  cache.set(key, { createdAt: now, value });
  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}

async function fetchCameras(state, apiKey) {
  if (state.cctvCache && Date.now() - state.cctvCache.createdAt < state.cctvCacheTtlMs) return state.cctvCache.value;
  if (state.cctvUpstreamRefreshes >= state.cctvMaxUpstreamRefreshes) {
    if (state.cctvCache) return { ...state.cctvCache.value, stale: true, warning: "refresh_budget_exhausted" };
    const error = new Error("CCTV_REFRESH_BUDGET_EXHAUSTED");
    error.status = 503;
    throw error;
  }
  return resolveSingleflight(state, "cctv", async () => {
    if (state.cctvUpstreamRefreshes >= state.cctvMaxUpstreamRefreshes) {
      if (state.cctvCache) return { ...state.cctvCache.value, stale: true, warning: "refresh_budget_exhausted" };
      const error = new Error("CCTV_REFRESH_BUDGET_EXHAUSTED");
      error.status = 503;
      throw error;
    }
    state.cctvUpstreamRefreshes += 1;
    const url = new URL(ITS_ENDPOINT);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("type", "all");
    url.searchParams.set("cctvType", "4");
    url.searchParams.set("minX", String(CCTV_BOUNDS.west));
    url.searchParams.set("maxX", String(CCTV_BOUNDS.east));
    url.searchParams.set("minY", String(CCTV_BOUNDS.south));
    url.searchParams.set("maxY", String(CCTV_BOUNDS.north));
    url.searchParams.set("getType", "json");

    const normalized = normalizeItsPayload(await fetchJson(url, {
      fetchImpl: state.fetchImpl,
      label: "ITS",
      timeoutMs: state.cctvRequestTimeoutMs,
    }));
    const value = {
      ...normalized,
      attribution: "국토교통부 국가교통정보센터",
      cachedAt: new Date().toISOString(),
      stale: false,
    };
    state.cctvCache = { createdAt: Date.now(), value };
    return value;
  }, state.cctvCache?.value);
}

async function fetchLatestWeather(state, apiKey) {
  if (state.weatherCache && Date.now() - state.weatherCache.createdAt < KMA_CACHE_TTL_MS) return state.weatherCache.value;
  return resolveSingleflight(state, "weather", async () => {
    const end = new Date();
    end.setUTCSeconds(0, 0);
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const listUrl = new URL(KMA_LIST_ENDPOINT);
    listUrl.searchParams.set("sDate", utcMinute(start));
    listUrl.searchParams.set("eDate", utcMinute(end));
    listUrl.searchParams.set("format", "json");
    listUrl.searchParams.set("authKey", apiKey);
    const listPayload = await fetchJson(listUrl, { fetchImpl: state.fetchImpl, label: "KMA_LIST" });
    const observedAt = findLatestKmaTimestamp(listPayload);
    if (!observedAt) throw new Error("KMA_TIMESTAMP_MISSING");

    const imageUrl = new URL(KMA_IMAGE_ENDPOINT);
    imageUrl.searchParams.set("date", observedAt);
    imageUrl.searchParams.set("authKey", apiKey);
    const image = await fetchPng(imageUrl, { fetchImpl: state.fetchImpl, label: "KMA_IMAGE" });
    const value = { observedAt, image, dimensions: readPngDimensions(image), contentType: "image/png", stale: false };
    state.weatherCache = { createdAt: Date.now(), value };
    return value;
  }, state.weatherCache?.value);
}

function validateSearchQuery(rawQuery) {
  const query = normalizeQuery(rawQuery);
  if (query.length < 2 || query.length > 80) return null;
  return query;
}

export function buildNominatimSearchUrl(query) {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "kr");
  url.searchParams.set(
    "viewbox",
    `${SEOUL_BOUNDS.west},${SEOUL_BOUNDS.north},${SEOUL_BOUNDS.east},${SEOUL_BOUNDS.south}`,
  );
  url.searchParams.set("bounded", "1");
  url.searchParams.set("accept-language", "ko");
  return url;
}

async function waitForSearchBudget(state) {
  const now = state.now();
  const waitMs = state.lastSearchStartedAt === null ? 0 : Math.max(0, SEARCH_INTERVAL_MS - (now - state.lastSearchStartedAt));
  if (waitMs > 0) await state.sleep(waitMs);
  state.lastSearchStartedAt = state.now();
}

async function enqueueSearch(state, producer) {
  ensureRuntimeState(state);
  const pending = state.searchQueue.length + (state.searchQueueActive ? 1 : 0);
  if (pending >= SEARCH_QUEUE_MAX_PENDING) return { error: "search_rate_limited", status: 429 };

  return new Promise((resolve, reject) => {
    state.searchQueue.push({ producer, resolve, reject });
    drainSearchQueue(state);
  });
}

async function drainSearchQueue(state) {
  if (state.searchQueueActive) return;
  state.searchQueueActive = true;
  try {
    while (state.searchQueue.length > 0) {
      const item = state.searchQueue.shift();
      try {
        await waitForSearchBudget(state);
        item.resolve(await item.producer());
      } catch (error) {
        item.reject(error);
      }
    }
  } finally {
    state.searchQueueActive = false;
  }
}

export async function searchPlaces(state, rawQuery) {
  ensureRuntimeState(state);
  const query = validateSearchQuery(rawQuery);
  if (!query) return { error: "invalid_query", status: 400 };
  const key = query.toLocaleLowerCase("ko-KR");
  const cached = getCacheEntry(state.searchCache, key, SEARCH_CACHE_TTL_MS, state.now());
  if (cached) return cached;

  return resolveSingleflight(state, `search:${key}`, async () => {
    return enqueueSearch(state, async () => {
      const payload = await fetchJson(buildNominatimSearchUrl(query), {
        fetchImpl: state.fetchImpl,
        headers: {
          Accept: "application/json",
          "Accept-Language": "ko",
          "User-Agent": NOMINATIM_USER_AGENT,
        },
        timeoutMs: 8_000,
        label: "SEARCH",
      });
      const results = Array.isArray(payload) ? payload.map(parseSearchResult).filter(Boolean) : [];
      const value = { count: results.length, results, cachedAt: new Date().toISOString(), stale: false };
      setLruCacheEntry(state.searchCache, key, value, SEARCH_CACHE_MAX_ENTRIES, state.now());
      return value;
    });
  }, cached?.value);
}

function sendJson(response, status, body, headers = {}, method = "GET") {
  response.writeHead(status, securityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, max-age=30",
    ...headers,
  }));
  response.end(method === "HEAD" ? "" : JSON.stringify(body));
}

async function serveStatic(requestPath, response, method = "GET") {
  if (!STATIC_FILES.has(requestPath)) return false;
  const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = normalize(join(ROOT, relative));
  if (!filePath.startsWith(ROOT)) return false;
  const body = await readFile(filePath);
  response.writeHead(200, securityHeaders({
    "Content-Type": CONTENT_TYPES.get(extname(filePath)) ?? "application/octet-stream",
    "Cache-Control": requestPath.startsWith("/vendor/") ? "public, max-age=31536000, immutable" : "no-cache",
  }));
  response.end(method === "HEAD" ? "" : body);
  return true;
}

export function createAppServer({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const state = {
    cctvCache: null,
    cctvCacheTtlMs: positiveInteger(environment.CCTV_CACHE_TTL_MS, DEFAULT_CCTV_CACHE_TTL_MS),
    cctvMaxUpstreamRefreshes: positiveInteger(environment.CCTV_MAX_UPSTREAM_REFRESHES, DEFAULT_CCTV_MAX_UPSTREAM_REFRESHES),
    cctvRequestTimeoutMs: positiveInteger(environment.CCTV_REQUEST_TIMEOUT_MS, DEFAULT_CCTV_REQUEST_TIMEOUT_MS),
    cctvUpstreamRefreshes: 0,
    weatherCache: null,
    searchCache: new Map(),
    searchQueue: [],
    searchQueueActive: false,
    inflight: new Map(),
    fetchImpl,
    lastSearchStartedAt: null,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };

  const server = createServer(async (request, response) => {
    let requestPath = "";
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      requestPath = url.pathname;
      if (!["GET", "HEAD"].includes(request.method)) {
        return sendJson(response, 405, { error: "method_not_allowed" }, {}, request.method);
      }
      if (url.pathname === "/healthz") {
        return sendJson(response, 200, { status: "ok" }, { "Cache-Control": "no-store" }, request.method);
      }
      if (url.pathname === "/api/search") {
        const result = await searchPlaces(state, url.searchParams.get("q"));
        if (result.error) return sendJson(response, result.status ?? 400, result);
        return sendJson(response, 200, result);
      }
      if (url.pathname === "/api/cctv") {
        if (!environment.ITS_CCTV_API_KEY) return sendJson(response, 503, { error: "cctv_key_missing" });
        const cctv = await fetchCameras(state, environment.ITS_CCTV_API_KEY);
        return sendJson(response, 200, { ...cctv, cameras: cctv.cameras.map(publicCamera) });
      }
      if (url.pathname === "/api/cctv/open") {
        if (!environment.ITS_CCTV_API_KEY) return sendJson(response, 503, { error: "cctv_key_missing" });
        const id = url.searchParams.get("id");
        if (!id) return sendJson(response, 400, { error: "camera_id_required" });
        const camera = (await fetchCameras(state, environment.ITS_CCTV_API_KEY)).cameras.find((item) => item.id === id);
        if (!camera?.mediaUrl) return sendJson(response, 404, { error: "camera_not_found" });
        response.writeHead(302, securityHeaders({ Location: camera.mediaUrl, "Cache-Control": "no-store" }));
        response.end();
        return;
      }
      if (url.pathname === "/api/weather") {
        if (!environment.KMA_API_AUTH_KEY) return sendJson(response, 503, { error: "weather_key_missing" });
        const weather = await fetchLatestWeather(state, environment.KMA_API_AUTH_KEY);
        return sendJson(response, 200, {
          observedAt: weather.observedAt,
          width: weather.dimensions.width,
          height: weather.dimensions.height,
          imageUrl: "/api/weather/image",
          attribution: "기상청 API Hub · 천리안 2A",
          overlayReady: false,
          stale: weather.stale,
        });
      }
      if (url.pathname === "/api/weather/image") {
        if (!environment.KMA_API_AUTH_KEY) return sendJson(response, 503, { error: "weather_key_missing" });
        const weather = await fetchLatestWeather(state, environment.KMA_API_AUTH_KEY);
        response.writeHead(200, securityHeaders({
          "Content-Type": weather.contentType,
          "Content-Length": weather.image.length,
          "Cache-Control": weather.stale ? "no-store" : "private, max-age=60",
        }));
        response.end(weather.image);
        return;
      }
      if (await serveStatic(url.pathname, response, request.method)) return;
      return sendJson(response, 404, { error: "not_found" }, {}, request.method);
    } catch (error) {
      const status = error?.status === 503 ? 503 : 502;
      const code = status === 503 ? "upstream_budget_exhausted" : "upstream_unavailable";
      const body = { error: code };
      if (status === 502 && requestPath.startsWith("/api/cctv")) {
        body.reason = classifyUpstreamError(error);
      }
      return sendJson(response, status, body, {}, request.method);
    }
  });
  server.appState = state;
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const environment = await loadEnvironment();
  const port = Number(environment.PORT || DEFAULT_PORT);
  const host = environment.HOST || DEFAULT_HOST;
  const server = createAppServer({ environment });
  server.listen(port, host, () => {
    console.log(`Seoul map prototype: http://${host}:${port}`);
  });
  process.once("SIGTERM", () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}
