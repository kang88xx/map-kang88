import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeItsPayload } from "../cctv-core.js";
import { encryptCctvFallback } from "../server.js";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: node scripts/refresh-cctv-fallback.mjs <official-response.json>");

const payload = JSON.parse(await readFile(resolve(inputPath), "utf8"));
const normalized = normalizeItsPayload(payload);
if (!normalized.count) throw new Error("The official response did not contain safe Seoul CCTV records");
const apiKey = process.env.ITS_CCTV_API_KEY;
if (!apiKey) throw new Error("ITS_CCTV_API_KEY is required to encrypt the fallback");

const output = {
  schemaVersion: 2,
  capturedAt: new Date().toISOString(),
  source: "국토교통부 국가교통정보센터 CCTV 화상자료 Open API",
  count: normalized.count,
  encryption: encryptCctvFallback(normalized.cameras, apiKey),
};

const outputPath = resolve("data/cctv-fallback.json");
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, count: output.count, capturedAt: output.capturedAt })}\n`);
