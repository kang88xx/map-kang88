import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("place search lets the app show its short-query error", () => {
  // Regression: ISSUE-001 — native minlength blocked the app's Korean error message.
  // Found by /qa on 2026-09-01.
  // Report: .gstack/qa-reports/qa-report-localhost-2026-09-01.md
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const input = html.match(/<input[\s\S]*?id="placeInput"[\s\S]*?>/)?.[0] ?? "";

  assert.equal(input.includes("minlength="), false);
});
