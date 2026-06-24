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
} from "../../src/lib/board.mjs";
import {
  writeGoal,
  loadGoal,
  startGoal,
  stampGoalFields,
  leaseOf,
  leaseTtlHours,
  windDownAt,
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

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
