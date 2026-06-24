#!/usr/bin/env node
// Tests for the CGR 2.0 handoff artifact + attention-gradient wind-down
// (handoff-and-winddown, ADR 0015).
//
// What this verifies:
//   - handoff round-trip: writeHandoff → readHandoff returns the structured object
//   - the handoff schema carries every required section (done+evidence, decisions,
//     files-actual-vs-predicted, remaining, continuation-notes, open-questions,
//     verification-status) and the file lives at .arch/board/handoff/<slug>.md
//   - ownership-accuracy (actual vs predicted, glob-aware): matched/unexpected/
//     missed/accuracy
//   - threshold-triggered mode switch: windDownMode below/at/above + missing fill,
//     windDownAt config resolution incl. per-model override
//   - the handoff is referenced by (successor) CGR frontmatter and readable via
//     archkit_session_state's `handoffs` slice
//   - runGoalHandoff integration: authors the artifact, computes accuracy from the
//     goal's predicted owns/files-to-touch, stamps the pointer on goal + successor

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  writeHandoff,
  readHandoff,
  listHandoffs,
  computeOwnershipAccuracy,
  handoffPath,
  handoffDir,
  VERIFICATION_STATUSES,
  sessionState,
} from "../../src/lib/board.mjs";
import {
  writeGoal,
  startGoal,
  loadGoal,
  stampGoalFields,
  handoffOf,
  windDownAt,
  windDownMode,
  windDownDecision,
  leaseTtlHours,
  DEFAULT_WIND_DOWN_AT,
  DEFAULT_LEASE_TTL_HOURS,
} from "../../src/lib/goals.mjs";
import { runGoalHandoff } from "../../src/commands/goal.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshArch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-handoff-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  return arch;
}
function writeConfig(arch, cfg) {
  fs.writeFileSync(path.join(arch, "config.json"), JSON.stringify(cfg));
}

// ── round-trip + schema ───────────────────────────────────────────────────────

test("writeHandoff → readHandoff round-trips the full structured schema", () => {
  const arch = freshArch();
  const input = {
    model: "claude-opus-4-8",
    at: "2026-06-23T22:00:00.000Z",
    verificationStatus: "green",
    done: [
      { criterion: "schema written", evidence: "tests/cgr-handoff green" },
      { criterion: "ownership recorded", evidence: "accuracy 1.0" },
    ],
    decisions: ["canonical store is a fenced json block"],
    remaining: ["wire fission successor"],
    continuationNotes: "fresh head re-plans the remaining DAG",
    openQuestions: ["per-model thresholds for non-Claude models?"],
    predicted: ["src/lib/*"],
    actual: ["src/lib/board.mjs"],
  };
  const w = writeHandoff(arch, "g", input);
  assert.equal(w.slug, "g");
  assert.equal(w.pointer, ".arch/board/handoff/g.md");
  assert.ok(fs.existsSync(handoffPath(arch, "g")), "artifact written at .arch/board/handoff/g.md");

  const r = readHandoff(arch, "g");
  assert.ok(r, "readHandoff returns the structured object");
  assert.equal(r.slug, "g");
  assert.equal(r.model, "claude-opus-4-8");
  assert.equal(r.verificationStatus, "green");
  assert.deepEqual(r.done, input.done);
  assert.deepEqual(r.decisions, input.decisions);
  assert.deepEqual(r.remaining, input.remaining);
  assert.equal(r.continuationNotes, input.continuationNotes);
  assert.deepEqual(r.openQuestions, input.openQuestions);
  // every required section present
  for (const k of ["done", "decisions", "filesActualVsPredicted", "remaining", "continuationNotes", "openQuestions", "verificationStatus"]) {
    assert.ok(k in r, `handoff carries ${k}`);
  }
  // accuracy embedded
  assert.equal(r.filesActualVsPredicted.accuracy, 1);
});

test("readHandoff accepts a pointer path, not just a bare slug", () => {
  const arch = freshArch();
  writeHandoff(arch, "x", { done: ["a"] });
  const byPointer = readHandoff(arch, ".arch/board/handoff/x.md");
  assert.ok(byPointer && byPointer.slug === "x", "pointer path resolves to the slug");
});

test("readHandoff is tolerant of a missing artifact", () => {
  const arch = freshArch();
  assert.equal(readHandoff(arch, "nope"), null);
  assert.deepEqual(listHandoffs(arch), [], "absent handoff dir → []");
});

test("plain-string done entries normalize to {criterion, evidence:''}", () => {
  const arch = freshArch();
  writeHandoff(arch, "g", { done: ["did the thing", { criterion: "and this", evidence: "proof" }] });
  const r = readHandoff(arch, "g");
  assert.deepEqual(r.done, [
    { criterion: "did the thing", evidence: "" },
    { criterion: "and this", evidence: "proof" },
  ]);
});

test("verificationStatus normalizes to the closed vocabulary", () => {
  assert.deepEqual([...VERIFICATION_STATUSES].sort(), ["green", "partial", "red", "unverified"]);
  const arch = freshArch();
  writeHandoff(arch, "a", { verificationStatus: "GREEN" });
  assert.equal(readHandoff(arch, "a").verificationStatus, "green");
  writeHandoff(arch, "b", { verificationStatus: "bogus" });
  assert.equal(readHandoff(arch, "b").verificationStatus, "unverified", "unknown → unverified");
  writeHandoff(arch, "c", {});
  assert.equal(readHandoff(arch, "c").verificationStatus, "unverified", "default unverified");
});

// ── ownership accuracy ────────────────────────────────────────────────────────

test("computeOwnershipAccuracy is glob-aware: matched/unexpected/missed/accuracy", () => {
  const o = computeOwnershipAccuracy(
    ["src/lib/*", "src/mcp/tools.mjs"],            // predicted
    ["src/lib/board.mjs", "src/commands/goal.mjs"], // actual
  );
  assert.deepEqual(o.matched, ["src/lib/board.mjs"], "glob src/lib/* covers board.mjs");
  assert.deepEqual(o.unexpected, ["src/commands/goal.mjs"], "touched but not predicted");
  assert.deepEqual(o.missed, ["src/mcp/tools.mjs"], "predicted but not touched");
  assert.equal(o.accuracy, 0.5, "1 of 2 actual files matched");
});

test("ownership accuracy edge cases", () => {
  assert.equal(computeOwnershipAccuracy([], []).accuracy, 1, "nothing predicted, nothing touched → 1");
  assert.equal(computeOwnershipAccuracy([], ["a.mjs"]).accuracy, 0, "touched with no prediction → 0");
  assert.equal(computeOwnershipAccuracy(["a.mjs"], ["a.mjs"]).accuracy, 1, "exact match → 1");
  // leading ./ is normalized on both sides
  const o = computeOwnershipAccuracy(["./src/x.mjs"], ["src/x.mjs"]);
  assert.equal(o.accuracy, 1);
});

// ── threshold-triggered mode switch ───────────────────────────────────────────

test("windDownMode flips at the threshold and never blocks on missing fill", () => {
  assert.equal(windDownMode(0.5, 0.65).mode, "accept", "below → accept");
  assert.equal(windDownMode(0.64, 0.65).windDown, false);
  assert.equal(windDownMode(0.65, 0.65).mode, "wind-down", "at threshold → wind-down");
  assert.equal(windDownMode(0.9, 0.65).windDown, true, "above → wind-down");
  // a missing/garbage fill reading must NOT block work
  assert.equal(windDownMode(undefined, 0.65).mode, "accept");
  assert.equal(windDownMode(NaN, 0.65).windDown, false);
  assert.equal(windDownMode("not a number", 0.65).mode, "accept");
  // invalid threshold falls back to the default
  assert.equal(windDownMode(0.7, undefined).threshold, DEFAULT_WIND_DOWN_AT);
});

test("windDownAt resolves config + per-model override", () => {
  const arch = freshArch();
  assert.equal(windDownAt(arch, {}), DEFAULT_WIND_DOWN_AT, "no config → default 0.65");

  writeConfig(arch, { cgr: { windDownAt: 0.5, windDownAtByModel: { "claude-haiku-4-5": 0.4 } } });
  assert.equal(windDownAt(arch, {}), 0.5, "config base wins over default");
  assert.equal(windDownAt(arch, { model: "claude-opus-4-8" }), 0.5, "model with no override → base");
  assert.equal(windDownAt(arch, { model: "claude-haiku-4-5" }), 0.4, "per-model override wins");

  // out-of-range config values fall back to the default rather than corrupting policy
  writeConfig(arch, { cgr: { windDownAt: 2 } });
  assert.equal(windDownAt(arch, {}), DEFAULT_WIND_DOWN_AT, "out-of-range → default");
});

test("windDownDecision combines config resolution + mode in one call", () => {
  const arch = freshArch();
  writeConfig(arch, { cgr: { windDownAt: 0.6, windDownAtByModel: { fast: 0.3 } } });
  assert.equal(windDownDecision(arch, { fill: 0.5 }).mode, "accept", "0.5 < 0.6 base");
  assert.equal(windDownDecision(arch, { fill: 0.5, model: "fast" }).mode, "wind-down", "0.5 ≥ 0.3 model override");
});

test("leaseTtlHours resolves from config with default fallback", () => {
  const arch = freshArch();
  assert.equal(leaseTtlHours(arch), DEFAULT_LEASE_TTL_HOURS);
  writeConfig(arch, { cgr: { leaseTtlHours: 12 } });
  assert.equal(leaseTtlHours(arch), 12);
  writeConfig(arch, { cgr: { leaseTtlHours: -1 } });
  assert.equal(leaseTtlHours(arch), DEFAULT_LEASE_TTL_HOURS, "invalid → default");
});

// ── referenced by frontmatter + readable via session_state ────────────────────

test("handoff is referenced by CGR frontmatter and surfaces in session_state", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "succ", title: "successor", exitCriteria: ["x"] });
  startGoal(arch, "succ"); // make it live (in-progress, in goals/ root)
  const w = writeHandoff(arch, "orig", {
    verificationStatus: "partial",
    predicted: ["src/lib/*"],
    actual: ["src/lib/board.mjs", "src/lib/goals.mjs"],
    remaining: ["finish board slice"],
  });
  // the successor references the handoff via its frontmatter pointer
  stampGoalFields(arch, "succ", { handoff: w.pointer });
  assert.equal(handoffOf(loadGoal(arch, "succ")), ".arch/board/handoff/orig.md");

  const s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  assert.ok(Array.isArray(s.handoffs), "session_state carries a handoffs slice");
  const h = s.handoffs.find((x) => x.slug === "succ");
  assert.ok(h, "the successor's handoff reference is surfaced");
  assert.equal(h.handoff, ".arch/board/handoff/orig.md");
  assert.equal(h.forSlug, "orig");
  assert.equal(h.verificationStatus, "partial", "verification-status read from the artifact");
  assert.equal(h.ownershipAccuracy, 1, "ownership accuracy read from the artifact");
  assert.equal(h.remaining, 1);
  assert.equal(h.resolved, true);
});

test("a dangling handoff pointer surfaces as resolved:false, not dropped", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "g", title: "g", exitCriteria: ["x"] });
  startGoal(arch, "g");
  stampGoalFields(arch, "g", { handoff: ".arch/board/handoff/missing.md" });
  const s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  const h = s.handoffs.find((x) => x.slug === "g");
  assert.ok(h && h.resolved === false, "broken reference is visible, not silent");
  assert.equal(h.verificationStatus, null);
});

// ── runGoalHandoff integration ────────────────────────────────────────────────

test("runGoalHandoff authors the artifact, computes accuracy, stamps goal + successor", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "work", title: "work", exitCriteria: ["a", "b"], owns: ["src/lib/*"] });
  startGoal(arch, "work");
  writeGoal(arch, { slug: "next", title: "next", exitCriteria: ["c"] });
  startGoal(arch, "next");

  const res = runGoalHandoff({
    archDir: arch,
    cwd: path.dirname(arch), // not a git repo → gitModifiedFiles is []
    slug: "work",
    done: [{ criterion: "a", evidence: "proof-a" }],
    decisions: ["use union-find"],
    remaining: ["criterion b"],
    continuationNotes: "pick up at b",
    openQuestions: [],
    verificationStatus: "partial",
    actualFiles: ["src/lib/board.mjs", "src/commands/goal.mjs"],
    successor: "next",
  });

  assert.equal(res.path, path.join("board", "handoff", "work.md"));
  assert.equal(res.verificationStatus, "partial");
  // predicted = owns (src/lib/*) ∪ files-to-touch; actual has board.mjs (matched
  // by the glob) + goal.mjs (unexpected) → 1/2 = 0.5
  assert.equal(res.ownershipAccuracy, 0.5);
  assert.deepEqual(res.ownership.unexpected, ["src/commands/goal.mjs"]);

  // pointer stamped on BOTH the goal and the successor
  assert.equal(handoffOf(loadGoal(arch, "work")), ".arch/board/handoff/work.md");
  assert.equal(res.successor, "next");
  assert.equal(handoffOf(loadGoal(arch, "next")), ".arch/board/handoff/work.md");

  // and it round-trips off disk
  const r = readHandoff(arch, "work");
  assert.equal(r.slug, "work");
  assert.deepEqual(r.remaining, ["criterion b"]);
  assert.equal(r.filesActualVsPredicted.accuracy, 0.5);
});

test("runGoalHandoff errors clearly on an unknown goal", () => {
  const arch = freshArch();
  assert.throws(() => runGoalHandoff({ archDir: arch, cwd: path.dirname(arch), slug: "ghost" }), /unknown goal/);
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
