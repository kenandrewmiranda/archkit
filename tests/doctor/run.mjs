#!/usr/bin/env node
// Tests for archkit doctor (v1.8 work item C).
//
// Doctor aggregates warmup + drift findings AND layers three intent checks
// (empty skills, unapplied BAN rules, weak CGR goals). These tests cover:
//   - throws no_arch_dir when archDir is null
//   - clean project → all checks pass, warnings empty, warningsNote present
//   - empty skill → flagged with D-INTENT-1 warning
//   - unapplied BAN rule → flagged with D-INTENT-2 warning
//   - weak CGR goal → flagged with D-INTENT-3 warning
//   - missing-source drift → escalates to blocker, pass:false

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDoctorJson } from "../../src/commands/doctor.mjs";
import { ArchkitError } from "../../src/lib/errors.mjs";
import { renderGuardrailHooks } from "../../src/lib/claude-settings.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeProject({ withEmptySkill = false, withUnappliedBan = false, withWeakGoal = false, withDrift = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-doctor-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(arch, "goals"), { recursive: true });

  // Wire the full guardrail-hook set into project settings so the D-HOOKS check
  // passes deterministically (these doctor tests exercise the intent checks,
  // not hook-install detection — that has its own suite in tests/hooks-status).
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".claude", "settings.json"), JSON.stringify(renderGuardrailHooks()));

  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Type: SaaS\n## Stack: Node.js\n## Pattern: Layered\n\n" +
    "## Rules\n- Layered\n\n## Reserved Words\n$db = database\n\n## Naming\nFiles: kebab\n");
  const indexBasePath = withDrift ? "src/missing-dir/" : "src/features/auth/";
  fs.writeFileSync(path.join(arch, "INDEX.md"),
    `## Nodes\n@auth = [auth] → ${indexBasePath}\n\n## Keywords\n`);
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n  [login]\n");

  if (!withDrift) {
    fs.mkdirSync(path.join(tmp, "src", "features", "auth"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "features", "auth", "index.js"), "export const x = 1;\n");
  }

  // Always include one populated skill so the "no skills" branch doesn't fire
  fs.writeFileSync(path.join(arch, "skills", "stripe.skill"),
    "# stripe\n\n## Use\nReal usage notes.\n\n## Patterns\nimport Stripe from 'stripe'.\n\n" +
    "## Gotchas\nWRONG: req.body\nRIGHT: req.rawBody\nWHY: parses JSON\n\n" +
    "## Boundaries\nN/A\n\n## Snippets\nconst s = new Stripe(key)\n\n## Meta\nupdated: 2026-05-25\n");

  if (withEmptySkill) {
    fs.writeFileSync(path.join(arch, "skills", "empty.skill"),
      "# empty\n\n## Use\n[How YOUR codebase]\n\n" +
      "## Gotchas\nWRONG: [example]\nRIGHT: [example]\nWHY: [example]\n\n## Meta\nupdated: 2026-05-25\n");
  }

  // Always have a real BAN rule that matches a real file
  fs.mkdirSync(path.join(tmp, "src", "copilot"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src", "copilot", "a.js"), "console.log(1)\n");
  fs.mkdirSync(path.join(tmp, "src", "execution"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src", "execution", "b.js"), "console.log(2)\n");

  const banLines = ["- BAN: src/copilot/* -> src/execution/*"];
  if (withUnappliedBan) banLines.push("- BAN: src/nowhere/* -> src/elsewhere/*");
  fs.writeFileSync(path.join(arch, "BOUNDARIES.md"), banLines.join("\n") + "\n");

  if (withWeakGoal) {
    fs.writeFileSync(path.join(arch, "goals", "weak-goal.md"),
      "---\nslug: weak-goal\ntitle: ship\nstatus: planned\ncreated: 2026-05-25\n" +
      "exit-criteria:\n  - ship\nfiles-to-touch:\nrequired-reading:\n" +
      "depends-on:\nsource-ask: do the thing\n---\n\n# ship\n");
  }

  return { tmp, arch };
}

function cleanup({ tmp }) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

await test("runDoctorJson throws ArchkitError(no_arch_dir) when archDir is null", async () => {
  try { await runDoctorJson({ archDir: null, cwd: process.cwd() }); assert.fail("expected throw"); }
  catch (err) {
    assert.ok(err instanceof ArchkitError, `got ${err.constructor.name}`);
    assert.equal(err.code, "no_arch_dir");
  }
});

await test("clean project → pass:true, warnings:[], warningsNote present, all checks pass", async () => {
  const fx = makeProject();
  try {
    const r = await runDoctorJson({ archDir: fx.arch, cwd: fx.tmp });
    assert.equal(r.pass, true, `expected pass; blockers=${JSON.stringify(r.blockers)} warnings=${JSON.stringify(r.warnings)}`);
    assert.deepEqual(r.blockers, []);
    assert.deepEqual(r.warnings, []);
    assert.ok(typeof r.warningsNote === "string" && r.warningsNote.length > 0,
      "clean run should set warningsNote (silent-success indicator)");
    assert.equal(r.summary.warnings, 0);
    assert.equal(r.summary.failing, 0);
    assert.ok(r.checks.every(c => c.status === "pass"),
      "every check should pass; got " + JSON.stringify(r.checks.map(c => [c.id, c.status])));
    assert.ok(typeof r.nextStep === "string" && r.nextStep.length > 0);
  } finally { cleanup(fx); }
});

await test("empty skill → D-INTENT-1 warns and intent.emptySkills populated", async () => {
  const fx = makeProject({ withEmptySkill: true });
  try {
    const r = await runDoctorJson({ archDir: fx.arch, cwd: fx.tmp });
    const c = r.checks.find(c => c.id === "D-INTENT-1");
    assert.ok(c, "missing D-INTENT-1 check");
    assert.equal(c.status, "warn", `D-INTENT-1 should warn; got ${c.status}`);
    assert.ok(r.intent.emptySkills.includes("empty"), JSON.stringify(r.intent.emptySkills));
    assert.equal(r.pass, true, "empty skill is a warning, not a blocker");
  } finally { cleanup(fx); }
});

await test("unapplied BAN rule → D-INTENT-2 warns and intent.unappliedBans populated", async () => {
  const fx = makeProject({ withUnappliedBan: true });
  try {
    const r = await runDoctorJson({ archDir: fx.arch, cwd: fx.tmp });
    const c = r.checks.find(c => c.id === "D-INTENT-2");
    assert.ok(c, "missing D-INTENT-2 check");
    assert.equal(c.status, "warn", `D-INTENT-2 should warn; got ${c.status}`);
    assert.equal(r.intent.unappliedBans.length, 1);
    assert.equal(r.intent.unappliedBans[0].source, "src/nowhere/*");
    assert.equal(r.pass, true);
  } finally { cleanup(fx); }
});

await test("weak CGR goal → D-INTENT-3 warns and intent.weakGoals populated", async () => {
  const fx = makeProject({ withWeakGoal: true });
  try {
    const r = await runDoctorJson({ archDir: fx.arch, cwd: fx.tmp });
    const c = r.checks.find(c => c.id === "D-INTENT-3");
    assert.ok(c, "missing D-INTENT-3 check");
    assert.equal(c.status, "warn", `D-INTENT-3 should warn; got ${c.status}`);
    const wg = r.intent.weakGoals.find(g => g.slug === "weak-goal");
    assert.ok(wg, "weak-goal not surfaced: " + JSON.stringify(r.intent.weakGoals));
    assert.ok(wg.reasons.some(s => s.includes("vacuous")), JSON.stringify(wg.reasons));
    assert.ok(wg.reasons.some(s => s.includes("no required-reading")));
    assert.equal(r.pass, true);
  } finally { cleanup(fx); }
});

await test("missing-source drift → D-DRIFT fails, escalates to blocker, pass:false", async () => {
  const fx = makeProject({ withDrift: true });
  try {
    const r = await runDoctorJson({ archDir: fx.arch, cwd: fx.tmp });
    const c = r.checks.find(c => c.id === "D-DRIFT");
    assert.ok(c);
    assert.equal(c.status, "fail", `D-DRIFT should fail; got ${c.status}`);
    assert.equal(r.pass, false);
    assert.ok(r.blockers.length >= 1, "missing-source drift should produce at least one blocker");
    assert.ok(r.blockers.some(b => b.includes("missing-source")), JSON.stringify(r.blockers));
    assert.match(r.nextStep, /Resolve blocker/i);
  } finally { cleanup(fx); }
});

await test("nextStep is always a non-empty string ≤280 chars (soft cap)", async () => {
  for (const opts of [
    {},
    { withEmptySkill: true, withUnappliedBan: true, withWeakGoal: true },
    { withDrift: true },
  ]) {
    const fx = makeProject(opts);
    try {
      const r = await runDoctorJson({ archDir: fx.arch, cwd: fx.tmp });
      assert.ok(typeof r.nextStep === "string", `nextStep missing for ${JSON.stringify(opts)}`);
      assert.ok(r.nextStep.length > 0);
      assert.ok(r.nextStep.length <= 280, `nextStep ${r.nextStep.length} chars for ${JSON.stringify(opts)}`);
    } finally { cleanup(fx); }
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
