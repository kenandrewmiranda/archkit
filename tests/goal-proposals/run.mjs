#!/usr/bin/env node
// Tests for deferred-goal proposals (v1.9): the goal-detector, proposal
// storage, and the defer / promote / dismiss command layer.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectDeferredGoals } from "../../src/lib/goal-detector.mjs";
import {
  writeGoalProposal, listGoalProposals, countGoalProposals, removeGoalProposal,
  promoteGoalProposal, listGoals, statusOf,
} from "../../src/lib/goals.mjs";
import { runGoalDefer, runGoalPromote, runGoalDismiss } from "../../src/commands/goal.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-prop-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# SYSTEM.md\n## Type: Internal\n");
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n  goal-proposals — detector");

test("detects an explicit Follow-up: label", () => {
  const d = detectDeferredGoals("Done. Follow-up: add retry/backoff to the upload client.");
  assert.ok(d.length >= 1);
  assert.match(d[0].title || d[0].titleHint, /retry\/backoff/);
});

test("detects 'in a follow-up PR' deferral", () => {
  const d = detectDeferredGoals("I'll wire pagination in a follow-up PR once the schema lands.");
  assert.ok(d.length >= 1, "should detect deferral");
});

test("detects 'out of scope for now'", () => {
  const d = detectDeferredGoals("Caching the responses is out of scope for now, but worth doing.");
  assert.ok(d.length >= 1);
});

test("ignores exploratory questions", () => {
  const d = detectDeferredGoals("Should we handle pagination later, or now?");
  assert.equal(d.length, 0, "a question is exploration, not a committed deferral");
});

test("ignores prose with no deferral language", () => {
  assert.equal(detectDeferredGoals("I fixed the bug and added a test. All green.").length, 0);
});

test("dedups identical matches by hash", () => {
  const text = "Follow-up: add retry logic. Later: Follow-up: add retry logic.";
  const d = detectDeferredGoals(text);
  const hashes = new Set(d.map((x) => x.hash));
  assert.equal(hashes.size, d.length, "no duplicate hashes");
});

console.log("\n  goal-proposals — storage");

test("writeGoalProposal persists and dedups by hash", () => {
  withArchDir(({ archDir }) => {
    assert.equal(writeGoalProposal(archDir, { hash: "abc123", title: "Do X" }), true);
    assert.equal(writeGoalProposal(archDir, { hash: "abc123", title: "Do X again" }), false, "dedup");
    assert.equal(countGoalProposals(archDir), 1);
    const list = listGoalProposals(archDir);
    assert.equal(list[0].title, "Do X");
  });
});

test("removeGoalProposal deletes a pending proposal", () => {
  withArchDir(({ archDir }) => {
    writeGoalProposal(archDir, { hash: "h1", title: "Y" });
    assert.equal(removeGoalProposal(archDir, "h1"), true);
    assert.equal(countGoalProposals(archDir), 0);
    assert.equal(removeGoalProposal(archDir, "h1"), false, "already gone");
  });
});

test("promoteGoalProposal turns a proposal into a planned goal and removes it", () => {
  withArchDir(({ archDir }) => {
    writeGoalProposal(archDir, { hash: "h2", title: "Add retries", exitCriteria: ["retries work"] });
    const r = promoteGoalProposal(archDir, "h2");
    assert.ok(r && r.slug);
    assert.equal(countGoalProposals(archDir), 0, "proposal removed after promote");
    const goal = listGoals(archDir).find((g) => g.slug === r.slug);
    assert.ok(goal, "planned goal exists");
    assert.equal(statusOf(goal), "planned");
    assert.deepEqual(goal.meta["exit-criteria"], ["retries work"]);
  });
});

console.log("\n  goal-proposals — defer / promote / dismiss");

test("runGoalDefer stashes a proposal and reports duplicates", () => {
  withArchDir(({ archDir }) => {
    const a = runGoalDefer({ archDir, title: "Cache responses", why: "perf" });
    assert.equal(a.proposed, true);
    assert.equal(a.totalPending, 1);
    const b = runGoalDefer({ archDir, title: "Cache responses" });
    assert.equal(b.proposed, false);
    assert.equal(b.duplicate, true);
  });
});

test("runGoalDefer requires a title", () => {
  withArchDir(({ archDir }) => {
    let threw = null;
    try { runGoalDefer({ archDir, title: "" }); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === "invalid_input");
  });
});

test("runGoalPromote with all:true promotes everything pending", () => {
  withArchDir(({ archDir }) => {
    runGoalDefer({ archDir, title: "One" });
    runGoalDefer({ archDir, title: "Two" });
    const out = runGoalPromote({ archDir, all: true });
    assert.equal(out.promoted.length, 2);
    assert.equal(countGoalProposals(archDir), 0);
    assert.equal(listGoals(archDir).length, 2);
  });
});

test("runGoalPromote with a hash subset promotes only the selection", () => {
  withArchDir(({ archDir }) => {
    const a = runGoalDefer({ archDir, title: "Keep me" });
    runGoalDefer({ archDir, title: "Promote me only" });
    const all = listGoalProposals(archDir);
    const target = all.find((p) => p.title === "Promote me only");
    const out = runGoalPromote({ archDir, hashes: [target.hash] });
    assert.equal(out.promoted.length, 1);
    assert.equal(countGoalProposals(archDir), 1, "the unselected one stays pending");
    assert.equal(listGoalProposals(archDir)[0].hash, a.hash);
  });
});

test("runGoalDismiss drops proposals without promoting", () => {
  withArchDir(({ archDir }) => {
    runGoalDefer({ archDir, title: "Noise" });
    const out = runGoalDismiss({ archDir, all: true });
    assert.equal(out.dismissed.length, 1);
    assert.equal(countGoalProposals(archDir), 0);
    assert.equal(listGoals(archDir).length, 0, "nothing promoted");
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
