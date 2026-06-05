#!/usr/bin/env node
// Tests for the CGR test gate (v1.9): test-command detection, the test runner,
// and the hard gate in archkit_goal_complete (refuses to complete on red).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectTestCommand, runTests } from "../../src/lib/test-runner.mjs";
import { writeGoal, loadGoal, isGoalDone, verifyCommandOf } from "../../src/lib/goals.mjs";
import { runGoalComplete, runGoalVerify, runGoalIntake } from "../../src/commands/goal.mjs";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-gate-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# SYSTEM.md\n## Type: Internal\n## Stack: Node.js\n");
  const r = fn({ dir, archDir });
  if (r && typeof r.then === "function") return r.finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

// Cross-platform deterministic pass/fail commands.
const PASS_CMD = `node -e "process.exit(0)"`;
const FAIL_CMD = `node -e "process.stderr.write('boom'); process.exit(1)"`;

console.log("\n  test-gate — detectTestCommand");

await test("detects npm test from package.json scripts.test", () => {
  withArchDir(({ dir }) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    const d = detectTestCommand(dir);
    assert.equal(d.command, "npm test");
    assert.match(d.source, /scripts\.test/);
  });
});

await test("returns null for the npm placeholder test script", () => {
  withArchDir(({ dir }) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    assert.equal(detectTestCommand(dir), null);
  });
});

await test("returns null when there is no package.json", () => {
  withArchDir(({ dir }) => { assert.equal(detectTestCommand(dir), null); });
});

await test("picks the runner from the lockfile (pnpm)", () => {
  withArchDir(({ dir }) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9");
    assert.equal(detectTestCommand(dir).command, "pnpm test");
  });
});

console.log("\n  test-gate — runTests");

await test("runTests reports passed on a green command", () => {
  const r = runTests({ command: PASS_CMD });
  assert.equal(r.ran, true);
  assert.equal(r.passed, true);
  assert.equal(r.exitCode, 0);
});

await test("runTests reports failed + output tail on a red command", () => {
  const r = runTests({ command: FAIL_CMD });
  assert.equal(r.ran, true);
  assert.equal(r.passed, false);
  assert.equal(r.exitCode, 1);
  assert.match(r.outputTail, /boom/);
});

await test("runTests reports ran:false when no command given", () => {
  const r = runTests({ command: "" });
  assert.equal(r.ran, false);
  assert.equal(r.passed, false);
});

console.log("\n  test-gate — intake auto-detect");

await test("intake bakes the detected command onto each goal as verify-command", () => {
  withArchDir(({ dir, archDir }) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    const out = runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [{ title: "G one", exitCriteria: ["done"] }] });
    assert.match(out.testGate, /Detected test command/);
    const g = loadGoal(archDir, out.written[0].slug);
    assert.equal(verifyCommandOf(g), "npm test");
  });
});

await test("explicit verifyCommand is not overwritten by auto-detect", () => {
  withArchDir(({ dir, archDir }) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    const out = runGoalIntake({ archDir, cwd: dir, goals: [{ title: "G two", exitCriteria: ["done"], verifyCommand: "vitest run src/a/" }] });
    const g = loadGoal(archDir, out.written[0].slug);
    assert.equal(verifyCommandOf(g), "vitest run src/a/");
  });
});

console.log("\n  test-gate — hard gate on complete");

await test("complete SUCCEEDS and stamps tests-passed when verify-command is green", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "green", title: "Green", exitCriteria: ["x"], verifyCommand: PASS_CMD });
    const out = runGoalComplete({ archDir, cwd: dir, slug: "green" });
    assert.ok(out.testGate && out.testGate.passed === true);
    assert.equal(isGoalDone(archDir, "green"), true, "archived to done/");
    const archived = fs.readFileSync(path.join(archDir, "goals", "done", "green.md"), "utf8");
    assert.match(archived, /tests-passed: true/);
    assert.match(archived, /tests-command:/);
  });
});

await test("complete REFUSES (throws test_gate_failed) when verify-command is red", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "red", title: "Red", exitCriteria: ["x"], verifyCommand: FAIL_CMD });
    let threw = null;
    try { runGoalComplete({ archDir, cwd: dir, slug: "red" }); }
    catch (e) { threw = e; }
    assert.ok(threw, "should throw");
    assert.equal(threw.code, "test_gate_failed");
    assert.equal(isGoalDone(archDir, "red"), false, "goal NOT archived on red");
    assert.ok(loadGoal(archDir, "red"), "goal still active");
  });
});

await test("complete is ungated when the goal has no verify-command", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "nogate", title: "No gate", exitCriteria: ["x"] });
    const out = runGoalComplete({ archDir, cwd: dir, slug: "nogate" });
    assert.equal(out.testGate, null);
    assert.equal(isGoalDone(archDir, "nogate"), true);
  });
});

await test("verify surfaces a tests preview and marks clean:false on red", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "v", title: "V", exitCriteria: ["x"], verifyCommand: FAIL_CMD });
    const r = await runGoalVerify({ archDir, cwd: dir, slug: "v" });
    assert.ok(r.tests, "tests block present");
    assert.equal(r.tests.passed, false);
    assert.equal(r.clean, false);
    assert.match(r.nextStep, /RED/);
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
