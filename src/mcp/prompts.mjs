// src/mcp/prompts.mjs
// MCP prompts for the CGR fresh-context relay loop (proto/cgr-relay-loop).
//
// These surface in Claude Code as /mcp__archkit__<name> slash commands. After
// a /clear, one keystroke loads the next (or current) goal's payload into the
// conversation — replacing the manual copy-paste of the /goal payload that was
// CGR's main friction point. State changes are deliberate and minimal:
//   goal_next   → marks the next eligible goal in-progress, injects its payload
//   goal_resume → re-injects the active goal's payload, no state change
//   goal_status → read-only orientation
//
// The Stop hook (bin/archkit-stop-hook.mjs) reads the in-progress status set
// here to guard the goal's exit-criteria until archkit_goal_complete is called.

import fs from "node:fs";
import { findArchDir } from "../lib/shared.mjs";
import {
  getActiveGoal,
  nextEligibleGoal,
  startGoal,
  renderPayload,
  listGoals,
  statusOf,
  doneDir,
  listGoalProposals,
} from "../lib/goals.mjs";

function archDirOrNull() {
  // The stdio server runs with cwd = the project Claude Code launched it in.
  return findArchDir({ requireFile: "SYSTEM.md" });
}

function textMessage(text) {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

// Prepended to an injected goal payload so the agent treats this as a relay
// turn: single goal, exit-criteria are the contract, goal_complete is the
// release signal the Stop hook waits for.
function relayHeader(slug) {
  return [
    `[archkit CGR relay] Active goal: ${slug}`,
    `Work ONLY this goal to its exit-criteria. Do not start other goals in this context.`,
    `When ALL exit-criteria are met, call archkit_goal_complete ${slug} — that is the signal that releases the Stop-hook guard and advances the queue.`,
    ``,
    `────────────────────────────────────────`,
    ``,
  ].join("\n");
}

const NO_ARCH = "No .arch/ project found here. Run /archkit-init to set one up, then decompose your ask with archkit_goal_intake.";

export const prompts = {
  goal_next: {
    config: {
      title: "archkit: start next goal",
      description:
        "CGR relay — load the next eligible goal (marks it in-progress) and inject its payload. Run after /clear to advance the goal queue without copy-pasting the /goal payload.",
    },
    handler: async () => {
      const archDir = archDirOrNull();
      if (!archDir) return textMessage(NO_ARCH);
      const goal = nextEligibleGoal(archDir);
      if (!goal) {
        return textMessage(
          "No eligible CGR goal to start — the queue is empty or every remaining goal is blocked by an incomplete dependency. Call archkit_goal_list to inspect, or archkit_goal_intake to decompose a new ask."
        );
      }
      startGoal(archDir, goal.slug);
      const { payload } = renderPayload(archDir, goal.slug);
      return textMessage(relayHeader(goal.slug) + payload);
    },
  },

  goal_resume: {
    config: {
      title: "archkit: resume active goal",
      description:
        "CGR relay — re-inject the currently in-progress goal's payload without changing state. Use after /clear when you want to keep working the same goal in a fresh context.",
    },
    handler: async () => {
      const archDir = archDirOrNull();
      if (!archDir) return textMessage(NO_ARCH);
      const goal = getActiveGoal(archDir);
      if (!goal) {
        return textMessage(
          "No goal is in progress. Run /mcp__archkit__goal_next to start the next eligible goal, or archkit_goal_list to see the queue."
        );
      }
      const { payload } = renderPayload(archDir, goal.slug);
      return textMessage(relayHeader(goal.slug) + payload);
    },
  },

  goal_review: {
    config: {
      title: "archkit: review follow-up goals",
      description:
        "Review follow-up goals proposed during prior sessions (.arch/goals/proposed/) and choose which to promote into planned goals. Drives a multi-select: promote selected, all, or dismiss.",
    },
    handler: async () => {
      const archDir = archDirOrNull();
      if (!archDir) return textMessage(NO_ARCH);
      const proposals = listGoalProposals(archDir);
      if (proposals.length === 0) {
        return textMessage(
          "No follow-up goal proposals pending in .arch/goals/proposed/. Nothing to review — these are drafted automatically when a session defers work, or via archkit_goal_defer."
        );
      }
      const lines = [
        `[archkit] ${proposals.length} follow-up goal proposal${proposals.length === 1 ? "" : "s"} pending review:`,
        ``,
      ];
      proposals.forEach((p, i) => {
        lines.push(`${i + 1}. [${p.hash}] ${p.title}`);
        if (p.why) lines.push(`   why: ${p.why}`);
        if (Array.isArray(p.exitCriteria) && p.exitCriteria.length) {
          lines.push(`   exit-criteria: ${p.exitCriteria.join("; ")}`);
        }
        if (p.contextExcerpt) lines.push(`   context: ${String(p.contextExcerpt).slice(0, 160).replace(/\s+/g, " ")}…`);
        lines.push(`   source: ${p.source}`);
        lines.push("");
      });
      lines.push(
        `Present these to the user with the AskUserQuestion tool as a MULTI-SELECT (multiSelect: true) — one option per proposal (label by title), so they can pick any subset; the tool also lets them pick all or none.`,
        `Then act on their choice:`,
        `  • promote the chosen ones: archkit_goal_promote with hashes:[...] (or all:true if they picked everything)`,
        `  • dismiss the rest if they explicitly reject them: archkit_goal_dismiss with hashes:[...]`,
        `Leave anything they neither promote nor dismiss as pending. After promoting, tell them to /clear then /mcp__archkit__goal_next to start the first new goal.`
      );
      return textMessage(lines.join("\n"));
    },
  },

  goal_status: {
    config: {
      title: "archkit: CGR queue status",
      description:
        "CGR relay — show the active goal plus counts of planned and completed goals. Read-only orientation; starts nothing.",
    },
    handler: async () => {
      const archDir = archDirOrNull();
      if (!archDir) return textMessage(NO_ARCH);
      const all = listGoals(archDir);
      const active = all.find((g) => statusOf(g) === "in-progress");
      const planned = all.filter((g) => statusOf(g) === "planned");
      const dDir = doneDir(archDir);
      const done = fs.existsSync(dDir)
        ? fs.readdirSync(dDir).filter((f) => f.endsWith(".md"))
        : [];
      const lines = [
        `archkit CGR queue:`,
        active
          ? `  active (in-progress): ${active.slug} — ${active.meta.title || ""}`
          : `  active: none`,
        `  planned: ${planned.length}${planned.length ? " (" + planned.map((g) => g.slug).join(", ") + ")" : ""}`,
        `  done:    ${done.length}`,
        ``,
        active
          ? `Resume with /mcp__archkit__goal_resume, or finish it then /clear + /mcp__archkit__goal_next.`
          : planned.length
            ? `Start with /mcp__archkit__goal_next.`
            : `Queue empty. Call archkit_goal_intake to decompose a new ask.`,
      ];
      return textMessage(lines.join("\n"));
    },
  },
};
