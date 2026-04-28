#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { ArchkitError, archkitError } from "../../src/lib/errors.mjs";
import { toMcpResult, toMcpError, formatZodError } from "../../src/mcp/envelope.mjs";
import { z } from "zod";

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

// Envelope tests
test("toMcpResult wraps data as MCP text content", () => {
  const r = toMcpResult({ ok: true, items: [1, 2] });
  assert.deepEqual(r, { content: [{ type: "text", text: '{"ok":true,"items":[1,2]}' }] });
});

test("toMcpError on ArchkitError preserves code/message/suggestion/docsUrl", () => {
  const err = new ArchkitError("no_arch_dir", "missing", {
    suggestion: "Run init", docsUrl: "https://x.com",
  });
  const r = toMcpError(err);
  assert.equal(r.isError, true);
  const env = JSON.parse(r.content[0].text);
  assert.equal(env.code, "no_arch_dir");
  assert.equal(env.message, "missing");
  assert.equal(env.suggestion, "Run init");
  assert.equal(env.docsUrl, "https://x.com");
});

test("toMcpError on unknown Error returns internal_error envelope", () => {
  const r = toMcpError(new Error("boom"));
  assert.equal(r.isError, true);
  const env = JSON.parse(r.content[0].text);
  assert.equal(env.code, "internal_error");
  assert.equal(env.message, "boom");
  assert.equal(env.suggestion, undefined);
});

test("formatZodError produces a readable single-line summary", () => {
  const schema = z.object({ files: z.array(z.string()).min(1) });
  const result = schema.safeParse({ files: [] });
  const msg = formatZodError(result.error);
  assert.ok(msg.includes("files"), `expected message to mention 'files', got: ${msg}`);
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
