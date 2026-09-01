import assert from "node:assert/strict";
import test from "node:test";

import {
  CCTV_OPEN_ENDPOINT,
  DEFAULT_VIEW,
  SEARCH_ENDPOINT,
  SEOUL_BOUNDS,
  buildCctvOpenUrl,
  buildCctvStatus,
  buildSearchUrl,
  buildShareUrl,
  buildWeatherStatus,
  normalizeQuery,
  parseBoundingBox,
  parseSearchResult,
  parseViewState,
} from "../prototype-core.js";

test("parseViewState restores a valid Seoul map URL", () => {
  assert.deepEqual(parseViewState("?lat=37.57&lng=127.02&z=13.5&layer=traffic"), {
    latitude: 37.57,
    longitude: 127.02,
    zoom: 13.5,
    layer: "traffic",
  });
});

test("parseViewState clamps coordinates and zoom while normalizing an unknown layer", () => {
  assert.deepEqual(parseViewState("?lat=99&lng=-20&z=80&layer=fake&camera=secret"), {
    latitude: SEOUL_BOUNDS.north,
    longitude: SEOUL_BOUNDS.west,
    zoom: 18,
    layer: "auto",
  });
});

test("parseViewState falls back when numeric values are invalid", () => {
  assert.deepEqual(parseViewState("?lat=nope&lng=&z=NaN"), DEFAULT_VIEW);
});

test("buildShareUrl emits only the P0 view contract", () => {
  const url = buildShareUrl("http://localhost:4173/?camera=old#fragment", {
    latitude: 37.566535,
    longitude: 126.978012,
    zoom: 12.345,
    layer: "auto",
  });
  assert.equal(url.toString(), "http://localhost:4173/?lat=37.56654&lng=126.97801&z=12.35&layer=auto");
  assert.equal(url.searchParams.has("camera"), false);
});

test("buildSearchUrl creates a same-origin search proxy request only", () => {
  const url = buildSearchUrl("  서울역  ", "https://map.kang88.io/demo?old=1#hash");
  assert.equal(url.origin + url.pathname, `https://map.kang88.io${SEARCH_ENDPOINT}`);
  assert.equal(url.searchParams.get("q"), "서울역");
  assert.equal([...url.searchParams.keys()].join(","), "q");
});

test("normalizeQuery removes surrounding and repeated whitespace", () => {
  assert.equal(normalizeQuery("  서울   시청\n광장 "), "서울 시청 광장");
});

test("parseSearchResult accepts a safe Seoul result", () => {
  const result = parseSearchResult({
    lat: "37.5547",
    lon: "126.9707",
    display_name: "서울역, 중구, 서울특별시, 대한민국",
    boundingbox: ["37.553", "37.556", "126.968", "126.974"],
  });
  assert.equal(result.shortName, "서울역");
  assert.deepEqual(result.boundingBox, [[126.968, 37.553], [126.974, 37.556]]);
});

test("parseSearchResult accepts server-normalized search results", () => {
  const result = parseSearchResult({
    latitude: 37.5547,
    longitude: 126.9707,
    displayName: "서울역, 중구, 서울특별시, 대한민국",
    shortName: "서울역",
    boundingBox: [[126.968, 37.553], [126.974, 37.556]],
  });
  assert.deepEqual(result, {
    latitude: 37.5547,
    longitude: 126.9707,
    displayName: "서울역, 중구, 서울특별시, 대한민국",
    shortName: "서울역",
    boundingBox: [[126.968, 37.553], [126.974, 37.556]],
  });
});

test("parseSearchResult rejects malformed or out-of-Seoul results", () => {
  assert.equal(parseSearchResult({ lat: "x", lon: "126.9", display_name: "broken" }), null);
  assert.equal(parseSearchResult({ lat: "35.1", lon: "129.0", display_name: "부산" }), null);
  assert.equal(parseSearchResult({ lat: "37.5", lon: "127.0", display_name: "" }), null);
});

test("parseBoundingBox rejects malformed input and clamps valid bounds", () => {
  assert.equal(parseBoundingBox(["1", "2"]), null);
  assert.equal(parseBoundingBox(["a", "2", "3", "4"]), null);
  assert.equal(parseBoundingBox(["38", "37", "128", "126"]), null);
  assert.deepEqual(
    parseBoundingBox(["37.0", "38.0", "126.0", "128.0"]),
    [[SEOUL_BOUNDS.west, SEOUL_BOUNDS.south], [SEOUL_BOUNDS.east, SEOUL_BOUNDS.north]],
  );
});

test("buildCctvOpenUrl opens only the same-origin camera id endpoint", () => {
  const url = buildCctvOpenUrl(" cam 01 ", "https://map.kang88.io/?token=secret");
  assert.equal(url.origin + url.pathname, `https://map.kang88.io${CCTV_OPEN_ENDPOINT}`);
  assert.equal(url.searchParams.get("id"), "cam 01");
  assert.equal([...url.searchParams.keys()].join(","), "id");
  assert.equal(url.toString().includes("secret"), false);
});

test("buildCctvOpenUrl rejects empty camera ids", () => {
  assert.equal(buildCctvOpenUrl("   "), null);
});

test("buildCctvStatus labels stale camera payloads as cached and delayed", () => {
  assert.deepEqual(buildCctvStatus({ count: 7, stale: true }, 3), {
    stale: true,
    dotClass: "stale",
    ariaLabel: "지연됨",
    text: "캐시된 7개 · 공급자 응답 지연",
    warning: "CCTV 공급자 응답이 지연되어 캐시된 위치를 표시합니다. 위성 레이어는 지도 정합 검증 중입니다.",
  });
});

test("buildCctvStatus labels fresh camera payloads as connected", () => {
  assert.deepEqual(buildCctvStatus({ count: 7 }, 3), {
    stale: false,
    dotClass: "connected",
    ariaLabel: "연결됨",
    text: "7개 · 확대 13 이상에서 표시",
    warning: null,
  });
});

test("buildWeatherStatus keeps observed time visible on stale payloads", () => {
  assert.deepEqual(buildWeatherStatus({ stale: true }, "2026-09-01 06:00 UTC"), {
    stale: true,
    dotClass: "stale",
    ariaLabel: "지연됨",
    observedAtText: "2026-09-01 06:00 UTC · 지연됨",
    text: "2026-09-01 06:00 UTC · 지연됨",
    warning: "기상청 응답이 지연되어 캐시된 위성영상을 표시합니다.",
  });
});

test("buildWeatherStatus labels fresh weather payloads as preview", () => {
  assert.deepEqual(buildWeatherStatus({}, "2026-09-01 06:00 UTC"), {
    stale: false,
    dotClass: "connected",
    ariaLabel: "연결됨",
    observedAtText: "2026-09-01 06:00 UTC",
    text: "2026-09-01 06:00 UTC · 미리보기",
    warning: null,
  });
});
