#!/usr/bin/env node
// Suite for the API-doc gate command layer (src/commands/api.mjs). The handlers
// are thin delegations to src/lib/api-registry.mjs; these tests assert that they
// (a) record the right clearance status via the lib, (b) bucket the manifest
// correctly on list, and (c) raise STRUCTURED errors (ArchkitError) — never a
// raw throw — when required arguments are missing.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runApiRegister, runApiOverride, runApiList } from "../../src/commands/api.mjs";
import { listApis } from "../../src/lib/api-registry.mjs";

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
// real .arch. The lib writes the manifest (apis.json) directly under archDir.
function tmpArch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "archkit-api-tools-"));
}

// A structured error is an ArchkitError carrying a code + suggestion, so the MCP
// layer can map it to a proper error envelope rather than a raw stack.
function assertStructured(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.name, "ArchkitError", `expected ArchkitError, got ${err.name}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    assert.ok(typeof err.suggestion === "string" && err.suggestion.length > 0, "structured error must carry a suggestion");
    return true;
  });
}

// ── register ─────────────────────────────────────────────────────────────────

console.log("\narchkit_api_register");

test("register records a referenced doc entry and clears the gate", () => {
  const archDir = tmpArch();
  const res = runApiRegister({ archDir, id: "stripe.charges.create", ref: "https://stripe.com/docs/api" });
  assert.equal(res.status, "referenced");
  assert.equal(res.kind, "doc");
  assert.equal(res.ref, "https://stripe.com/docs/api");
  assert.ok(typeof res.nextStep === "string" && res.nextStep.length > 0, "must carry a nextStep");
  // Delegation proof: the manifest the lib owns actually got the entry.
  const entries = listApis(archDir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "stripe.charges.create");
  assert.equal(entries[0].status, "referenced");
});

test("register honors kind:sdk", () => {
  const archDir = tmpArch();
  const res = runApiRegister({ archDir, id: "aws.s3.putObject", kind: "sdk", ref: "@aws-sdk/client-s3" });
  assert.equal(res.kind, "sdk");
  assert.equal(res.status, "referenced");
});

test("register raises a STRUCTURED error when id is missing", () => {
  const archDir = tmpArch();
  assertStructured(() => runApiRegister({ archDir, ref: "https://example.com" }), "invalid_input");
});

test("register raises a STRUCTURED error when ref is missing", () => {
  const archDir = tmpArch();
  assertStructured(() => runApiRegister({ archDir, id: "stripe.charges.create" }), "invalid_input");
});

// ── override ─────────────────────────────────────────────────────────────────

console.log("\narchkit_api_override");

test("override records an audit-stamped override with the reason", () => {
  const archDir = tmpArch();
  const res = runApiOverride({ archDir, id: "legacy.internal.thing", reason: "vendored, no public docs" });
  assert.equal(res.status, "override");
  assert.equal(res.reason, "vendored, no public docs");
  assert.ok(typeof res.addedAt === "string" && res.addedAt.length > 0, "override must be timestamp-stamped");
  assert.ok(typeof res.nextStep === "string" && res.nextStep.length > 0);
  const entries = listApis(archDir);
  assert.equal(entries[0].status, "override");
  assert.equal(entries[0].reason, "vendored, no public docs");
});

test("override raises a STRUCTURED error when reason is missing", () => {
  const archDir = tmpArch();
  assertStructured(() => runApiOverride({ archDir, id: "legacy.internal.thing" }), "invalid_input");
});

test("override raises a STRUCTURED error when id is missing", () => {
  const archDir = tmpArch();
  assertStructured(() => runApiOverride({ archDir, reason: "no docs" }), "invalid_input");
});

// ── list ─────────────────────────────────────────────────────────────────────

console.log("\narchkit_api_list");

test("list buckets referenced / overridden / pending correctly", () => {
  const archDir = tmpArch();
  runApiRegister({ archDir, id: "stripe.charges.create", ref: "https://stripe.com/docs" });
  runApiOverride({ archDir, id: "legacy.internal.thing", reason: "vendored" });
  // Hand-write a `pending` entry (a status the mutators never produce) straight
  // into the manifest to prove list buckets it as still-gated.
  const apisFile = path.join(archDir, "apis.json");
  const raw = JSON.parse(fs.readFileSync(apisFile, "utf8"));
  raw.push({
    id: "unknown.pending.api",
    kind: "doc",
    ref: null,
    reason: "",
    addedAt: new Date().toISOString(),
    status: "pending",
  });
  fs.writeFileSync(apisFile, `${JSON.stringify(raw, null, 2)}\n`);

  const res = runApiList({ archDir });
  assert.equal(res.total, 3);
  assert.deepEqual(res.referenced.map((e) => e.id), ["stripe.charges.create"]);
  assert.deepEqual(res.overridden.map((e) => e.id), ["legacy.internal.thing"]);
  assert.deepEqual(res.pending.map((e) => e.id), ["unknown.pending.api"]);
  assert.ok(res.nextStep.includes("1 referenced"), "nextStep should summarize the buckets");
});

test("list on an empty manifest returns a silent-success nextStep, not a bare empty", () => {
  const archDir = tmpArch();
  const res = runApiList({ archDir });
  assert.equal(res.total, 0);
  assert.deepEqual(res.referenced, []);
  assert.deepEqual(res.overridden, []);
  assert.deepEqual(res.pending, []);
  assert.ok(typeof res.nextStep === "string" && res.nextStep.length > 0, "empty list must still explain what to do");
});

// ── missing archDir ──────────────────────────────────────────────────────────

console.log("\nguards");

test("each handler raises a STRUCTURED error when archDir is absent", () => {
  assertStructured(() => runApiRegister({ id: "x", ref: "y" }), "no_arch_dir");
  assertStructured(() => runApiOverride({ id: "x", reason: "y" }), "no_arch_dir");
  assertStructured(() => runApiList({}), "no_arch_dir");
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
