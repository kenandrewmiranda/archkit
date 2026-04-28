#!/usr/bin/env node

/**
 * Tests for drift fix #17 — multi-file basePath should not produce false positives.
 *
 * Bug: INDEX.md entries like `@kalshi = [streams] → bot/streams/a.py, bot/streams/b.py`
 * were stored as a single basePath string, causing fs.existsSync() to always fail
 * even when both files existed.
 *
 * Fix: split basePath on comma, check each file individually, emit per-file findings.
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
    }) };
  } catch (err) {
    return { ok: false, stdout: err.stdout?.toString() || "", code: err.status };
  }
}

function withProject(setup, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-drift-"));
  try { setup(dir); fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function makeArchProject(dir, indexContent, srcFiles) {
  fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "## App: test\n## Rules\n- R1\n");
  fs.writeFileSync(path.join(dir, ".arch", "INDEX.md"), indexContent);
  // Create cluster graph file so it's not orphaned
  fs.writeFileSync(path.join(dir, ".arch", "clusters", "streams.graph"), "[streams] : data sources\n");
  // Create requested source files
  for (const file of srcFiles) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "# placeholder\n");
  }
}

console.log("\n\x1b[1m=== Drift Fix #17 Tests ===\x1b[0m\n");

test("multi-file node with all files present produces no missing-source findings", () => {
  withProject(
    (dir) => makeArchProject(dir,
      `## Nodes
@kalshi = [streams] → bot/streams/kalshi_rest.py, bot/streams/kalshi_ws.py
`,
      ["bot/streams/kalshi_rest.py", "bot/streams/kalshi_ws.py"]
    ),
    (dir) => {
      const r = tryRun(["drift", "--json"], { cwd: dir });
      const result = JSON.parse(r.stdout);
      const missingFindings = result.stale.filter(f =>
        f.type === "missing-source" || f.type === "missing-file"
      );
      assert.equal(missingFindings.length, 0,
        `expected no missing findings, got: ${JSON.stringify(missingFindings)}`);
    }
  );
});

test("multi-file node with one file missing produces exactly one missing-file finding", () => {
  withProject(
    (dir) => makeArchProject(dir,
      `## Nodes
@kalshi = [streams] → bot/streams/kalshi_rest.py, bot/streams/kalshi_ws.py
`,
      ["bot/streams/kalshi_rest.py"]  // kalshi_ws.py missing
    ),
    (dir) => {
      const r = tryRun(["drift", "--json"], { cwd: dir });
      const result = JSON.parse(r.stdout);
      const missingFindings = result.stale.filter(f =>
        f.type === "missing-source" || f.type === "missing-file"
      );
      assert.equal(missingFindings.length, 1,
        `expected 1 missing finding, got ${missingFindings.length}: ${JSON.stringify(missingFindings)}`);
      assert.ok(missingFindings[0].detail.includes("kalshi_ws.py"),
        `finding should mention kalshi_ws.py, got: ${missingFindings[0].detail}`);
    }
  );
});

test("multi-file node with all files missing produces N missing-file findings", () => {
  withProject(
    (dir) => makeArchProject(dir,
      `## Nodes
@odds = [streams] → bot/sources/odds_api.py, bot/sources/espn.py, bot/sources/draftkings.py
`,
      []  // all missing
    ),
    (dir) => {
      const r = tryRun(["drift", "--json"], { cwd: dir });
      const result = JSON.parse(r.stdout);
      const missingFindings = result.stale.filter(f =>
        f.type === "missing-source" || f.type === "missing-file"
      );
      assert.equal(missingFindings.length, 3,
        `expected 3 missing findings, got ${missingFindings.length}: ${JSON.stringify(missingFindings)}`);
    }
  );
});

test("single-file node still works (regression check)", () => {
  withProject(
    (dir) => makeArchProject(dir,
      `## Nodes
@auth = [streams] → bot/auth/login.py
`,
      []  // missing
    ),
    (dir) => {
      const r = tryRun(["drift", "--json"], { cwd: dir });
      const result = JSON.parse(r.stdout);
      const missingFindings = result.stale.filter(f =>
        f.type === "missing-source" || f.type === "missing-file"
      );
      assert.equal(missingFindings.length, 1,
        `expected 1 finding for missing single file`);
    }
  );
});

test("directory-style basePath (trailing slash) still works", () => {
  withProject(
    (dir) => makeArchProject(dir,
      `## Nodes
@features = [streams] → src/features/
`,
      []  // src/features/ doesn't exist
    ),
    (dir) => {
      const r = tryRun(["drift", "--json"], { cwd: dir });
      const result = JSON.parse(r.stdout);
      const missingFindings = result.stale.filter(f =>
        f.type === "missing-source" || f.type === "missing-file"
      );
      assert.equal(missingFindings.length, 1, "missing directory should produce 1 finding");
    }
  );
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
