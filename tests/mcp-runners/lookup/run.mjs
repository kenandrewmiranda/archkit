#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runLookupJson } from "../../../src/commands/resolve.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-lookup-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- R\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"),
    "[auth]\n  [login] : signs user in\n");
  fs.writeFileSync(path.join(arch, "skills", "postgres.skill"),
    "## Meta\npackage: postgres\n## Use\nUsed for storage.\n");
  return path.join(tmp, ".arch");
}

await test("runLookupJson finds a node by id", async () => {
  const arch = makeFixture();
  try {
    const result = await runLookupJson({ archDir: arch, id: "login" });
    assert.equal(typeof result, "object");
    assert.ok(result !== null);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("runLookupJson throws node_not_found for unknown id", async () => {
  const arch = makeFixture();
  try {
    await runLookupJson({ archDir: arch, id: "nonexistent-xyz" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "node_not_found");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
