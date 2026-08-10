#!/usr/bin/env node
// Tests for cgr-states-mcp-wiring — the goal that surfaces the expanded CGR
// lifecycle (ADR 0003) through the MCP tools, slash prompts, CLI, and docs.
//
// What this verifies:
//   - the `on-hold` state (markOnHold): in-progress → on-hold, stays in goals/
//     root, status flips, on-hold-since stamped, turn-cap counter cleared
//   - on-hold RELEASES the relay guard (getActiveGoal ignores it; the Stop hook
//     does not block) — parking is a deliberate stop, unlike `testing`
//   - nextEligibleGoal excludes on-hold from auto-selection but offers it as a
//     last-resort resume once no pending/testing work is left
//   - startGoal resumes an on-hold goal back to in-progress
//   - the three NEW MCP tool handlers (archkit_goal_testing / _hold /
//     _consolidate) are wired and callable through src/mcp/tools.mjs
//   - end-to-end through the MCP/CLI runner path:
//     intake → start → testing → verify → complete → consolidate, suite green
//
// dispatched-lifecycle-state (ADR 0027) extends the same surface with the
// `dispatched` state — claimed on behalf of a worker subagent:
//   - dispatchGoal: status flips, stays in goals/ root, dispatched-since /
//     dispatched-to stamped, turn-cap cleared, a lease minted (existing kept)
//   - the Stop-hook relay guard is RELEASED for a dispatched goal (no
//     keep-working criteria) while the lease is RETAINED — unlike on-hold
//   - frontier / nextEligibleGoal / routeNextGoal / triageNextGoal never offer a
//     dispatched goal, but session_state.in_flight still carries it
//   - lease-TTL expiry reclaims a dispatched goal as an orphan, exactly as it
//     does an in-progress one
//   - complete / handoff / testing still work from `dispatched`, and a worker's
//     own goal_start does not flip it back to in-progress (reclaim:true does)

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  writeGoal,
  startGoal,
  markOnHold,
  dispatchGoal,
  dispatchedGoals,
  getActiveGoal,
  nextEligibleGoal,
  routeNextGoal,
  triageNextGoal,
  completeGoal,
  loadGoal,
  listGoals,
  isGoalDone,
  statusOf,
  leaseOf,
  computeFileConflicts,
  goalsDir,
  testingDir,
  doneDir,
  archiveDir,
  digestDir,
  listDigests,
  readLoopState,
  bumpLoopBlock,
  parseGoal,
  stampGoalFields,
  STATUS_ON_HOLD,
  STATUS_PENDING,
  STATUS_COMPLETED,
  STATUS_DISPATCHED,
} from "../../src/lib/goals.mjs";
import {
  runGoalHold,
  runGoalTesting,
  runGoalConsolidate,
  runGoalVerify,
  runGoalComplete,
  runGoalIntake,
} from "../../src/commands/goal.mjs";
import { sessionState, reclaimExpiredLeases, readEvents } from "../../src/lib/board.mjs";
import { tools } from "../../src/mcp/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-stop-hook.mjs");

const PASS_CMD = `node -e "process.exit(0)"`;

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-states-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Naming\nFiles: kebab\n");
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  let result;
  try { result = fn({ dir, archDir }); }
  catch (err) { cleanup(); throw err; }
  if (result && typeof result.then === "function") return result.finally(cleanup);
  cleanup();
  return result;
}

// Run the Stop hook with a synthetic event; return parsed stdout (or null).
function runHook({ cwd, assistant_response = "" }) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify({ cwd, assistant_response }),
    encoding: "utf8",
  });
  const trimmed = out.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

console.log("\n  cgr-states-wiring — on-hold transition");

await test("markOnHold flips status to on-hold, stays in goals/ root, stamps on-hold-since", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    const res = markOnHold(archDir, "g1");
    assert.equal(res.status, STATUS_ON_HOLD);
    const rootPath = path.join(goalsDir(archDir), "g1.md");
    assert.ok(fs.existsSync(rootPath), "on-hold goal stays in goals/ root (no per-state folder)");
    assert.ok(!fs.existsSync(path.join(testingDir(archDir), "g1.md")), "not in testing/");
    const g = loadGoal(archDir, "g1");
    assert.equal(statusOf(g), "on-hold");
    assert.ok(g.meta["on-hold-since"], "on-hold-since stamped");
  });
});

await test("markOnHold clears the turn-cap counter (guard released)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    bumpLoopBlock(archDir, "g1");
    assert.ok(readLoopState(archDir).g1 > 0, "counter was bumped");
    markOnHold(archDir, "g1");
    assert.ok(!readLoopState(archDir).g1, "counter cleared on park");
  });
});

await test("markOnHold relocates a goal parked from testing/ back to goals/ root", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    // simulate it sitting in testing/ first
    runGoalTesting({ archDir, slug: "g1" });
    assert.ok(fs.existsSync(path.join(testingDir(archDir), "g1.md")));
    markOnHold(archDir, "g1");
    assert.ok(fs.existsSync(path.join(goalsDir(archDir), "g1.md")), "back in goals/ root");
    assert.ok(!fs.existsSync(path.join(testingDir(archDir), "g1.md")), "no longer in testing/");
  });
});

console.log("\n  cgr-states-wiring — on-hold releases the guard");

await test("getActiveGoal ignores an on-hold goal (not guarded)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    assert.equal(getActiveGoal(archDir).slug, "g1");
    markOnHold(archDir, "g1");
    assert.equal(getActiveGoal(archDir), null, "parked goal does not keep the guard engaged");
  });
});

await test("Stop hook does NOT block when only an on-hold goal exists (nudges to resume)", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    markOnHold(archDir, "g1");
    const out = runHook({ cwd: dir, assistant_response: "Parked it for now." });
    assert.notEqual(out?.decision, "block", "no guard on a deliberately parked goal");
    assert.match(out.systemMessage, /conductor/, "surfaces the parked goal as resumable");
  });
});

console.log("\n  cgr-states-wiring — nextEligibleGoal ordering");

await test("on-hold is excluded while pending work exists", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "pend", title: "Pending", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "park", title: "Parked", exitCriteria: ["x"] });
    startGoal(archDir, "park");
    markOnHold(archDir, "park");
    assert.equal(nextEligibleGoal(archDir).slug, "pend", "pending preferred over the parked goal");
  });
});

await test("on-hold is resumed as a last resort once nothing live is left", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "pend", title: "Pending", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "park", title: "Parked", exitCriteria: ["x"] });
    startGoal(archDir, "park");
    markOnHold(archDir, "park");
    startGoal(archDir, "pend");
    completeGoal(archDir, "pend");
    assert.equal(nextEligibleGoal(archDir).slug, "park", "parked goal offered when it's the only work");
  });
});

await test("on-hold with unmet depends-on is NOT offered (deps still gate)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "dep", title: "Dep", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "park", title: "Parked", exitCriteria: ["x"], dependsOn: ["dep"] });
    startGoal(archDir, "park");
    markOnHold(archDir, "park");
    startGoal(archDir, "dep");
    // dep is in-progress (not done) → park's dependency is unmet → resume dep, not park
    assert.equal(nextEligibleGoal(archDir).slug, "dep", "in-progress dep resumes; parked goal still blocked by deps");
  });
});

await test("startGoal resumes an on-hold goal back to in-progress", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    markOnHold(archDir, "g1");
    startGoal(archDir, "g1");
    assert.equal(statusOf(loadGoal(archDir, "g1")), "in-progress");
    assert.equal(getActiveGoal(archDir).slug, "g1", "guard re-engages on resume");
  });
});

console.log("\n  cgr-states-wiring — runGoalHold handler shape");

await test("runGoalHold returns on-hold status + a resume-focused nextStep", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    const out = runGoalHold({ archDir, slug: "g1" });
    assert.equal(out.status, STATUS_ON_HOLD);
    assert.match(out.nextStep, /on-hold/i);
    assert.match(out.nextStep, /conductor/);
  });
});

await test("runGoalHold throws unknown_goal for a missing slug", () => {
  withArchDir(({ archDir }) => {
    let threw = null;
    try { runGoalHold({ archDir, slug: "nope" }); } catch (e) { threw = e; }
    assert.ok(threw, "should throw");
    assert.equal(threw.code, "unknown_goal");
  });
});

console.log("\n  cgr-states-wiring — the three new MCP tool handlers are wired");

await test("archkit_goal_testing / _hold / _consolidate resolve through src/mcp/tools.mjs", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    // sanity: the tools are actually registered on the surface
    for (const name of ["archkit_goal_testing", "archkit_goal_hold", "archkit_goal_consolidate"]) {
      assert.ok(tools[name] && typeof tools[name].handler === "function", `${name} registered`);
      assert.ok(tools[name].description.length > 80, `${name} has tool-pick prose`);
    }
    writeGoal(archDir, { slug: "m", title: "M", exitCriteria: ["x"] });
    startGoal(archDir, "m");
    const prevCwd = process.cwd();
    process.chdir(dir); // handlers resolve archDir from process.cwd()
    try {
      const t = await tools.archkit_goal_testing.handler({ slug: "m" });
      assert.equal(t.status, "testing");
      startGoal(archDir, "m"); // resume
      const h = await tools.archkit_goal_hold.handler({ slug: "m" });
      assert.equal(h.status, STATUS_ON_HOLD);
      const c = await tools.archkit_goal_consolidate.handler({});
      assert.equal(typeof c.consolidated, "number", "consolidate returns a count");
    } finally {
      process.chdir(prevCwd);
    }
  });
});

console.log("\n  cgr-states-wiring — end-to-end MCP/CLI path");

await test("intake → start → testing → verify → complete → consolidate", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    // intake (the agent-driven decomposition entry point)
    runGoalIntake({
      archDir,
      cwd: dir,
      sourceAsk: "ship the thing",
      goals: [{ slug: "e2e", title: "E2E", exitCriteria: ["it works"], verifyCommand: PASS_CMD }],
    });
    assert.equal(statusOf(loadGoal(archDir, "e2e")), "pending", "intake writes a pending goal");

    // start (mirrors /mcp__archkit__goal_next)
    startGoal(archDir, "e2e");
    assert.equal(statusOf(loadGoal(archDir, "e2e")), "in-progress");

    // testing — edits applied, verification pending
    const t = runGoalTesting({ archDir, slug: "e2e" });
    assert.equal(t.status, "testing");
    assert.ok(fs.existsSync(path.join(testingDir(archDir), "e2e.md")), "parked in testing/");

    // verify — the cheap preview; in the verification window
    const v = await runGoalVerify({ archDir, cwd: dir, slug: "e2e" });
    assert.equal(v.verificationWindow, true);
    assert.equal(v.clean, true, "objective checks clean (tests green)");

    // complete — hard gate runs green; this drains the queue and consolidates
    const c = runGoalComplete({ archDir, cwd: dir, slug: "e2e" });
    assert.ok(c.testGate && c.testGate.passed === true, "completed through the green gate");
    assert.equal(isGoalDone(archDir, "e2e"), true);

    // consolidation fired on queue-drain
    assert.ok(c.consolidation && c.consolidation.consolidated >= 1, "consolidation ran on drain");
    assert.ok(fs.existsSync(path.join(archiveDir(archDir), "e2e.md")), "raw CGR preserved verbatim in archive/");
    const digests = listDigests(archDir);
    assert.ok(digests.length >= 1 && digests[0].slugs.includes("e2e"), "digest summarizes the completed goal");
    assert.ok(!fs.existsSync(path.join(testingDir(archDir), "e2e.md")), "testing/ drained");
  });
});

await test("runGoalConsolidate on demand is a no-op when nothing terminal is un-archived", () => {
  withArchDir(({ archDir }) => {
    const r = runGoalConsolidate({ archDir });
    assert.equal(r.consolidated, 0);
    assert.match(r.nextStep, /[Nn]othing to consolidate/);
    assert.ok(!fs.existsSync(digestDir(archDir)) || fs.readdirSync(digestDir(archDir)).length === 0, "no digest written");
  });
});

console.log("\n  cgr-states-wiring — status vocabulary reconciliation (ADR 0003, back-compat)");

await test("intake/complete write the canonical pending/completed vocabulary", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g", title: "G", exitCriteria: ["x"] });
    // raw frontmatter, not normalized — proves we WRITE the new words. New goals
    // are queued under goals/queue/ now (cgr-queue-folder-layout).
    const pendingRaw = parseGoal(fs.readFileSync(path.join(goalsDir(archDir), "queue", "g.md"), "utf8")).meta.status;
    assert.equal(pendingRaw, STATUS_PENDING, "new goals are written as pending, not planned");
    startGoal(archDir, "g");
    completeGoal(archDir, "g");
    const archivedRaw = parseGoal(fs.readFileSync(path.join(doneDir(archDir), "g.md"), "utf8")).meta.status;
    assert.equal(archivedRaw, STATUS_COMPLETED, "completed goals are written as completed, not done");
  });
});

await test("legacy 'planned' / 'done' status values still resolve (alias on read)", () => {
  withArchDir(({ archDir }) => {
    // hand-write an OLD-vocabulary goal file as a prior archkit version would have
    fs.mkdirSync(goalsDir(archDir), { recursive: true });
    fs.writeFileSync(path.join(goalsDir(archDir), "old.md"),
      "---\nslug: old\ntitle: Old\nstatus: planned\nexit-criteria:\n  - x\n---\n\n# Old\n");
    assert.equal(statusOf(loadGoal(archDir, "old")), STATUS_PENDING, "legacy 'planned' normalizes to pending");
    // a legacy goal is still selectable (treated as pending, not an unknown state)
    assert.equal(nextEligibleGoal(archDir).slug, "old", "legacy pending goal is eligible");

    // legacy 'done' in the archive normalizes to completed via statusOf
    const legacyDone = parseGoal("---\nslug: z\nstatus: done\n---\n\nbody\n");
    assert.equal(statusOf(legacyDone), STATUS_COMPLETED, "legacy 'done' normalizes to completed");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// dispatched-lifecycle-state (ADR 0027)
// ───────────────────────────────────────────────────────────────────────────

// Dispatch g1 to `worker`, with an optional lane, from a pending goal.
function dispatch(archDir, slug, { worker = "lane-worker-1", lane = null } = {}) {
  if (lane) stampGoalFields(archDir, slug, { lane });
  return dispatchGoal(archDir, slug, { worker });
}

console.log("\n  cgr-states-wiring — dispatched transition");

await test("dispatchGoal flips status to dispatched, stays in goals/ root, stamps since/to", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"] });
    const res = dispatch(archDir, "d1", { worker: "w-alpha" });
    assert.equal(res.status, STATUS_DISPATCHED);
    assert.equal(res.worker, "w-alpha");
    assert.ok(fs.existsSync(path.join(goalsDir(archDir), "d1.md")), "dispatched goal lives in goals/ root");
    assert.ok(!fs.existsSync(path.join(testingDir(archDir), "d1.md")), "no per-state folder");
    const g = loadGoal(archDir, "d1");
    assert.equal(statusOf(g), "dispatched");
    assert.ok(g.meta["dispatched-since"], "dispatched-since stamped");
    assert.equal(g.meta["dispatched-to"], "w-alpha", "dispatched-to records the worker");
  });
});

await test("dispatchGoal HOLDS a lease (minted when absent, preserved when present)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"] });
    const res = dispatch(archDir, "d1", { worker: "w-alpha" });
    const lease = leaseOf(loadGoal(archDir, "d1"));
    assert.ok(lease, "a dispatched goal carries a lease");
    assert.equal(lease.worker, "w-alpha");
    assert.ok(Date.parse(lease.expires) > Date.now(), "lease expiry is in the future");
    assert.deepEqual(res.lease, lease, "the returned lease is the stamped one");

    // A pre-existing claim is never re-minted (claim-then-dispatch composes).
    writeGoal(archDir, { slug: "d2", title: "D2", exitCriteria: ["x"] });
    const existing = { worker: "w-beta", expires: "2099-01-01T00:00:00.000Z" };
    stampGoalFields(archDir, "d2", { lease: existing });
    dispatchGoal(archDir, "d2", { worker: "w-beta" });
    assert.deepEqual(leaseOf(loadGoal(archDir, "d2")), existing, "existing lease preserved verbatim");
  });
});

await test("dispatchGoal clears the turn-cap counter (guard released in this session)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"] });
    startGoal(archDir, "d1");
    bumpLoopBlock(archDir, "d1");
    assert.ok(readLoopState(archDir).d1 > 0, "counter was bumped");
    dispatchGoal(archDir, "d1", { worker: "w-alpha" });
    assert.ok(!readLoopState(archDir).d1, "counter cleared on dispatch");
  });
});

await test("dispatchedGoals reports slug/lane/worker/lease for every dispatched goal", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "keep", title: "Keep", exitCriteria: ["x"] });
    dispatch(archDir, "d1", { worker: "w-alpha", lane: "cgr-lifecycle" });
    const list = dispatchedGoals(archDir);
    assert.equal(list.length, 1, "only the dispatched goal is reported");
    assert.equal(list[0].slug, "d1");
    assert.equal(list[0].lane, "cgr-lifecycle");
    assert.equal(list[0].worker, "w-alpha");
    assert.ok(list[0].lease?.expires, "carries the lease");
  });
});

console.log("\n  cgr-states-wiring — dispatched RELEASES the guard, KEEPS the lease");

await test("getActiveGoal ignores a dispatched goal (not guarded)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"] });
    startGoal(archDir, "d1");
    assert.equal(getActiveGoal(archDir).slug, "d1", "in-progress IS guarded");
    dispatchGoal(archDir, "d1", { worker: "w-alpha" });
    assert.equal(getActiveGoal(archDir), null, "a goal worked by a subagent does not guard this session");
  });
});

await test("Stop hook emits NO keep-working criteria for a dispatched goal (contrast: in-progress blocks)", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["criterion-one-must-hold"] });
    startGoal(archDir, "d1");
    const blocked = runHook({ cwd: dir, assistant_response: "Working on it." });
    assert.equal(blocked?.decision, "block", "in-progress traps the session (the bug's precondition)");
    assert.match(blocked.reason, /criterion-one-must-hold/, "and repeats the exit-criteria");

    dispatchGoal(archDir, "d1", { worker: "w-alpha" });
    const out = runHook({ cwd: dir, assistant_response: "Dispatched the lane." });
    assert.notEqual(out?.decision, "block", "dispatched releases the relay guard");
    assert.ok(!(out?.reason || "").includes("criterion-one-must-hold"), "no keep-working criteria emitted");
    assert.ok(!(out?.systemMessage || "").includes("criterion-one-must-hold"), "criteria are not restated as a nudge either");
    assert.match(out.systemMessage, /DISPATCHED/, "the release is explained, not silent");
    assert.match(out.systemMessage, /w-alpha/, "and names the worker holding it");
  });
});

await test("a dispatched goal RETAINS its lease while the guard is released", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"] });
    startGoal(archDir, "d1");
    dispatchGoal(archDir, "d1", { worker: "w-alpha" });
    assert.equal(getActiveGoal(archDir), null, "guard released");
    assert.ok(leaseOf(loadGoal(archDir, "d1")), "lease still held — unlike a park, this is live work");
  });
});

await test("a dispatched goal still counts as LIVE for file-overlap conflict detection", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"], filesToTouch: ["src/lib/goals.mjs"] });
    writeGoal(archDir, { slug: "other", title: "Other", exitCriteria: ["x"], filesToTouch: ["src/lib/goals.mjs"] });
    dispatchGoal(archDir, "d1", { worker: "w-alpha" });
    const conflicts = computeFileConflicts(loadGoal(archDir, "other"), listGoals(archDir));
    assert.deepEqual(conflicts.map((c) => c.slug), ["d1"], "the worker is editing that file right now");
  });
});

console.log("\n  cgr-states-wiring — dispatched is never re-offered as work");

await test("nextEligibleGoal skips a dispatched goal and picks pending work instead", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "disp", title: "Dispatched", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "pend", title: "Pending", exitCriteria: ["x"] });
    dispatchGoal(archDir, "disp", { worker: "w-alpha" });
    assert.equal(nextEligibleGoal(archDir).slug, "pend", "pending work is offered, not the claimed goal");
  });
});

await test("a dispatched goal is NOT offered even as a last resort (unlike on-hold)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "disp", title: "Dispatched", exitCriteria: ["x"] });
    dispatchGoal(archDir, "disp", { worker: "w-alpha" });
    assert.equal(nextEligibleGoal(archDir), null, "handing it out again would double-work a leased goal");
    // on-hold, by contrast, IS offered once nothing live is left.
    markOnHold(archDir, "disp");
    assert.equal(nextEligibleGoal(archDir).slug, "disp", "a parked goal is resumable — a dispatched one is not");
  });
});

await test("routeNextGoal / triageNextGoal do not route to a dispatched goal", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "disp", title: "Dispatched", exitCriteria: ["x"] });
    dispatchGoal(archDir, "disp", { worker: "w-alpha" });
    assert.equal(routeNextGoal(archDir).kind, "none", "no track has offerable work");
    const t = triageNextGoal(archDir);
    assert.ok(!t.queue.includes("disp"), "not in the triage queue slice");
    assert.equal(t.recommended ?? null, null, "nothing recommended");
  });
});

await test("session_state keeps a dispatched goal in in_flight (lane/worker/lease) and OUT of frontier", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "disp", title: "Dispatched", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "pend", title: "Pending", exitCriteria: ["x"] });
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      await tools.archkit_goal_start.handler({ slug: "disp", worker: "w-alpha" });
    } finally {
      process.chdir(prevCwd);
    }
    const board = sessionState(archDir);
    const flight = board.in_flight.find((f) => f.slug === "disp");
    assert.ok(flight, "a dispatched goal is still in flight");
    assert.equal(flight.worker, "w-alpha");
    assert.ok(flight.lease?.expires, "with its lease");
    assert.ok(flight.lane, "and its lane");
    assert.deepEqual(board.frontier.map((f) => f.slug), ["pend"], "frontier offers only unclaimed pending work");
  });
});

console.log("\n  cgr-states-wiring — lease TTL still reclaims a dispatched goal as an orphan");

await test("an expired dispatched lease folds into leases_expired, exactly as in-progress does", () => {
  withArchDir(({ archDir }) => {
    const past = { worker: "w-alpha", expires: "2020-01-01T00:00:00.000Z" };
    for (const [slug, live] of [["disp", "dispatch"], ["active", "start"]]) {
      writeGoal(archDir, { slug, title: slug, exitCriteria: ["x"] });
      if (live === "dispatch") dispatchGoal(archDir, slug, { worker: "w-alpha" });
      else startGoal(archDir, slug);
      stampGoalFields(archDir, slug, { lease: past });
      // both need a claim event to be in flight at all
      fs.mkdirSync(path.join(archDir, "board"), { recursive: true });
      fs.appendFileSync(path.join(archDir, "board", "events.ndjson"),
        `${JSON.stringify({ type: "claimed", slug, worker: "w-alpha", lease: past, at: past.expires })}\n`);
    }
    const expired = sessionState(archDir).leases_expired.map((l) => l.slug).sort();
    assert.deepEqual(expired, ["active", "disp"], "dispatched expiry is reclaimed on the same terms as in-progress");
  });
});

await test("reclaimExpiredLeases clears a dispatched goal's stale lease and logs lease-expired", () => {
  withArchDir(({ archDir }) => {
    const past = { worker: "w-alpha", expires: "2020-01-01T00:00:00.000Z" };
    writeGoal(archDir, { slug: "disp", title: "Disp", exitCriteria: ["x"] });
    dispatchGoal(archDir, "disp", { worker: "w-alpha" });
    stampGoalFields(archDir, "disp", { lease: past });
    fs.mkdirSync(path.join(archDir, "board"), { recursive: true });
    fs.appendFileSync(path.join(archDir, "board", "events.ndjson"),
      `${JSON.stringify({ type: "claimed", slug: "disp", worker: "w-alpha", lease: past, at: past.expires })}\n`);

    const r = reclaimExpiredLeases(archDir);
    assert.deepEqual(r.reclaimed.map((x) => x.slug ?? x), ["disp"], "the orphan is reclaimed");
    assert.equal(leaseOf(loadGoal(archDir, "disp")), null, "stale lease dropped so it is cleanly re-claimable");
    assert.ok(readEvents(archDir).some((e) => e.type === "lease-expired" && e.slug === "disp"), "lease-expired appended");
    assert.deepEqual(reclaimExpiredLeases(archDir).reclaimed, [], "idempotent");
  });
});

console.log("\n  cgr-states-wiring — the owning worker still closes the goal normally");

await test("startGoal from the worker PRESERVES dispatched; reclaim:true takes it back", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"] });
    dispatchGoal(archDir, "d1", { worker: "w-alpha" });
    const again = startGoal(archDir, "d1");
    assert.equal(again.status, STATUS_DISPATCHED, "a worker confirming its claim must not re-trap the conductor");
    assert.equal(getActiveGoal(archDir), null, "so the guard stays released");
    const reclaimed = startGoal(archDir, "d1", { reclaim: true });
    assert.equal(reclaimed.status, "in-progress", "reclaim is the explicit take-it-back escape");
    assert.equal(getActiveGoal(archDir).slug, "d1", "guard re-engages on reclaim");
    assert.ok(!loadGoal(archDir, "d1").meta["dispatched-to"], "the stale dispatch record is cleared");
  });
});

await test("complete / testing / hold all work from `dispatched`", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "t1", title: "T1", exitCriteria: ["x"] });
    dispatchGoal(archDir, "t1", { worker: "w-alpha" });
    assert.equal(runGoalTesting({ archDir, slug: "t1" }).status, "testing");

    writeGoal(archDir, { slug: "h1", title: "H1", exitCriteria: ["x"] });
    dispatchGoal(archDir, "h1", { worker: "w-alpha" });
    assert.equal(runGoalHold({ archDir, slug: "h1" }).status, STATUS_ON_HOLD);

    writeGoal(archDir, { slug: "c1", title: "C1", exitCriteria: ["x"] });
    dispatchGoal(archDir, "c1", { worker: "w-alpha" });
    completeGoal(archDir, "c1");
    assert.equal(isGoalDone(archDir, "c1"), true, "the owning worker completes it from its own session");
  });
});

await test("archkit_goal_start with `worker` dispatches; without it, it still starts in-progress", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "d1", title: "D1", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "s1", title: "S1", exitCriteria: ["x"] });
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const d = await tools.archkit_goal_start.handler({ slug: "d1", worker: "w-alpha" });
      assert.equal(d.status, STATUS_DISPATCHED);
      assert.equal(d.worker, "w-alpha");
      assert.ok(d.lease?.expires, "the handler returns the held lease");
      assert.match(d.nextStep, /Do NOT work its exit-criteria/i, "tells the conductor to wait");
      assert.ok(d.payload, "the worker still gets the goal payload to act on");

      const s = await tools.archkit_goal_start.handler({ slug: "s1" });
      assert.equal(s.status, "in-progress", "the plain start path is unchanged");
    } finally {
      process.chdir(prevCwd);
    }
    assert.equal(statusOf(loadGoal(archDir, "d1")), "dispatched");
    assert.equal(getActiveGoal(archDir).slug, "s1", "only the same-session start guards");
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
