#!/usr/bin/env node
// Tests for intake-side lane planning (intake-dag-ownership, ADR 0013).
//
// What this verifies:
//   - the per-goal CGR-2.0 prediction fields round-trip: dependsOn (DAG edges),
//     owns (ownership globs), feature (cohesion tag), exclusive (barrier flag)
//   - glob-aware ownership overlap (globsIntersect / ownsOverlap) — the shared
//     conflict primitive board.mjs and the partitioner both use
//   - partitionLanes correctness: feature cohesion groups CGRs into one lane;
//     distinct features fan out into parallel lanes
//   - DISJOINT-OWNERSHIP enforcement: overlapping owns are serialized into ONE
//     lane (even across features), so across parallel lanes ownership is disjoint;
//     transitive overlap chains collapse into a single lane
//   - EXCLUSIVE-goal isolation: an exclusive goal is pulled out of the parallel
//     partition and emitted as a solo barrier stage between fan-out stages
//   - the partition is PURE (same input → identical plan)
//   - runGoalIntake emits the plan and stamps each goal's computed lane

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  writeGoal,
  loadGoal,
  ownsOf,
  featureOf,
  exclusiveOf,
  dependsOnOf,
  laneOf,
  globsIntersect,
  ownsOverlap,
  partitionLanes,
} from "../../src/lib/goals.mjs";
import { runGoalIntake } from "../../src/commands/goal.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshArch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-lanes-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  return arch;
}

// A lightweight CGR record shaped like listGoals output, so partitionLanes can be
// exercised purely without touching disk.
function rec(slug, { feature, owns = [], exclusive = false, order, files = [], dependsOn = [] } = {}) {
  const meta = { slug };
  if (feature !== undefined) meta.feature = feature;
  if (owns.length) meta.owns = owns;
  if (exclusive) meta.exclusive = true;
  if (order !== undefined) meta.order = order;
  if (files.length) meta["files-to-touch"] = files;
  if (dependsOn.length) meta["depends-on"] = dependsOn;
  return { slug, meta };
}

// Find the lane (by membership) that contains a given slug.
function laneWith(plan, slug) {
  return [...plan.lanes, ...plan.barriers].find((l) => l.goals.includes(slug));
}

// ── prediction-field round-trip ──────────────────────────────────────────────

test("writeGoal persists owns/feature/exclusive/dependsOn; accessors read them back", () => {
  const arch = freshArch();
  writeGoal(arch, {
    slug: "x", title: "X", exitCriteria: ["e"],
    owns: ["src/x/*", "src/lib/x.mjs"], feature: "Auth", exclusive: true, dependsOn: ["y", "z"],
  });
  const g = loadGoal(arch, "x");
  assert.deepEqual(ownsOf(g), ["src/x/*", "src/lib/x.mjs"]);
  assert.equal(featureOf(g), "auth", "feature is normalized to lowercase");
  assert.equal(exclusiveOf(g), true);
  assert.deepEqual(dependsOnOf(g), ["y", "z"]);
});

test("absent prediction fields stay absent (legacy goals untouched)", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "plain", title: "Plain", exitCriteria: ["e"] });
  const g = loadGoal(arch, "plain");
  assert.deepEqual(ownsOf(g), []);
  assert.equal(featureOf(g), null);
  assert.equal(exclusiveOf(g), false);
  assert.equal(g.meta.owns, undefined);
  assert.equal(g.meta.exclusive, undefined);
});

// ── glob-overlap primitive ───────────────────────────────────────────────────

test("globsIntersect: prefix-aware overlap", () => {
  assert.equal(globsIntersect("src/lib/*", "src/lib/board.mjs"), true);
  assert.equal(globsIntersect("src/auth/", "src/auth/login.mjs"), true);
  assert.equal(globsIntersect("src/x.mjs", "src/x.mjs"), true);
  assert.equal(globsIntersect("src/auth/", "src/billing/"), false);
  assert.equal(globsIntersect("", "src/x"), false, "a blank claim owns nothing");
});

test("ownsOverlap: any pair across two sets", () => {
  assert.equal(ownsOverlap(["src/a/*"], ["src/b/*"]), false);
  assert.equal(ownsOverlap(["src/a/*", "src/c.mjs"], ["src/c.mjs"]), true);
  assert.equal(ownsOverlap([], ["src/a"]), false);
});

// ── partition correctness ────────────────────────────────────────────────────

test("feature cohesion: same feature → one lane; distinct features → parallel lanes", () => {
  const plan = partitionLanes([
    rec("a", { feature: "auth", owns: ["src/auth/a.mjs"], order: 0 }),
    rec("b", { feature: "auth", owns: ["src/auth/b.mjs"], order: 1 }),
    rec("c", { feature: "billing", owns: ["src/billing/c.mjs"], order: 2 }),
  ]);
  assert.equal(plan.lanes.length, 2);
  assert.equal(plan.barriers.length, 0);
  assert.equal(plan.parallelWidth, 2, "two disjoint lanes can run in parallel");
  assert.deepEqual(laneWith(plan, "a").goals, ["a", "b"], "auth goals share a lane");
  assert.equal(laneWith(plan, "a").lane, "auth", "lane named after the shared feature");
  assert.deepEqual(laneWith(plan, "c").goals, ["c"]);
  assert.notEqual(laneWith(plan, "a"), laneWith(plan, "c"));
});

test("within a lane, goals are ordered by relay `order`", () => {
  const plan = partitionLanes([
    rec("late", { feature: "auth", order: 5 }),
    rec("early", { feature: "auth", order: 1 }),
  ]);
  assert.deepEqual(plan.lanes[0].goals, ["early", "late"]);
});

test("partitionLanes is pure (same input → identical plan)", () => {
  const build = () => partitionLanes([
    rec("a", { feature: "auth", owns: ["src/auth/*"], order: 0 }),
    rec("b", { feature: "billing", owns: ["src/billing/*"], order: 1 }),
    rec("z", { exclusive: true, owns: ["src/**"], order: 2 }),
  ]);
  assert.deepEqual(build(), build());
});

test("empty batch → empty plan, never throws", () => {
  const plan = partitionLanes([]);
  assert.deepEqual(plan, { lanes: [], barriers: [], stages: [], parallelWidth: 0 });
});

// ── disjoint-ownership enforcement ────────────────────────────────────────────

test("overlapping owns serialize into ONE lane even across different features", () => {
  const plan = partitionLanes([
    rec("a", { feature: "auth", owns: ["src/shared/util.mjs"], order: 0 }),
    rec("b", { feature: "billing", owns: ["src/shared/util.mjs"], order: 1 }),
  ]);
  assert.equal(plan.lanes.length, 1, "shared ownership cannot run in parallel");
  assert.deepEqual(plan.lanes[0].goals.sort(), ["a", "b"]);
});

test("across parallel lanes, ownership is provably disjoint", () => {
  const plan = partitionLanes([
    rec("a", { feature: "auth", owns: ["src/auth/*"], order: 0 }),
    rec("b", { feature: "billing", owns: ["src/billing/*"], order: 1 }),
    rec("c", { feature: "search", owns: ["src/search/*"], order: 2 }),
  ]);
  assert.equal(plan.lanes.length, 3);
  for (let i = 0; i < plan.lanes.length; i++) {
    for (let j = i + 1; j < plan.lanes.length; j++) {
      assert.equal(
        ownsOverlap(plan.lanes[i].owns, plan.lanes[j].owns), false,
        `lanes ${plan.lanes[i].lane} and ${plan.lanes[j].lane} must not share ownership`,
      );
    }
  }
});

test("transitive ownership overlap collapses a chain into one lane", () => {
  // a∩b on src/x, b∩c on src/y, but a and c never touch directly.
  const plan = partitionLanes([
    rec("a", { owns: ["src/x/a.mjs"], order: 0 }),
    rec("b", { owns: ["src/x/a.mjs", "src/y/b.mjs"], order: 1 }),
    rec("c", { owns: ["src/y/b.mjs"], order: 2 }),
  ]);
  assert.equal(plan.lanes.length, 1, "the overlap chain serializes A,B,C together");
  assert.deepEqual(plan.lanes[0].goals.sort(), ["a", "b", "c"]);
});

test("files-to-touch is used as the ownership proxy when owns is omitted", () => {
  const plan = partitionLanes([
    rec("a", { files: ["src/shared/x.mjs"], order: 0 }),
    rec("b", { files: ["src/shared/x.mjs"], order: 1 }),
  ]);
  assert.equal(plan.lanes.length, 1, "overlap via files-to-touch still serializes");
});

// ── exclusive-goal isolation ──────────────────────────────────────────────────

test("an exclusive goal becomes a solo barrier between fan-out stages", () => {
  const plan = partitionLanes([
    rec("a", { feature: "auth", owns: ["src/auth/a.mjs"], order: 0 }),
    rec("rename", { exclusive: true, owns: ["src/**"], order: 1 }),
    rec("c", { feature: "billing", owns: ["src/billing/c.mjs"], order: 2 }),
  ]);
  assert.equal(plan.barriers.length, 1);
  assert.deepEqual(plan.barriers[0].goals, ["rename"]);
  assert.equal(plan.barriers[0].exclusive, true);

  // The barrier is NOT a parallel lane, and its repo-wide owns did not drag the
  // regular goals into its group.
  assert.equal(plan.lanes.length, 2, "regular goals fan out around the barrier");
  assert.equal(laneWith(plan, "rename").exclusive, true);

  // Stages: fan-out → barrier → fan-out (everything merges before, resumes after).
  assert.deepEqual(plan.stages.map((s) => s.kind), ["fan-out", "barrier", "fan-out"]);
  assert.equal(plan.stages[1].goal, "rename");
});

test("multiple exclusive goals each get their own barrier stage", () => {
  const plan = partitionLanes([
    rec("e1", { exclusive: true, order: 0 }),
    rec("a", { feature: "auth", order: 1 }),
    rec("e2", { exclusive: true, order: 2 }),
  ]);
  assert.equal(plan.barriers.length, 2);
  assert.deepEqual(plan.stages.map((s) => s.kind), ["barrier", "fan-out", "barrier"]);
});

// ── intake integration ────────────────────────────────────────────────────────

test("runGoalIntake emits the lane plan and stamps each goal's computed lane", () => {
  const arch = freshArch();
  const cwd = path.dirname(arch);
  const res = runGoalIntake({
    archDir: arch, cwd, sourceAsk: "build it",
    goals: [
      { title: "Auth A", slug: "auth-a", exitCriteria: ["e"], feature: "auth", owns: ["src/auth/a.mjs"] },
      { title: "Auth B", slug: "auth-b", exitCriteria: ["e"], feature: "auth", owns: ["src/auth/b.mjs"] },
      { title: "Bill C", slug: "bill-c", exitCriteria: ["e"], feature: "billing", owns: ["src/billing/c.mjs"] },
      { title: "Repo rename", slug: "repo-rename", exitCriteria: ["e"], exclusive: true, owns: ["src/**"] },
    ],
  });

  assert.ok(res.lanes, "intake returns a lane plan");
  assert.equal(res.lanes.lanes.length, 2, "auth lane + billing lane");
  assert.equal(res.lanes.barriers.length, 1, "the rename is a barrier");

  // The auth goals were stamped onto one shared lane; billing on its own.
  assert.equal(laneOf(loadGoal(arch, "auth-a")), "auth");
  assert.equal(laneOf(loadGoal(arch, "auth-b")), "auth");
  assert.equal(laneOf(loadGoal(arch, "bill-c")), "billing");
  assert.equal(laneOf(loadGoal(arch, "repo-rename")), "barrier-repo-rename");

  // owns/feature/exclusive persisted through intake.
  assert.deepEqual(ownsOf(loadGoal(arch, "auth-a")), ["src/auth/a.mjs"]);
  assert.equal(exclusiveOf(loadGoal(arch, "repo-rename")), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
