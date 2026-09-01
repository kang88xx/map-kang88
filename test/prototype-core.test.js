import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VIEW,
  NOMINATIM_ENDPOINT,
  SEARCH_INTERVAL_MS,
  SEOUL_BOUNDS,
  buildSearchUrl,
  buildShareUrl,
  normalizeQuery,
  parseBoundingBox,
  parseSearchResult,
  parseViewState,
  remainingSearchDelay,
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

test("buildSearchUrl creates one bounded Korean Nominatim request", () => {
  const url = buildSearchUrl("  서울역  ");
  assert.equal(url.origin + url.pathname, NOMINATIM_ENDPOINT);
  assert.equal(url.searchParams.get("q"), "서울역");
  assert.equal(url.searchParams.get("format"), "jsonv2");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.get("countrycodes"), "kr");
  assert.equal(url.searchParams.get("bounded"), "1");
  assert.equal(url.searchParams.get("accept-language"), "ko");
  assert.equal(url.searchParams.get("viewbox"), "126.76,37.7,127.18,37.42");
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

test("remainingSearchDelay enforces the public one-request-per-second budget", () => {
  assert.equal(remainingSearchDelay(1000, 1000), SEARCH_INTERVAL_MS);
  assert.equal(remainingSearchDelay(1000, 1600), 500);
  assert.equal(remainingSearchDelay(1000, 2200), 0);
});
