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
  exitCriteriaOf,
  renderPayload,
  ensureGoalsLayout,
  goalsDir,
  doneDir,
} from "../lib/goals.mjs";
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
  const written = [];
  const payloads = [];
  for (const g of goals) {
    if (sourceAsk && !g.sourceAsk) g.sourceAsk = sourceAsk;
    const { slug, filepath } = writeGoal(archDir, g);
    written.push({ slug, filepath: path.relative(cwd, filepath) });
    const { payload, length, withinBudget } = renderPayload(archDir, slug);
    payloads.push({ slug, payload, length, withinBudget });
  }
  return {
    written,
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
      done.push({ slug: name.replace(/\.md$/, "") });
    }
  }
  const activeList = active.map((g) => ({
    slug: g.slug,
    title: g.meta.title || g.slug,
    status: g.meta.status || "planned",
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
  return { active: activeList, done, goalsNote, nextStep };
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

export function runGoalComplete({ archDir, slug, notes }) {
  const result = completeGoal(archDir, slug, { notes });
  // Suggest the next goal's payload if any
  const remaining = listGoals(archDir);
  const next = remaining.find((g) => (g.meta.status || "planned") !== "done");
  return {
    ...result,
    nextGoal: next
      ? {
          slug: next.slug,
          ...renderPayload(archDir, next.slug),
          instruction: `Run /clear, then /mcp__archkit__goal_next (fallback: paste the payload above after /goal).`,
        }
      : null,
    nextStep: next
      ? `Tell the user: run /clear, then /mcp__archkit__goal_next to begin ${next.slug} (fallback: paste nextGoal.payload after /goal).`
      : `All goals complete. Tell the user the CGR queue is empty and ask what to tackle next.`,
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
  const next = remaining.find((g) => (g.meta.status || "planned") !== "done");
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

  const clean = stagedReview.errors === 0;
  const nextStep = !clean
    ? `Staged review has ${stagedReview.errors} error(s) — resolve them (archkit_review_staged for detail) before archkit_goal_complete ${slug}.`
    : untouched.length === filesToTouch.length && filesToTouch.length > 0
      ? `None of the ${filesToTouch.length} planned files are modified yet — the goal likely isn't done. Keep working or re-scope.`
      : `Objective checks clean. Confirm each of the ${exitCriteria.length} exit-criterion below holds, then call archkit_goal_complete ${slug}.`;

  return {
    slug,
    title: goal.meta.title || slug,
    exitCriteria,
    exitCriteriaNote: exitCriteria.length === 0 ? `Goal has no exit-criteria — can't verify completion objectively. Add some to .arch/goals/${slug}.md.` : undefined,
    filesToTouch: { touched, untouched },
    filesToTouchNote: filesToTouch.length === 0 ? "Goal declared no files-to-touch — skipping the file-modification check." : undefined,
    stagedReview,
    reviewNote,
    clean,
    nextStep,
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
    console.log(`${C.gray}    complete <slug> [--notes X]  Mark a goal done, archive to done/${C.reset}`);
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
      case "complete": {
        const slug = args[1];
        if (!slug) throw archkitError("invalid_input", "slug required", { suggestion: "archkit goal complete <slug>" });
        const notesIdx = args.indexOf("--notes");
        const notes = notesIdx > 0 ? (args[notesIdx + 1] || "") : "";
        const out = runGoalComplete({ archDir, slug, notes });
        if (isJson) { console.log(JSON.stringify(out)); break; }
        commandBanner("archkit goal", `completed ${slug}`);
        console.log(`\n  ${C.green}${I.check}${C.reset} archived: ${out.archivedAt}\n`);
        if (out.nextGoal) {
          console.log(`  ${C.bold}Next goal:${C.reset} ${out.nextGoal.slug}`);
          console.log(`  ${out.nextGoal.instruction}`);
          printPayload(out.nextGoal);
        } else {
          console.log(`  ${C.dim}all goals complete${C.reset}\n`);
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
