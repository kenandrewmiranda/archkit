#!/usr/bin/env node
// Tests for the LANE CONVERGENCE stage (lane-convergence-stage, ADR 0023) —
// the stage that makes lanes converge to the branch tip BEFORE the merge queue
// drains, so a stale-base worker branch can never revert an integration point
// that landed earlier in the same drain.
//
// What this verifies:
//   - laneConvergencePlan groups the ordered merge queue BY LANE — one
//     integration point per lane, not N independent merges onto the branch (EC1)
//   - every group carries the explicit rebase-onto-branch-tip PRECONDITION, and
//     the `git checkout <branch> -- <owned paths>` path-extract FALLBACK (EC2)
//   - cross-lane dependency order from orderMergeQueue survives the grouping:
//     a lane containing a CGR that depends_on a CGR in another lane lands AFTER
//     it; mutually dependent lanes degrade to ordered segments, never lose order (EC3)
//   - the STALE-BASE scenario: two lanes whose naive sequential merge would
//     clobber, asserting the emitted plan carries the rebase precondition (EC5)
//   - the plan is EMITTED, never executed — archkit shells out to no git (ADR 0010)
//   - the concept is named "convergence", never "reconcile" (archkit_goal_reconcile
//     is goal-FILE placement — the two must not be confusable in output)
//   - conductorPlan exposes it as `convergence` while keeping `mergeOrder` intact
//   - the conductor prompt's step 5 emits the lane-grouped plan, not a flat list (EC4)

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  laneConvergencePlan,
  laneConvergence,
  renderConvergencePlan,
  integrationBranch,
  conductorPlan,
  appendEvent,
  CONVERGENCE_PRECONDITION,
  CONVERGENCE_FALLBACK,
  DEFAULT_INTEGRATION_BRANCH,
} from "../../src/lib/board.mjs";
import { writeGoal, startGoal, stampGoalFields } from "../../src/lib/goals.mjs";
import { prompts } from "../../src/mcp/prompts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshArch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-convergence-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  return arch;
}
function liveGoal(arch, slug, fields = {}) {
  writeGoal(arch, { slug, title: slug, exitCriteria: ["x"] });
  startGoal(arch, slug);
  if (Object.keys(fields).length) stampGoalFields(arch, slug, fields);
  return slug;
}
const NOW = "2026-08-02T12:00:00.000Z";
const q = (slug, lane, since, extra = {}) => ({ slug, lane, since, completion: "full", ...extra });

console.log("\nLane convergence stage (ADR 0023)\n");

// ── EC1: grouped BY LANE, one integration point per lane ─────────────────────

test("EC1: the ordered queue collapses to ONE integration point per lane", () => {
  const ordered = [
    q("board-a", "board", "1"),
    q("board-b", "board", "2"),
    q("goals-a", "goals", "3"),
  ];
  const plan = laneConvergencePlan(ordered, { branch: "main" });
  assert.equal(plan.groups.length, 2, "3 CGRs on 2 lanes → 2 integration points, not 3 merges");
  assert.deepEqual(plan.groups.map((g) => g.lane), ["board", "goals"]);
  assert.deepEqual(plan.groups[0].slugs, ["board-a", "board-b"], "lane members stay in queue order");
  assert.deepEqual(plan.counts, { groups: 2, lanes: 2, cgrs: 3, crossLaneEdges: 0 });
});

test("EC1: a laneless queue still yields a single 'default' integration point", () => {
  const plan = laneConvergencePlan([q("a", null, "1"), q("b", undefined, "2")], { branch: "main" });
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].lane, "default");
  assert.deepEqual(plan.groups[0].slugs, ["a", "b"]);
});

test("EC1: an empty queue yields no groups (and renders the empty case)", () => {
  const plan = laneConvergencePlan([], { branch: "main" });
  assert.deepEqual(plan.groups, []);
  assert.equal(plan.counts.cgrs, 0);
  assert.match(renderConvergencePlan(plan).join("\n"), /queue empty/i);
});

// ── EC2: rebase-onto-tip precondition + path-extract fallback ────────────────

test("EC2: EVERY group carries the rebase-onto-branch-tip precondition", () => {
  const plan = laneConvergencePlan([q("a", "l1", "1"), q("b", "l2", "2")], { branch: "trunk" });
  for (const g of plan.groups) {
    assert.equal(g.precondition.kind, CONVERGENCE_PRECONDITION);
    assert.equal(g.precondition.kind, "rebase-onto-tip");
    assert.equal(g.precondition.branch, "trunk", "the precondition names the integration branch");
    assert.match(g.precondition.command, /git .*rebase trunk/, "an explicit rebase onto the branch tip");
    assert.match(g.precondition.why, /stale/i, "the precondition explains the stale-base hazard");
  }
  assert.equal(plan.precondition, "rebase-onto-tip", "the plan declares its primary primitive");
});

test("EC2: the fallback is `git checkout <branch> -- <owned paths>`, bounded by ownership", () => {
  const paths = { "a": ["src/lib/board.mjs"], "b": ["src/mcp/prompts.mjs", "tests/x/run.mjs"] };
  const plan = laneConvergencePlan([q("a", "l1", "1"), q("b", "l1", "2")], {
    branch: "main",
    pathsOf: (s) => paths[s] || [],
    branchOf: () => "worktree-agent-abc",
  });
  const g = plan.groups[0];
  assert.deepEqual(g.paths, ["src/lib/board.mjs", "src/mcp/prompts.mjs", "tests/x/run.mjs"],
    "the group's owned paths are the union of its CGRs'");
  assert.equal(g.fallback.kind, CONVERGENCE_FALLBACK);
  assert.equal(g.fallback.kind, "path-extract");
  assert.equal(
    g.fallback.command,
    "git checkout worktree-agent-abc -- src/lib/board.mjs src/mcp/prompts.mjs tests/x/run.mjs",
    "path-extract names the lane branch and ONLY the lane's owned paths",
  );
  assert.equal(g.fallback.on, "main", "path-extract is run from the integration branch");
  assert.match(g.fallback.when, /stale/i, "the fallback is scoped to an unrecoverably stale base");
});

test("EC2: an unknown worker branch degrades to a lane placeholder, never a bad command", () => {
  const plan = laneConvergencePlan([q("a", "board", "1")], { branch: "main" });
  assert.equal(plan.groups[0].branchRef, "<worktree-branch:board>");
  assert.match(plan.groups[0].fallback.command, /^git checkout <worktree-branch:board> -- <owned paths>$/);
});

// ── EC3: cross-lane dependency order survives the grouping ──────────────────

test("EC3: a lane depending on another lane lands AFTER it (order preserved)", () => {
  // Queue order (already dependency-ordered by orderMergeQueue): base(goals) →
  // ui(view) → follow(goals). Grouping by lane must NOT float the `goals` lane
  // ahead of `view` blindly — but here `view` depends on `goals`, so goals first.
  const ordered = [q("base", "goals", "1"), q("ui", "view", "2"), q("follow", "goals", "3")];
  const depsOf = (s) => (s === "ui" ? ["base"] : []);
  const plan = laneConvergencePlan(ordered, { branch: "main", depsOf });
  assert.deepEqual(plan.groups.map((g) => g.lane), ["goals", "view"]);
  assert.deepEqual(plan.groups[0].slugs, ["base", "follow"]);
  assert.deepEqual(plan.groups[1].dependsOnLanes, ["goals"], "the cross-lane edge is explicit");
  assert.equal(plan.counts.crossLaneEdges, 1);
  assert.equal(plan.split, false);
});

test("EC3: the dependent lane lands after its dependency even when it appears FIRST in the queue", () => {
  // `api` appears first in the flat queue, but its second CGR depends on a CGR in
  // `db` — collapsing api into one point would otherwise land it before db.
  const ordered = [q("api-a", "api", "1"), q("db-a", "db", "2"), q("api-b", "api", "3")];
  const depsOf = (s) => (s === "api-b" ? ["db-a"] : []);
  const plan = laneConvergencePlan(ordered, { branch: "main", depsOf });
  assert.deepEqual(plan.groups.map((g) => g.lane), ["db", "api"],
    "api waits for db because api-b depends_on db-a — the flat first-appearance order is overridden");
  const apiIdx = plan.groups.findIndex((g) => g.lane === "api");
  const dbIdx = plan.groups.findIndex((g) => g.lane === "db");
  assert.ok(dbIdx < apiIdx, "dependency lane strictly precedes the dependent lane");
});

test("EC3: independent lanes keep the queue's relative order", () => {
  const ordered = [q("z1", "zeta", "1"), q("a1", "alpha", "2")];
  const plan = laneConvergencePlan(ordered, { branch: "main" });
  assert.deepEqual(plan.groups.map((g) => g.lane), ["zeta", "alpha"],
    "no deps → first-appearance order, not alphabetical");
});

test("EC3: mutually dependent lanes degrade to ordered SEGMENTS, never lose order or items", () => {
  // l1→l2→l1: no per-lane collapse can honor both edges, so the plan splits into
  // contiguous segments of the flat (already dependency-ordered) queue.
  const ordered = [q("a", "l1", "1"), q("b", "l2", "2"), q("c", "l1", "3")];
  const depsOf = (s) => (s === "b" ? ["a"] : s === "c" ? ["b"] : []);
  const plan = laneConvergencePlan(ordered, { branch: "main", depsOf });
  assert.equal(plan.split, true);
  assert.equal(plan.splitReason, "cross-lane-dependency-cycle");
  assert.deepEqual(plan.groups.map((g) => g.slugs), [["a"], ["b"], ["c"]],
    "the flat dependency order is preserved verbatim");
  assert.deepEqual(plan.groups.map((g) => g.segment), [1, 2, 3]);
  // Even in the degraded case the precondition is still emitted per group.
  for (const g of plan.groups) assert.equal(g.precondition.kind, "rebase-onto-tip");
});

test("EC3: deps pointing OUTSIDE the queue impose no lane edge", () => {
  const ordered = [q("a", "l1", "1"), q("b", "l2", "2")];
  const depsOf = (s) => (s === "a" ? ["already-merged"] : []);
  const plan = laneConvergencePlan(ordered, { branch: "main", depsOf });
  assert.equal(plan.counts.crossLaneEdges, 0);
  assert.deepEqual(plan.groups.map((g) => g.lane), ["l1", "l2"]);
});

// ── EC5: the stale-base clobber scenario ─────────────────────────────────────

test("EC5: STALE BASE — two lanes that would clobber if merged naively emit the rebase precondition", () => {
  // The hazard, concretely: lane `board` and lane `relay` BOTH touch
  // src/mcp/prompts.mjs. Both workers were cut from the same stale base commit.
  // Draining the flat queue naively = `git merge board-branch` then
  // `git merge relay-branch`; relay's tree still holds the PRE-board content of
  // prompts.mjs, so the second merge reverts what the first just landed.
  const arch = freshArch();
  liveGoal(arch, "board-cgr", { lane: "board", owns: ["src/lib/board.mjs", "src/mcp/prompts.mjs"] });
  liveGoal(arch, "relay-cgr", { lane: "relay", owns: ["src/mcp/prompts.mjs"] });
  appendEvent(arch, { type: "completed", slug: "board-cgr", at: "2026-08-02T10:00:00.000Z" });
  appendEvent(arch, { type: "completed", slug: "relay-cgr", at: "2026-08-02T11:00:00.000Z" });

  const plan = laneConvergence(arch, { now: NOW });

  // Two lanes → two integration points, each preceded by convergence onto the tip.
  assert.equal(plan.groups.length, 2, "one integration point per lane");
  assert.deepEqual(plan.groups.map((g) => g.lane), ["board", "relay"]);
  for (const g of plan.groups) {
    assert.equal(g.precondition.kind, "rebase-onto-tip",
      `lane ${g.lane} must converge onto the branch tip BEFORE it lands`);
    assert.match(g.precondition.command, /rebase main/);
    assert.equal(g.fallback.kind, "path-extract");
  }

  // The overlapping file is claimed by both lanes — exactly the clobber surface.
  const boardPaths = plan.groups[0].paths, relayPaths = plan.groups[1].paths;
  assert.ok(boardPaths.includes("src/mcp/prompts.mjs") && relayPaths.includes("src/mcp/prompts.mjs"),
    "the two lanes contend on the same file — the naive-merge revert hazard");
  // The SECOND lane is the dangerous one: it lands onto a tip that already carries
  // lane one, so its rebase precondition is what prevents the revert.
  const second = plan.groups[1];
  assert.match(second.precondition.why, /stale/i);
  assert.match(second.precondition.why, /revert|earlier/i,
    "the emitted reason names the revert-an-earlier-merge hazard");

  // The rendered instruction the conductor actually reads carries it too.
  const text = renderConvergencePlan(plan).join("\n");
  assert.match(text, /PRECONDITION \(rebase-onto-tip\)/);
  assert.match(text, /git checkout .* -- .*src\/mcp\/prompts\.mjs/, "path-extract fallback is rendered");
  assert.match(text, /Never merge a worker branch onto main without step 1/);
});

test("EC5: files-to-touch counts as owned paths alongside `owns`", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "g", title: "g", exitCriteria: ["x"], filesToTouch: ["docs/x.md"] });
  startGoal(arch, "g");
  stampGoalFields(arch, "g", { lane: "L", owns: ["src/lib/board.mjs"] });
  appendEvent(arch, { type: "completed", slug: "g", at: "2026-08-02T10:00:00.000Z" });
  const plan = laneConvergence(arch, { now: NOW });
  assert.deepEqual(plan.groups[0].paths, ["docs/x.md", "src/lib/board.mjs"]);
});

// ── integration branch resolution ────────────────────────────────────────────

test("integrationBranch defaults to main and reads cgr.integrationBranch", () => {
  const arch = freshArch();
  assert.equal(integrationBranch(arch), DEFAULT_INTEGRATION_BRANCH);
  assert.equal(DEFAULT_INTEGRATION_BRANCH, "main");
  fs.writeFileSync(path.join(arch, "config.json"), JSON.stringify({ cgr: { integrationBranch: "trunk" } }));
  assert.equal(integrationBranch(arch), "trunk");
  fs.writeFileSync(path.join(arch, "config.json"), "{ not json");
  assert.equal(integrationBranch(arch), "main", "a broken config never throws — it falls back");
});

// ── instruct-not-act (ADR 0010): the plan is EMITTED, never executed ─────────

test("the convergence stage never shells out to git (instruct-not-act, ADR 0010)", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/board.mjs"), "utf8");
  assert.ok(!/from\s+["']node:child_process["']|require\(["']child_process["']\)/.test(src),
    "board.mjs must not import child_process");
  assert.ok(!/\b(execSync|execFileSync|spawnSync|execFile)\s*\(/.test(src),
    "board.mjs must not call any process-spawning API");
  // Every git string it emits lives inside a plan structure, not an execution.
  const plan = laneConvergencePlan([q("a", "l", "1")], { branch: "main" });
  assert.equal(typeof plan.groups[0].precondition.command, "string");
  assert.equal(typeof plan.groups[0].integration.command, "string");
});

test("the concept is named CONVERGENCE — never 'reconcile' (that word is goal-file placement)", () => {
  const plan = laneConvergencePlan([q("a", "l", "1")], { branch: "main" });
  const emitted = JSON.stringify(plan) + "\n" + renderConvergencePlan(plan).join("\n");
  assert.ok(!/reconcil/i.test(emitted),
    "the emitted plan must not use 'reconcile' — archkit_goal_reconcile is a different concept");
  assert.match(emitted, /converge|convergence|rebase-onto-tip/i);
});

// ── EC4: conductorPlan + the /mcp__archkit__conductor prompt step 5 ──────────

test("conductorPlan exposes `convergence` and keeps `mergeOrder` for existing consumers", () => {
  const arch = freshArch();
  liveGoal(arch, "m1", { lane: "backend", owns: ["src/a.mjs"] });
  liveGoal(arch, "m2", { lane: "frontend", owns: ["src/b.mjs"] });
  appendEvent(arch, { type: "completed", slug: "m1", at: "2026-08-02T10:00:00.000Z" });
  appendEvent(arch, { type: "completed", slug: "m2", at: "2026-08-02T11:00:00.000Z" });
  const plan = conductorPlan(arch, { now: NOW });
  assert.deepEqual(plan.mergeOrder.map((m) => m.slug), ["m1", "m2"], "the flat order still exists");
  assert.equal(plan.convergence.groups.length, 2);
  assert.equal(plan.counts.convergenceGroups, 2);
  assert.deepEqual(plan.convergence.groups.map((g) => g.lane), ["backend", "frontend"]);
});

await testAsync("EC4: the conductor prompt's step 5 emits the lane-grouped plan, not a flat slug list", async () => {
  const arch = freshArch();
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "# system\n");
  liveGoal(arch, "board-cgr", { lane: "board", owns: ["src/lib/board.mjs"] });
  liveGoal(arch, "relay-cgr", { lane: "relay", owns: ["src/mcp/prompts.mjs"] });
  appendEvent(arch, { type: "completed", slug: "board-cgr", at: "2026-08-02T10:00:00.000Z" });
  appendEvent(arch, { type: "completed", slug: "relay-cgr", at: "2026-08-02T11:00:00.000Z" });

  const cwd = process.cwd();
  process.chdir(path.dirname(arch));
  let text;
  try {
    const msg = await prompts.conductor.handler();
    text = msg.messages[0].content.text;
  } finally { process.chdir(cwd); }

  assert.match(text, /5\. CONVERGE \+ MERGE/, "step 5 is the convergence stage");
  assert.match(text, /integration points \(one per lane\)/);
  assert.match(text, /lane board: board-cgr/);
  assert.match(text, /lane relay: relay-cgr/);
  assert.match(text, /PRECONDITION \(rebase-onto-tip\)/, "the rebase precondition is in the prompt");
  assert.match(text, /FALLBACK \(path-extract\)/, "the path-extract fallback is in the prompt");
  assert.ok(!/MERGE the queue SEQUENTIALLY in this dependency order: /.test(text),
    "the old flat slug list is gone");
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
