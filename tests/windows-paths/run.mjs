#!/usr/bin/env node
// Windows path-separator regression: review checks compare file paths against
// `/`-delimited spec conventions (features/<id>/). On Windows, path.join and the
// Edit-tool file_path surface backslash paths, which previously matched nothing
// — cross-feature / file-location findings silently never fired. The checks now
// normalize via toPosixPath at the boundary, so backslash and forward-slash
// paths must produce identical findings.

import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED = pathToFileURL(path.resolve(__dirname, "../../src/lib/shared.mjs")).href;
const IMPORTS = pathToFileURL(path.resolve(__dirname, "../../src/commands/review/import-checks.mjs")).href;
const { toPosixPath } = await import(SHARED);
const { checkImportHierarchy } = await import(IMPORTS);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

console.log("\nwindows-paths — backslash paths normalize for review checks\n");

// ─── toPosixPath unit ──────────────────────────────────────────────────────

test("toPosixPath — converts backslashes to forward slashes", () => {
  assert.equal(toPosixPath("src\\features\\auth\\auth.service.ts"), "src/features/auth/auth.service.ts");
});

test("toPosixPath — leaves forward-slash paths untouched (no-op on POSIX)", () => {
  assert.equal(toPosixPath("src/features/auth/auth.service.ts"), "src/features/auth/auth.service.ts");
});

test("toPosixPath — handles mixed separators", () => {
  assert.equal(toPosixPath("src\\features/auth\\auth.service.ts"), "src/features/auth/auth.service.ts");
});

test("toPosixPath — null / undefined / empty are safe", () => {
  assert.equal(toPosixPath(null), "");
  assert.equal(toPosixPath(undefined), "");
  assert.equal(toPosixPath(""), "");
});

// ─── checkImportHierarchy cross-feature detection ──────────────────────────

const crossFeatureCode = `import { BillingRepo } from "../billing/billing.repo";`;

test("cross-feature import fires on a forward-slash path", () => {
  const findings = checkImportHierarchy(crossFeatureCode, "src/features/auth/auth.service.ts");
  const boundary = findings.filter(f => f.type === "import-boundary");
  assert.equal(boundary.length, 1, "expected one cross-feature finding");
  assert.match(boundary[0].message, /auth → billing/);
});

test("cross-feature import fires identically on a BACKSLASH (Windows) path", () => {
  const findings = checkImportHierarchy(crossFeatureCode, "src\\features\\auth\\auth.service.ts");
  const boundary = findings.filter(f => f.type === "import-boundary");
  assert.equal(boundary.length, 1, "Windows path must produce the same finding as POSIX");
  assert.match(boundary[0].message, /auth → billing/);
});

test("forward-slash and backslash paths yield identical findings", () => {
  const fwd = checkImportHierarchy(crossFeatureCode, "src/features/auth/auth.service.ts");
  const bck = checkImportHierarchy(crossFeatureCode, "src\\features\\auth\\auth.service.ts");
  assert.deepEqual(bck, fwd);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
