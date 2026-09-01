import assert from "node:assert/strict";
import test from "node:test";

import { findLatestKmaTimestamp, isPng, readPngDimensions } from "../weather-core.js";

test("findLatestKmaTimestamp returns the newest observation", () => {
  assert.equal(findLatestKmaTimestamp('{"list":["202609010800","202609010812","202609010810"]}'), "202609010812");
  assert.equal(findLatestKmaTimestamp("no timestamps"), null);
});

test("PNG helpers validate the signature and dimensions", () => {
  const png = Buffer.alloc(24);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  png.writeUInt32BE(900, 16);
  png.writeUInt32BE(922, 20);
  assert.equal(isPng(png), true);
  assert.deepEqual(readPngDimensions(png), { width: 900, height: 922 });
  assert.equal(readPngDimensions(Buffer.from("not png")), null);
});
