#!/usr/bin/env node
// Tests for the CGR `testing` state (cgr-testing-state / ADR 0003).
//
// What this verifies:
//   - ensureGoalsLayout creates goals/testing/
//   - markTesting transition: in-progress → testing, file relocates to
//     goals/testing/<slug>.md, status flips, testing-since stamped
//   - loadGoal / listGoals / getActiveGoal / nextEligibleGoal all recognize a
//     goal living in goals/testing/ (without breaking planned/in-progress/done)
//   - startGoal relocates a resumed testing goal back to goals/ root
//   - completeGoal from testing archives to done/ and clears testing/
//   - Stop hook keeps GUARDING a testing goal (NOT done — no premature release)
//   - archkit_goal_complete's hard gate still applies when completing FROM
//     testing: green succeeds, red refuses

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  writeGoal,
  startGoal,
  markTesting,
  getActiveGoal,
  nextEligibleGoal,
  completeGoal,
  loadGoal,
  listGoals,
  isGoalDone,
  ensureGoalsLayout,
  testingDir,
  goalsDir,
  statusOf,
  STATUS_TESTING,
} from "../../src/lib/goals.mjs";
import { runGoalComplete, runGoalTesting, runGoalVerify } from "../../src/commands/goal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-stop-hook.mjs");

const PASS_CMD = `node -e "process.exit(0)"`;
const FAIL_CMD = `node -e "process.stderr.write('boom'); process.exit(1)"`;

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-testing-"));
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

console.log("\n  cgr-testing — layout + transition");

await test("ensureGoalsLayout creates goals/testing/", () => {
  withArchDir(({ archDir }) => {
    ensureGoalsLayout(archDir);
    assert.ok(fs.existsSync(testingDir(archDir)), "goals/testing/ exists");
    assert.ok(fs.statSync(testingDir(archDir)).isDirectory());
  });
});

await test("markTesting moves an in-progress goal to goals/testing/ and flips status", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["edits applied"] });
    startGoal(archDir, "g1");
    const rootPath = path.join(goalsDir(archDir), "g1.md");
    assert.ok(fs.existsSync(rootPath), "starts life in goals/ root");

    const res = markTesting(archDir, "g1");
    assert.equal(res.status, STATUS_TESTING);
    const testPath = path.join(testingDir(archDir), "g1.md");
    assert.ok(fs.existsSync(testPath), "relocated into goals/testing/");
    assert.ok(!fs.existsSync(rootPath), "removed from goals/ root (no duplicate)");

    const g = loadGoal(archDir, "g1");
    assert.equal(statusOf(g), "testing");
    assert.ok(g.meta["testing-since"], "testing-since stamped");
  });
});

await test("markTesting is idempotent (re-park stays in testing/, no duplicate)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    markTesting(archDir, "g1");
    markTesting(archDir, "g1");
    assert.ok(fs.existsSync(path.join(testingDir(archDir), "g1.md")));
    assert.ok(!fs.existsSync(path.join(goalsDir(archDir), "g1.md")));
    assert.equal(listGoals(archDir).filter((g) => g.slug === "g1").length, 1, "no duplicate listing");
  });
});

console.log("\n  cgr-testing — discovery recognizes testing goals");

await test("loadGoal + listGoals find a goal living in goals/testing/", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    markTesting(archDir, "g1");
    assert.ok(loadGoal(archDir, "g1"), "loadGoal resolves it from testing/");
    const slugs = listGoals(archDir).map((g) => g.slug);
    assert.ok(slugs.includes("g1"), "listGoals includes the testing goal");
  });
});

await test("getActiveGoal returns a testing goal; prefers in-progress when both exist", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "t1", title: "T1", exitCriteria: ["x"] });
    startGoal(archDir, "t1");
    markTesting(archDir, "t1");
    assert.equal(getActiveGoal(archDir).slug, "t1", "testing goal is guarded/active");

    writeGoal(archDir, { slug: "p1", title: "P1", exitCriteria: ["x"] });
    startGoal(archDir, "p1"); // now in-progress alongside the testing goal
    assert.equal(getActiveGoal(archDir).slug, "p1", "in-progress preferred over testing");
  });
});

await test("nextEligibleGoal is pending-first below the backlog threshold; planned/done flows intact", () => {
  // NOTE: cgr-backlog-ordering changed the default ordering. A lone testing
  // goal no longer jumps ahead of pending work — pending-first is the default
  // until the testing backlog crosses the threshold (see that suite for the
  // above-threshold case). Here, one testing goal stays below the default knob.
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "aaa", title: "A planned", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "zzz", title: "Z", exitCriteria: ["x"] });
    startGoal(archDir, "zzz");
    markTesting(archDir, "zzz");
    assert.equal(nextEligibleGoal(archDir).slug, "aaa", "pending work preferred while backlog is small");
    // Drain the pending goal; the testing goal is then the only work left.
    startGoal(archDir, "aaa");
    completeGoal(archDir, "aaa");
    assert.equal(nextEligibleGoal(archDir).slug, "zzz", "testing goal is next once pending work is exhausted");
  });
});

console.log("\n  cgr-testing — startGoal relocates a resumed testing goal back to root");

await test("startGoal on a testing goal moves it back to goals/ root as in-progress", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    markTesting(archDir, "g1");
    assert.ok(fs.existsSync(path.join(testingDir(archDir), "g1.md")));

    startGoal(archDir, "g1"); // resumed for more work
    assert.ok(fs.existsSync(path.join(goalsDir(archDir), "g1.md")), "back in goals/ root");
    assert.ok(!fs.existsSync(path.join(testingDir(archDir), "g1.md")), "no longer in testing/");
    assert.equal(statusOf(loadGoal(archDir, "g1")), "in-progress");
  });
});

console.log("\n  cgr-testing — completeGoal drains testing/");

await test("completeGoal archives a testing goal to done/ and clears testing/", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    markTesting(archDir, "g1");
    completeGoal(archDir, "g1");
    assert.equal(isGoalDone(archDir, "g1"), true, "archived to done/");
    assert.ok(!fs.existsSync(path.join(testingDir(archDir), "g1.md")), "removed from testing/");
    assert.equal(getActiveGoal(archDir), null, "guard released once completed");
  });
});

console.log("\n  cgr-testing — Stop hook keeps guarding a testing goal");

await test("Stop hook BLOCKS on a testing goal (NOT done) with a verification-focused message", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["tests pass"], verifyCommand: PASS_CMD });
    startGoal(archDir, "g1");
    markTesting(archDir, "g1");
    const out = runHook({ cwd: dir, assistant_response: "Applied the edits." });
    assert.ok(out, "hook produced output");
    assert.equal(out.decision, "block", "testing goal still blocks — no premature release");
    assert.match(out.reason, /TESTING/);
    assert.match(out.reason, /verification is still pending/i);
    assert.match(out.reason, /archkit_goal_complete g1/);
  });
});

await test("Stop hook does NOT block a testing goal when the response is a question to the user", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    markTesting(archDir, "g1");
    const out = runHook({ cwd: dir, assistant_response: "Should I bump the major version or the minor one?" });
    assert.ok(out);
    assert.notEqual(out.decision, "block");
    assert.match(out.systemMessage, /in testing/i);
  });
});

console.log("\n  cgr-testing — complete-from-testing honors the hard test gate");

await test("runGoalTesting parks the goal then complete SUCCEEDS from testing when green", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "green", title: "Green", exitCriteria: ["x"], verifyCommand: PASS_CMD });
    startGoal(archDir, "green");
    const t = runGoalTesting({ archDir, slug: "green" });
    assert.equal(t.status, STATUS_TESTING);
    assert.match(t.nextStep, /verification pending/i);
    const out = runGoalComplete({ archDir, cwd: dir, slug: "green" });
    assert.ok(out.testGate && out.testGate.passed === true, "gate ran green and completed");
    assert.equal(isGoalDone(archDir, "green"), true);
  });
});

await test("complete REFUSES from testing when the verify-command is red (goal stays in testing/)", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "red", title: "Red", exitCriteria: ["x"], verifyCommand: FAIL_CMD });
    startGoal(archDir, "red");
    markTesting(archDir, "red");
    let threw = null;
    try { runGoalComplete({ archDir, cwd: dir, slug: "red" }); }
    catch (e) { threw = e; }
    assert.ok(threw, "should throw on red");
    assert.equal(threw.code, "test_gate_failed");
    assert.equal(isGoalDone(archDir, "red"), false, "not archived on red");
    assert.ok(fs.existsSync(path.join(testingDir(archDir), "red.md")), "stays parked in testing/");
  });
});

await test("runGoalVerify flags the verification window for a testing goal", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "v", title: "V", exitCriteria: ["x"], verifyCommand: PASS_CMD });
    startGoal(archDir, "v");
    markTesting(archDir, "v");
    const r = await runGoalVerify({ archDir, cwd: dir, slug: "v" });
    assert.equal(r.status, "testing");
    assert.equal(r.verificationWindow, true);
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
