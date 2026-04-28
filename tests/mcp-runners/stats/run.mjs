#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runStatsJson } from "../../../src/commands/stats.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-stats-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(arch, "apis"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Rules\n- R\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "test → @test\n");
  fs.writeFileSync(path.join(arch, "skills", "postgres.skill"),
    "## Meta\npackage: postgres\nversion: 15\n## Use\nU\n## Gotchas\nWRONG: x\nRIGHT: y\nWHY: z\n");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n  [login]\n");
  return path.join(tmp, ".arch");
}

await test("runStatsJson returns health, system, index, skills, graphs, recommendations", async () => {
  const arch = makeFixture();
  try {
    const result = await runStatsJson({ archDir: arch });
    assert.equal(typeof result.health, "object");
    assert.equal(typeof result.health.pct, "number");
    assert.ok(Array.isArray(result.health.checks));
    assert.equal(result.system.exists, true);
    assert.ok(Array.isArray(result.skills));
    assert.ok(Array.isArray(result.graphs));
    assert.ok(Array.isArray(result.recommendations));
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("runStatsJson throws no_arch_dir when archDir missing", async () => {
  try { await runStatsJson({ archDir: null }); assert.fail("expected throw"); }
  catch (err) { assert.ok(err instanceof ArchkitError); assert.equal(err.code, "no_arch_dir"); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
