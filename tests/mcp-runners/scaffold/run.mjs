#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runScaffoldJson } from "../../../src/commands/resolve/scaffold.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-scaffold-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- Layered\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "clusters", "billing.graph"),
    "[billing]\n  [invoice]\n");
  return tmp;
}

await test("runScaffoldJson returns checklist for new feature", async () => {
  const tmp = makeFixture();
  try {
    const result = await runScaffoldJson({
      archDir: path.join(tmp, ".arch"), cwd: tmp, feature: "billing",
    });
    assert.equal(typeof result, "object");
    assert.ok(result !== null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test("runScaffoldJson throws on missing feature", async () => {
  try {
    await runScaffoldJson({ archDir: "/tmp/x", feature: "" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "invalid_input");
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
