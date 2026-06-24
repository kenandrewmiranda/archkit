#!/usr/bin/env node

/**
 * CLI dispatch test suite.
 *
 * Locks in the bin/archkit.mjs router behavior so unrecognized input never
 * silently launches the interactive wizard again:
 *   - `--version` / `--help` are handled (not treated as a scaffold).
 *   - `upgrade` (and dash-typed command forms like `--upgrade`) route to the
 *     real command instead of the wizard.
 *   - an unknown WORD errors with a did-you-mean, exit code 1.
 *
 * Usage:
 *   node tests/cli-dispatch/run.mjs
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "..", "..", "bin", "archkit.mjs");

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[90m${err.message}\x1b[0m`); failed++; failures.push(name); }
}

// Run the CLI with a hard timeout so a command that continues into network work
// (e.g. `update`) can't hang the suite — we only assert the router's own output,
// which is printed before any command body runs.
function run(args) {
  const r = spawnSync(process.execPath, [ARCHKIT, ...args], { encoding: "utf8", timeout: 8000 });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

console.log("\n  ┌─────────────────────────────────────────────┐");
console.log("  │            ARCHKIT CLI DISPATCH             │");
console.log("  └─────────────────────────────────────────────┘\n");

test("--version prints the version and exits 0", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0, `exit ${r.status}`);
  assert.match(r.stdout, /archkit v\d+\.\d+\.\d+/, r.stdout);
});

test("-v is an alias for --version", () => {
  const r = run(["-v"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /archkit v\d/);
});

test("--help prints usage and lists update (upgrade)", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, `exit ${r.status}`);
  assert.match(r.stdout, /Usage: archkit/);
  assert.match(r.stdout, /update \(upgrade\)/);
});

test("'upgrade' routes to the real 'update' command (not the wizard)", () => {
  const r = run(["upgrade", "--check"]);
  assert.match(r.stderr, /'upgrade' → running 'update'/, r.stderr);
  assert.doesNotMatch(r.stderr, /unknown command/);
});

test("dash-typed command '--upgrade' routes to 'update'", () => {
  const r = run(["--upgrade", "--check"]);
  assert.match(r.stderr, /'--upgrade' → running 'update'/, r.stderr);
});

test("single-dash '-upgrade' (the reported bug) routes to 'update'", () => {
  const r = run(["-upgrade", "--check"]);
  assert.match(r.stderr, /'-upgrade' → running 'update'/, r.stderr);
});

test("dash-typed command '--stats' routes to the real 'stats'", () => {
  const r = run(["--stats", "--json"]);
  assert.match(r.stderr, /'--stats' → running 'stats'/, r.stderr);
});

test("unknown WORD errors with a did-you-mean and exit 1", () => {
  const r = run(["updaet"]);
  assert.equal(r.status, 1, `exit ${r.status}`);
  assert.match(r.stderr, /unknown command 'updaet'/);
  assert.match(r.stderr, /Did you mean 'archkit update'\?/);
});

test("a far-off unknown word still errors (no wizard) and points at --help", () => {
  const r = run(["zzzznope"]);
  assert.equal(r.status, 1, `exit ${r.status}`);
  assert.match(r.stderr, /unknown command 'zzzznope'/);
  assert.match(r.stderr, /archkit --help/);
});

console.log("");
console.log("  ═════════════════════════════════════════════════════════");
console.log(`  \x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
if (failures.length > 0) {
  console.log("\n  \x1b[31mFailed:\x1b[0m");
  for (const f of failures) console.log(`    - ${f}`);
}
console.log("");
process.exit(failed > 0 ? 1 : 0);
