#!/usr/bin/env node
// Tests for CONCRETE verify-after-each-merge (merge-verify-command, ADR 0024).
//
// The gap this closes: conductor step 5 said "verifying after EACH" but named no
// command and recorded no result. The CGR test gate runs at goal_complete INSIDE
// the worker's worktree, PRE-merge — a green worktree does not prove a green
// branch after integration.
//
// What this verifies:
//   EC1 — the convergence plan resolves a CONCRETE verify command per LANE via
//         the fallback chain (the CGR's verify-command -> the project test
//         command -> none) and emits it alongside each integration step
//   EC2 — the `merged` board event carries the verification outcome (command +
//         pass/fail), and the fold distinguishes verified from unverified
//   EC3 — conductorPlan surfaces unverified-but-merged CGRs as integration debt
//   EC4 — the fallback chain and the merged-event payload are covered end to end
//         (including the tail case: no command anywhere -> explicit "none")

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveVerifyCommand,
  projectVerifyCommand,
  normalizeMergeVerification,
  laneConvergencePlan,
  laneConvergence,
  renderConvergencePlan,
  recordMerge,
  sessionState,
  conductorPlan,
  appendEvent,
  readEvents,
  foldEvents,
  VERIFY_SOURCES,
  MERGE_VERIFY_STATUSES,
} from "../../src/lib/board.mjs";
import { writeGoal, startGoal, stampGoalFields } from "../../src/lib/goals.mjs";
import { prompts } from "../../src/mcp/prompts.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshProject({ testScript } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mergeverify-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  if (testScript !== undefined) {
    fs.writeFileSync(path.join(tmp, "package.json"),
      JSON.stringify({ name: "fixture", scripts: testScript === null ? {} : { test: testScript } }, null, 2));
  }
  return { root: tmp, arch };
}
// `verify-command` is set at authoring time (writeGoal), the CGR 2.0 extended
// fields are stamped after — matching how intake + the conductor actually write.
function liveGoal(arch, slug, fields = {}) {
  const { verifyCommand, ...stamped } = fields;
  writeGoal(arch, { slug, title: slug, exitCriteria: ["x"], verifyCommand });
  startGoal(arch, slug);
  if (Object.keys(stamped).length) stampGoalFields(arch, slug, stamped);
  return slug;
}
const NOW = "2026-08-02T12:00:00.000Z";
const q = (slug, lane, since) => ({ slug, lane, since, completion: "full" });

console.log("\nMerge verification: a concrete command + a recorded result (ADR 0024)\n");

// ── EC4a: the fallback chain, in isolation ───────────────────────────────────

test("chain step 1: the CGR's OWN verify-command wins", () => {
  const r = resolveVerifyCommand(["a"], {
    verifyOf: () => "vitest run src/auth/",
    projectCommand: "npm test",
  });
  assert.equal(r.command, "vitest run src/auth/");
  assert.equal(r.source, "cgr");
  assert.equal(r.unresolved, false);
  assert.deepEqual(r.perSlug, [{ slug: "a", command: "vitest run src/auth/", source: "cgr" }]);
});

test("chain step 2: no CGR command falls back to the PROJECT test command", () => {
  const r = resolveVerifyCommand(["a"], { verifyOf: () => null, projectCommand: "npm test" });
  assert.equal(r.command, "npm test");
  assert.equal(r.source, "project");
  assert.equal(r.unresolved, false);
});

test("chain step 3: nothing anywhere resolves to an explicit NONE, never a silent gap", () => {
  const r = resolveVerifyCommand(["a"], { verifyOf: () => null, projectCommand: null });
  assert.equal(r.command, null);
  assert.equal(r.source, "none");
  assert.equal(r.unresolved, true, "an unresolvable verify is FLAGGED, so the merge is recorded unverified");
  assert.deepEqual(r.perSlug, [{ slug: "a", command: null, source: "none" }]);
});

test("the chain is applied PER CGR, then unioned for the lane", () => {
  // Two CGRs on one lane: one scoped to its slice, one with nothing of its own.
  const r = resolveVerifyCommand(["scoped", "plain"], {
    verifyOf: (s) => (s === "scoped" ? "vitest run src/board/" : null),
    projectCommand: "npm test",
  });
  assert.deepEqual(r.commands, ["vitest run src/board/", "npm test"], "union, in queue order");
  assert.equal(r.command, "vitest run src/board/ && npm test", "all of them must pass");
  assert.equal(r.source, "mixed");
  assert.equal(r.mixed, true);
  assert.deepEqual(r.perSlug.map((p) => p.source), ["cgr", "project"]);
});

test("identical per-CGR commands de-dup to ONE command (no `npm test && npm test`)", () => {
  const r = resolveVerifyCommand(["a", "b", "c"], { verifyOf: () => null, projectCommand: "npm test" });
  assert.equal(r.command, "npm test");
  assert.deepEqual(r.commands, ["npm test"]);
  assert.equal(r.mixed, false);
});

test("resolution is tolerant: blank commands and a throwing accessor degrade, never crash", () => {
  const r = resolveVerifyCommand(["a", "b"], {
    verifyOf: (s) => { if (s === "a") throw new Error("boom"); return "   "; },
    projectCommand: "  npm test  ",
  });
  assert.equal(r.command, "npm test", "whitespace-only CGR commands fall through; the project command is trimmed");
  assert.equal(r.source, "project");
  assert.ok(VERIFY_SOURCES.includes(r.source));
});

test("projectVerifyCommand reads package.json scripts.test at the project root", () => {
  const withTests = freshProject({ testScript: "node scripts/test.mjs" });
  assert.equal(projectVerifyCommand(withTests.arch), "npm test");
  const noScript = freshProject({ testScript: null });
  assert.equal(projectVerifyCommand(noScript.arch), null, "no scripts.test → the chain's `none` tail");
  const noPkg = freshProject();
  assert.equal(projectVerifyCommand(noPkg.arch), null, "no package.json → null, not a throw");
});

// ── EC1: the plan emits a concrete command alongside each integration step ───

test("EC1: each lane's integration step carries its OWN resolved verify command", () => {
  const ordered = [q("board-a", "board", "1"), q("goals-a", "goals", "2")];
  const plan = laneConvergencePlan(ordered, {
    branch: "main",
    verifyOf: (s) => (s === "board-a" ? "node tests/cgr-board/run.mjs" : null),
    projectVerify: "npm test",
  });
  const [board, goals] = plan.groups;
  assert.equal(board.integration.verify, "node tests/cgr-board/run.mjs");
  assert.equal(board.integration.verifySource, "cgr", "the lane keeps its CGR-scoped command");
  assert.equal(goals.integration.verify, "npm test");
  assert.equal(goals.integration.verifySource, "project", "the other lane falls back to the project command");
  assert.deepEqual(goals.integration.verifyBySlug, [{ slug: "goals-a", command: "npm test", source: "project" }]);
  assert.equal(plan.counts.verifiableGroups, 2);
  assert.equal(plan.counts.unverifiableGroups, 0);
  assert.equal(plan.projectVerify, "npm test");
});

test("EC1: an unverifiable lane is FLAGGED, not silently blank", () => {
  const plan = laneConvergencePlan([q("a", "l1", "1")], { branch: "main" });
  const g = plan.groups[0];
  assert.equal(g.integration.verify, null);
  assert.equal(g.integration.verifySource, "none");
  assert.equal(g.integration.verifiable, false);
  assert.equal(plan.counts.unverifiableGroups, 1);
  const text = renderConvergencePlan(plan).join("\n");
  assert.match(text, /VERIFY: NO command resolved/, "the rendered plan says so out loud");
  assert.match(text, /record it as unverified rather than assuming green/i);
});

test("EC1: every integration point emits its RECORD step (command + how to record it)", () => {
  const plan = laneConvergencePlan([q("a", "l1", "1"), q("b", "l1", "2")], {
    branch: "main", projectVerify: "npm test",
  });
  const g = plan.groups[0];
  assert.equal(g.record.tool, "archkit_board_merged");
  assert.deepEqual(g.record.args.slugs, ["a", "b"]);
  assert.equal(g.record.args.verifyCommand, "npm test");
  const text = renderConvergencePlan(plan).join("\n");
  assert.match(text, /3\. VERIFY \(from project\): npm test/, "the verify step names the concrete command");
  assert.match(text, /4\. RECORD: archkit_board_merged slugs=a,b/);
  assert.match(text, /a merge with no recorded outcome is integration debt/i);
});

test("EC1: laneConvergence resolves the chain LIVE off the CGR files + package.json", () => {
  const { arch } = freshProject({ testScript: "node scripts/test.mjs" });
  liveGoal(arch, "scoped-cgr", { lane: "board", owns: ["src/lib/board.mjs"], verifyCommand: "node tests/cgr-board/run.mjs" });
  liveGoal(arch, "plain-cgr", { lane: "relay", owns: ["src/mcp/prompts.mjs"] });
  appendEvent(arch, { type: "completed", slug: "scoped-cgr", at: "2026-08-02T10:00:00.000Z" });
  appendEvent(arch, { type: "completed", slug: "plain-cgr", at: "2026-08-02T11:00:00.000Z" });

  const plan = laneConvergence(arch, { now: NOW });
  const byLane = Object.fromEntries(plan.groups.map((g) => [g.lane, g]));
  assert.equal(byLane.board.integration.verify, "node tests/cgr-board/run.mjs", "the CGR's own verify-command");
  assert.equal(byLane.board.integration.verifySource, "cgr");
  assert.equal(byLane.relay.integration.verify, "npm test", "detected from package.json scripts.test");
  assert.equal(byLane.relay.integration.verifySource, "project");
});

test("EC1: with NO project test command the live plan degrades to none — explicitly", () => {
  const { arch } = freshProject({ testScript: null });
  liveGoal(arch, "plain-cgr", { lane: "relay" });
  appendEvent(arch, { type: "completed", slug: "plain-cgr", at: "2026-08-02T10:00:00.000Z" });
  const plan = laneConvergence(arch, { now: NOW });
  assert.equal(plan.groups[0].integration.verify, null);
  assert.equal(plan.groups[0].integration.verifySource, "none");
  assert.equal(plan.counts.unverifiableGroups, 1);
});

// ── EC2: the merged event carries the verification outcome ───────────────────

test("EC2: recordMerge appends a `merged` event per CGR carrying command + pass/fail", () => {
  const { arch } = freshProject();
  liveGoal(arch, "a", { lane: "board" });
  liveGoal(arch, "b", { lane: "board" });
  const res = recordMerge(arch, {
    slugs: ["a", "b"], lane: "board", branch: "main",
    verifyCommand: "npm test", verifySource: "project", passed: true, exitCode: 0, now: NOW,
  });
  assert.deepEqual(res.slugs, ["a", "b"]);
  assert.equal(res.merged.length, 2, "one event per CGR in the integration point");
  const events = readEvents(arch).filter((e) => e.type === "merged");
  assert.equal(events.length, 2);
  for (const ev of events) {
    assert.equal(ev.branch, "main");
    assert.equal(ev.verification.command, "npm test");
    assert.equal(ev.verification.passed, true);
    assert.equal(ev.verification.status, "green");
    assert.equal(ev.verification.source, "project");
    assert.ok(MERGE_VERIFY_STATUSES.includes(ev.verification.status));
  }
});

test("EC2: the status is DERIVED from the reported result, never taken on trust", () => {
  assert.deepEqual(
    ["green", "red", "unverified", "unverified"],
    [
      normalizeMergeVerification({ command: "npm test", passed: true }).status,
      normalizeMergeVerification({ command: "npm test", passed: false }).status,
      normalizeMergeVerification({ command: "npm test" }).status,
      normalizeMergeVerification({}).status,
    ],
  );
  assert.equal(normalizeMergeVerification({ command: "npm test", passed: false }).reason, "verify-failed");
  assert.equal(normalizeMergeVerification({ command: "npm test" }).reason, "verify-not-run");
  assert.equal(normalizeMergeVerification({}).reason, "no-verify-command");
  assert.equal(normalizeMergeVerification({}).passed, null, "unverified is NOT false — it's unknown");
});

test("EC2: the fold distinguishes a VERIFIED merge from an unverified one", () => {
  const { arch } = freshProject();
  liveGoal(arch, "green-cgr", { lane: "L" });
  liveGoal(arch, "silent-cgr", { lane: "L" });
  liveGoal(arch, "red-cgr", { lane: "L" });
  recordMerge(arch, { slugs: ["green-cgr"], branch: "main", verifyCommand: "npm test", passed: true, now: NOW });
  // A merge recorded with NO verification payload at all (the pre-ADR-0024 shape).
  appendEvent(arch, { type: "merged", slug: "silent-cgr", at: NOW });
  recordMerge(arch, { slugs: ["red-cgr"], branch: "main", verifyCommand: "npm test", passed: false, exitCode: 1, now: NOW });

  const { bySlug } = foldEvents(readEvents(arch));
  assert.equal(bySlug.get("green-cgr").verification.status, "green");
  assert.equal(bySlug.get("silent-cgr").verification.status, "unverified",
    "a merged event with no payload folds to UNVERIFIED — never to assumed-green");
  assert.equal(bySlug.get("red-cgr").verification.status, "red");

  const board = sessionState(arch, { now: NOW });
  assert.deepEqual(board.merged.map((m) => m.slug), ["green-cgr", "red-cgr", "silent-cgr"]);
  assert.deepEqual(board.merged.map((m) => m.verifyStatus), ["green", "red", "unverified"]);
  assert.deepEqual(board.merged.map((m) => m.verified), [true, false, false]);
  assert.equal(board.merged.find((m) => m.slug === "green-cgr").verifyCommand, "npm test");
  assert.equal(board.merged.find((m) => m.slug === "green-cgr").branch, "main");
});

test("EC2: a merged CGR leaves the merge queue (lifecycle completed → merged)", () => {
  const { arch } = freshProject();
  liveGoal(arch, "a", { lane: "L" });
  appendEvent(arch, { type: "completed", slug: "a", at: "2026-08-02T10:00:00.000Z" });
  let board = sessionState(arch, { now: NOW });
  assert.deepEqual(board.merge_queue.map((m) => m.slug), ["a"]);
  assert.deepEqual(board.merged, []);
  recordMerge(arch, { slugs: ["a"], lane: "L", branch: "main", verifyCommand: "npm test", passed: true, now: NOW });
  board = sessionState(arch, { now: NOW });
  assert.equal(board.merge_queue.length, 0);
  assert.deepEqual(board.merged.map((m) => m.slug), ["a"]);
});

test("EC2: recordMerge refuses an empty slug set rather than writing a slugless event", () => {
  const { arch } = freshProject();
  assert.throws(() => recordMerge(arch, {}), /requires slug/);
  assert.equal(readEvents(arch).length, 0);
});

// ── EC3: the conductor surfaces unverified-but-merged CGRs ──────────────────

test("EC3: conductorPlan surfaces unverified-but-merged CGRs as integration debt", () => {
  const { arch } = freshProject({ testScript: "node scripts/test.mjs" });
  liveGoal(arch, "green-cgr", { lane: "L" });
  liveGoal(arch, "silent-cgr", { lane: "L" });
  liveGoal(arch, "red-cgr", { lane: "M" });
  recordMerge(arch, { slugs: ["green-cgr"], lane: "L", branch: "main", verifyCommand: "npm test", passed: true, now: NOW });
  appendEvent(arch, { type: "merged", slug: "silent-cgr", lane: "L", at: NOW });
  recordMerge(arch, { slugs: ["red-cgr"], lane: "M", branch: "main", verifyCommand: "npm test", passed: false, now: NOW });

  const plan = conductorPlan(arch, { now: NOW });
  assert.equal(plan.counts.merged, 3);
  assert.equal(plan.counts.unverified_merges, 2, "green is not debt; red and silent are");
  assert.deepEqual(plan.unverifiedMerges.map((m) => m.slug), ["red-cgr", "silent-cgr"]);
  const bySlug = Object.fromEntries(plan.unverifiedMerges.map((m) => [m.slug, m]));
  assert.equal(bySlug["red-cgr"].status, "red");
  assert.equal(bySlug["red-cgr"].reason, "verify-failed");
  assert.equal(bySlug["red-cgr"].command, "npm test");
  assert.equal(bySlug["silent-cgr"].status, "unverified");
  assert.equal(bySlug["silent-cgr"].reason, "no-verify-command");
  assert.equal(bySlug["silent-cgr"].lane, "L");
});

test("EC3: an all-green board reports NO integration debt", () => {
  const { arch } = freshProject();
  liveGoal(arch, "a", { lane: "L" });
  recordMerge(arch, { slugs: ["a"], lane: "L", branch: "main", verifyCommand: "npm test", passed: true, now: NOW });
  const plan = conductorPlan(arch, { now: NOW });
  assert.deepEqual(plan.unverifiedMerges, []);
  assert.equal(plan.counts.unverified_merges, 0);
  assert.equal(plan.counts.merged, 1);
});

await testAsync("EC3: the conductor prompt renders the integration-debt ledger", async () => {
  const { root, arch } = freshProject({ testScript: "node scripts/test.mjs" });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "# system\n");
  liveGoal(arch, "board-cgr", { lane: "board", owns: ["src/lib/board.mjs"] });
  liveGoal(arch, "relay-cgr", { lane: "relay", owns: ["src/mcp/prompts.mjs"] });
  appendEvent(arch, { type: "completed", slug: "board-cgr", at: "2026-08-02T10:00:00.000Z" });
  // relay-cgr already merged, but nobody recorded a verify result.
  appendEvent(arch, { type: "merged", slug: "relay-cgr", lane: "relay", at: NOW });

  const cwd = process.cwd();
  process.chdir(root);
  let text;
  try {
    const msg = await prompts.conductor.handler();
    text = msg.messages[0].content.text;
  } finally { process.chdir(cwd); }

  assert.match(text, /INTEGRATION DEBT/, "the debt ledger is a step of the loop, not a footnote");
  assert.match(text, /relay-cgr \(lane relay\): unverified/);
  assert.match(text, /archkit_board_merged/, "the prompt names the tool that clears the debt");
  // Step 5 still emits a CONCRETE command for the lane still awaiting integration.
  assert.match(text, /3\. VERIFY \(from project\): npm test/);
});

await testAsync("EC3: with no debt the prompt says so rather than staying silent", async () => {
  const { root, arch } = freshProject({ testScript: "node scripts/test.mjs" });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "# system\n");
  liveGoal(arch, "a", { lane: "L" });
  liveGoal(arch, "b", { lane: "M" });
  appendEvent(arch, { type: "completed", slug: "a", at: "2026-08-02T10:00:00.000Z" });
  appendEvent(arch, { type: "completed", slug: "b", at: "2026-08-02T11:00:00.000Z" });
  const cwd = process.cwd();
  process.chdir(root);
  let text;
  try { text = (await prompts.conductor.handler()).messages[0].content.text; }
  finally { process.chdir(cwd); }
  assert.match(text, /INTEGRATION DEBT: none/);
});

// ── instruct-not-act still holds ────────────────────────────────────────────

test("archkit resolves and RECORDS the verify command — it never runs it", () => {
  const src = fs.readFileSync(new URL("../../src/lib/board.mjs", import.meta.url), "utf8");
  assert.ok(!/from\s+["']node:child_process["']/.test(src), "board.mjs must not import child_process");
  assert.ok(!/\b(execSync|execFileSync|spawnSync|execFile)\s*\(/.test(src), "board.mjs must not spawn");
  assert.ok(!/\brunTests\b/.test(src), "board.mjs must not run tests — it imports DETECTION only");
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
