import assert from "node:assert/strict";
import test from "node:test";

import { buildNominatimSearchUrl, createAppServer, publicCamera, searchPlaces } from "../server.js";

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
