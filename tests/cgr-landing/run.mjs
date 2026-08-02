#!/usr/bin/env node
// Tests for CI-AWARE bucket landing (pr-based-landing, ADR 0025).
//
// The terminal step of a CGR batch used to emit a DIRECT merge to mainline
// (`git switch main && git merge <branch>`) — bypassing the pull_request-gated
// CI the project's own release docs promise. Landing is now gated on
// .arch/config.json → cgr.finalize.ciCd:
//   - a CI provider  → push + open-a-PR + WAIT for the required checks (EC1, EC3)
//   - no CI provider → the historical direct merge, byte for byte (EC2)
//
// archkit still runs no git: only the EMITTED string and its config gating
// changed (EC4, instruct-not-act / ADR 0010).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bucketMergeGuidance,
  bucketLandingStrategy,
  bucketCompletion,
  hasCiProvider,
  writeFinalizeConfig,
  writeGoal,
  startGoal,
  LANDING_DIRECT,
  LANDING_PR,
} from "../../src/lib/goals.mjs";
import { tools } from "../../src/mcp/tools.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshArch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-landing-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "goals"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "# SYSTEM.md\n## Type: Internal\n");
  return arch;
}

// A goal record shaped like listGoals output, for the pure bucketCompletion path.
const mkGoal = (slug, status, project) => ({
  slug, meta: { slug, status, ...(project ? { project } : {}) },
});

console.log("\nCI-aware bucket landing (ADR 0025)\n");

// ── EC2: no CI configured → the existing direct merge, untouched ─────────────

test("EC2: with NO ciCd argument the guidance is the historical direct merge", () => {
  assert.equal(
    bucketMergeGuidance({ branch: "feat/alpha", mainline: "main" }),
    "git switch main && git merge feat/alpha",
  );
  assert.equal(
    bucketMergeGuidance({ branch: "cgr-queue-2026-06-20", mainline: "develop" }),
    "git switch develop && git merge cgr-queue-2026-06-20",
  );
});

test("EC2: ciCd 'none' (the finalize default) is NOT a CI provider", () => {
  assert.equal(hasCiProvider("none"), false);
  assert.equal(hasCiProvider(""), false);
  assert.equal(hasCiProvider(null), false);
  assert.equal(hasCiProvider(undefined), false);
  assert.equal(
    bucketMergeGuidance({ branch: "feat/alpha", mainline: "main", ciCd: "none" }),
    "git switch main && git merge feat/alpha",
  );
});

test("EC2: a project with no finalize config keeps direct-merge landing end to end", () => {
  const arch = freshArch();
  const strategy = bucketLandingStrategy(arch);
  assert.equal(strategy.strategy, LANDING_DIRECT);
  assert.equal(strategy.ci, false);

  const bc = bucketCompletion(arch, [mkGoal("p-a1", "in-progress", "alpha")], "p-a1");
  assert.equal(bc.landing, LANDING_DIRECT);
  assert.equal(bc.ciCd, "none");
  assert.equal(bc.mergeGuidance, "git switch main && git merge feat/alpha");
});

// ── EC1: a CI provider → push + open a PR, never a direct merge ──────────────

test("EC1: github-actions emits push + `gh pr create --base <mainline>`", () => {
  const g = bucketMergeGuidance({ branch: "feat/alpha", mainline: "main", ciCd: "github-actions" });
  assert.match(g, /git push -u origin feat\/alpha/, "pushes the branch");
  assert.match(g, /gh pr create --base main --head feat\/alpha/, "opens the PR against mainline");
  assert.ok(!/git merge/.test(g), "no direct merge");
  assert.ok(!/git switch main/.test(g), "never switches to mainline to land it locally");
});

test("EC1: a non-GitHub provider still pushes and opens a PR, without assuming gh", () => {
  const g = bucketMergeGuidance({ branch: "feat/alpha", mainline: "main", ciCd: "custom" });
  assert.match(g, /git push -u origin feat\/alpha/);
  assert.match(g, /open a PR from feat\/alpha into main/);
  assert.ok(!/gh pr create/.test(g), "does not assume the gh CLI for an unknown provider");
  assert.ok(!/git merge/.test(g), "no direct merge");
});

test("EC1: the configured provider drives the strategy end to end", () => {
  const arch = freshArch();
  writeFinalizeConfig(arch, { ciCd: "github-actions" });

  const strategy = bucketLandingStrategy(arch);
  assert.equal(strategy.strategy, LANDING_PR);
  assert.equal(strategy.ciCd, "github-actions");

  const bc = bucketCompletion(arch, [mkGoal("q-1", "in-progress")], "q-1");
  assert.equal(bc.landing, LANDING_PR);
  assert.equal(bc.ciCd, "github-actions");
  assert.match(bc.mergeGuidance, /gh pr create --base main/);
  assert.ok(!/git merge/.test(bc.mergeGuidance));
});

test("EC1: switching the provider off restores direct-merge landing", () => {
  const arch = freshArch();
  writeFinalizeConfig(arch, { ciCd: "github-actions" });
  assert.equal(bucketLandingStrategy(arch).strategy, LANDING_PR);
  writeFinalizeConfig(arch, { ciCd: "none" });
  assert.equal(bucketLandingStrategy(arch).strategy, LANDING_DIRECT);
  const bc = bucketCompletion(arch, [mkGoal("q-1", "in-progress")], "q-1");
  assert.equal(bc.mergeGuidance, "git switch main && git merge cgr-queue-" + new Date().toISOString().slice(0, 10));
});

// ── EC3: wait for the required checks (RELEASING.md step 3) ──────────────────

test("EC3: the PR guidance tells the agent to WAIT for the required checks before merging", () => {
  for (const ciCd of ["github-actions", "custom"]) {
    const g = bucketMergeGuidance({ branch: "feat/alpha", mainline: "main", ciCd });
    assert.match(g, /WAIT for the required/, `${ciCd}: waits for checks`);
    assert.match(g, new RegExp(ciCd.replace(/[-]/g, "[-]")), `${ciCd}: names the provider`);
    assert.match(g, /before merging it/, `${ciCd}: the wait precedes the merge`);
    assert.match(g, /do NOT merge to main locally/, `${ciCd}: rules out the local merge`);
    assert.match(g, /the PR IS the gate/, `${ciCd}: says why`);
  }
});

test("EC3: the guidance stays ONE copy-pasteable line (a relay prints it verbatim)", () => {
  const g = bucketMergeGuidance({ branch: "feat/alpha", mainline: "main", ciCd: "github-actions" });
  assert.ok(!g.includes("\n"), "single line");
  // The wait instruction rides in a shell comment, so the line is still valid to paste.
  assert.match(g, /^git push[^#]*#/, "commands first, instruction in a trailing comment");
});

// ── EC4: instruct-not-act — the change is the string + its config gating ─────

test("EC4: archkit still runs no git — goals.mjs shells out to nothing", () => {
  const src = fs.readFileSync(new URL("../../src/lib/goals.mjs", import.meta.url), "utf8");
  assert.ok(!/from\s+["']node:child_process["']|require\(["']child_process["']\)/.test(src),
    "goals.mjs never imports child_process");
  assert.ok(!/\b(execSync|spawnSync|execFileSync|spawn)\(/.test(src), "goals.mjs runs no commands");
});

test("EC4: bucketMergeGuidance is PURE — same inputs, same string, no disk touched", () => {
  const a = bucketMergeGuidance({ branch: "feat/x", mainline: "main", ciCd: "github-actions" });
  const b = bucketMergeGuidance({ branch: "feat/x", mainline: "main", ciCd: "github-actions" });
  assert.equal(a, b);
});

test("EC4: a real drained bucket emits guidance only — no branch is created or moved", () => {
  const arch = freshArch();
  writeFinalizeConfig(arch, { ciCd: "github-actions" });
  writeGoal(arch, { slug: "p-a1", title: "A1", project: "alpha", exitCriteria: ["x"] });
  startGoal(arch, "p-a1");
  const before = fs.existsSync(path.join(path.dirname(arch), ".git"));
  const bc = bucketCompletion(arch, [mkGoal("p-a1", "in-progress", "alpha")], "p-a1");
  assert.match(bc.mergeGuidance, /git push -u origin feat\/alpha/);
  assert.equal(fs.existsSync(path.join(path.dirname(arch), ".git")), before,
    "no repo state was touched — archkit only emitted a string");
});

// ── The tool description documents the CI-aware landing ──────────────────────

// The two landing branches themselves are asserted above against the EMITTED
// mergeGuidance (the string the agent actually relays), which is the load-bearing
// contract. The tool description no longer restates those git commands verbatim:
// tool-description-diet moved that prose to ADR 0025 / docs/mcp-tool-surface.md,
// leaving the description to ROUTE the reader. This asserts the routing survives.
test("archkit_goal_complete's description routes the reader to the landing choice", () => {
  const d = tools.archkit_goal_complete.description;
  assert.match(d, /bucketCompletion/, "it names the field that carries the choice");
  assert.match(d, /AskUserQuestion/, "it says to present the choice to the user");
  assert.match(d, /mergeGuidance/, "it names the emitted guidance");
  assert.match(d, /VERBATIM/, "and says to relay it unedited");
  assert.match(d, /never runs git/, "it keeps the instruct-not-act framing");
  assert.match(d, /ADR 0025/, "and points at the decision that holds the detail");
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
