#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDriftJson } from "../../../src/commands/drift.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-drift-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- R\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "skills", "stale.skill"), "## Meta\npackage: nonexistent-zzz-pkg\n");
  return path.join(tmp, ".arch");
}

await test("runDriftJson returns stale array and summary", async () => {
  const arch = makeFixture();
  try {
    const result = await runDriftJson({ archDir: arch, cwd: path.dirname(arch) });
    assert.ok(Array.isArray(result.stale));
    assert.equal(typeof result.summary, "object");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("runDriftJson throws no_arch_dir when archDir missing", async () => {
  try { await runDriftJson({ archDir: null }); assert.fail("expected throw"); }
  catch (err) { assert.ok(err instanceof ArchkitError); assert.equal(err.code, "no_arch_dir"); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
