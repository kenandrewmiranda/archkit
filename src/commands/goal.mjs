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
  renderPayload,
  ensureGoalsLayout,
  goalsDir,
  doneDir,
} from "../lib/goals.mjs";
import { archkitError } from "../lib/errors.mjs";

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
        ? `Run /clear, then paste the payload above after /goal to start the goal.`
        : `Run /clear, paste the FIRST payload after /goal. When done, complete it and the next payload will print.`,
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
  return {
    active: active.map((g) => ({
      slug: g.slug,
      title: g.meta.title || g.slug,
      status: g.meta.status || "planned",
      created: g.meta.created || "",
    })),
    done,
  };
}

export function runGoalPayload({ archDir, slug }) {
  return renderPayload(archDir, slug);
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
          instruction: `Run /clear, then paste the payload above after /goal.`,
        }
      : null,
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
