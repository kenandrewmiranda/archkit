import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isApiCleared,
  registerApi,
  overrideApi,
  listApis,
  readApiGateConfig,
  apisPath,
} from "../../src/lib/api-registry.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// Each test gets a throwaway archDir under the OS temp dir so we never touch the
// real .arch. Returns the path; caller is responsible for nothing (temp evicts).
function tmpArch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "archkit-api-registry-"));
}

// ── Clearance ────────────────────────────────────────────────────────────────

console.log("\nClearance");

test("unregistered id is NOT cleared (blocking)", () => {
  const archDir = tmpArch();
  assert.equal(isApiCleared(archDir, "stripe.charges.create"), false);
});

test("doc-referenced api IS cleared", () => {
  const archDir = tmpArch();
  registerApi(archDir, { id: "stripe.charges.create", kind: "doc", ref: "https://stripe.com/docs" });
  assert.equal(isApiCleared(archDir, "stripe.charges.create"), true);
});

test("sdk-referenced api IS cleared", () => {
  const archDir = tmpArch();
  registerApi(archDir, { id: "aws.s3.putObject", kind: "sdk", ref: "@aws-sdk/client-s3" });
  assert.equal(isApiCleared(archDir, "aws.s3.putObject"), true);
});

test("referenced api WITHOUT a ref is NOT cleared", () => {
  const archDir = tmpArch();
  // A doc/sdk kind must actually carry a reference to clear.
  registerApi(archDir, { id: "foo.bar", kind: "doc", ref: null });
  assert.equal(isApiCleared(archDir, "foo.bar"), false);
});

test("override IS cleared even with no ref", () => {
  const archDir = tmpArch();
  overrideApi(archDir, { id: "legacy.internal.thing", reason: "vendored, no public docs" });
  assert.equal(isApiCleared(archDir, "legacy.internal.thing"), true);
});

test("empty / blank apiId is NOT cleared", () => {
  const archDir = tmpArch();
  assert.equal(isApiCleared(archDir, ""), false);
  assert.equal(isApiCleared(archDir, "   "), false);
});

// ── Manifest tolerance ───────────────────────────────────────────────────────

console.log("\nManifest tolerance");

test("missing manifest is tolerated (empty list, not cleared)", () => {
  const archDir = tmpArch();
  assert.deepEqual(listApis(archDir), []);
  assert.equal(isApiCleared(archDir, "anything"), false);
});

test("empty manifest file is tolerated", () => {
  const archDir = tmpArch();
  fs.writeFileSync(apisPath(archDir), "");
  assert.deepEqual(listApis(archDir), []);
  assert.equal(isApiCleared(archDir, "anything"), false);
});

test("corrupt manifest is tolerated (never throws)", () => {
  const archDir = tmpArch();
  fs.writeFileSync(apisPath(archDir), "{ this is not valid json ]]]");
  assert.deepEqual(listApis(archDir), []);
  assert.equal(isApiCleared(archDir, "anything"), false);
});

test("non-array/object manifest degrades to empty", () => {
  const archDir = tmpArch();
  fs.writeFileSync(apisPath(archDir), "42");
  assert.deepEqual(listApis(archDir), []);
});

test("{ apis: [...] } envelope shape is accepted", () => {
  const archDir = tmpArch();
  fs.writeFileSync(
    apisPath(archDir),
    JSON.stringify({ apis: [{ id: "x.y", kind: "doc", ref: "http://d", status: "referenced" }] }),
  );
  assert.equal(isApiCleared(archDir, "x.y"), true);
});

// ── Mutators / persistence ───────────────────────────────────────────────────

console.log("\nMutators");

test("registerApi persists an entry with the expected shape", () => {
  const archDir = tmpArch();
  const entry = registerApi(archDir, { id: "svc.op", kind: "doc", ref: "http://d" });
  assert.equal(entry.id, "svc.op");
  assert.equal(entry.kind, "doc");
  assert.equal(entry.status, "referenced");
  assert.ok(entry.addedAt, "addedAt is set");
  const [reread] = listApis(archDir);
  assert.equal(reread.id, "svc.op");
  assert.equal(reread.ref, "http://d");
});

test("registerApi without id throws (bad args)", () => {
  const archDir = tmpArch();
  assert.throws(() => registerApi(archDir, { kind: "doc" }), /id/);
});

test("overrideApi requires a non-empty reason", () => {
  const archDir = tmpArch();
  assert.throws(() => overrideApi(archDir, { id: "a.b" }), /reason/);
  assert.throws(() => overrideApi(archDir, { id: "a.b", reason: "  " }), /reason/);
});

test("upsert is idempotent on id (last write wins, no dupes)", () => {
  const archDir = tmpArch();
  registerApi(archDir, { id: "svc.op", kind: "doc", ref: "http://old" });
  registerApi(archDir, { id: "svc.op", kind: "sdk", ref: "pkg-new" });
  const entries = listApis(archDir);
  assert.equal(entries.length, 1, "one entry, not two");
  assert.equal(entries[0].kind, "sdk");
  assert.equal(entries[0].ref, "pkg-new");
});

test("override supersedes an earlier reference on the same id", () => {
  const archDir = tmpArch();
  registerApi(archDir, { id: "svc.op", kind: "doc", ref: null }); // not cleared alone
  assert.equal(isApiCleared(archDir, "svc.op"), false);
  overrideApi(archDir, { id: "svc.op", reason: "internal shim, no docs" });
  assert.equal(isApiCleared(archDir, "svc.op"), true);
});

// ── Gate config ──────────────────────────────────────────────────────────────

console.log("\nGate config");

test("readApiGateConfig returns defaults when config is missing", () => {
  const archDir = tmpArch();
  const cfg = readApiGateConfig(archDir);
  assert.equal(cfg.enabled, true);
  assert.ok(cfg.internalHosts.includes("localhost"));
  assert.ok(cfg.internalHosts.includes("127.0.0.1"));
  assert.ok(cfg.internalHosts.includes("::1"));
});

test("readApiGateConfig is tolerant of corrupt config", () => {
  const archDir = tmpArch();
  fs.writeFileSync(path.join(archDir, "config.json"), "not json");
  const cfg = readApiGateConfig(archDir);
  assert.equal(cfg.enabled, true);
  assert.ok(cfg.internalHosts.includes("localhost"));
});

test("readApiGateConfig honors an explicit apiGate section", () => {
  const archDir = tmpArch();
  fs.writeFileSync(
    path.join(archDir, "config.json"),
    JSON.stringify({ apiGate: { enabled: false, internalHosts: ["internal.example.com"] } }),
  );
  const cfg = readApiGateConfig(archDir);
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.internalHosts, ["internal.example.com"]);
});

test("readApiGateConfig fills defaults for a partial apiGate section", () => {
  const archDir = tmpArch();
  fs.writeFileSync(path.join(archDir, "config.json"), JSON.stringify({ apiGate: { enabled: false } }));
  const cfg = readApiGateConfig(archDir);
  assert.equal(cfg.enabled, false);
  assert.ok(cfg.internalHosts.includes("localhost"), "internalHosts falls back to defaults");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
