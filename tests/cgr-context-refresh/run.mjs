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
import { writeGoal, renderPayload, writeGraphProposal } from "../../src/lib/goals.mjs";
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

await test("runDriftJson reads/parses each .arch file once per invocation (no redundant re-parse)", async () => {
  const archDir = makeArchDir();
  try {
    const cwd = path.dirname(archDir);

    // Count disk reads per file during a SINGLE invocation. The request-scoped
    // reader memoizes each .arch file's read+parse for the call, so INDEX.md is
    // read exactly once even though detectFindings AND the silent-success scan
    // both need the parsed index. Before request-scoped caching, INDEX.md was
    // parsed twice per drift call.
    const origRead = fs.readFileSync;
    const reads = {};
    fs.readFileSync = (p, ...rest) => {
      reads[path.basename(String(p))] = (reads[path.basename(String(p))] || 0) + 1;
      return origRead(p, ...rest);
    };
    try {
      await runDriftJson({ archDir, cwd });
    } finally {
      fs.readFileSync = origRead;
    }

    assert.equal(reads["INDEX.md"], 1,
      "INDEX.md must be read+parsed exactly once per drift invocation (request-scoped memoization)");
    assert.equal(reads["SYSTEM.md"], 1,
      "SYSTEM.md must be read exactly once per drift invocation");
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

console.log("\n  cgr-context-refresh — warmup surfaces pending graph-proposals (ADR 0004)");

await test("warmup surfaces count + slugs of pending graph-proposals (W015) in human + JSON", async () => {
  const archDir = makeArchDir();
  try {
    // Two completed goals each left a persisted graph-proposal — the write-back
    // half of the flywheel that warmup must make visible instead of leaving in a
    // silent folder.
    writeGraphProposal(archDir, "added-warmup-check", [
      { kind: "undocumented-file", file: "src/commands/resolve/warmup.mjs", cluster: "resolve",
        node: "@resolve", suggestedLine: "WarmupCmd [U] : src/commands/resolve/warmup.mjs — <role — fill in> | <flow — fill in>" },
    ]);
    writeGraphProposal(archDir, "added-graph-accept", [
      { kind: "undocumented-file", file: "src/lib/goals.mjs", cluster: "goals",
        node: "@goals", suggestedLine: "Goals [U] : src/lib/goals.mjs — <role — fill in> | <flow — fill in>" },
    ]);

    const result = await runWarmupJson({ archDir, deep: false });

    // JSON/MCP surface: structured count + the W015 check carrying both slugs.
    assert.equal(result.summary.pendingGraphProposals, 2,
      "summary must report the count of pending graph-proposals");
    const w015 = result.checks.find(c => c.id === "W015");
    assert.ok(w015, "a W015 check must be present when graph-proposals are pending");
    assert.match(w015.detail, /added-warmup-check/, "W015 detail must list proposal slugs");
    assert.match(w015.detail, /added-graph-accept/, "W015 detail must list every pending slug");

    // Human banner surface: a warning string the agent/human reads, naming the
    // slugs and the accept path.
    const warn = result.warnings.find(w => w.includes("graph-proposal"));
    assert.ok(warn, "a human-readable warning must surface pending graph-proposals");
    assert.match(warn, /added-warmup-check/, "warning must name the pending slugs");
    assert.match(warn, /archkit_graph_accept/, "warning must point at the accept tool");
  } finally {
    fs.rmSync(path.dirname(archDir), { recursive: true, force: true });
  }
});

await test("warmup stays silent about graph-proposals when none are pending", async () => {
  const archDir = makeArchDir();
  try {
    // Base fixture has no .arch/graph-proposals/ at all — the clean case.
    const result = await runWarmupJson({ archDir, deep: false });
    assert.equal(result.summary.pendingGraphProposals, 0,
      "count must be zero when no proposals are pending");
    assert.ok(!result.checks.some(c => c.id === "W015"),
      "no W015 check when clean — silent, mirroring the other warmup checks");
    assert.ok(!result.warnings.some(w => w.includes("graph-proposal")),
      "no graph-proposal warning when clean");
    assert.ok(!result.actions.some(a => a.includes("graph-proposal")),
      "no graph-proposal action when clean");
  } finally {
    fs.rmSync(path.dirname(archDir), { recursive: true, force: true });
  }
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
