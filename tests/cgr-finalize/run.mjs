#!/usr/bin/env node

/**
 * CGR finalization goal test suite (cgr.finalize).
 *
 * Covers:
 *  - config defaults (changelog/docs/commit ON; push/release/deployDev OFF; unconfigured)
 *  - readFinalizeConfig / writeFinalizeConfig round-trip + merge semantics
 *  - intake surfaces the one-time setup nudge when unconfigured and does NOT append
 *  - after configure (enabled), intake appends a finalize goal that runs LAST + SOLO
 *  - exit-criteria reflect exactly the enabled steps
 *  - enabling back-fills a finalize goal onto an already-queued batch
 *  - enabled:false → no finalize goal appended
 *
 * Usage:
 *   node tests/cgr-finalize/run.mjs
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readFinalizeConfig,
  writeFinalizeConfig,
  runFinalizeConfig,
  buildFinalizeGoal,
  listGoals,
  FINALIZE_SLUG,
  FINALIZE_STEPS,
} from "../../src/lib/goals.mjs";
import { runGoalIntake } from "../../src/commands/goal.mjs";

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[90m${err.message}\x1b[0m`); failed++; failures.push(name); }
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-fin-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "goals"), { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# SYSTEM.md\n## App: x\n## Type: saas\n");
  return { dir, archDir };
}
function slugs(archDir) { return listGoals(archDir).map((g) => g.slug); }
function loadGoalFile(archDir, slug) {
  const hit = listGoals(archDir).find((g) => g.slug === slug);
  return hit ? { meta: hit.meta, raw: fs.readFileSync(hit.filepath, "utf8") } : null;
}

console.log("\n  ┌─────────────────────────────────────────────┐");
console.log("  │           ARCHKIT CGR FINALIZE              │");
console.log("  └─────────────────────────────────────────────┘\n");

// ── Config defaults + round-trip ─────────────────────────────────────────────

test("defaults: safe steps ON, outward steps OFF, unconfigured", () => {
  const { archDir } = fixture();
  const cfg = readFinalizeConfig(archDir);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.configured, false);
  assert.equal(cfg.steps.changelog, true);
  assert.equal(cfg.steps.docs, true);
  assert.equal(cfg.steps.commit, true);
  assert.equal(cfg.steps.push, false);
  assert.equal(cfg.steps.release, false);
  assert.equal(cfg.steps.deployDev, false);
});

test("writeFinalizeConfig merges + stamps configured, preserves other cgr keys", () => {
  const { archDir } = fixture();
  fs.writeFileSync(path.join(archDir, "config.json"), JSON.stringify({ cgr: { windDownAt: 0.65 } }));
  writeFinalizeConfig(archDir, { steps: { push: true }, ciCd: "github-actions" });
  const onDisk = JSON.parse(fs.readFileSync(path.join(archDir, "config.json"), "utf8"));
  assert.equal(onDisk.cgr.windDownAt, 0.65, "preserved unrelated cgr key");
  const cfg = readFinalizeConfig(archDir);
  assert.equal(cfg.configured, true, "write stamps configured");
  assert.equal(cfg.steps.push, true, "patched step applied");
  assert.equal(cfg.steps.changelog, true, "unpatched step keeps default");
  assert.equal(cfg.ciCd, "github-actions");
});

// ── buildFinalizeGoal ────────────────────────────────────────────────────────

test("buildFinalizeGoal: barrier depending on the batch, criteria = enabled steps", () => {
  const { archDir } = fixture();
  writeFinalizeConfig(archDir, { steps: { changelog: true, docs: true, commit: false, push: false, release: false, deployDev: false } });
  const g = buildFinalizeGoal(archDir, { batchSlugs: ["a", "b"], order: 5 });
  assert.equal(g.slug, FINALIZE_SLUG);
  assert.equal(g.exclusive, true, "runs solo as a barrier");
  assert.deepEqual(g.dependsOn, ["a", "b"], "depends on the whole batch → runs last");
  assert.equal(g.exitCriteria.length, 2, "only the 2 enabled steps become criteria");
  assert.ok(g.exitCriteria.some((c) => /CHANGELOG/i.test(c)));
  assert.ok(!g.exitCriteria.some((c) => /committed/i.test(c)), "disabled step is absent");
});

test("buildFinalizeGoal returns null when disabled or no steps", () => {
  const { archDir } = fixture();
  writeFinalizeConfig(archDir, { enabled: false });
  assert.equal(buildFinalizeGoal(archDir, { batchSlugs: ["a"] }), null, "null when disabled");
  writeFinalizeConfig(archDir, { enabled: true, steps: Object.fromEntries(FINALIZE_STEPS.map((s) => [s.key, false])) });
  assert.equal(buildFinalizeGoal(archDir, { batchSlugs: ["a"] }), null, "null when no steps enabled");
});

// ── Intake integration ───────────────────────────────────────────────────────

test("unconfigured intake: surfaces setup nudge, appends NO finalize goal", () => {
  const { dir, archDir } = fixture();
  const res = runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [
    { title: "Goal A", exitCriteria: ["a"] },
  ]});
  assert.equal(res.finalize.appended, null, "no finalize goal before setup");
  assert.equal(res.finalize.configured, false);
  assert.ok(res.finalize.setup && res.finalize.setup.firstRun, "one-time setup surfaced");
  assert.ok(!slugs(archDir).includes(FINALIZE_SLUG), "queue has no finalize goal yet");
});

test("configured intake: appends a finalize goal that runs LAST + SOLO", () => {
  const { dir, archDir } = fixture();
  writeFinalizeConfig(archDir, { enabled: true }); // configured:true, default steps
  const res = runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [
    { title: "Build X", exitCriteria: ["x"], owns: ["src/x/*"] },
    { title: "Build Y", exitCriteria: ["y"], owns: ["src/y/*"] },
  ]});
  assert.equal(res.finalize.appended, FINALIZE_SLUG);
  assert.ok(!res.finalize.setup, "no setup nudge once configured");
  const fg = loadGoalFile(archDir, FINALIZE_SLUG);
  assert.ok(fg, "finalize goal written");
  // frontmatter scalars deserialize as strings — accept either representation.
  assert.ok(fg.meta.exclusive === true || fg.meta.exclusive === "true", "exclusive barrier");
  const deps = fg.meta["depends-on"] || [];
  assert.ok(deps.includes("build-x") && deps.includes("build-y"), "depends on every batch goal");
  // lane partition stamps it as its own barrier lane → scheduled last + solo.
  assert.ok(String(fg.meta.lane).includes("barrier"), `finalize is a barrier lane (got ${fg.meta.lane})`);
});

test("enabling back-fills a finalize goal onto an already-queued batch", () => {
  const { dir, archDir } = fixture();
  // First intake while unconfigured → no finalize goal.
  runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [
    { title: "Goal A", exitCriteria: ["a"] },
    { title: "Goal B", exitCriteria: ["b"] },
  ]});
  assert.ok(!slugs(archDir).includes(FINALIZE_SLUG), "no finalize goal pre-setup");
  // User runs the one-time setup (enable) → back-fill onto the live batch.
  const out = runFinalizeConfig({ archDir, enabled: true });
  assert.equal(out.backfilled, FINALIZE_SLUG, "back-filled onto current queue");
  const fg = loadGoalFile(archDir, FINALIZE_SLUG);
  const deps = fg.meta["depends-on"] || [];
  assert.ok(deps.includes("goal-a") && deps.includes("goal-b"), "depends on the already-queued goals");
});

test("enabled:false → intake appends nothing", () => {
  const { dir, archDir } = fixture();
  writeFinalizeConfig(archDir, { enabled: false });
  const res = runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [{ title: "Goal A", exitCriteria: ["a"] }] });
  assert.equal(res.finalize.appended, null);
  assert.ok(!slugs(archDir).includes(FINALIZE_SLUG));
});

test("runFinalizeConfig show:true is read-only", () => {
  const { archDir } = fixture();
  const out = runFinalizeConfig({ archDir, show: true });
  assert.ok(out.config && typeof out.nextStep === "string");
  assert.equal(out.config.configured, false, "show does not stamp configured");
  assert.ok(!fs.existsSync(path.join(archDir, "config.json")), "show writes nothing");
});

console.log("");
console.log("  ═════════════════════════════════════════════════════════");
console.log(`  \x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
if (failures.length > 0) {
  console.log("\n  \x1b[31mFailed:\x1b[0m");
  for (const f of failures) console.log(`    - ${f}`);
}
console.log("");
process.exit(failed > 0 ? 1 : 0);
