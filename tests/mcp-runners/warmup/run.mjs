#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWarmupJson } from "../../../src/commands/resolve/warmup.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-warmup-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## Rules\n- Rule 1\n\n## Reserved Words\n$tenant = scoped to current org\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "test → @test\n");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n");
  return path.join(tmp, ".arch");
}

await test("runWarmupJson returns pass/blockers/warnings/actions/checks", async () => {
  const arch = makeFixture();
  const result = await runWarmupJson({ archDir: arch, deep: false });
  assert.equal(typeof result.pass, "boolean");
  assert.ok(Array.isArray(result.blockers));
  assert.ok(Array.isArray(result.warnings));
  assert.ok(Array.isArray(result.actions));
  assert.ok(Array.isArray(result.checks));
  fs.rmSync(path.dirname(arch), { recursive: true, force: true });
});

await test("runWarmupJson surfaces instruction and marketplace fields for MCP agents", async () => {
  const arch = makeFixture();
  const result = await runWarmupJson({ archDir: arch, deep: false });
  assert.equal(typeof result.instruction, "string", "instruction must be present so MCP agents know whether to proceed with codegen");
  assert.ok(result.instruction.length > 0);
  assert.equal(typeof result.marketplace, "object");
  assert.ok(result.marketplace !== null);
  assert.equal(typeof result.timestamp, "string");
  assert.equal(typeof result.summary, "object");
  fs.rmSync(path.dirname(arch), { recursive: true, force: true });
});

await test("runWarmupJson throws no_arch_dir when archDir is null", async () => {
  try { await runWarmupJson({ archDir: null }); assert.fail("expected throw"); }
  catch (err) { assert.ok(err instanceof ArchkitError); assert.equal(err.code, "no_arch_dir"); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
