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
  RELAY_PAYLOAD_BUDGET,
  listGoals,
  statusOf,
  doneDir,
  archiveDir,
  listDigests,
  listGoalProposals,
  goalsCompletedOn,
} from "../lib/goals.mjs";

function archDirOrNull() {
  // The stdio server runs with cwd = the project Claude Code launched it in.
  return findArchDir({ requireFile: "SYSTEM.md" });
}

function textMessage(text) {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

// One-liner clamp for the breadcrumb (avoid a goals.mjs export just for this).
function clampLine(text, max = 48) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// "Done today" breadcrumb: a single line tallying goals completed today (count
// + titles, slug fallback), read from done/ + done/digest. Returns "" when
// nothing was completed today so the header stays clean (graceful empty case).
export function doneTodayTally(archDir, today) {
  let done;
  try { done = goalsCompletedOn(archDir, today); } catch { done = []; }
  if (!done.length) return "";
  const names = done.map((g) => clampLine(g.title || g.slug)).join(", ");
  return `✓ Done today (${done.length}): ${names}`;
}

// Prepended to an injected goal payload so the agent treats this as a relay
// turn: single goal, exit-criteria are the contract, goal_complete is the
// release signal the Stop hook waits for. Status-aware: a goal resumed in the
// `testing` state is framed as draining verification debt (edits already
// landed) rather than fresh work. When `tallyLine` is non-empty it leads as a
// "done today" breadcrumb so the relay loop keeps yesterday/today's progress in
// view across /clear. Each variant also asks the agent to restate the goal in
// one sentence before working — orientation the user only ever sees here.
export function relayHeader(slug, status = "in-progress", { tallyLine = "" } = {}) {
  const inTesting = status === "testing";
  const lines = [];
  if (tallyLine) lines.push(tallyLine, ``);
  lines.push(
    `[archkit CGR relay] Active goal: ${slug}${inTesting ? " (TESTING — edits applied, verification pending)" : ""}`,
    `Work ONLY this goal to its exit-criteria. Do not start other goals in this context.`,
  );
  if (inTesting) {
    lines.push(
      `This goal is in the verification window: its edits already landed. Re-run the verify-command and confirm every exit-criterion is green, then call archkit_goal_complete ${slug} (it re-runs the gate and refuses on red). It is NOT done until verified.`,
      `First, restate in ONE sentence what was already built and what still needs verifying — then verify it.`,
    );
  } else {
    lines.push(
      `When ALL exit-criteria are met, call archkit_goal_complete ${slug} — that releases the Stop-hook guard and advances the queue. If edits are applied but you want a later session to verify, park it with archkit_goal_testing ${slug}; to deliberately set it aside, archkit_goal_hold ${slug}.`,
      `First, restate this goal in ONE sentence (what you're about to build and its done-condition) — then start.`,
    );
  }
  lines.push(``, `────────────────────────────────────────`, ``);
  return lines.join("\n");
}

const NO_ARCH = "No .arch/ project found here. Run /archkit-init to set one up, then decompose your ask with archkit_goal_intake.";

export const prompts = {
  goal_next: {
    config: {
      title: "archkit: start next goal",
      description:
        "CGR relay — load the next eligible goal (marks it in-progress) and inject its payload. Run after /clear to advance the goal queue without copy-pasting the /goal payload. Scan order: resume an in-progress goal first, else pending-first until the testing (verification-debt) backlog crosses the configured threshold (then drain testing first), and as a last resort resume an on-hold goal once nothing live is left.",
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
      const { payload } = renderPayload(archDir, goal.slug, { budget: RELAY_PAYLOAD_BUDGET });
      const today = new Date().toISOString().slice(0, 10);
      return textMessage(relayHeader(goal.slug, "in-progress", { tallyLine: doneTodayTally(archDir, today) }) + payload);
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
      const { payload } = renderPayload(archDir, goal.slug, { budget: RELAY_PAYLOAD_BUDGET });
      const today = new Date().toISOString().slice(0, 10);
      return textMessage(relayHeader(goal.slug, statusOf(goal), { tallyLine: doneTodayTally(archDir, today) }) + payload);
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
      // pending = the queued-not-started bucket (statusOf normalizes the legacy
      // `planned` alias to `pending`, so this single check covers both).
      const pending = all.filter((g) => statusOf(g) === "pending");
      const testing = all.filter((g) => statusOf(g) === "testing");
      const onHold = all.filter((g) => statusOf(g) === "on-hold");
      const dDir = doneDir(archDir);
      const done = fs.existsSync(dDir)
        ? fs.readdirSync(dDir).filter((f) => f.endsWith(".md"))
        : [];
      const aDir = archiveDir(archDir);
      const archived = fs.existsSync(aDir)
        ? fs.readdirSync(aDir).filter((f) => f.endsWith(".md")).length
        : 0;
      const digests = listDigests(archDir);
      const fmt = (gs) => gs.length ? " (" + gs.map((g) => g.slug).join(", ") + ")" : "";
      const lines = [
        `archkit CGR queue (lifecycle: pending → in-progress → testing → completed; side states on-hold, abandoned):`,
        active
          ? `  in-progress: ${active.slug} — ${active.meta.title || ""}`
          : `  in-progress: none`,
        `  testing:     ${testing.length}${fmt(testing)}`,
        `  pending:     ${pending.length}${fmt(pending)}`,
        `  on-hold:     ${onHold.length}${fmt(onHold)}`,
        `  completed:   ${done.length} un-consolidated${archived ? ` + ${archived} archived` : ""}${digests.length ? ` (${digests.length} digest day${digests.length === 1 ? "" : "s"})` : ""}`,
        ``,
      ];
      if (active) {
        lines.push(`Resume with /mcp__archkit__goal_resume, or finish it then /clear + /mcp__archkit__goal_next.`);
      } else if (testing.length) {
        lines.push(`${testing.length} goal(s) await verification. Run /clear + /mcp__archkit__goal_next to drain the testing backlog (verify green, then archkit_goal_complete).`);
      } else if (pending.length) {
        lines.push(`Start with /clear + /mcp__archkit__goal_next.`);
      } else if (onHold.length) {
        lines.push(`Only on-hold (parked) goals remain. Run /clear + /mcp__archkit__goal_next to resume one, or archkit_goal_abandon to drop it.`);
      } else {
        lines.push(`Queue empty. Run archkit_goal_consolidate to fold any un-consolidated done/ goals into a dated digest, or archkit_goal_intake to decompose a new ask.`);
      }
      return textMessage(lines.join("\n"));
    },
  },
};
