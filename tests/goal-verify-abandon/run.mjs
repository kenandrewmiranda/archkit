#!/usr/bin/env node
// Tests for archkit_goal_verify (evidence, no auto-complete) + archkit_goal_abandon.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeGoal, listGoals, loadGoal } from "../../src/lib/goals.mjs";
import { runGoalVerify, runGoalAbandon } from "../../src/commands/goal.mjs";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-gva-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# SYSTEM.md\n## Type: Internal\n## Stack: Node.js\n");
  const r = fn({ dir, archDir });
  if (r && typeof r.then === "function") return r.finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

console.log("\n  goal-verify-abandon — verify");

await test("verify echoes exit-criteria and reports untouched files (no git changes)", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["tests pass", "no console.log"], filesToTouch: ["src/a.js"] });
    const r = await runGoalVerify({ archDir, cwd: dir, slug: "g1" });
    assert.deepEqual(r.exitCriteria, ["tests pass", "no console.log"]);
    assert.deepEqual(r.filesToTouch.untouched, ["src/a.js"], "unmodified file reported untouched");
    assert.equal(r.filesToTouch.touched.length, 0);
    assert.ok(typeof r.nextStep === "string" && r.nextStep.length > 0);
    assert.ok("clean" in r);
  });
});

await test("verify notes a goal with no exit-criteria", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g2", title: "G2", exitCriteria: [] });
    const r = await runGoalVerify({ archDir, cwd: dir, slug: "g2" });
    assert.match(r.exitCriteriaNote, /no exit-criteria/i);
  });
});

await test("verify throws unknown_goal for a missing slug", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    await assert.rejects(() => runGoalVerify({ archDir, cwd: dir, slug: "nope" }), /unknown goal/);
  });
});

console.log("\n  goal-verify-abandon — abandon");

await test("abandon archives the goal with status abandoned (not done) and removes it from active", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    const res = runGoalAbandon({ archDir, slug: "g1", reason: "obsolete" });
    assert.equal(res.status, "abandoned");
    assert.equal(loadGoal(archDir, "g1"), null, "no longer an active goal");
    const archived = fs.readFileSync(path.join(archDir, "goals", "done", "g1.md"), "utf8");
    assert.match(archived, /status: abandoned/);
    assert.match(archived, /abandon-reason: obsolete/);
  });
});

await test("abandon returns the next pending goal's payload", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "g2", title: "G2", exitCriteria: ["y"] });
    const res = runGoalAbandon({ archDir, slug: "g1" });
    assert.ok(res.nextGoal && res.nextGoal.slug === "g2", "next goal surfaced");
    assert.match(res.nextStep, /goal_next/);
  });
});

await test("abandon throws unknown_goal for a missing slug", () => {
  withArchDir(({ archDir }) => {
    assert.throws(() => runGoalAbandon({ archDir, slug: "nope" }), /unknown goal/);
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
