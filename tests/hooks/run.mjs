#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

function withGitDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-hooks-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  const orig = process.cwd();
  try { process.chdir(dir); fn(dir); }
  finally { process.chdir(orig); fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\narchkit init --install-hooks\n");

test("--install-hooks creates pre-commit hook", () => {
  withGitDir((dir) => {
    const out = execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--json"], {
      cwd: dir,
      encoding: "utf8",
    });
    const result = JSON.parse(out.trim());
    assert.equal(result.status, "installed", `Expected status=installed, got: ${JSON.stringify(result)}`);

    const hookPath = path.join(dir, ".git", "hooks", "pre-commit");
    assert.ok(fs.existsSync(hookPath), "pre-commit hook file should exist");

    const content = fs.readFileSync(hookPath, "utf8");
    assert.ok(content.includes("archkit drift"), "hook should contain 'archkit drift'");

    const mode = fs.statSync(hookPath).mode;
    assert.ok((mode & 0o111) !== 0, "hook file should be executable");
  });
});

test("--install-hooks with existing hook returns existing-hook status", () => {
  withGitDir((dir) => {
    const hooksDir = path.join(dir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, "pre-commit");
    const originalContent = "#!/bin/sh\n# existing hook\nexit 0\n";
    fs.writeFileSync(hookPath, originalContent);

    const out = execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--json"], {
      cwd: dir,
      encoding: "utf8",
    });
    const result = JSON.parse(out.trim());
    assert.equal(result.status, "existing-hook", `Expected status=existing-hook, got: ${JSON.stringify(result)}`);
    assert.ok(result.suggested_append, "should include suggested_append");

    const content = fs.readFileSync(hookPath, "utf8");
    assert.equal(content, originalContent, "original hook content should be unchanged");
  });
});

test("--install-hooks in non-git dir errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-nongit-"));
  const orig = process.cwd();
  try {
    process.chdir(dir);
    let threw = false;
    let stdout = "";
    try {
      stdout = execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--json"], {
        cwd: dir,
        encoding: "utf8",
      });
    } catch (err) {
      threw = true;
      stdout = err.stdout || "";
    }
    assert.ok(threw, "should have thrown (non-zero exit)");
    assert.ok(stdout.includes("not_a_git_repo"), `stdout should contain 'not_a_git_repo', got: ${stdout}`);
  } finally {
    process.chdir(orig);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
