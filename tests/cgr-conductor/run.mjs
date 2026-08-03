#!/usr/bin/env node
// Tests for the CGR 2.0 conductor orchestration loop + rehydration hooks
// (conductor-loop-hooks, ADR 0013/0014/0015).
//
// Exit-criterion 6 names three required coverages — orphan-lease reclaim,
// rehydrate-from-board, and merge-queue ordering — plus the supporting pieces:
//   - claimFrontier stamps a lease + appends a `claimed` event with TTL expiry
//   - reclaimExpiredLeases appends lease-expired + clears the stale lease, idempotent
//   - orderMergeQueue / mergeQueueOrder respect depends_on, tie-break (since, slug)
//   - conductorPlan assembles claimable lanes, barriers, exceptions, merge order
//   - conductorExceptions flags partials / non-green / low-accuracy / cross-lane
//   - PreCompact flush marker write/read/clear
//   - rehydrateConductor reclaims orphans, consumes the flush marker, folds a plan
//   - stopGuardDecision releases per-lane (drained OR wind-down handoff), else blocks
//   - config knobs (windDownAt/windDownAtByModel/leaseTtlHours) resolve (EC4)
//
// conductor-dispatch-claim-wiring (ADR 0027) adds the CLAIM half of dispatch —
// the pass has to tell the conductor to claim each lane, not just to spawn for it:
//   - dispatchClaims derives one archkit_goal_start {slug, worker} call per
//     claimable slug, grouped by dispatch unit (lane, or a solo barrier)
//   - conductorPlan carries that as `dispatch` + counts.dispatch_claims
//   - the RENDERED pass (conductorGraph) carries the claim step with the worker
//     identifier, and never offers archkit_goal_hold as an action
//   - end to end: claim -> dispatched -> session_state.in_flight -> complete,
//     including a worker's own goal_start only CONFIRMING the existing claim

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendEvent,
  readEvents,
  sessionState,
  claimFrontier,
  reclaimExpiredLeases,
  orderMergeQueue,
  mergeQueueOrder,
  conductorExceptions,
  conductorPlan,
  rehydrateConductor,
  writeFlushMarker,
  readFlushMarker,
  clearFlushMarker,
  flushMarkerPath,
  stopGuardDecision,
  writeHandoff,
  dispatchClaims,
  dispatchWorkerId,
  recordCompletion,
  recordMerge,
} from "../../src/lib/board.mjs";
import { runGoalComplete } from "../../src/commands/goal.mjs";
import { conductorGraph } from "../../src/lib/format.mjs";
import {
  writeGoal,
  loadGoal,
  startGoal,
  stampGoalFields,
  leaseOf,
  leaseTtlHours,
  windDownAt,
  dispatchGoal,
  completeGoal,
  statusOf,
  getActiveGoal,
  isGoalDone,
  STATUS_DISPATCHED,
} from "../../src/lib/goals.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshArch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-conductor-"));
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
// A temp PROJECT (root + .arch/) — runGoalComplete needs a cwd it can run the
// verify-command and `git diff` in, unlike the bare-.arch helpers above.
function freshProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-conductor-proj-"));
  const arch = path.join(root, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: {} }, null, 2));
  return { root, arch };
}
const PASS_CMD = `node -e "process.exit(0)"`;

function pendingGoal(arch, slug, fields = {}) {
  writeGoal(arch, { slug, title: slug, exitCriteria: ["x"] });
  if (Object.keys(fields).length) stampGoalFields(arch, slug, fields);
  return slug;
}
const NOW = "2026-06-23T12:00:00.000Z";

// ── claimFrontier ─────────────────────────────────────────────────────────────

test("claimFrontier stamps a lease + appends a claimed event with TTL expiry", () => {
  const arch = freshArch();
  pendingGoal(arch, "p", { lane: "backend" });
  const r = claimFrontier(arch, { slug: "p", worker: "w1", now: NOW, ttlHours: 24 });
  assert.equal(r.lease.worker, "w1");
  assert.equal(r.lease.expires, "2026-06-24T12:00:00.000Z", "expires = now + 24h");
  assert.equal(r.lane, "backend", "lane resolved from the goal");
  // Lease stamped on the live CGR.
  assert.deepEqual(leaseOf(loadGoal(arch, "p")), { worker: "w1", expires: "2026-06-24T12:00:00.000Z" });
  // A claimed event was folded → the goal is now in_flight.
  const s = sessionState(arch, { now: NOW });
  assert.deepEqual(s.in_flight.map((f) => f.slug), ["p"]);
  assert.equal(readEvents(arch).filter((e) => e.type === "claimed").length, 1);
});

test("claimFrontier defaults the TTL from cgr.leaseTtlHours", () => {
  const arch = freshArch();
  fs.writeFileSync(path.join(arch, "config.json"), JSON.stringify({ cgr: { leaseTtlHours: 1 } }));
  pendingGoal(arch, "p");
  const r = claimFrontier(arch, { slug: "p", worker: "w", now: NOW });
  assert.equal(r.lease.expires, "2026-06-23T13:00:00.000Z", "default TTL (1h) from config applied");
});

// ── orphan-lease reclaim (exit-criterion 3 + 6) ───────────────────────────────

test("reclaimExpiredLeases reclaims TTL-expired claims, leaves live ones", () => {
  const arch = freshArch();
  liveGoal(arch, "x", { lane: "L" });
  liveGoal(arch, "y", { lane: "L" });
  appendEvent(arch, { type: "claimed", slug: "x", worker: "w1", lane: "L",
    lease: { worker: "w1", expires: "2026-06-23T10:00:00.000Z" } }); // past
  appendEvent(arch, { type: "claimed", slug: "y", worker: "w2", lane: "L",
    lease: { worker: "w2", expires: "2026-06-23T23:00:00.000Z" } }); // future
  // Mirror the lease onto the CGRs so the clear-on-reclaim is observable.
  stampGoalFields(arch, "x", { lease: { worker: "w1", expires: "2026-06-23T10:00:00.000Z" } });

  const { reclaimed } = reclaimExpiredLeases(arch, { now: NOW });
  assert.deepEqual(reclaimed.map((r) => r.slug), ["x"], "only the past-TTL claim is reclaimed");
  assert.equal(reclaimed[0].worker, "w1");
  // A lease-expired event was appended and the stale lease cleared.
  assert.ok(readEvents(arch).some((e) => e.type === "lease-expired" && e.slug === "x"));
  assert.equal(leaseOf(loadGoal(arch, "x")), null, "stale lease cleared off the orphan");
  // y untouched.
  const s = sessionState(arch, { now: NOW });
  assert.deepEqual(s.in_flight.map((f) => f.slug), ["y"], "the live claim stays in flight");
});

test("reclaimExpiredLeases is idempotent (no double-append)", () => {
  const arch = freshArch();
  liveGoal(arch, "x", { lane: "L" });
  appendEvent(arch, { type: "claimed", slug: "x", worker: "w1", lane: "L",
    lease: { worker: "w1", expires: "2026-06-23T10:00:00.000Z" } });
  reclaimExpiredLeases(arch, { now: NOW });
  const after1 = readEvents(arch).filter((e) => e.type === "lease-expired").length;
  const second = reclaimExpiredLeases(arch, { now: NOW });
  const after2 = readEvents(arch).filter((e) => e.type === "lease-expired").length;
  assert.equal(second.reclaimed.length, 0, "already-reclaimed orphan not reclaimed again");
  assert.equal(after1, after2, "no duplicate lease-expired event");
});

// ── merge-queue ordering (exit-criterion 1 + 6) ───────────────────────────────

test("orderMergeQueue is pure: deps win over the (since,slug) tie-break", () => {
  // b depends on a, but b completed EARLIER → tie-break alone would float b first.
  const queue = [
    { slug: "b", since: "2026-06-23T10:00:00.000Z" },
    { slug: "a", since: "2026-06-23T11:00:00.000Z" },
  ];
  const depsOf = (s) => (s === "b" ? ["a"] : []);
  assert.deepEqual(orderMergeQueue(queue, depsOf).map((m) => m.slug), ["a", "b"],
    "dependency forces a before b despite later completion");
});

test("orderMergeQueue tie-breaks independent items by (since, slug)", () => {
  const queue = [
    { slug: "z", since: "2026-06-23T11:00:00.000Z" },
    { slug: "a", since: "2026-06-23T11:00:00.000Z" }, // same since → slug tiebreak
    { slug: "m", since: "2026-06-23T09:00:00.000Z" }, // earliest since → first
  ];
  assert.deepEqual(orderMergeQueue(queue, () => []).map((m) => m.slug), ["m", "a", "z"]);
});

test("orderMergeQueue never drops items on a dependency cycle", () => {
  const queue = [{ slug: "a", since: "1" }, { slug: "b", since: "2" }];
  const depsOf = (s) => (s === "a" ? ["b"] : ["a"]); // a↔b cycle
  const out = orderMergeQueue(queue, depsOf).map((m) => m.slug);
  assert.deepEqual([...out].sort(), ["a", "b"], "both items still returned");
});

test("mergeQueueOrder reads depends_on from live CGRs", () => {
  const arch = freshArch();
  liveGoal(arch, "base", { lane: "L" });
  liveGoal(arch, "feat", { lane: "L", dependsOn: ["base"] });
  // feat completes first, base second — deps must still order base→feat.
  appendEvent(arch, { type: "completed", slug: "feat", at: "2026-06-23T10:00:00.000Z" });
  appendEvent(arch, { type: "completed", slug: "base", at: "2026-06-23T11:00:00.000Z" });
  const ordered = mergeQueueOrder(arch, { now: NOW });
  assert.deepEqual(ordered.map((m) => m.slug), ["base", "feat"]);
});

// ── conductor exceptions + plan ───────────────────────────────────────────────

test("conductorExceptions flags partial/non-green/low-accuracy/cross-lane", () => {
  const board = {
    merge_queue: [{ slug: "part", completion: "partial" }, { slug: "ok", completion: "full" }],
    handoffs: [
      { slug: "red", resolved: true, verificationStatus: "red", ownershipAccuracy: 1 },
      { slug: "drift", resolved: true, verificationStatus: "green", ownershipAccuracy: 0.2 },
      { slug: "ok", resolved: true, verificationStatus: "green", ownershipAccuracy: 1 },
    ],
    conflicts: [{ slugs: ["c1", "c2"], crossLane: true }, { slugs: ["s1", "s2"], crossLane: false }],
    leases_expired: [{ slug: "orphan" }],
  };
  const r = conductorExceptions(board);
  const bySlug = Object.fromEntries(r.exceptions.map((e) => [e.slug, e.reasons]));
  assert.ok(bySlug.part.includes("partial-completion"));
  assert.ok(bySlug.red.some((x) => x.startsWith("verification-red")));
  assert.ok(bySlug.drift.some((x) => x.startsWith("low-ownership-accuracy")));
  assert.ok(bySlug.c1.includes("cross-lane-conflict") && bySlug.c2.includes("cross-lane-conflict"));
  assert.ok(!bySlug.s1, "same-lane conflict is not an exception");
  assert.deepEqual(r.clean, ["ok"], "the clean merge-queue item needs no deep review");
  assert.deepEqual(r.leasesExpired, ["orphan"]);
});

test("conductorPlan groups claimable frontier by lane, splits barriers, orders merges", () => {
  const arch = freshArch();
  pendingGoal(arch, "f1", { lane: "backend" });
  pendingGoal(arch, "f2", { lane: "frontend" });
  pendingGoal(arch, "x1", { lane: "wide", exclusive: true }); // barrier
  liveGoal(arch, "m1", { lane: "backend" });
  appendEvent(arch, { type: "completed", slug: "m1", at: "2026-06-23T10:00:00.000Z" });
  const plan = conductorPlan(arch, { now: NOW });
  assert.deepEqual(Object.keys(plan.claimableLanes).sort(), ["backend", "frontend"]);
  assert.deepEqual(plan.claimableLanes.backend, ["f1"]);
  assert.deepEqual(plan.barriers, ["x1"], "exclusive frontier CGR is a solo barrier");
  assert.deepEqual(plan.mergeOrder.map((m) => m.slug), ["m1"]);
  assert.equal(plan.counts.claimableLanes, 2);
  assert.equal(plan.counts.barriers, 1);
});

// ── PreCompact flush marker (exit-criterion 2) ────────────────────────────────

test("flush marker write/read/clear round-trips the in-flight snapshot", () => {
  const arch = freshArch();
  liveGoal(arch, "a", { lane: "L" });
  appendEvent(arch, { type: "claimed", slug: "a", worker: "w1", lane: "L" });
  const written = writeFlushMarker(arch, { now: NOW, trigger: "auto", sessionId: "s1" });
  assert.equal(written.written, true);
  assert.deepEqual(written.inFlight, ["a"]);
  assert.deepEqual(written.handoffsPending, ["a"], "no handoff yet → pending");
  const read = readFlushMarker(arch);
  assert.equal(read.trigger, "auto");
  assert.deepEqual(read.inFlight, ["a"]);
  clearFlushMarker(arch);
  assert.equal(readFlushMarker(arch), null, "marker consumed");
  assert.ok(!fs.existsSync(flushMarkerPath(arch)));
});

// ── rehydrate-from-board (exit-criterion 3 + 6) ───────────────────────────────

test("rehydrateConductor reclaims orphans, consumes the flush marker, folds a plan", () => {
  const arch = freshArch();
  liveGoal(arch, "stuck", { lane: "L" });
  appendEvent(arch, { type: "claimed", slug: "stuck", worker: "w1", lane: "L",
    lease: { worker: "w1", expires: "2026-06-23T10:00:00.000Z" } }); // expired
  pendingGoal(arch, "next", { lane: "M" });
  writeFlushMarker(arch, { now: "2026-06-23T09:00:00.000Z", trigger: "auto", board: sessionState(arch, { now: NOW }) });

  const { reclaimed, flush, plan } = rehydrateConductor(arch, { now: NOW });
  assert.deepEqual(reclaimed.map((r) => r.slug), ["stuck"], "orphan lease reclaimed on rehydrate");
  assert.ok(flush, "the flush marker was read");
  assert.equal(flush.trigger, "auto");
  assert.equal(readFlushMarker(arch), null, "flush marker consumed (cleared) by rehydration");
  assert.ok(plan.counts.frontier >= 1, "the folded plan surfaces the frontier");
  assert.deepEqual(plan.claimableLanes.M, ["next"]);
});

// ── per-lane Stop-guard release (exit-criterion 5) ────────────────────────────

test("stopGuardDecision BLOCKS a fresh, handoff-less, populated lane", () => {
  const arch = freshArch();
  liveGoal(arch, "a", { lane: "L" });
  const g = loadGoal(arch, "a");
  const d = stopGuardDecision(arch, g);
  assert.equal(d.release, false, "default per-goal blocking preserved");
  assert.equal(d.reason, null);
  assert.equal(d.lane, "L");
});

test("stopGuardDecision RELEASES when a wind-down handoff was produced", () => {
  const arch = freshArch();
  liveGoal(arch, "a", { lane: "L" });
  liveGoal(arch, "b", { lane: "L" }); // lane NOT drained (b still live)
  writeHandoff(arch, "a", { verificationStatus: "partial", remaining: ["rest"] });
  stampGoalFields(arch, "a", { handoff: ".arch/board/handoff/a.md" });
  const d = stopGuardDecision(arch, loadGoal(arch, "a"));
  assert.equal(d.release, true);
  assert.equal(d.reason, "wind-down-handoff");
  assert.equal(d.handoffProduced, true);
});

test("stopGuardDecision RELEASES when the lane is drained", () => {
  const arch = freshArch();
  liveGoal(arch, "c", { lane: "N" });
  appendEvent(arch, { type: "completed", slug: "c" }); // lane N has no live work left
  const d = stopGuardDecision(arch, loadGoal(arch, "c"));
  assert.equal(d.release, true);
  assert.equal(d.reason, "lane-drained");
  assert.equal(d.laneDrained, true);
});

// ── config policy knobs (exit-criterion 4) ────────────────────────────────────

test("config knobs resolve: windDownAt (+ per-model) and leaseTtlHours", () => {
  const arch = freshArch();
  fs.writeFileSync(path.join(arch, "config.json"), JSON.stringify({
    cgr: { windDownAt: 0.65, windDownAtByModel: { "claude-opus-4-8": 0.7 }, leaseTtlHours: 24, backlogThreshold: { count: 5, ageDays: 7 } },
  }));
  assert.equal(windDownAt(arch, {}), 0.65, "base wind-down threshold");
  assert.equal(windDownAt(arch, { model: "claude-opus-4-8" }), 0.7, "per-model override");
  assert.equal(leaseTtlHours(arch), 24, "lease TTL hours");
});

// ── the dispatch CLAIM (conductor-dispatch-claim-wiring, ADR 0027) ───────────

test("dispatchClaims derives one goal_start claim per slug, grouped by dispatch unit", () => {
  const d = dispatchClaims({
    claimableLanes: { backend: ["b1", "b2"], "output fmt": ["o1"] },
    barriers: ["solo-x"],
  });
  assert.equal(d.tool, "archkit_goal_start", "the claim is made with goal_start, not a new verb");
  assert.deepEqual(d.claims.map((c) => c.slug), ["b1", "b2", "o1", "solo-x"], "every claimable slug is claimed");
  // One worker per LANE (the dispatch unit) — both backend CGRs go to the same one.
  assert.equal(d.claims[0].worker, d.claims[1].worker, "a lane's CGRs share its worker");
  assert.equal(d.workers.backend, "w-backend");
  assert.equal(d.workers["output fmt"], dispatchWorkerId("output fmt"), "a lane id is slugified into the worker id");
  // A barrier is its OWN unit: keyed by slug, so two barriers never collide.
  const solo = d.units.find((u) => u.solo);
  assert.deepEqual(solo.slugs, ["solo-x"]);
  assert.equal(solo.worker, "w-solo-x");
  assert.equal(d.claims.find((c) => c.slug === "solo-x").lane, null);
});

test("conductorPlan carries the claims the pass owes (dispatch + counts)", () => {
  const arch = freshArch();
  pendingGoal(arch, "f1", { lane: "backend" });
  pendingGoal(arch, "f2", { lane: "frontend" });
  pendingGoal(arch, "x1", { lane: "wide", exclusive: true });
  const plan = conductorPlan(arch, { now: NOW });
  assert.deepEqual(plan.dispatch.claims.map((c) => c.slug).sort(), ["f1", "f2", "x1"]);
  assert.equal(plan.counts.dispatch_claims, 3, "one claim per claimable CGR, barriers included");
  assert.equal(plan.dispatch.workers.backend, "w-backend");
  assert.equal(plan.dispatch.workers.x1, "w-x1", "the barrier's unit is keyed by slug");
});

test("the RENDERED dispatch step tells the conductor to CLAIM with a worker before spawning", () => {
  const arch = freshArch();
  pendingGoal(arch, "f1", { lane: "backend" });
  pendingGoal(arch, "f2", { lane: "frontend" });
  const text = conductorGraph(conductorPlan(arch, { now: NOW })).join("\n");
  const claimLine = text.split("\n").find((l) => l.includes("archkit_goal_start"));
  assert.ok(claimLine, "the pass names the claim tool at all");
  assert.match(claimLine, /worker/, "…and passes a worker identifier with it");
  assert.match(claimLine, /CLAIM first/i, "…before/as the worker is spawned, not after");
  assert.match(claimLine, /dispatched/, "…so the goal lands in `dispatched`, not in-progress");
  // The claim template is emitted ONCE for N lanes — O(1), like the convergence one.
  assert.equal(text.split("archkit_goal_start").length - 1, 1, "one claim template, not one call per lane");
  // The lane tree still maps lanes to slugs, so <lane> in the template resolves.
  assert.match(text, /backend: f1/);
  assert.match(text, /frontend: f2/);
});

test("the rendered pass never offers archkit_goal_hold as a way to end the session", () => {
  const arch = freshArch();
  pendingGoal(arch, "f1", { lane: "backend" });
  pendingGoal(arch, "f2", { lane: "frontend" });
  const lines = conductorGraph(conductorPlan(arch, { now: NOW }));
  for (const line of lines) {
    if (!line.includes("archkit_goal_hold")) continue;
    // on-hold stays reserved for deliberately parked work: the only way the pass
    // may mention it is as the ✗ anti-pattern, never as a ▸ action to take.
    assert.ok(line.includes("✗"), `goal_hold must be marked as the anti-pattern, got: ${line}`);
    assert.ok(!/^\d+ ▸/.test(line), "…and never as a numbered action step");
  }
});

// ── end to end: claim → dispatched → in_flight → complete ────────────────────

test("claim → dispatched → in_flight (lane/worker/lease) → complete clears the board", () => {
  const arch = freshArch();
  pendingGoal(arch, "lane-a", { lane: "backend" });
  pendingGoal(arch, "lane-b", { lane: "frontend" });
  const worker = conductorPlan(arch, { now: NOW }).dispatch.workers.backend;

  // 1. the conductor claims, exactly as archkit_goal_start {slug, worker} does.
  const claim = claimFrontier(arch, { slug: "lane-a", worker, now: NOW });
  const dispatched = dispatchGoal(arch, "lane-a", { worker });
  assert.equal(dispatched.status, STATUS_DISPATCHED, "the claim dispatches rather than starting");
  assert.equal(claim.lane, "backend");

  // 2. the guard is released in the claiming session, and the board shows the
  //    dispatch — so a conductor cleared mid-pass rehydrates it.
  assert.equal(getActiveGoal(arch), null, "a dispatched goal does not guard the conductor's session");
  const flight = sessionState(arch, { now: NOW }).in_flight.find((f) => f.slug === "lane-a");
  assert.ok(flight, "the dispatched lane is in flight");
  assert.equal(flight.lane, "backend");
  assert.equal(flight.worker, worker);
  assert.ok(flight.lease?.expires, "under a lease with a TTL");
  const rehydrated = rehydrateConductor(arch, { now: NOW });
  assert.deepEqual(rehydrated.plan.inFlight.map((f) => f.slug), ["lane-a"], "it survives the /clear rehydrate");
  assert.deepEqual(rehydrated.reclaimed, [], "and a live lease is not reclaimed out from under the worker");

  // 3. it is no longer offered for claiming — the frontier can't double-dispatch it.
  assert.deepEqual(rehydrated.plan.dispatch.claims.map((c) => c.slug), ["lane-b"]);

  // 4. the worker confirming its own claim does NOT flip it back to in-progress
  //    (that would re-arm the conductor's guard — ADR 0027).
  assert.equal(startGoal(arch, "lane-a").status, STATUS_DISPATCHED, "a worker's goal_start only CONFIRMS");
  assert.equal(getActiveGoal(arch), null, "so the guard stays released");
  assert.equal(leaseOf(loadGoal(arch, "lane-a")).worker, worker, "and the lease still names the worker");

  // 5. the worker closes it from its own session → off the board.
  completeGoal(arch, "lane-a");
  assert.equal(isGoalDone(arch, "lane-a"), true);
  const after = sessionState(arch, { now: NOW });
  assert.deepEqual(after.in_flight.map((f) => f.slug), [], "a closed dispatch stops rehydrating as in-flight");
  assert.deepEqual(after.leases_expired.map((l) => l.slug), [], "and its lease is not left to age into reclaim");
});

// ── completion reaches the board (ADR 0029) ──────────────────────────────────

test("recordCompletion appends a `completed` event for a CLAIMED CGR, carrying its integration metadata", () => {
  const arch = freshArch();
  pendingGoal(arch, "c1", { lane: "backend" });
  claimFrontier(arch, { slug: "c1", worker: "w-backend", now: NOW });
  const r = recordCompletion(arch, {
    slug: "c1", completion: "full", dependsOn: ["base"], paths: ["src/a.mjs"], verify: "npm test", now: NOW,
  });
  assert.equal(r.appended, true);
  assert.equal(r.lane, "backend", "the lane is carried from the claim");
  assert.equal(r.worker, "w-backend");
  const ev = readEvents(arch).filter((e) => e.type === "completed");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].paths, ["src/a.mjs"], "owned paths ride along — the CGR file is about to be archived");
  assert.deepEqual(ev[0].dependsOn, ["base"]);
  assert.equal(ev[0].verify, "npm test");
});

test("recordCompletion records NOTHING for a CGR that was never claimed (no phantom merge)", () => {
  const arch = freshArch();
  liveGoal(arch, "foreground", { lane: "L" });
  const r = recordCompletion(arch, { slug: "foreground", now: NOW });
  assert.equal(r.appended, false);
  assert.equal(r.reason, "never-claimed", "a foreground CGR has no worktree branch to merge");
  assert.equal(readEvents(arch).filter((e) => e.type === "completed").length, 0);
  assert.deepEqual(sessionState(arch, { now: NOW }).merge_queue, [], "so it never enters the merge queue");
});

test("recordCompletion is idempotent — a completion already on the board is not re-appended", () => {
  const arch = freshArch();
  pendingGoal(arch, "c1", { lane: "L" });
  claimFrontier(arch, { slug: "c1", worker: "w1", now: NOW });
  assert.equal(recordCompletion(arch, { slug: "c1", now: NOW }).appended, true);
  const second = recordCompletion(arch, { slug: "c1", now: NOW });
  assert.equal(second.appended, false);
  assert.equal(second.reason, "already-completed");
  assert.equal(readEvents(arch).filter((e) => e.type === "completed").length, 1);
});

test("archkit_goal_complete moves a dispatched CGR from in_flight into the merge queue, and board_merged clears it", () => {
  const { arch, root } = freshProject();
  writeGoal(arch, {
    slug: "lane-a", title: "Lane A", exitCriteria: ["x"],
    owns: ["src/a.mjs"], verifyCommand: PASS_CMD,
  });
  stampGoalFields(arch, "lane-a", { lane: "backend" });
  claimFrontier(arch, { slug: "lane-a", worker: "w-backend", now: NOW });
  dispatchGoal(arch, "lane-a", { worker: "w-backend" });

  const done = runGoalComplete({ archDir: arch, cwd: root, slug: "lane-a" });
  assert.equal(done.boardRecord.recorded, true, "the completion is recorded on the board");
  assert.equal(done.boardRecord.lane, "backend");
  assert.match(done.nextStep, /merge queue/i, "…and the agent is told where the CGR went");

  const plan = conductorPlan(arch, { now: NOW });
  assert.deepEqual(plan.board.in_flight.map((f) => f.slug), [], "it is no longer in flight");
  const queued = plan.board.merge_queue.find((m) => m.slug === "lane-a");
  assert.ok(queued, "it is in the merge queue");
  assert.equal(queued.lane, "backend");
  assert.equal(queued.completion, "full");
  // The CGR file is archived to done/ by now, so this metadata can only have
  // come off the event — which is the point of carrying it.
  assert.equal(loadGoal(arch, "lane-a"), null, "the CGR file is archived out of goals/");
  assert.deepEqual(queued.paths, ["src/a.mjs"], "its owned paths survive the archive");
  assert.equal(queued.verify, PASS_CMD, "as does its own verify-command");

  // …and the convergence stage now has an integration point to drain.
  const group = plan.convergence.groups.find((g) => g.slugs.includes("lane-a"));
  assert.ok(group, "the merge queue reaches the convergence plan");
  assert.equal(group.lane, "backend");
  assert.deepEqual(group.paths, ["src/a.mjs"], "the path-extract fallback is still bounded by what it owns");
  assert.equal(group.integration.verify, PASS_CMD);
  assert.equal(group.integration.verifySource, "cgr");

  // Recording the merge takes it off the queue for good.
  recordMerge(arch, { slugs: ["lane-a"], lane: "backend", branch: "main", verifyCommand: PASS_CMD, passed: true, now: NOW });
  const after = conductorPlan(arch, { now: NOW });
  assert.deepEqual(after.board.merge_queue.map((m) => m.slug), [], "merged CGRs leave the queue");
  assert.deepEqual(after.unverifiedMerges, [], "and the merge carries a green verify, so no integration debt");
});

test("dependency order survives archival — a completed stack still merges bottom-up", () => {
  const { arch, root } = freshProject();
  for (const slug of ["base", "feat"]) {
    writeGoal(arch, { slug, title: slug, exitCriteria: ["x"], dependsOn: slug === "feat" ? ["base"] : [] });
    stampGoalFields(arch, slug, { lane: "backend" });
    claimFrontier(arch, { slug, worker: "w-backend", now: NOW });
  }
  // feat finishes FIRST, so only the recorded depends_on can order them.
  runGoalComplete({ archDir: arch, cwd: root, slug: "feat" });
  runGoalComplete({ archDir: arch, cwd: root, slug: "base" });
  assert.equal(loadGoal(arch, "feat"), null, "both CGRs are archived");
  assert.deepEqual(mergeQueueOrder(arch, { now: NOW }).map((m) => m.slug), ["base", "feat"],
    "the dependency edge outlives the CGR file it was declared in");
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
