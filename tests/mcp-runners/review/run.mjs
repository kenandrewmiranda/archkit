#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReviewJson } from "../../../src/commands/review.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-review-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Type: Internal Tool\n## Stack: Node.js\n## Pattern: Simple Layered\n\n## Rules\n- Layered\n\n## Reserved Words\n\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(tmp, "test-file.js"), "const x = 1;\nexport default x;\n");
  return tmp;
}

await test("runReviewJson returns structured findings", async () => {
  const tmp = makeFixture();
  try {
    const result = await runReviewJson({ files: ["test-file.js"], archDir: path.join(tmp, ".arch"), cwd: tmp });
    assert.equal(typeof result.files, "number");
    assert.equal(typeof result.errors, "number");
    assert.equal(typeof result.warnings, "number");
    assert.equal(typeof result.pass, "boolean");
    assert.equal(typeof result.findings, "object");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test("runReviewJson throws ArchkitError when archDir missing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-review-noarch-"));
  try {
    await runReviewJson({ files: ["whatever.js"], archDir: null, cwd: tmp });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError, `expected ArchkitError, got ${err.constructor.name}`);
    assert.equal(err.code, "no_arch_dir");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test("runReviewJson throws when file does not exist", async () => {
  const tmp = makeFixture();
  try {
    await runReviewJson({ files: ["does-not-exist.js"], archDir: path.join(tmp, ".arch"), cwd: tmp });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "file_not_found");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
