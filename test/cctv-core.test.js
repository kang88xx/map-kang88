import assert from "node:assert/strict";
import test from "node:test";

import { normalizeItsPayload, normalizeMediaUrl } from "../cctv-core.js";

test("normalizeItsPayload keeps safe HTTPS Seoul cameras only", () => {
  const result = normalizeItsPayload({ response: { coordtype: "1", data: [
    { cctvname: "서울역;", coordx: "126.9707;", coordy: "37.5547", cctvurl: "https://cctvsec.ktict.co.kr/camera.m3u8", cctvformat: "HLS" },
    { cctvname: "부산", coordx: "129.0", coordy: "35.1", cctvurl: "https://cctvsec.ktict.co.kr/busan.m3u8" },
    { cctvname: "HTTP", coordx: "126.98", coordy: "37.56", cctvurl: "http://cctvsec.ktict.co.kr/insecure.m3u8" },
    { cctvname: "Wrong host", coordx: "126.98", coordy: "37.56", cctvurl: "https://media.example/live.m3u8" },
  ] } });
  assert.equal(result.count, 1);
  assert.equal(result.cameras[0].name, "서울역");
  assert.equal(result.cameras[0].mediaHost, "cctvsec.ktict.co.kr");
  assert.equal(result.cameras[0].format, "HLS");
  assert.equal(result.cameras[0].id.length, 24);
});

test("normalizeItsPayload uses stable camera ids independent of roadsectionid and order", () => {
  const payload = { response: { data: [
    { roadsectionid: "same", cctvname: "A", coordx: "126.98", coordy: "37.56", cctvurl: "https://cctvsec.ktict.co.kr/a.m3u8" },
    { roadsectionid: "same", cctvname: "B", coordx: "126.99", coordy: "37.57", cctvurl: "https://cctvsec.ktict.co.kr/b.m3u8" },
  ] } };
  const result = normalizeItsPayload(payload);
  const reordered = normalizeItsPayload({ response: { data: [...payload.response.data].reverse() } });
  assert.notEqual(result.cameras[0].id, result.cameras[1].id);
  assert.equal(result.cameras[0].id, reordered.cameras[1].id);
  assert.equal(result.cameras[1].id, reordered.cameras[0].id);
});

test("normalizeItsPayload keeps camera ids stable when signed media URLs rotate", () => {
  const first = normalizeItsPayload({ response: { data: [{
    cctvname: "서울역",
    coordx: "126.9707",
    coordy: "37.5547",
    cctvurl: "https://cctvsec.ktict.co.kr/token-a/live.m3u8?sig=old",
    cctvformat: "HLS",
  }] } });
  const rotated = normalizeItsPayload({ response: { data: [{
    cctvname: "서울역",
    coordx: "126.9707",
    coordy: "37.5547",
    cctvurl: "https://cctvsec.ktict.co.kr/token-b/live.m3u8?sig=new",
    cctvformat: "HLS",
  }] } });

  assert.equal(first.cameras[0].id, rotated.cameras[0].id);
  assert.notEqual(first.cameras[0].mediaUrl, rotated.cameras[0].mediaUrl);
});

test("normalizeMediaUrl accepts HTTPS and rejects unsafe values", () => {
  assert.deepEqual(normalizeMediaUrl("https://cctvsec.ktict.co.kr/live.m3u8"), {
    url: "https://cctvsec.ktict.co.kr/live.m3u8",
    host: "cctvsec.ktict.co.kr",
  });
  assert.equal(normalizeMediaUrl("http://cctvsec.ktict.co.kr/live.m3u8"), null);
  assert.equal(normalizeMediaUrl("https://media.example/live.m3u8"), null);
  assert.equal(normalizeMediaUrl("not a url"), null);
});
