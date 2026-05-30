#!/usr/bin/env node
// Tests for archkit_boundary_propose (human-gated BAN capture).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runBoundaryProposeJson } from "../../src/commands/boundary.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn, { boundaries = "# Boundaries\n" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-bp-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# SYSTEM.md\n## Type: Internal\n");
  fs.writeFileSync(path.join(archDir, "BOUNDARIES.md"), boundaries);
  try { return fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n  boundary-propose");

test("valid BAN is queued to .arch/boundary-proposals/ (not auto-merged)", () => {
  withArchDir(({ archDir }) => {
    const r = runBoundaryProposeJson({ archDir, source: "src/web/*", target: "src/db/*", why: "web must not touch db directly" });
    assert.equal(r.queued, true);
    assert.match(r.banLine, /BAN: src\/web\/\* -> src\/db\/\*/);
    assert.match(r.banLine, /web must not touch db/);
    assert.ok(fs.existsSync(r.proposalPath), "proposal file written");
    // NOT merged into BOUNDARIES.md
    const boundaries = fs.readFileSync(path.join(archDir, "BOUNDARIES.md"), "utf8");
    assert.ok(!boundaries.includes("BAN: src/web/*"), "BOUNDARIES.md untouched (human-gated)");
    assert.match(r.nextStep, /human must review/i);
  });
});

test("unsupported glob is rejected", () => {
  withArchDir(({ archDir }) => {
    assert.throws(() => runBoundaryProposeJson({ archDir, source: "src/{a,b}/*", target: "src/db/*" }), /Unsupported glob|proposal_invalid/);
  });
});

test("missing target is rejected", () => {
  withArchDir(({ archDir }) => {
    assert.throws(() => runBoundaryProposeJson({ archDir, source: "src/web/*" }), /Missing required field/);
  });
});

test("a BAN already in BOUNDARIES.md is a no-op (not re-proposed)", () => {
  withArchDir(({ archDir }) => {
    const r = runBoundaryProposeJson({ archDir, source: "src/web/*", target: "src/db/*" });
    assert.equal(r.queued, false);
    assert.equal(r.alreadyEnforced, true);
  }, { boundaries: "# Boundaries\n\n- BAN: src/web/* -> src/db/*\n" });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
