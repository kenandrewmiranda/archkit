#!/usr/bin/env node

/**
 * Tests for verify-wiring fix #18 — silent 0-files-found should warn loudly.
 *
 * Bug: verify-wiring scans only .ts/.tsx/.js/.mjs. In a Python (or other
 * non-JS) project, it returns {files:0, exports:0, unwired:[]} silently —
 * looks like a passing check, but tool didn't actually scan anything.
 *
 * Fix: when 0 files found, emit stderr warning explaining supported types
 * and add a `warning` field to the JSON output so agents can detect it.
 */

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
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

function tryRun(args, opts = {}) {
  try {
    return { ok: true, stdout: execFileSync("node", [ARCHKIT, ...args], {
      encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"], ...opts,
    }), stderr: "" };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || "",
      code: err.status,
    };
  }
}

function withProject(setup, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-verify-"));
  try { setup(dir); fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function makeArchProject(dir) {
  fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "## App: test\n## Rules\n- R1\n");
  fs.writeFileSync(path.join(dir, ".arch", "INDEX.md"), "");
}

console.log("\n\x1b[1m=== Verify-Wiring Fix #18 Tests ===\x1b[0m\n");

test("Python-only project: warns about 0 files found", () => {
  withProject(
    (dir) => {
      makeArchProject(dir);
      // Create a Python project structure
      fs.mkdirSync(path.join(dir, "bot", "streams"), { recursive: true });
      fs.mkdirSync(path.join(dir, "bot", "domain"), { recursive: true });
      fs.writeFileSync(path.join(dir, "bot", "streams", "kalshi.py"), "def fetch(): pass\n");
      fs.writeFileSync(path.join(dir, "bot", "domain", "trades.py"), "class Trade: pass\n");
    },
    (dir) => {
      const r = tryRun(["resolve", "verify-wiring", "bot", "--pretty"], { cwd: dir });
      // Should warn on stderr regardless of exit code
      const combined = r.stdout + r.stderr;
      assert.ok(
        combined.toLowerCase().includes("0 files") ||
        combined.toLowerCase().includes("no source files") ||
        combined.toLowerCase().includes("supported"),
        `expected warning about 0 files / supported types, got stdout=${r.stdout} stderr=${r.stderr}`
      );
    }
  );
});

test("Python-only project: JSON output includes warning field", () => {
  withProject(
    (dir) => {
      makeArchProject(dir);
      fs.mkdirSync(path.join(dir, "bot"), { recursive: true });
      fs.writeFileSync(path.join(dir, "bot", "main.py"), "def main(): pass\n");
    },
    (dir) => {
      const r = tryRun(["resolve", "verify-wiring", "bot", "--pretty"], { cwd: dir });
      // Find the JSON object in stdout (resolve uses output() which prints JSON)
      const stdout = r.stdout || "";
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        assert.equal(json.files, 0, "should report 0 files");
        assert.ok(json.warning, `JSON should include 'warning' field, got: ${JSON.stringify(json)}`);
      } else {
        assert.fail(`no JSON in stdout: ${stdout}`);
      }
    }
  );
});

test("JS project: still works, no warning when files found", () => {
  withProject(
    (dir) => {
      makeArchProject(dir);
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src", "index.js"), "export const x = 1;\n");
      fs.writeFileSync(path.join(dir, "src", "lib.js"), "export function y() {}\n");
    },
    (dir) => {
      const r = tryRun(["resolve", "verify-wiring", "src", "--pretty"], { cwd: dir });
      const stdout = r.stdout || "";
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      assert.ok(jsonMatch, `expected JSON, got: ${stdout}`);
      const json = JSON.parse(jsonMatch[0]);
      assert.ok(json.files >= 1, `should find at least 1 JS file, got ${json.files}`);
      assert.ok(!json.warning, `should not include warning when files found, got: ${JSON.stringify(json.warning)}`);
    }
  );
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
