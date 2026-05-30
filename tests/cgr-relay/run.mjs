#!/usr/bin/env node
// Tests for the CGR fresh-context relay loop (proto/cgr-relay-loop).
//
// What this verifies:
//   - Active-goal lifecycle: startGoal → in-progress, getActiveGoal finds it
//   - nextEligibleGoal respects depends-on (skips dep-blocked goals)
//   - Turn-cap state: bump increments, reset clears
//   - /mcp__archkit__goal_next prompt marks in-progress + injects payload
//   - Stop hook blocks (decision:block) while a goal is in-progress,
//     does NOT block on a question-to-user, nudges when none active,
//     and stays silent once the goal is done.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  writeGoal,
  startGoal,
  getActiveGoal,
  nextEligibleGoal,
  completeGoal,
  bumpLoopBlock,
  readLoopState,
  resetLoopState,
  statusOf,
} from "../../src/lib/goals.mjs";
import { prompts } from "../../src/mcp/prompts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-stop-hook.mjs");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

// Works for both sync and async fn: for an async body we attach cleanup to the
// returned promise so the temp dir survives until the body resolves.
function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-relay-"));
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

console.log("\n  cgr-relay — active-goal lifecycle");

await test("startGoal flips status to in-progress and getActiveGoal finds it", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "First", exitCriteria: ["tests pass"] });
    assert.equal(getActiveGoal(archDir), null, "nothing active before startGoal");
    startGoal(archDir, "g1");
    const active = getActiveGoal(archDir);
    assert.ok(active, "a goal is active after startGoal");
    assert.equal(active.slug, "g1");
    assert.equal(statusOf(active), "in-progress");
    assert.ok(active.meta.started, "started date recorded");
  });
});

await test("nextEligibleGoal skips a goal whose depends-on is incomplete, returns it once the dep is done", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "base", title: "Base", exitCriteria: ["done"] });
    writeGoal(archDir, { slug: "dependent", title: "Dependent", exitCriteria: ["done"], dependsOn: ["base"] });
    // Both planned. listGoals order is filesystem (alphabetical): base before dependent.
    let next = nextEligibleGoal(archDir);
    assert.equal(next.slug, "base", "picks the unblocked goal first");
    completeGoal(archDir, "base");
    next = nextEligibleGoal(archDir);
    assert.equal(next.slug, "dependent", "dependent becomes eligible after base completes");
  });
});

await test("nextEligibleGoal prefers an in-progress goal over planned ones", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "aaa", title: "A", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "zzz", title: "Z", exitCriteria: ["x"] });
    startGoal(archDir, "zzz");
    assert.equal(nextEligibleGoal(archDir).slug, "zzz", "resume the in-progress goal");
  });
});

console.log("\n  cgr-relay — turn-cap state");

await test("bumpLoopBlock increments per slug; resetLoopState clears; startGoal clears stale counter", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    assert.equal(bumpLoopBlock(archDir, "g1"), 1);
    assert.equal(bumpLoopBlock(archDir, "g1"), 2);
    assert.equal(readLoopState(archDir)["g1"], 2);
    resetLoopState(archDir);
    assert.deepEqual(readLoopState(archDir), {});
    bumpLoopBlock(archDir, "g1");
    startGoal(archDir, "g1"); // starting a goal resets its counter
    assert.equal(readLoopState(archDir)["g1"], undefined);
  });
});

console.log("\n  cgr-relay — goal_next prompt");

await test("goal_next marks the next goal in-progress and injects a relay payload", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "First goal", exitCriteria: ["criterion A", "criterion B"] });
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const res = await prompts.goal_next.handler();
      const text = res.messages[0].content.text;
      assert.match(text, /\[archkit CGR relay\] Active goal: g1/);
      assert.match(text, /criterion A/);
      assert.match(text, /archkit_goal_complete g1/);
    } finally {
      process.chdir(prevCwd);
    }
    assert.equal(statusOf(getActiveGoal(archDir)), "in-progress", "goal_next started the goal");
  });
});

await test("goal_next on an empty queue returns guidance, starts nothing", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const res = await prompts.goal_next.handler();
      assert.match(res.messages[0].content.text, /No eligible CGR goal/);
    } finally {
      process.chdir(prevCwd);
    }
    assert.equal(getActiveGoal(archDir), null);
  });
});

console.log("\n  cgr-relay — Stop hook guard");

await test("Stop hook blocks (decision:block) while a goal is in-progress", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["tests pass", "no console.log"] });
    startGoal(archDir, "g1");
    const out = runHook({ cwd: dir, assistant_response: "I made some edits." });
    assert.ok(out, "hook produced output");
    assert.equal(out.decision, "block");
    assert.match(out.reason, /goal "g1" is still in progress/);
    assert.match(out.reason, /tests pass/);
    assert.match(out.reason, /archkit_goal_complete g1/);
  });
});

await test("Stop hook does NOT block when the response is a question to the user", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["tests pass"] });
    startGoal(archDir, "g1");
    const out = runHook({ cwd: dir, assistant_response: "Which database should I use, Postgres or SQLite?" });
    assert.ok(out, "hook produced output");
    assert.notEqual(out.decision, "block");
    assert.match(out.hookSpecificOutput.additionalContext, /reads as a question to the user/);
  });
});

await test("Stop hook nudges (no block) when no goal active but one is queued", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] }); // planned, not started
    const out = runHook({ cwd: dir, assistant_response: "Here is a summary." });
    assert.ok(out, "hook produced output");
    assert.notEqual(out.decision, "block");
    assert.match(out.hookSpecificOutput.additionalContext, /goal_next/);
  });
});

await test("Stop hook is silent once the goal is done and queue is empty", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    completeGoal(archDir, "g1");
    const out = runHook({ cwd: dir, assistant_response: "All done." });
    assert.equal(out, null, "no output / no block when nothing is queued");
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
