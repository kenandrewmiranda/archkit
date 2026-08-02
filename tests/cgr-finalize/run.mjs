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
 *  - the `version` step: OFF by default, expands to bump + re-verify criteria that
 *    name the project's real manifests, sorts before changelog/commit, and older
 *    configs without the key keep their exact previous criteria
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
  detectVersionSync,
  listGoals,
  renderPayload,
  reconcileGoalsLayout,
  FINALIZE_SLUG,
  FINALIZE_STEPS,
} from "../../src/lib/goals.mjs";
import { runGoalIntake } from "../../src/commands/goal.mjs";
import { tools } from "../../src/mcp/tools.mjs";

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

// ── Project inheritance (finalize-project-inheritance) ───────────────────────
//
// The barrier writes the CHANGELOG, commits and pushes the work it depends on —
// so it MUST be on that work's branch. Without inheritance its payload said
// `git switch -c cgr-queue-<date>` while every goal it depends on lived on
// feat/<project>: a silently-wrong instruction at the batch's last, most
// consequential step.

// The branch-prework block of a payload — the lines the agent actually acts on.
function branchPrework(archDir, slug) {
  const { payload } = renderPayload(archDir, slug);
  const lines = payload.split("\n");
  const start = lines.findIndex((l) => l.startsWith("Branch prework"));
  if (start < 0) return [];
  const rest = lines.slice(start);
  const end = rest.findIndex((l, i) => i > 0 && l === "");
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => /`git /.test(l) || l.startsWith("Branch prework"));
}

test("finalize inherits the batch project → same branch prework as the work", () => {
  const { dir, archDir } = fixture();
  writeFinalizeConfig(archDir, { enabled: true });
  runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [
    { title: "Build X", exitCriteria: ["x"], project: "lane-integration", owns: ["src/x/*"] },
    { title: "Build Y", exitCriteria: ["y"], project: "lane-integration", owns: ["src/y/*"] },
  ]});
  const fg = loadGoalFile(archDir, FINALIZE_SLUG);
  assert.equal(fg.meta.project, "lane-integration", "finalize inherited the batch project");
  // Criterion 4: branch-prework PARITY with the goals it depends on.
  const mine = branchPrework(archDir, FINALIZE_SLUG);
  assert.deepEqual(mine, branchPrework(archDir, "build-x"), "same branch prework as build-x");
  assert.deepEqual(mine, branchPrework(archDir, "build-y"), "same branch prework as build-y");
  assert.ok(mine.some((l) => l.includes("feat/lane-integration")), "prework names the project branch");
  assert.ok(!mine.some((l) => /cgr-queue-/.test(l)), "no dated queue branch for a projected batch");
});

test("inherited project decides the finalize goal's on-disk home", () => {
  const { dir, archDir } = fixture();
  writeFinalizeConfig(archDir, { enabled: true });
  runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [
    { title: "Build X", exitCriteria: ["x"], project: "lane-integration" },
  ]});
  const hit = listGoals(archDir).find((g) => g.slug === FINALIZE_SLUG);
  assert.equal(
    path.relative(archDir, hit.filepath),
    path.join("goals", "queue", "lane-integration", `${FINALIZE_SLUG}.md`),
    "filed beside the batch it finalizes",
  );
  // Criterion 3: reconcile agrees it's already where it belongs.
  const report = reconcileGoalsLayout(archDir, { apply: false });
  assert.ok(!report.moved.some((m) => m.slug === FINALIZE_SLUG), "reconcile would not relocate it");
});

test("multi-project batch does NOT guess — falls back to the shared queue branch", () => {
  const { dir, archDir } = fixture();
  writeFinalizeConfig(archDir, { enabled: true });
  runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [
    { title: "Build X", exitCriteria: ["x"], project: "alpha" },
    { title: "Build Y", exitCriteria: ["y"], project: "beta" },
  ]});
  const fg = loadGoalFile(archDir, FINALIZE_SLUG);
  assert.ok(!fg.meta.project, `no project inherited from a mixed batch (got ${fg.meta.project})`);
  const mine = branchPrework(archDir, FINALIZE_SLUG);
  assert.ok(mine.some((l) => /cgr-queue-/.test(l)), "falls back to the shared dated queue branch");
  assert.ok(!mine.some((l) => /feat\//.test(l)), "never guesses one of the projects");
});

test("ungrouped batch keeps its pre-existing branch behavior", () => {
  const { dir, archDir } = fixture();
  writeFinalizeConfig(archDir, { enabled: true });
  runGoalIntake({ archDir, cwd: dir, sourceAsk: "x", goals: [
    { title: "Build X", exitCriteria: ["x"] },
    { title: "Build Y", exitCriteria: ["y"] },
  ]});
  const fg = loadGoalFile(archDir, FINALIZE_SLUG);
  assert.ok(!fg.meta.project, "nothing to inherit → no project");
  assert.deepEqual(branchPrework(archDir, FINALIZE_SLUG), branchPrework(archDir, "build-x"),
    "still parity with the batch goals");
});

// ── The `version` step (finalize-version-bump) ───────────────────────────────
//
// check:versions enforces package.json == .claude-plugin/plugin.json and the
// release workflow refuses to publish unless the git tag equals package.json's
// version — yet nothing in the CGR lifecycle ever bumped them. The step closes
// that gap; it is OFF by default and must sort BEFORE changelog/commit so both
// describe the version being cut.

// A project root with a package.json + plugin manifest + a real check script,
// i.e. the shape detectVersionSync is meant to read.
function versionedFixture() {
  const { dir, archDir } = fixture();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "demo", version: "1.17.0",
    scripts: { test: "node scripts/test.mjs", "check:versions": "node scripts/check-version-sync.mjs" },
  }, null, 2));
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin/plugin.json"), JSON.stringify({ version: "1.17.0" }));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/check-version-sync.mjs"),
    `const a = read("package.json");\nconst b = read(".claude-plugin/plugin.json");\n`);
  return { dir, archDir };
}

test("version step: OFF by default, and absent from the synthesized goal", () => {
  const { archDir } = versionedFixture();
  assert.equal(readFinalizeConfig(archDir).steps.version, false, "default OFF");
  writeFinalizeConfig(archDir, { enabled: true }); // defaults → version stays off
  const g = buildFinalizeGoal(archDir, { batchSlugs: ["a"], order: 1 });
  assert.ok(!g.exitCriteria.some((c) => /version/i.test(c)), `no version criteria (got ${JSON.stringify(g.exitCriteria)})`);
});

test("version step: enabled → bump + re-verify criteria naming the real files", () => {
  const { archDir } = versionedFixture();
  writeFinalizeConfig(archDir, { enabled: true, steps: { version: true } });
  const g = buildFinalizeGoal(archDir, { batchSlugs: ["a"], order: 1 });
  const bump = g.exitCriteria.find((c) => /bumped/i.test(c));
  const check = g.exitCriteria.find((c) => /re-verified/i.test(c));
  assert.ok(bump, "a bump criterion exists");
  assert.ok(bump.includes("package.json"), `names package.json (got ${bump})`);
  assert.ok(bump.includes(".claude-plugin/plugin.json"), `names the plugin manifest (got ${bump})`);
  assert.ok(bump.includes("1.17.0"), "names the current version so the agent knows what it is bumping from");
  assert.ok(check, "a re-verify criterion exists");
  assert.ok(check.includes("npm run check:versions"), `names the project's own check (got ${check})`);
  // The barrier edits those manifests, so it must declare them.
  assert.ok(g.owns.includes("package.json") && g.owns.includes(".claude-plugin/plugin.json"), "owns the bumped files");
});

test("version step: ordered BEFORE changelog and commit", () => {
  const { archDir } = versionedFixture();
  writeFinalizeConfig(archDir, { enabled: true, steps: { version: true, changelog: true, docs: true, commit: true } });
  const g = buildFinalizeGoal(archDir, { batchSlugs: ["a"], order: 1 });
  const at = (re) => g.exitCriteria.findIndex((c) => re.test(c));
  const bump = at(/bumped/i), recheck = at(/re-verified/i);
  const changelog = at(/CHANGELOG/i), commit = at(/committed/i);
  assert.ok(changelog >= 0 && commit >= 0, "changelog + commit criteria present");
  assert.ok(bump < changelog && bump < commit, `bump precedes changelog/commit (bump ${bump}, changelog ${changelog}, commit ${commit})`);
  assert.ok(recheck < commit, `re-verify precedes the commit (recheck ${recheck}, commit ${commit})`);
  assert.ok(FINALIZE_STEPS.findIndex((s) => s.key === "version") <
    FINALIZE_STEPS.findIndex((s) => s.key === "changelog"), "step order itself puts version first");
});

test("version step: undetectable project still gets a generic criterion", () => {
  const { archDir } = fixture(); // no package.json at all
  writeFinalizeConfig(archDir, { enabled: true, steps: { version: true } });
  const g = buildFinalizeGoal(archDir, { batchSlugs: ["a"], order: 1 });
  assert.ok(g.exitCriteria.some((c) => /bumped/i.test(c)), "bump criterion survives detection failure");
  assert.ok(g.exitCriteria.some((c) => /re-verified/i.test(c)), "re-verify criterion survives detection failure");
});

test("detectVersionSync reads the project's own check, not a guess", () => {
  const { archDir } = versionedFixture();
  const v = detectVersionSync(archDir);
  assert.equal(v.command, "npm run check:versions");
  assert.equal(v.version, "1.17.0");
  assert.deepEqual(v.files, ["package.json", ".claude-plugin/plugin.json"]);
});

test("back-compat: a config written before the version step keeps working", () => {
  const { archDir } = versionedFixture();
  // Exactly what an existing project has on disk: steps with no `version` key.
  fs.writeFileSync(path.join(archDir, "config.json"), JSON.stringify({
    cgr: { finalize: { enabled: true, configured: true, steps: { changelog: true, docs: true, commit: true, push: true, release: false, deployDev: false }, ciCd: "github-actions", deployCommand: "" } },
  }, null, 2));
  const cfg = readFinalizeConfig(archDir);
  assert.equal(cfg.version, undefined, "no stray top-level key");
  assert.equal(cfg.steps.version, false, "missing step reads as its default (OFF)");
  assert.equal(cfg.steps.push, true, "pre-existing choices untouched");
  assert.equal(cfg.ciCd, "github-actions");
  const g = buildFinalizeGoal(archDir, { batchSlugs: ["a"], order: 1 });
  assert.equal(g.exitCriteria.length, 4, "same 4 criteria as before the step existed");
  assert.ok(!g.exitCriteria.some((c) => /bumped/i.test(c)), "old config gets no version criteria");
});

test("archkit_finalize_config surfaces the version step", () => {
  // Schema acceptance: zod strips unknown keys, so a surviving `version` proves it.
  const parsed = tools.archkit_finalize_config.inputSchema.parse({ steps: { version: true } });
  assert.equal(parsed.steps.version, true, "steps.version is part of the tool schema");
  assert.ok(/version/i.test(tools.archkit_finalize_config.description), "description names the step");
  const { archDir } = versionedFixture();
  const saved = runFinalizeConfig({ archDir, enabled: true, steps: { version: true } });
  assert.equal(saved.config.steps.version, true, "the tool's lib entrypoint persists it");
  assert.equal(runFinalizeConfig({ archDir, show: true }).config.steps.version, true, "and reads it back");
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
