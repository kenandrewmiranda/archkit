#!/usr/bin/env node
// Tests for CGR 2.0 fission — partial-complete split with a hard verify gate
// (fission-transition, ADR 0014/0015).
//
// What this verifies:
//   - partitionCriteria / fissionDecision: pure met/unmet split + close decision
//     (fully-met → complete, partial → fission, none-met → no-op)
//   - the HARD verify gate (exit-criterion 2): a partial close BLOCKS when
//     verification can't be ISOLATED to the met criteria (no isolated verify-
//     command) OR when the isolated run is RED — no silent debt fork, nothing
//     written, the parent stays live
//   - successful fork-with-carry-forward (exit-criterion 3): the finished portion
//     closes as a terminal `partial` record and a lean successor carrying ONLY the
//     unmet criteria + the carry-forward handoff + lineage (forked_from /
//     superseded_by, both ways) is forked
//   - the board events appended (exit-criterion 4): cgr.closed(partial) (a
//     `completed` event, completion:partial) + cgr.forked (a `fissioned` event)
//   - the scheduler prefers the continuation over cold pending work

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  writeGoal,
  startGoal,
  loadGoal,
  stampGoalFields,
  isGoalDone,
  nextEligibleGoal,
  exitCriteriaOf,
  lineageOf,
  completionOf,
  criteriaMetOf,
  handoffOf,
  isContinuation,
  partitionCriteria,
  fissionDecision,
  successorSlugFor,
  doneDir,
  parseGoal,
  statusOf,
} from "../../src/lib/goals.mjs";
import { readEvents, foldEvents, readHandoff } from "../../src/lib/board.mjs";
import { runGoalFission } from "../../src/commands/goal.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshArch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-fission-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  return arch;
}
// cwd that is NOT a git repo → gitModifiedFiles() is [] (deterministic ownership).
const noGitCwd = (arch) => path.dirname(arch);

// Cross-platform verify commands (no `true`/`false` shell builtins on Windows).
const GREEN = `node -e ""`;
const RED = `node -e "process.exit(1)"`;

// A live, partially-worked goal: exit-criteria ["A","B"], A met / B unmet.
function partialGoal(arch, slug = "work", { verifyCommand = "npm test", owns } = {}) {
  writeGoal(arch, { slug, title: slug, exitCriteria: ["A", "B"], verifyCommand, ...(owns ? { owns } : {}) });
  startGoal(arch, slug);
  return slug;
}

// ── pure partition / decision ─────────────────────────────────────────────────

test("partitionCriteria splits met/unmet by the flag vector", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "g", title: "g", exitCriteria: ["A", "B", "C"] });
  const g = loadGoal(arch, "g");
  const p = partitionCriteria(g, [true, false, true]);
  assert.deepEqual(p.met, ["A", "C"]);
  assert.deepEqual(p.unmet, ["B"]);
  assert.deepEqual(p.metFlags, [true, false, true]);
  assert.equal(p.total, 3);
  assert.equal(p.partiallyMet, true);
  assert.equal(p.fullyMet, false);
  assert.equal(p.noneMet, false);
});

test("partitionCriteria falls back to stamped criteria-met; tolerant of short vectors", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "g", title: "g", exitCriteria: ["A", "B"] });
  stampGoalFields(arch, "g", { criteriaMet: [true, false] });
  const g = loadGoal(arch, "g");
  assert.deepEqual(partitionCriteria(g).met, ["A"], "reads stamped criteria-met when no override");
  // a missing flag reads as unmet, never throws
  assert.deepEqual(partitionCriteria(g, [true]).unmet, ["B"]);
});

test("fissionDecision: fully-met → complete, partial → fission, none → none", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "g", title: "g", exitCriteria: ["A", "B"] });
  const g = loadGoal(arch, "g");
  assert.equal(fissionDecision(g, [true, true]).action, "complete");
  assert.equal(fissionDecision(g, [true, false]).action, "fission");
  assert.equal(fissionDecision(g, [false, false]).action, "none");
});

test("successorSlugFor dedupes against live + archived goals", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "work", title: "work", exitCriteria: ["x"] });
  assert.equal(successorSlugFor(arch, "work"), "work-cont");
  writeGoal(arch, { slug: "work-cont", title: "wc", exitCriteria: ["x"] });
  assert.equal(successorSlugFor(arch, "work"), "work-cont-2");
});

// ── decision guards on the runner ─────────────────────────────────────────────

test("fission refuses a FULLY-met goal (close normally instead)", () => {
  const arch = freshArch();
  partialGoal(arch);
  assert.throws(
    () => runGoalFission({ archDir: arch, cwd: noGitCwd(arch), slug: "work", criteriaMet: [true, true], verifyCommand: GREEN }),
    /fully-met|closes normally/i,
  );
  assert.ok(!isGoalDone(arch, "work"), "the goal was not closed");
  assert.equal(loadGoal(arch, "work-cont"), null, "no successor forked");
});

test("fission refuses a goal with NO met criteria (nothing finished to close)", () => {
  const arch = freshArch();
  partialGoal(arch);
  assert.throws(
    () => runGoalFission({ archDir: arch, cwd: noGitCwd(arch), slug: "work", criteriaMet: [false, false], verifyCommand: GREEN }),
    /no exit-criteria.*are met|nothing finished/i,
  );
});

// ── HARD verify gate: block on unverifiable / red (no silent debt fork) ────────

test("BLOCK on unverifiable partial — no isolated verify-command, nothing written", () => {
  const arch = freshArch();
  partialGoal(arch); // has a WHOLE-goal verify-command (npm test), but none scoped to met
  assert.throws(
    () => runGoalFission({ archDir: arch, cwd: noGitCwd(arch), slug: "work", criteriaMet: [true, false] }),
    /cannot isolate verification|BLOCKED/i,
  );
  // No silent debt fork: parent still live, no successor, no events, no handoff.
  assert.ok(loadGoal(arch, "work"), "parent is still live");
  assert.equal(statusOf(loadGoal(arch, "work")), "in-progress");
  assert.ok(!isGoalDone(arch, "work"), "parent was NOT closed");
  assert.equal(loadGoal(arch, "work-cont"), null, "no successor forked");
  assert.equal(readEvents(arch).length, 0, "no board events appended");
  assert.equal(readHandoff(arch, "work"), null, "no handoff authored");
});

test("BLOCK on a RED isolated verify — partial close refused", () => {
  const arch = freshArch();
  partialGoal(arch);
  assert.throws(
    () => runGoalFission({ archDir: arch, cwd: noGitCwd(arch), slug: "work", criteriaMet: [true, false], verifyCommand: RED }),
    /RED|BLOCKED/i,
  );
  assert.ok(!isGoalDone(arch, "work"), "parent was NOT closed on red");
  assert.equal(loadGoal(arch, "work-cont"), null, "no successor forked on red");
  assert.equal(readEvents(arch).length, 0, "no board events appended on red");
});

// ── successful fork-with-carry-forward ────────────────────────────────────────

test("successful fission forks a lean successor + closes the met portion + events", () => {
  const arch = freshArch();
  partialGoal(arch, "work", { owns: ["src/lib/*"] });

  const res = runGoalFission({
    archDir: arch,
    cwd: noGitCwd(arch),
    slug: "work",
    criteriaMet: [true, false],
    verifyCommand: GREEN, // scoped to the MET criterion, green
    decisions: ["banked criterion A"],
    continuationNotes: "fresh head: finish B",
    actualFiles: ["src/lib/board.mjs"],
  });

  // result shape
  assert.equal(res.completion, "partial");
  assert.equal(res.successor.slug, "work-cont");
  assert.deepEqual(res.successor.carriedForward, ["B"]);
  assert.deepEqual(res.events, ["completed(partial)", "fissioned"]);
  assert.equal(res.verify.passed, true);

  // the finished portion is a terminal `partial` record, archived to done/
  assert.ok(isGoalDone(arch, "work"), "met portion closed to done/");
  assert.equal(loadGoal(arch, "work"), null, "closed parent is no longer live");
  const archived = parseGoal(fs.readFileSync(path.join(doneDir(arch), "work.md"), "utf8"));
  assert.equal(statusOf(archived), "completed");
  assert.equal(completionOf(archived), "partial", "completion: partial stamped");
  assert.deepEqual(criteriaMetOf(archived), [true, false], "criteria-met recorded");
  assert.equal(archived.meta["tests-passed"], "true", "isolated-verify evidence recorded");
  assert.equal(lineageOf(archived).superseded_by, "work-cont", "parent links forward to successor");

  // the lean successor carries ONLY the unmet criterion + lineage + handoff
  const succ = loadGoal(arch, "work-cont");
  assert.ok(succ, "successor exists and is live (pending)");
  assert.equal(statusOf(succ), "pending");
  assert.deepEqual(exitCriteriaOf(succ), ["B"], "successor carries ONLY the unmet criterion");
  assert.deepEqual(lineageOf(succ), { forked_from: "work", supersedes: "work", superseded_by: null });
  assert.equal(isContinuation(succ), true);
  assert.equal(handoffOf(succ), ".arch/board/handoff/work.md", "successor references the carry-forward handoff");

  // the carry-forward handoff: remaining = the unmet criteria, status partial
  const h = readHandoff(arch, "work");
  assert.ok(h, "handoff authored");
  assert.deepEqual(h.remaining, ["B"]);
  assert.equal(h.verificationStatus, "partial");
  assert.equal(h.filesActualVsPredicted.accuracy, 1, "src/lib/* covers src/lib/board.mjs");

  // board events: cgr.closed(partial) + cgr.forked
  const events = readEvents(arch);
  const completed = events.find((e) => e.type === "completed" && e.slug === "work");
  const fissioned = events.find((e) => e.type === "fissioned" && e.slug === "work");
  assert.ok(completed && completed.completion === "partial", "cgr.closed(partial) appended");
  assert.ok(fissioned && fissioned.lineage.superseded_by === "work-cont", "cgr.forked appended with lineage");
  const fold = foldEvents(events);
  assert.equal(fold.bySlug.get("work").lifecycle, "fissioned", "parent folds to fissioned");
});

test("scheduler prefers the forked continuation over cold pending work", () => {
  const arch = freshArch();
  partialGoal(arch, "work");
  // a cold pending goal with a LOWER order — it would sort first without the
  // continuation preference.
  writeGoal(arch, { slug: "cold", title: "cold", exitCriteria: ["z"], order: 0 });

  runGoalFission({ archDir: arch, cwd: noGitCwd(arch), slug: "work", criteriaMet: [true, false], verifyCommand: GREEN });

  const next = nextEligibleGoal(arch);
  assert.ok(next, "there is a next goal");
  assert.equal(next.slug, "work-cont", "the warm continuation is picked ahead of cold pending work");
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
