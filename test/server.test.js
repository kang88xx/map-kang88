import assert from "node:assert/strict";
import test from "node:test";

import { buildNominatimSearchUrl, createAppServer, getAppServerStats, publicCamera, searchPlaces } from "../server.js";

function requestServer(server, path, { method = "GET" } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const headers = new Headers();
    const response = {
      statusCode: 200,
      writeHead(status, rawHeaders) {
        this.statusCode = status;
        for (const [key, value] of Object.entries(rawHeaders)) headers.set(key, String(value));
      },
      end(chunk = "") {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        resolve(new Response(Buffer.concat(chunks), { status: this.statusCode, headers }));
      },
    };
    server.emit("request", { method, url: path, headers: { host: "127.0.0.1" } }, response);
  });
}

test("search proxy calls Nominatim instead of recursively calling the app proxy", async () => {
  const seenUrls = [];
  const state = {
    searchCache: new Map(),
    inflight: new Map(),
    lastSearchStartedAt: 0,
    fetchImpl: async (url) => {
      seenUrls.push(url.toString());
      return new Response(JSON.stringify([{
        lat: "37.5547",
        lon: "126.9707",
        display_name: "서울역, 중구, 서울특별시, 대한민국",
      }]), { headers: { "content-type": "application/json" } });
    },
  };

  const result = await searchPlaces(state, "서울역");

  assert.equal(seenUrls.length, 1);
  assert.equal(new URL(seenUrls[0]).origin, "https://nominatim.openstreetmap.org");
  assert.equal(result.results[0].shortName, "서울역");
});

test("different search queries are globally serialized without real waiting", async () => {
  let currentTime = 0;
  const upstreamCalls = [];
  const sleeps = [];
  const state = {
    searchCache: new Map(),
    inflight: new Map(),
    searchQueue: [],
    searchQueueActive: false,
    lastSearchStartedAt: null,
    now: () => currentTime,
    sleep: async (ms) => {
      sleeps.push(ms);
      currentTime += ms;
    },
    fetchImpl: async (url) => {
      upstreamCalls.push({ query: new URL(url).searchParams.get("q"), time: currentTime });
      return new Response(JSON.stringify([{
        lat: "37.5547",
        lon: "126.9707",
        display_name: `${new URL(url).searchParams.get("q")}, 서울특별시, 대한민국`,
      }]), { headers: { "content-type": "application/json" } });
    },
  };

  await Promise.all([
    searchPlaces(state, "서울역"),
    searchPlaces(state, "시청역"),
    searchPlaces(state, "광화문"),
  ]);

  assert.deepEqual(upstreamCalls, [
    { query: "서울역", time: 0 },
    { query: "시청역", time: 1100 },
    { query: "광화문", time: 2200 },
  ]);
  assert.deepEqual(sleeps, [1100, 1100]);
});

test("search cache is capped as LRU", async () => {
  let currentTime = 0;
  const state = {
    searchCache: new Map(),
    inflight: new Map(),
    searchQueue: [],
    searchQueueActive: false,
    lastSearchStartedAt: null,
    now: () => currentTime,
    sleep: async (ms) => { currentTime += ms; },
    fetchImpl: async (url) => new Response(JSON.stringify([{
      lat: "37.5547",
      lon: "126.9707",
      display_name: `${new URL(url).searchParams.get("q")}, 서울특별시, 대한민국`,
    }]), { headers: { "content-type": "application/json" } }),
  };

  for (let index = 0; index < 101; index += 1) {
    await searchPlaces(state, `장소${index}`);
  }

  assert.equal(state.searchCache.size, 100);
  assert.equal(state.searchCache.has("장소0"), false);
  assert.equal(state.searchCache.has("장소100"), true);
});

test("search route returns 429 when the bounded queue is full", async () => {
  const server = createAppServer({
    fetchImpl: async () => new Response("[]", { headers: { "content-type": "application/json" } }),
  });
  server.appState.searchQueueActive = true;
  server.appState.searchQueue = Array.from({ length: 19 }, () => ({}));

  const response = await requestServer(server, "/api/search?q=서울역");
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "search_rate_limited", status: 429 });
});

test("buildNominatimSearchUrl creates a bounded Korean Nominatim request", () => {
  const url = buildNominatimSearchUrl("서울역");

  assert.equal(url.origin + url.pathname, "https://nominatim.openstreetmap.org/search");
  assert.equal(url.searchParams.get("q"), "서울역");
  assert.equal(url.searchParams.get("format"), "jsonv2");
  assert.equal(url.searchParams.get("countrycodes"), "kr");
  assert.equal(url.searchParams.get("bounded"), "1");
  assert.equal(url.searchParams.get("accept-language"), "ko");
});

test("publicCamera hides the official media URL from the list payload", () => {
  const camera = publicCamera({
    id: "camera-1",
    name: "서울역",
    mediaUrl: "https://cctvsec.ktict.co.kr/live.m3u8",
    mediaHost: "cctvsec.ktict.co.kr",
  });

  assert.deepEqual(camera, {
    id: "camera-1",
    name: "서울역",
    mediaHost: "cctvsec.ktict.co.kr",
  });
});

test("healthz responds without upstream work for GET and HEAD", async () => {
  let fetchCalls = 0;
  const server = createAppServer({
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("unexpected upstream call");
    },
  });

  const getResponse = await requestServer(server, "/healthz");
  assert.equal(getResponse.status, 200);
  assert.equal(await getResponse.text(), '{"status":"ok"}');
  assert.equal(getResponse.headers.get("cache-control"), "no-store");
  assert.match(getResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);

  const headResponse = await requestServer(server, "/healthz", { method: "HEAD" });
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");
  assert.equal(fetchCalls, 0);
});

test("cctv route omits mediaUrl and reuses cached upstream data for open", async () => {
  let fetchCalls = 0;
  const server = createAppServer({
    environment: { ITS_CCTV_API_KEY: "test-key" },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({
        response: {
          data: [{
            cctvname: "서울역",
            coordx: "126.9707",
            coordy: "37.5547",
            cctvurl: "https://cctvsec.ktict.co.kr/live.m3u8",
            cctvformat: "HLS",
          }],
        },
      }), { headers: { "content-type": "application/json" } });
    },
  });

  const list = await (await requestServer(server, "/api/cctv")).json();
  assert.equal(list.count, 1);
  assert.equal(list.cameras[0].mediaUrl, undefined);
  assert.equal(list.cameras[0].mediaHost, "cctvsec.ktict.co.kr");

  const openResponse = await requestServer(server, `/api/cctv/open?id=${list.cameras[0].id}`);
  assert.equal(openResponse.status, 302);
  assert.equal(openResponse.headers.get("location"), "https://cctvsec.ktict.co.kr/live.m3u8");
  assert.equal(openResponse.headers.get("cache-control"), "no-store");
  assert.equal(fetchCalls, 1);
});

test("cctv refresh budget serves stale cache without extra upstream calls", async () => {
  let fetchCalls = 0;
  const server = createAppServer({
    environment: {
      ITS_CCTV_API_KEY: "test-key",
      CCTV_CACHE_TTL_MS: "1",
      CCTV_MAX_UPSTREAM_REFRESHES: "1",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({
        response: {
          data: [{
            cctvname: "서울역",
            coordx: "126.9707",
            coordy: "37.5547",
            cctvurl: "https://cctvsec.ktict.co.kr/live.m3u8",
            cctvformat: "HLS",
          }],
        },
      }), { headers: { "content-type": "application/json" } });
    },
  });

  assert.equal((await requestServer(server, "/api/cctv")).status, 200);
  server.appState.cctvCache.createdAt = 0;

  const stale = await (await requestServer(server, "/api/cctv")).json();
  assert.equal(stale.stale, true);
  assert.equal(stale.warning, "refresh_budget_exhausted");
  assert.equal(fetchCalls, 1);
  assert.deepEqual(getAppServerStats(server), {
    cctvUpstreamRefreshes: 1,
    cctvMaxUpstreamRefreshes: 1,
    cctvRefreshBudgetScope: "process",
    cctvCacheTtlMs: 1,
  });
});

test("cctv refresh budget returns 503 without cache and never calls upstream", async () => {
  let fetchCalls = 0;
  const server = createAppServer({
    environment: {
      ITS_CCTV_API_KEY: "test-key",
      CCTV_MAX_UPSTREAM_REFRESHES: "1",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
  });
  server.appState.cctvUpstreamRefreshes = 1;

  const response = await requestServer(server, "/api/cctv");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "upstream_budget_exhausted" });
  assert.equal(fetchCalls, 0);
});
