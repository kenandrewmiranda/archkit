#!/usr/bin/env node

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

function withMinArchProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-dep-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "## App: t\n## Rules\n- R\n");
    fs.writeFileSync(path.join(dir, ".arch", "INDEX.md"), "");
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n\x1b[1m=== Deprecation Warnings ===\x1b[0m\n");

test("plan command prints DEPRECATED to stderr", () => {
  withMinArchProject((dir) => {
    const r = spawnSync("node", [ARCHKIT, "resolve", "plan", "test prompt", "--pretty"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    assert.ok(r.stderr.includes("DEPRECATED"), `expected DEPRECATED in stderr, got: ${r.stderr}`);
    assert.ok(r.stderr.includes("plan"), "should mention plan command");
  });
});

test("context command prints DEPRECATED to stderr", () => {
  withMinArchProject((dir) => {
    const r = spawnSync("node", [ARCHKIT, "resolve", "context", "test prompt", "--pretty"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    assert.ok(r.stderr.includes("DEPRECATED"), `expected DEPRECATED in stderr, got: ${r.stderr}`);
    assert.ok(r.stderr.includes("context"), "should mention context command");
  });
});

test("--no-deprecation-warning suppresses warning on plan", () => {
  withMinArchProject((dir) => {
    const r = spawnSync("node", [ARCHKIT, "resolve", "plan", "test prompt", "--pretty", "--no-deprecation-warning"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    assert.ok(!r.stderr.includes("DEPRECATED"), `should NOT have DEPRECATED in stderr, got: ${r.stderr}`);
  });
});

test("plan still produces JSON output (functional behavior unchanged)", () => {
  withMinArchProject((dir) => {
    const r = spawnSync("node", [ARCHKIT, "resolve", "plan", "test prompt", "--pretty"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    const stdout = r.stdout || "";
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    assert.ok(jsonMatch, "should still produce JSON output");
    const json = JSON.parse(jsonMatch[0]);
    assert.ok(json.prompt || json.steps || json.type, "should have plan-shape data");
  });
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
