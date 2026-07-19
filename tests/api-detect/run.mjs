#!/usr/bin/env node
// Tests for src/lib/api-detect.mjs — heuristic external-API-involvement detector.
// Covers each evidence class (sdk-import / external-url / declared), the
// internal-host + relative-import exclusions, and the never-throws contract.

import { strict as assert } from "node:assert";
import { detectApis } from "../../src/lib/api-detect.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

const has = (arr, api, evidence) =>
  arr.some((e) => e.api === api && e.evidence === evidence);

console.log("\n  api-detect — detectApis");

test("known SDK import flagged as sdk-import", () => {
  const out = detectApis({
    filePath: "src/pay.mjs",
    content: `import Stripe from "stripe";\nconst s = new Stripe(key);`,
  });
  assert.ok(has(out, "stripe", "sdk-import"), JSON.stringify(out));
});

test("scoped SDK import keeps @scope/name", () => {
  const out = detectApis({
    filePath: "src/s3.mjs",
    content: `import { S3Client } from "@aws-sdk/client-s3";`,
  });
  assert.ok(has(out, "@aws-sdk/client-s3", "sdk-import"), JSON.stringify(out));
});

test("require() SDK import flagged as sdk-import", () => {
  const out = detectApis({
    filePath: "src/x.cjs",
    content: `const OpenAI = require("openai");`,
  });
  assert.ok(has(out, "openai", "sdk-import"), JSON.stringify(out));
});

test("external base-URL flagged as external-url", () => {
  const out = detectApis({
    filePath: "src/x.mjs",
    content: `const BASE = "https://api.stripe.com/v1";`,
  });
  assert.ok(has(out, "api.stripe.com", "external-url"), JSON.stringify(out));
});

test("external fetch(host) flagged as external-url", () => {
  const out = detectApis({
    filePath: "src/x.mjs",
    content: `await fetch("https://api.github.com/user");`,
  });
  assert.ok(has(out, "api.github.com", "external-url"), JSON.stringify(out));
});

test("localhost URL is NOT flagged", () => {
  const out = detectApis({
    filePath: "src/x.mjs",
    content: `await fetch("http://localhost:3000/api");\nconst u = "http://127.0.0.1:8080/x";`,
  });
  assert.equal(out.length, 0, JSON.stringify(out));
});

test("::1 / 0.0.0.0 internal hosts NOT flagged", () => {
  const out = detectApis({
    filePath: "src/x.mjs",
    content: `const a = "http://[::1]:9000/x";\nconst b = "http://0.0.0.0:5000/y";`,
  });
  assert.equal(out.length, 0, JSON.stringify(out));
});

test("relative import + node builtin NOT flagged", () => {
  const out = detectApis({
    filePath: "src/x.mjs",
    content: `import { foo } from "./util.mjs";\nimport bar from "../lib/bar.mjs";\nimport fs from "node:fs";\nimport path from "path";`,
  });
  assert.equal(out.length, 0, JSON.stringify(out));
});

test("declared api surfaced as evidence 'declared'", () => {
  const out = detectApis({
    filePath: "src/x.mjs",
    content: `const noop = 1;`,
    declaredApis: ["stripe", "sendgrid"],
  });
  assert.ok(has(out, "stripe", "declared"), JSON.stringify(out));
  assert.ok(has(out, "sendgrid", "declared"), JSON.stringify(out));
});

test("custom internalHosts allowlist suppresses a host", () => {
  const out = detectApis({
    filePath: "src/x.mjs",
    content: `const u = "https://api.internal.corp/v1";`,
    internalHosts: ["api.internal.corp"],
  });
  assert.equal(out.length, 0, JSON.stringify(out));
});

test("dedup: same host from URL + fetch appears once", () => {
  const out = detectApis({
    filePath: "src/x.mjs",
    content: `const B = "https://api.stripe.com/v1";\nawait fetch("https://api.stripe.com/charges");`,
  });
  const hits = out.filter((e) => e.api === "api.stripe.com" && e.evidence === "external-url");
  assert.equal(hits.length, 1, JSON.stringify(out));
});

test("declared entries ordered before scan results", () => {
  const out = detectApis({
    filePath: "src/pay.mjs",
    content: `import Stripe from "stripe";`,
    declaredApis: ["billing-api"],
  });
  assert.equal(out[0].evidence, "declared", JSON.stringify(out));
});

console.log("\n  api-detect — never-throws / best-effort");

test("empty content returns []", () => {
  assert.deepEqual(detectApis({ filePath: "x.mjs", content: "" }), []);
});

test("no args at all returns [] (no throw)", () => {
  assert.deepEqual(detectApis(), []);
});

test("garbage / binary-ish content tolerated (no throw)", () => {
  const junk = "\x00\x01\x02￿import \x00 from ((( `unterminated";
  let out;
  assert.doesNotThrow(() => { out = detectApis({ filePath: "x.bin", content: junk }); });
  assert.ok(Array.isArray(out), JSON.stringify(out));
});

test("non-string content tolerated (no throw)", () => {
  let out;
  assert.doesNotThrow(() => {
    out = detectApis({ filePath: "x.mjs", content: { not: "a string" } });
  });
  assert.ok(Array.isArray(out));
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
