#!/usr/bin/env node
// archkit goal — Clear Goal Run (CGR) artifact management.
//
//   archkit goal list                       — show active + done goals
//   archkit goal show <slug>                — print full goal markdown
//   archkit goal payload <slug>             — print copy-paste payload for `/goal`
//   archkit goal complete <slug> [notes]    — mark goal done, archive to done/
//   archkit goal intake --json <payload>    — accept structured decomposition
//
// The agent (Claude) drives intake by calling the MCP tool
// archkit_goal_intake with a JSON decomposition of the user's ask.
// The CLI `goal intake` is for scripted callers / debugging.

import fs from "fs";
import path from "path";
import { C, ICONS as I, findArchDir as _findArchDir } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import {
  writeGoal,
  listGoals,
  loadGoal,
  completeGoal,
  abandonGoal,
  markTesting,
  markOnHold,
  statusOf,
  STATUS_COMPLETED,
  exitCriteriaOf,
  verifyCommandOf,
  renderPayload,
  ensureGoalsLayout,
  goalsDir,
  doneDir,
  writeGoalProposal,
  listGoalProposals,
  removeGoalProposal,
  promoteGoalProposal,
  countGoalProposals,
  consolidateGoals,
  listDigests,
  archiveDir,
} from "../lib/goals.mjs";
import crypto from "node:crypto";
import { detectTestCommand, runTests } from "../lib/test-runner.mjs";
import { archkitError } from "../lib/errors.mjs";
import { execFileSync } from "node:child_process";

// review.mjs auto-fires main() when ARCHKIT_RUN is set (CLI-dispatch
// convention). bin/archkit.mjs sets it for the `goal` subcommand, so a static
// import would run review's CLI on import. Dynamic-import with the env cleared
// (same pattern as doctor.mjs/loadDrift).
async function loadReview() {
  const prev = process.env.ARCHKIT_RUN;
  delete process.env.ARCHKIT_RUN;
  try { return await import("./review.mjs"); }
  finally { if (prev !== undefined) process.env.ARCHKIT_RUN = prev; }
}

// Files changed in the working tree (porcelain), relative to cwd. Empty if not
// a git repo — verify degrades gracefully rather than throwing.
function gitModifiedFiles(cwd) {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  } catch { return []; }
}

function findArchDir() {
  return _findArchDir({ requireFile: "SYSTEM.md" });
}

export function runGoalIntake({ archDir, cwd, sourceAsk, goals }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  if (!Array.isArray(goals) || goals.length === 0) {
    throw archkitError("invalid_input", "goals must be a non-empty array", {
      suggestion: "Pass at least one decomposed goal with a title and exitCriteria.",
    });
  }
  ensureGoalsLayout(archDir);
  // Auto-detect the project's test command once and bake it onto every goal
  // that doesn't override it — so completion gates on green tests by default
  // (the agent can scope/override per goal via the goal's verifyCommand field).
  const detected = detectTestCommand(cwd);
  const written = [];
  const payloads = [];
  for (const g of goals) {
    if (sourceAsk && !g.sourceAsk) g.sourceAsk = sourceAsk;
    if (!g.verifyCommand && detected) g.verifyCommand = detected.command;
    const { slug, filepath } = writeGoal(archDir, g);
    written.push({ slug, filepath: path.relative(cwd, filepath), verifyCommand: g.verifyCommand || null });
    const { payload, length, withinBudget } = renderPayload(archDir, slug);
    payloads.push({ slug, payload, length, withinBudget });
  }
  return {
    written,
    testGate: detected
      ? `Detected test command "${detected.command}" (${detected.source}) — baked onto goals as verify-command. archkit_goal_complete will run it and refuse to complete on red.`
      : `No test command detected (no package.json scripts.test). Goals have no test gate — set verifyCommand per goal to enable one.`,
    payloads,
    nextStep:
      payloads.length === 1
        ? `Tell the user: run /clear, then /mcp__archkit__goal_next to start the goal (fallback: paste the payload above after /goal).`
        : `Tell the user: run /clear, then /mcp__archkit__goal_next to start the first goal. Repeat /clear + /mcp__archkit__goal_next after each archkit_goal_complete to advance the queue.`,
  };
}

export function runGoalList({ archDir }) {
  const active = listGoals(archDir);
  const dDir = doneDir(archDir);
  const done = [];
  if (fs.existsSync(dDir)) {
    for (const name of fs.readdirSync(dDir)) {
      if (!name.endsWith(".md")) continue;
      const fp = path.join(dDir, name);
      try { if (!fs.statSync(fp).isFile()) continue; } catch { continue; }
      done.push({ slug: name.replace(/\.md$/, "") });
    }
  }
  // Consolidated history: raw CGRs preserved under done/archive/ + the dated
  // digests that summarize them. Surfaces the consolidation output so the
  // digest is discoverable here, not a dead file.
  const aDir = archiveDir(archDir);
  let archived = 0;
  if (fs.existsSync(aDir)) {
    archived = fs.readdirSync(aDir).filter((n) => n.endsWith(".md")).length;
  }
  const digests = listDigests(archDir).slice(0, 5).map((d) => ({
    date: d.date,
    count: d.count,
    slugs: d.slugs,
    relativePath: d.relativePath,
    summary: d.summary,
  }));
  const activeList = active.map((g) => ({
    slug: g.slug,
    title: g.meta.title || g.slug,
    status: statusOf(g),
    created: g.meta.created || "",
  }));
  const goalsNote = activeList.length === 0 && done.length === 0
    ? `No goals exist in .arch/goals/ yet. CGR hasn't been used in this project.`
    : activeList.length === 0
      ? `All goals complete (${done.length} archived). No active work.`
      : undefined;
  const nextStep = activeList.length === 0 && done.length === 0
    ? `Call archkit_goal_intake with the user's ask decomposed into 1..N goals to begin CGR.`
    : activeList.length === 0
      ? `Queue is empty. Call archkit_goal_intake with the next ask, or proceed without CGR.`
      : `Continue ${activeList[0].slug}. Call archkit_goal_payload ${activeList[0].slug} to re-render the /goal payload if needed.`;
  return { active: activeList, done, archived, digests, goalsNote, nextStep };
}

export function runGoalPayload({ archDir, slug }) {
  const out = renderPayload(archDir, slug);
  return {
    ...out,
    nextStep: out.withinBudget
      ? `Tell the user: run /clear, then /mcp__archkit__goal_next (fallback: paste this payload after /goal).`
      : `Payload is over the 3800-char budget. Trim required-reading or files-to-touch in .arch/goals/${slug}.md, then re-call.`,
  };
}

// Move an active goal into the `testing` state — edits applied, verification
// pending (ADR 0003). The file relocates to .arch/goals/testing/ and the goal
// stays guarded by the Stop hook (it is NOT done) until a session verifies it
// green and completes it. This replaces the premature-goal_complete antipattern
// for fast mass-edits: park visible verification debt instead of hiding it.
export function runGoalTesting({ archDir, slug }) {
  const goal = loadGoal(archDir, slug);
  if (!goal) {
    const active = listGoals(archDir).map((g) => g.slug);
    throw archkitError("unknown_goal", `unknown goal: ${slug}`, {
      suggestion: active.length ? `Active goals: ${active.join(", ")}` : "No active goals — nothing to move to testing.",
    });
  }
  const result = markTesting(archDir, slug);
  const verifyCommand = verifyCommandOf(goal);
  return {
    ...result,
    verifyCommand: verifyCommand || null,
    nextStep: verifyCommand
      ? `Goal "${slug}" parked in testing (.arch/goals/testing/${slug}.md) — edits applied, verification pending. It is NOT done: the Stop hook keeps guarding it. Run archkit_goal_verify ${slug} to preview the gate, then archkit_goal_complete ${slug} (re-runs "${verifyCommand}" and refuses on red).`
      : `Goal "${slug}" parked in testing (.arch/goals/testing/${slug}.md) — edits applied, verification pending. It is NOT done: confirm the exit-criteria hold, then archkit_goal_complete ${slug}.`,
  };
}

// Park an active goal in `on-hold` — deliberately set aside but resumable (ADR
// 0003). Unlike `testing`, parking RELEASES the Stop-hook guard (the session may
// end) and the goal is not auto-selected ahead of pending/testing work; a later
// /mcp__archkit__goal_next resumes it (startGoal flips it back to in-progress)
// only once nothing live is left. Distinct from archkit_goal_defer, which stashes
// a follow-up PROPOSAL — on-hold parks a real, already-queued goal.
export function runGoalHold({ archDir, slug }) {
  const goal = loadGoal(archDir, slug);
  if (!goal) {
    const active = listGoals(archDir).map((g) => g.slug);
    throw archkitError("unknown_goal", `unknown goal: ${slug}`, {
      suggestion: active.length ? `Active goals: ${active.join(", ")}` : "No active goals — nothing to put on hold.",
    });
  }
  const result = markOnHold(archDir, slug);
  return {
    ...result,
    nextStep: `Goal "${slug}" parked on-hold (guard released — session can end). Resume later via /clear + /mcp__archkit__goal_next once nothing live is ahead of it; to DROP it instead, use archkit_goal_abandon ${slug}.`,
  };
}

export function runGoalComplete({ archDir, cwd = process.cwd(), slug, notes }) {
  // HARD test gate: if the goal declares a verify-command, run it and refuse to
  // complete on red (or if it can't run). This is what makes "done" provably
  // mean tests pass instead of trusting the agent's say-so. Escape hatch: a
  // genuinely-obsolete goal should be archkit_goal_abandon'd, not completed.
  const goal = loadGoal(archDir, slug);
  if (!goal) {
    const active = listGoals(archDir).map((g) => g.slug);
    throw archkitError("unknown_goal", `unknown goal: ${slug}`, {
      suggestion: active.length ? `Active goals: ${active.join(", ")}` : "No active goals — nothing to complete.",
    });
  }
  const verifyCommand = verifyCommandOf(goal);
  let extraMeta = {};
  if (verifyCommand) {
    const r = runTests({ cwd, command: verifyCommand });
    if (!r.ran) {
      throw archkitError("test_gate_unrunnable", `verify-command "${verifyCommand}" could not run: ${r.reason || "spawn failed"}`, {
        suggestion: `Fix or correct the command in .arch/goals/${slug}.md, then retry archkit_goal_complete ${slug}. If the goal is obsolete, use archkit_goal_abandon ${slug}.`,
      });
    }
    if (!r.passed) {
      throw archkitError("test_gate_failed", `verify-command "${verifyCommand}" is RED${r.timedOut ? " (timed out)" : ` (exit ${r.exitCode})`} — goal NOT completed.`, {
        suggestion: `Fix the failing tests, then retry archkit_goal_complete ${slug}. Tail:\n${r.outputTail || "(no output)"}`,
      });
    }
    extraMeta = {
      "tests-passed": true,
      "tests-command": verifyCommand,
      "tests-at": new Date().toISOString().slice(0, 10),
    };
  }
  const result = completeGoal(archDir, slug, { notes, extraMeta });
  // Suggest the next goal's payload if any
  const remaining = listGoals(archDir);
  const next = remaining.find((g) => statusOf(g) !== STATUS_COMPLETED);
  // Queue-drain trigger: when nothing is left to work, fold the freshly-
  // completed goal (and any earlier un-consolidated terminal goals) into a
  // dated digest and archive the raw CGRs verbatim. Best-effort — a
  // consolidation failure must never block marking the goal done.
  let consolidation = null;
  if (!next) {
    try { consolidation = consolidateGoals(archDir); } catch { /* non-fatal */ }
  }
  const drainNote = consolidation && consolidation.consolidated > 0
    ? ` Consolidated ${consolidation.consolidated} completed goal(s) into the ${consolidation.date} digest (raw archived under goals/done/archive/; searchable via archkit_goal_list).`
    : "";
  return {
    ...result,
    testGate: verifyCommand ? { command: verifyCommand, passed: true } : null,
    consolidation,
    nextGoal: next
      ? {
          slug: next.slug,
          ...renderPayload(archDir, next.slug),
          instruction: `Run /clear, then /mcp__archkit__goal_next (fallback: paste the payload above after /goal).`,
        }
      : null,
    nextStep: next
      ? `Tell the user: run /clear, then /mcp__archkit__goal_next to begin ${next.slug} (fallback: paste nextGoal.payload after /goal).`
      : `All goals complete.${drainNote} Tell the user the CGR queue is empty and ask what to tackle next.`,
  };
}

// Incremental consolidation/digest on demand — drains terminal goals in
// .arch/goals/done/ into a dated digest + archives raw CGRs. Safe to call with
// goals still pending (NOT gated on an empty queue); the relay also fires this
// automatically at queue-drain (runGoalComplete) and session-end (Stop hook).
export function runGoalConsolidate({ archDir }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  const r = consolidateGoals(archDir);
  return {
    ...r,
    nextStep: r.consolidated > 0
      ? `Consolidated ${r.consolidated} terminal goal(s) into .arch/goals/done/digest/${r.date}.md. Raw CGRs preserved under goals/done/archive/ — full context recoverable. Recent digests surface in archkit_goal_list.`
      : `Nothing to consolidate — no un-archived terminal goals in .arch/goals/done/.`,
  };
}

export function runGoalAbandon({ archDir, slug, reason }) {
  if (!loadGoal(archDir, slug)) {
    const active = listGoals(archDir).map((g) => g.slug);
    throw archkitError("unknown_goal", `unknown goal: ${slug}`, {
      suggestion: active.length ? `Active goals: ${active.join(", ")}` : "No active goals — nothing to abandon.",
    });
  }
  const result = abandonGoal(archDir, slug, { reason });
  const remaining = listGoals(archDir);
  const next = remaining.find((g) => statusOf(g) !== STATUS_COMPLETED);
  return {
    ...result,
    nextGoal: next ? { slug: next.slug, ...renderPayload(archDir, next.slug) } : null,
    nextStep: next
      ? `Goal ${slug} abandoned (archived to done/). Run /clear then /mcp__archkit__goal_next to start ${next.slug}.`
      : `Goal ${slug} abandoned. CGR queue is empty — ask the user what to tackle next.`,
  };
}

// Evidence for "is this goal actually done?" — does NOT auto-judge free-text
// exit-criteria. Echoes the criteria as a checklist and gathers objective
// signals: which files-to-touch were modified, and what a staged review finds.
// Hardens the relay (the Stop guard otherwise trusts the goal_complete call).
export async function runGoalVerify({ archDir, cwd = process.cwd(), slug }) {
  const goal = loadGoal(archDir, slug);
  if (!goal) {
    const active = listGoals(archDir).map((g) => g.slug);
    throw archkitError("unknown_goal", `unknown goal: ${slug}`, {
      suggestion: active.length ? `Active goals: ${active.join(", ")}` : "No active goals — call archkit_goal_intake first.",
    });
  }

  const exitCriteria = exitCriteriaOf(goal);
  const filesToTouch = Array.isArray(goal.meta["files-to-touch"]) ? goal.meta["files-to-touch"] : [];
  const modified = gitModifiedFiles(cwd);
  const norm = (p) => p.replace(/^\.\//, "");
  const touched = filesToTouch.filter((f) => modified.some((m) => norm(m) === norm(f) || norm(m).endsWith(norm(f)) || norm(f).endsWith(norm(m))));
  const untouched = filesToTouch.filter((f) => !touched.includes(f));

  let stagedReview = { files: 0, errors: 0, findings: 0 };
  let reviewNote;
  try {
    const { runReviewJson } = await loadReview();
    const r = await runReviewJson({ archDir, cwd, staged: true });
    stagedReview = { files: r.files || 0, errors: r.errors || 0, findings: Array.isArray(r.findings) ? r.findings.length : 0 };
    reviewNote = r.filesNote;
  } catch (_) { reviewNote = "Staged review skipped (no git repo or no staged changes)."; }

  // Test gate (preview). The goal's verify-command is run here as a cheap dry
  // run; archkit_goal_complete re-runs it as the authoritative gate. A red or
  // failed-to-run command makes the goal "not clean" so the agent keeps working.
  const verifyCommand = verifyCommandOf(goal);
  let tests;
  if (verifyCommand) {
    const r = runTests({ cwd, command: verifyCommand });
    tests = { command: verifyCommand, ran: r.ran, passed: r.passed, exitCode: r.exitCode, durationMs: r.durationMs, timedOut: r.timedOut, outputTail: r.outputTail, reason: r.reason };
  }

  const testsGreen = !verifyCommand || (tests?.ran && tests.passed);
  const clean = stagedReview.errors === 0 && testsGreen;
  // A goal in `testing` IS the verification window (ADR 0003): edits already
  // landed and we're now draining the verify debt. Surface that so the agent
  // knows a green run here is the cue to complete.
  const inTesting = (goal.meta.status || "") === "testing";
  const nextStep = stagedReview.errors > 0
    ? `Staged review has ${stagedReview.errors} error(s) — resolve them (archkit_review_staged for detail) before archkit_goal_complete ${slug}.`
    : verifyCommand && !tests.ran
      ? `Couldn't run verify-command "${verifyCommand}" (${tests.reason || "spawn failed"}). Fix or correct the command in .arch/goals/${slug}.md before archkit_goal_complete ${slug}.`
      : verifyCommand && !tests.passed
        ? `verify-command "${verifyCommand}" is RED${tests.timedOut ? " (timed out)" : ` (exit ${tests.exitCode})`} — fix the failing tests before archkit_goal_complete ${slug}. archkit_goal_complete will re-run it and refuse on red.`
        : untouched.length === filesToTouch.length && filesToTouch.length > 0
          ? `None of the ${filesToTouch.length} planned files are modified yet — the goal likely isn't done. Keep working or re-scope.`
          : `Objective checks clean${verifyCommand ? " (tests green)" : ""}. Confirm each of the ${exitCriteria.length} exit-criterion below holds, then call archkit_goal_complete ${slug}.`;

  return {
    slug,
    title: goal.meta.title || slug,
    status: statusOf(goal),
    verificationWindow: inTesting,
    exitCriteria,
    exitCriteriaNote: exitCriteria.length === 0 ? `Goal has no exit-criteria — can't verify completion objectively. Add some to .arch/goals/${slug}.md.` : undefined,
    filesToTouch: { touched, untouched },
    filesToTouchNote: filesToTouch.length === 0 ? "Goal declared no files-to-touch — skipping the file-modification check." : undefined,
    stagedReview,
    reviewNote,
    tests,
    testsNote: verifyCommand ? undefined : "Goal has no verify-command — no test gate. Add one to .arch/goals/" + slug + ".md to gate completion on green tests.",
    clean,
    nextStep,
  };
}

// Explicitly stash a follow-up the agent noticed mid-session as a PROPOSED goal
// (not a real goal). Richer than the Stop-hook regex draft because the agent
// supplies a real title + exit-criteria. Lands in .arch/goals/proposed/.
export function runGoalDefer({ archDir, title, why, exitCriteria, context }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  if (!title || !title.trim()) {
    throw archkitError("invalid_input", "title is required", { suggestion: "Pass a one-line title for the follow-up." });
  }
  const hash = crypto.createHash("sha1").update(`defer::${title.trim()}`).digest("hex").slice(0, 12);
  const created = writeGoalProposal(archDir, {
    hash,
    title: title.trim(),
    why: why || "",
    exitCriteria: Array.isArray(exitCriteria) ? exitCriteria : [],
    contextExcerpt: context || "",
    patternName: null,
    source: "goal-defer",
  });
  const totalPending = countGoalProposals(archDir);
  return {
    proposed: created,
    hash,
    duplicate: !created,
    totalPending,
    nextStep: created
      ? `Stashed "${title.trim()}" as a follow-up proposal (${totalPending} pending). It is NOT a goal yet — at session end, run /mcp__archkit__goal_review to promote it (or dismiss). Keep working the current goal.`
      : `An identical follow-up is already pending (${totalPending} total). No duplicate written.`,
  };
}

// Promote proposed follow-ups into planned goals. Pass hashes:[...] for a
// selection or all:true for everything. The /mcp__archkit__goal_review prompt
// drives the user-facing multi-select that decides what gets passed here.
export function runGoalPromote({ archDir, hashes, all }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  const pending = listGoalProposals(archDir);
  if (pending.length === 0) {
    return { promoted: [], notFound: [], nextStep: "No follow-up proposals pending in .arch/goals/proposed/. Nothing to promote." };
  }
  const targets = all ? pending.map((p) => p.hash) : (Array.isArray(hashes) ? hashes : []);
  if (targets.length === 0) {
    throw archkitError("invalid_input", "pass hashes:[...] or all:true", {
      suggestion: `Pending: ${pending.map((p) => `${p.hash} (${p.title})`).join("; ")}`,
    });
  }
  const promoted = [];
  const notFound = [];
  for (const h of targets) {
    const r = promoteGoalProposal(archDir, h);
    if (r) promoted.push({ hash: h, slug: r.slug });
    else notFound.push(h);
  }
  const remaining = countGoalProposals(archDir);
  return {
    promoted,
    notFound,
    remaining,
    nextStep: promoted.length
      ? `Promoted ${promoted.length} proposal(s) to planned goals: ${promoted.map((p) => p.slug).join(", ")}. ${remaining} still pending. Run /clear then /mcp__archkit__goal_next to start the first one.`
      : `No proposals matched the given hashes. ${remaining} still pending.`,
  };
}

// Drop proposed follow-ups without promoting them. hashes:[...] or all:true.
export function runGoalDismiss({ archDir, hashes, all }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  const pending = listGoalProposals(archDir);
  const targets = all ? pending.map((p) => p.hash) : (Array.isArray(hashes) ? hashes : []);
  if (targets.length === 0 && !all) {
    throw archkitError("invalid_input", "pass hashes:[...] or all:true", {
      suggestion: pending.length ? `Pending: ${pending.map((p) => `${p.hash} (${p.title})`).join("; ")}` : "No proposals pending.",
    });
  }
  const dismissed = targets.filter((h) => removeGoalProposal(archDir, h));
  return {
    dismissed,
    remaining: countGoalProposals(archDir),
    nextStep: `Dismissed ${dismissed.length} follow-up proposal(s). ${countGoalProposals(archDir)} still pending.`,
  };
}

function printPayload({ payload, length, withinBudget }) {
  console.log("");
  console.log(`${C.bold}─── Copy and paste after /goal in a fresh /clear'd session ───${C.reset}`);
  console.log(payload);
  console.log(`${C.dim}─── (${length}/${withinBudget ? "ok" : "OVER"} budget) ───${C.reset}`);
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);
  const sub = args[0];
  const isJson = args.includes("--json");

  if (!sub || args.includes("--help") || args.includes("-h")) {
    commandBanner("archkit goal", "Clear Goal Run (CGR) — one goal per session");
    console.log(`${C.yellow}  Subcommands:${C.reset}`);
    console.log(`${C.gray}    list                         List active + done goals${C.reset}`);
    console.log(`${C.gray}    show <slug>                  Print the goal's markdown${C.reset}`);
    console.log(`${C.gray}    payload <slug>               Print the /goal copy-paste payload${C.reset}`);
    console.log(`${C.gray}    testing <slug>               Park a goal in testing/ (edits applied, verify pending)${C.reset}`);
    console.log(`${C.gray}    hold <slug>                  Set a goal aside as on-hold (resumable, guard released)${C.reset}`);
    console.log(`${C.gray}    complete <slug> [--notes X]  Mark a goal done, archive to done/${C.reset}`);
    console.log(`${C.gray}    consolidate                  Digest terminal goals → done/digest/, archive raw${C.reset}`);
    console.log(`${C.gray}    intake --json <json>         Accept decomposed-goals JSON (agent driver)${C.reset}`);
    console.log("");
    console.log(`${C.dim}  CGR workflow: type a sprawling ask in a fresh session → agent decomposes${C.reset}`);
    console.log(`${C.dim}  via archkit_goal_intake → for each goal, /clear then /goal <payload>.${C.reset}`);
    process.exit(0);
  }

  const archDir = findArchDir();
  if (!archDir) {
    const msg = { error: "no_arch_dir", message: "No .arch/ directory found." };
    console.log(isJson ? JSON.stringify(msg) : `${C.red}  ${I.warn} ${msg.message}${C.reset}`);
    process.exit(1);
  }

  try {
    switch (sub) {
      case "list": {
        const out = runGoalList({ archDir });
        if (isJson) { console.log(JSON.stringify(out)); break; }
        commandBanner("archkit goal", "active + done goals");
        if (out.active.length === 0 && out.done.length === 0) {
          console.log(`${C.dim}  no goals yet — agent should call archkit_goal_intake${C.reset}\n`);
          break;
        }
        if (out.active.length > 0) {
          console.log(`\n  ${C.bold}Active${C.reset}`);
          for (const g of out.active) {
            console.log(`  ${I.dot} ${C.bold}${g.slug}${C.reset} ${C.dim}(${g.status})${C.reset} — ${g.title}`);
          }
        }
        if (out.done.length > 0) {
          console.log(`\n  ${C.bold}Done${C.reset}`);
          for (const g of out.done) console.log(`  ${C.green}${I.check}${C.reset} ${g.slug}`);
        }
        console.log("");
        break;
      }
      case "show": {
        const slug = args[1];
        if (!slug) throw archkitError("invalid_input", "slug required", { suggestion: "archkit goal show <slug>" });
        const goal = loadGoal(archDir, slug);
        if (!goal) throw archkitError("unknown_goal", `unknown goal: ${slug}`, {
          suggestion: "Run `archkit goal list` to see available goals.",
        });
        if (isJson) { console.log(JSON.stringify({ slug, meta: goal.meta, body: goal.body })); break; }
        console.log(fs.readFileSync(goal.filepath, "utf8"));
        break;
      }
      case "payload": {
        const slug = args[1];
        if (!slug) throw archkitError("invalid_input", "slug required", { suggestion: "archkit goal payload <slug>" });
        const out = runGoalPayload({ archDir, slug });
        if (isJson) { console.log(JSON.stringify(out)); break; }
        commandBanner("archkit goal", `payload for ${slug}`);
        printPayload(out);
        break;
      }
      case "testing": {
        const slug = args[1];
        if (!slug) throw archkitError("invalid_input", "slug required", { suggestion: "archkit goal testing <slug>" });
        const out = runGoalTesting({ archDir, slug });
        if (isJson) { console.log(JSON.stringify(out)); break; }
        commandBanner("archkit goal", `testing ${slug}`);
        console.log(`\n  ${C.yellow}${I.dot}${C.reset} parked in testing: .arch/goals/testing/${slug}.md`);
        console.log(`  ${C.dim}edits applied, verification pending — NOT done${C.reset}\n`);
        break;
      }
      case "hold": {
        const slug = args[1];
        if (!slug) throw archkitError("invalid_input", "slug required", { suggestion: "archkit goal hold <slug>" });
        const out = runGoalHold({ archDir, slug });
        if (isJson) { console.log(JSON.stringify(out)); break; }
        commandBanner("archkit goal", `on-hold ${slug}`);
        console.log(`\n  ${C.yellow}${I.dot}${C.reset} parked on-hold: .arch/goals/${slug}.md`);
        console.log(`  ${C.dim}deliberately set aside — guard released, resume with /mcp__archkit__goal_next${C.reset}\n`);
        break;
      }
      case "complete": {
        const slug = args[1];
        if (!slug) throw archkitError("invalid_input", "slug required", { suggestion: "archkit goal complete <slug>" });
        const notesIdx = args.indexOf("--notes");
        const notes = notesIdx > 0 ? (args[notesIdx + 1] || "") : "";
        const out = runGoalComplete({ archDir, cwd: process.cwd(), slug, notes });
        if (isJson) { console.log(JSON.stringify(out)); break; }
        commandBanner("archkit goal", `completed ${slug}`);
        console.log(`\n  ${C.green}${I.check}${C.reset} archived: ${out.archivedAt}`);
        if (out.testGate) console.log(`  ${C.green}${I.check}${C.reset} test gate: ${out.testGate.command} passed`);
        console.log("");
        if (out.nextGoal) {
          console.log(`  ${C.bold}Next goal:${C.reset} ${out.nextGoal.slug}`);
          console.log(`  ${out.nextGoal.instruction}`);
          printPayload(out.nextGoal);
        } else {
          console.log(`  ${C.dim}all goals complete${C.reset}\n`);
        }
        break;
      }
      case "consolidate": {
        const out = runGoalConsolidate({ archDir });
        if (isJson) { console.log(JSON.stringify(out)); break; }
        commandBanner("archkit goal", "consolidate completed goals");
        if (out.consolidated > 0) {
          console.log(`\n  ${C.green}${I.check}${C.reset} digest: .arch/goals/done/digest/${out.date}.md (${out.consolidated} goal${out.consolidated === 1 ? "" : "s"})`);
          console.log(`  ${C.dim}raw preserved under goals/done/archive/${C.reset}\n`);
        } else {
          console.log(`\n  ${C.dim}nothing to consolidate${C.reset}\n`);
        }
        break;
      }
      case "intake": {
        const jsonIdx = args.indexOf("--json");
        const raw = args[jsonIdx + 1];
        if (!raw) throw archkitError("invalid_input", "--json <json> required",
          { suggestion: "archkit goal intake --json '{\"sourceAsk\":\"...\",\"goals\":[...]}'" });
        let body;
        try { body = JSON.parse(raw); } catch (e) {
          throw archkitError("invalid_input", `invalid JSON: ${e.message}`,
            { suggestion: "Ensure the --json argument is a single JSON object." });
        }
        const out = runGoalIntake({ archDir, cwd: process.cwd(), sourceAsk: body.sourceAsk || "", goals: body.goals || [] });
        console.log(JSON.stringify(out));
        break;
      }
      default:
        throw archkitError("invalid_input", `unknown subcommand: ${sub}`,
          { suggestion: "archkit goal --help" });
    }
  } catch (err) {
    if (isJson) {
      console.log(JSON.stringify({ error: err.code || "internal_error", message: err.message, suggestion: err.suggestion }));
    } else {
      console.error(`${C.red}  ${I.cross} ${err.message}${C.reset}`);
      if (err.suggestion) console.error(`  ${C.dim}${err.suggestion}${C.reset}`);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main();
}
