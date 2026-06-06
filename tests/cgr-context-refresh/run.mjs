#!/usr/bin/env node
// Tests for the CGR between-goal context-refresh contract.
//
// Background (ADR 0002): the archkit MCP server is a long-running process.
// Between CGR goals (/clear → /mcp__archkit__goal_next) the PROCESS keeps
// running, so if any architecture-derived state (INDEX parse, warmup digest,
// drift findings) were memoized at module scope, a stale cache could leak from
// one goal into the next. A trace found NO such cache: every derivation reads
// .arch/ fresh per call, and the next goal re-derives its context via the
// warmup instruction the relay payload always carries.
//
// This suite PINS that contract so a future caching optimization can't silently
// reintroduce cross-goal staleness:
//   1. renderPayload ALWAYS carries the "archkit resolve warmup" refresh
//      instruction — the line that makes each relayed goal re-derive its arch
//      context after /clear.
//   2. runWarmupJson reflects on-disk .arch/ changes across successive calls in
//      the SAME process (no stale warmup digest).
//   3. runDriftJson reflects on-disk .arch/ changes across successive calls in
//      the SAME process (no stale drift findings).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeGoal, renderPayload } from "../../src/lib/goals.mjs";
import { runWarmupJson } from "../../src/commands/resolve/warmup.mjs";
import { runDriftJson } from "../../src/commands/drift.mjs";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

// Minimal, drift-clean .arch/ with the files warmup/drift read. The INDEX node
// uses the canonical `@node = [cluster] → path` form with a matching .graph and
// an on-disk source file, so the base fixture reports zero drift. Returns the
// .arch path; cwd for drift is its parent dir.
function makeArchDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-refresh-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(archDir, "skills"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "## Rules\n- Rule 1\n\n## Reserved Words\n$tenant = scoped to current org\n");
  fs.writeFileSync(path.join(archDir, "INDEX.md"), "## Nodes\n@auth = [auth] → src/auth.js\n");
  fs.writeFileSync(path.join(archDir, "clusters", "auth.graph"), "[auth]\n");
  fs.writeFileSync(path.join(dir, "src", "auth.js"), "// placeholder\n");
  return archDir;
}

console.log("\n  cgr-context-refresh — relay refresh instruction (ADR 0002)");

await test("renderPayload always carries the 'archkit resolve warmup' refresh instruction", () => {
  const archDir = makeArchDir();
  try {
    // A goal with no required-reading / files-to-touch / verify-command — the
    // warmup line must still be present (it's what re-derives arch context after
    // /clear, independent of the goal's other fields).
    writeGoal(archDir, { slug: "bare", title: "Bare goal", exitCriteria: ["does a thing"] });
    const { payload } = renderPayload(archDir, "bare");
    assert.match(payload, /Then run: archkit resolve warmup/,
      "relay payload must instruct the agent to re-run warmup so the next goal re-derives arch context");
  } finally {
    fs.rmSync(path.dirname(archDir), { recursive: true, force: true });
  }
});

console.log("\n  cgr-context-refresh — no stale arch state across calls in one process");

await test("runWarmupJson re-derives the digest from disk on each call (no stale cache)", async () => {
  const archDir = makeArchDir();
  try {
    const before = await runWarmupJson({ archDir, deep: false });
    const graphsBefore = before.summary.graphs;

    // Mutate .arch/ on disk between calls, exactly as a completed goal would.
    fs.writeFileSync(path.join(archDir, "clusters", "billing.graph"), "[billing]\n");

    const after = await runWarmupJson({ archDir, deep: false });
    assert.equal(after.summary.graphs, graphsBefore + 1,
      "second warmup call must see the graph added between calls — proves the digest is re-derived, not cached");
  } finally {
    fs.rmSync(path.dirname(archDir), { recursive: true, force: true });
  }
});

await test("runDriftJson re-derives findings from disk on each call (no stale cache)", async () => {
  const archDir = makeArchDir();
  try {
    const cwd = path.dirname(archDir);
    const before = await runDriftJson({ archDir, cwd });
    assert.equal(before.summary.total, 0, "clean fixture starts with no drift");

    // Introduce drift on disk: an INDEX node whose .graph cluster doesn't exist
    // (orphaned-index-node). A stale cache would still report 0.
    fs.writeFileSync(path.join(archDir, "INDEX.md"),
      "## Nodes\n@auth = [auth] → src/auth.js\n@billing = [billing] → src/billing.js\n");

    const after = await runDriftJson({ archDir, cwd });
    assert.ok(after.summary.total > before.summary.total,
      "second drift call must see the drift introduced between calls — proves findings are re-derived, not cached");
  } finally {
    fs.rmSync(path.dirname(archDir), { recursive: true, force: true });
  }
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
