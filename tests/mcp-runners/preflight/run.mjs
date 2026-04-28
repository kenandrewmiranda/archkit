#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPreflightJson } from "../../../src/commands/resolve/preflight.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-preflight-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- Layered\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"),
    "[auth] : authentication cluster\n  [login] : user → session\n");
  return tmp;
}

await test("runPreflightJson returns structured data for known feature", async () => {
  const tmp = makeFixture();
  try {
    const result = await runPreflightJson({
      archDir: path.join(tmp, ".arch"),
      cwd: tmp,
      feature: "auth",
      layer: "controller",
    });
    assert.equal(typeof result, "object");
    assert.ok(result !== null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test("runPreflightJson throws no_arch_dir without archDir", async () => {
  try {
    await runPreflightJson({ archDir: null, feature: "x", layer: "y" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "no_arch_dir");
  }
});

await test("runPreflightJson throws on missing feature", async () => {
  try {
    await runPreflightJson({ archDir: "/tmp/x", feature: "", layer: "controller" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "invalid_input");
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
