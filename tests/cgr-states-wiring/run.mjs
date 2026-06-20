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
  getActiveGoal,
  nextEligibleGoal,
  completeGoal,
  loadGoal,
  listGoals,
  isGoalDone,
  statusOf,
  goalsDir,
  testingDir,
  doneDir,
  archiveDir,
  digestDir,
  listDigests,
  readLoopState,
  bumpLoopBlock,
  parseGoal,
  STATUS_ON_HOLD,
  STATUS_PENDING,
  STATUS_COMPLETED,
} from "../../src/lib/goals.mjs";
import {
  runGoalHold,
  runGoalTesting,
  runGoalConsolidate,
  runGoalVerify,
  runGoalComplete,
  runGoalIntake,
} from "../../src/commands/goal.mjs";
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
    assert.match(out.systemMessage, /goal_next/, "surfaces the parked goal as resumable");
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
    assert.match(out.nextStep, /goal_next/);
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

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
