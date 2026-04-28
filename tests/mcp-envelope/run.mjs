#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { ArchkitError, archkitError } from "../../src/lib/errors.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

test("ArchkitError carries code, message, suggestion, docsUrl", () => {
  const e = new ArchkitError("no_arch_dir", "missing", {
    suggestion: "Run archkit init", docsUrl: "https://example.com",
  });
  assert.equal(e.code, "no_arch_dir");
  assert.equal(e.message, "missing");
  assert.equal(e.suggestion, "Run archkit init");
  assert.equal(e.docsUrl, "https://example.com");
  assert.equal(e.name, "ArchkitError");
  assert.ok(e instanceof Error);
});

test("ArchkitError without optional fields leaves them undefined", () => {
  const e = new ArchkitError("internal_error", "boom");
  assert.equal(e.suggestion, undefined);
  assert.equal(e.docsUrl, undefined);
});

test("archkitError factory returns an ArchkitError instance", () => {
  const e = archkitError("invalid_input", "bad", { suggestion: "fix it" });
  assert.ok(e instanceof ArchkitError);
  assert.equal(e.code, "invalid_input");
  assert.equal(e.suggestion, "fix it");
});

test("ArchkitError preserves cause", () => {
  const cause = new Error("inner");
  const e = new ArchkitError("internal_error", "wrap", { cause });
  assert.equal(e.cause, cause);
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
