#!/usr/bin/env node
// Tests for the ambiguity-gated triage decision (cgr-conductor-ambiguity-triage).
//
// triageNextGoal generalizes routeNextGoal: instead of only surfacing a choice
// when an ungrouped queue AND a project track are both live, it classifies the
// WHOLE board (multiple tracks, testing backlog, on-hold work, empty/blocked
// queue) into single (auto-pick) vs choice (ask) vs none (offer a plan), gated by
// the cgr.triageMode config knob.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeGoal,
  startGoal,
  markTesting,
  markOnHold,
  triageNextGoal,
  triageMode,
  DEFAULT_TRIAGE_MODE,
  TRIAGE_MODES,
} from "../../src/lib/goals.mjs";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-triage-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Write cgr.triageMode into .arch/config.json (merging nothing else).
function setTriageMode(archDir, value) {
  fs.writeFileSync(path.join(archDir, "config.json"), JSON.stringify({ cgr: { triageMode: value } }, null, 2));
}

console.log("\n  cgr-conductor-ambiguity-triage — triageMode config resolution");

test("triageMode defaults to ambiguity with no/invalid config", () => {
  withArchDir(({ archDir }) => {
    assert.equal(triageMode(archDir), "ambiguity", "no config → ambiguity");
    assert.equal(DEFAULT_TRIAGE_MODE, "ambiguity");
    fs.writeFileSync(path.join(archDir, "config.json"), "{ not json");
    assert.equal(triageMode(archDir), "ambiguity", "invalid JSON → ambiguity");
    setTriageMode(archDir, "nonsense");
    assert.equal(triageMode(archDir), "ambiguity", "unknown value → ambiguity");
  });
});

test("triageMode resolves each recognized value (case/space tolerant)", () => {
  withArchDir(({ archDir }) => {
    for (const m of TRIAGE_MODES) {
      setTriageMode(archDir, m);
      assert.equal(triageMode(archDir), m);
    }
    setTriageMode(archDir, "  ALWAYS  ");
    assert.equal(triageMode(archDir), "always", "trimmed + lowercased");
  });
});

console.log("\n  cgr-conductor-ambiguity-triage — ambiguity mode classification");

test("single-track queue with no debt → single (frictionless auto-pick)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-a", title: "QA", order: 0 });
    writeGoal(archDir, { slug: "q-b", title: "QB", order: 1 });
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "single", "one obvious thing, no debt → auto-pick");
    assert.equal(t.goal.slug, "q-a", "picks the first in queue order");
    assert.equal(t.recommended, "q-a");
    assert.equal(t.empty, false);
    assert.deepEqual(t.queue, ["q-a", "q-b"]);
    assert.equal(t.queueNext, "q-a");
  });
});

test("single-track project with no debt → single", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "p-a", title: "PA", order: 0, project: "alpha" });
    writeGoal(archDir, { slug: "p-b", title: "PB", order: 1, project: "alpha" });
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "single", "one project track, no other debt → auto-pick");
    assert.equal(t.goal.slug, "p-a");
    assert.deepEqual(t.projects.alpha, ["p-a", "p-b"]);
    assert.equal(t.projectNext.alpha, "p-a");
  });
});

test("multiple tracks (queue + projects) → choice with full slices", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });                       // ungrouped
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 1, project: "alpha" });
    writeGoal(archDir, { slug: "p-a2", title: "A2", order: 2, project: "alpha" });
    writeGoal(archDir, { slug: "p-b1", title: "B1", order: 3, project: "beta" });
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "choice", "queue + 2 projects → ambiguous");
    assert.deepEqual(t.queue, ["q-1"]);
    assert.equal(t.queueNext, "q-1");
    assert.deepEqual(t.projects.alpha, ["p-a1", "p-a2"]);
    assert.deepEqual(t.projects.beta, ["p-b1"]);
    assert.equal(t.projectNext.alpha, "p-a1");
    assert.equal(t.projectNext.beta, "p-b1");
    assert.equal(t.recommended, "q-1", "recommended = pure auto-pick (lowest order)");
    assert.equal(t.empty, false);
  });
});

test("two projects (no ungrouped queue) still → choice", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 0, project: "alpha" });
    writeGoal(archDir, { slug: "p-b1", title: "B1", order: 1, project: "beta" });
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "choice", "two project tracks → ambiguous even without a queue");
    assert.deepEqual(t.queue, []);
    assert.equal(t.queueNext, null);
    assert.deepEqual(Object.keys(t.projects).sort(), ["alpha", "beta"]);
  });
});

test("testing debt alongside pending work → choice", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });
    writeGoal(archDir, { slug: "t-1", title: "T1", order: 1 });
    startGoal(archDir, "t-1");
    markTesting(archDir, "t-1"); // t-1 now verification debt
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "choice", "pending queue + testing backlog → ambiguous");
    assert.deepEqual(t.queue, ["q-1"]);
    assert.equal(t.testing.count, 1);
    assert.deepEqual(t.testing.slugs, ["t-1"]);
  });
});

test("testing-only board (nothing pending) → single auto-drain", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "t-1", title: "T1", order: 0 });
    startGoal(archDir, "t-1");
    markTesting(archDir, "t-1");
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "single", "only verification debt, one axis → auto-pick to drain");
    assert.equal(t.goal.slug, "t-1");
    assert.equal(t.testing.count, 1);
  });
});

test("only-on-hold → choice (resume-or-plan, never silent resume)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "h-1", title: "H1", order: 0 });
    startGoal(archDir, "h-1");
    markOnHold(archDir, "h-1");
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "choice", "parked-only work is surfaced, not silently resumed");
    assert.equal(t.onHold.count, 1);
    assert.deepEqual(t.onHold.slugs, ["h-1"]);
    assert.equal(t.empty, false, "on-hold work means the board is not empty");
    assert.deepEqual(t.queue, []);
  });
});

test("on-hold alongside a single pending track → choice", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });
    writeGoal(archDir, { slug: "h-1", title: "H1", order: 1 });
    startGoal(archDir, "h-1");
    markOnHold(archDir, "h-1");
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "choice", "parked debt makes even a single queue ambiguous");
    assert.deepEqual(t.queue, ["q-1"]);
    assert.equal(t.onHold.count, 1);
    assert.equal(t.recommended, "q-1", "auto-pick still recommends the live queue goal, not the parked one");
  });
});

test("empty/blocked board → none with empty:true", () => {
  withArchDir(({ archDir }) => {
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "none", "nothing eligible, nothing parked");
    assert.equal(t.empty, true, "explicit empty signal for the plan/intake path");
    assert.equal(t.recommended, null);
    assert.deepEqual(t.queue, []);
    assert.equal(t.testing.count, 0);
    assert.equal(t.onHold.count, 0);
  });
});

test("dep-blocked-only queue → none (empty), a blocked goal never triggers a choice", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0, dependsOn: ["missing-dep"] });
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "none", "the sole goal is dependency-blocked → nothing eligible");
    assert.equal(t.empty, true);
  });
});

console.log("\n  cgr-conductor-ambiguity-triage — in-progress pre-emption");

test("in-progress resume pre-empts any choice, regardless of other tracks", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 1, project: "alpha" });
    startGoal(archDir, "q-1"); // genuinely active
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "resume", "active goal resumed, never interrupted by the choice");
    assert.equal(t.goal.slug, "q-1");
    assert.equal(t.empty, false);
  });
});

test("in-progress resume pre-empts even in `always` mode", () => {
  withArchDir(({ archDir }) => {
    setTriageMode(archDir, "always");
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });
    writeGoal(archDir, { slug: "q-2", title: "Q2", order: 1 });
    startGoal(archDir, "q-1");
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "resume", "resume beats the forced-choice knob");
    assert.equal(t.goal.slug, "q-1");
  });
});

console.log("\n  cgr-conductor-ambiguity-triage — triageMode overrides");

test("mode `always` forces a choice for the trivial single-track case", () => {
  withArchDir(({ archDir }) => {
    setTriageMode(archDir, "always");
    writeGoal(archDir, { slug: "q-a", title: "QA", order: 0 });
    writeGoal(archDir, { slug: "q-b", title: "QB", order: 1 });
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "choice", "always → choice even when one obvious thing exists");
    assert.equal(t.mode, "always");
    assert.deepEqual(t.queue, ["q-a", "q-b"]);
    assert.equal(t.recommended, "q-a");
  });
});

test("mode `always` still reports none on a truly empty board", () => {
  withArchDir(({ archDir }) => {
    setTriageMode(archDir, "always");
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "none", "cannot force a choice out of nothing");
    assert.equal(t.empty, true);
  });
});

test("mode `off` restores pure auto-pick (single) even with mixed tracks", () => {
  withArchDir(({ archDir }) => {
    setTriageMode(archDir, "off");
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });                  // ungrouped
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 1, project: "alpha" }); // project
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "single", "off → never surfaces a choice");
    assert.equal(t.goal.slug, "q-1", "auto-picks the pure-precedence next goal");
    assert.equal(t.mode, "off");
  });
});

test("mode `off` reports none on an empty board", () => {
  withArchDir(({ archDir }) => {
    setTriageMode(archDir, "off");
    const t = triageNextGoal(archDir);
    assert.equal(t.kind, "none");
    assert.equal(t.empty, true);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
