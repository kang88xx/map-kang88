import assert from "node:assert/strict";
import test from "node:test";

import { findLatestKmaTimestamp, isPng, readPngDimensions } from "../weather-core.js";

test("findLatestKmaTimestamp returns the newest root list observation", () => {
  assert.equal(findLatestKmaTimestamp({
    list: [
      "202609010800",
      { item: "202609010814" },
      { filename: "GK2A_LE1B_IR105_KO_202609010812.png" },
      { path: "/sat/GK2A_LE1B_IR105_KO_202609010810.png" },
    ],
  }), "202609010814");
  assert.equal(findLatestKmaTimestamp('{"list":["202609010800","GK2A_LE1B_IR105_KO_202609010812.png"]}'), "202609010812");
});

test("findLatestKmaTimestamp ignores arbitrary JSON and loose text", () => {
  assert.equal(findLatestKmaTimestamp('{"message":"202609010900"}'), null);
  assert.equal(findLatestKmaTimestamp("status 202609010900 ready"), null);
  assert.equal(findLatestKmaTimestamp({ list: [{ message: "202609010900" }] }), null);
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
