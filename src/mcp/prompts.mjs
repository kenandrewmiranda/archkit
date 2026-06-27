// src/mcp/prompts.mjs
// MCP prompts for the CGR fresh-context relay loop (proto/cgr-relay-loop).
//
// These surface in Claude Code as /mcp__archkit__<name> slash commands. After
// a /clear, one keystroke loads the next (or current) goal's payload into the
// conversation — replacing the manual copy-paste of the /goal payload that was
// CGR's main friction point. The day-to-day loop is just three commands:
// /mcp__archkit__intake (decompose an ask) → /clear → /mcp__archkit__conductor.
// State changes are deliberate and minimal:
//   intake      → guidance to decompose an ask into goals (calls archkit_goal_intake)
//   conductor   → the unified relay: foregrounds the next single goal in-progress
//                 (injects its payload), OR orchestrates parallel lanes when the
//                 board has them. The merge of the old goal_next + conductor.
//   goal_resume → re-injects the active goal's payload, no state change
//   goal_status → read-only orientation
//
// The Stop hook (bin/archkit-stop-hook.mjs) reads the in-progress status set
// here to guard the goal's exit-criteria until archkit_goal_complete is called.

import fs from "node:fs";
import { findArchDir } from "../lib/shared.mjs";
import { conductorPlan } from "../lib/board.mjs";
import {
  getActiveGoal,
  routeNextGoal,
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
  windDownAt,
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
export function relayHeader(slug, status = "in-progress", { tallyLine = "", windDownThreshold = null } = {}) {
  const inTesting = status === "testing";
  const lines = [];
  if (tallyLine) lines.push(tallyLine, ``);
  lines.push(
    `[archkit CGR relay] Active goal: ${slug}${inTesting ? " (TESTING — edits applied, verification pending)" : ""}`,
    `Work ONLY this goal to its exit-criteria. Do not start other goals in this context.`,
  );
  // Attention-gradient wind-down policy (ADR 0015): the tail of the context window
  // is for handoff authoring, not for accepting more work. Surface the threshold so
  // the worker self-enforces the mode switch (archkit is stateless — it can't read
  // your fill; it emits the policy, you act on it).
  if (!inTesting && windDownThreshold != null) {
    lines.push(
      `Wind-down policy: once your context fill reaches ~${windDownThreshold}, STOP accepting new goals and author your handoff with archkit_goal_handoff ${slug} (done+evidence, decisions, remaining, continuation-notes) — the degraded tail is for writing down, not novel work.`,
    );
  }
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

// Queue-vs-project routing choice (cgr-relay-queue-vs-project-routing). When both
// the ungrouped queue AND one or more project feature-sets have ready work, the
// relay does NOT auto-pick — it hands the agent a choice to put to the user. Each
// track names its recommended next slug; the agent presents the options with
// AskUserQuestion and then starts the chosen one via archkit_goal_start <slug>
// (the only relay action that can begin a SPECIFIC goal). Starting an ungrouped
// goal records the shared cgr-queue-<date> branch; a project goal branches on
// feat/<project>.
export function relayRoutingChoice(route) {
  const projectEntries = Object.entries(route.projects);
  const lines = [
    `[archkit CGR relay] Two tracks have ready work — the queue and ${projectEntries.length} project branch${projectEntries.length === 1 ? "" : "es"}. Ask which to advance instead of auto-picking.`,
    ``,
    `Present this choice to the user with the AskUserQuestion tool (single-select):`,
    `  • Advance the queue (${route.queue.length} ungrouped goal${route.queue.length === 1 ? "" : "s"}, shared branch cgr-queue-<date>) → next: ${route.queueNext}`,
  ];
  for (const [proj, slugs] of projectEntries) {
    lines.push(`  • Project ${proj} (${slugs.length} goal${slugs.length === 1 ? "" : "s"}, branch feat/${proj}) → next: ${route.projectNext[proj]}`);
  }
  lines.push(
    ``,
    `Once the user picks, call archkit_goal_start <slug> with that track's "next" slug — it marks the goal in-progress, injects its payload, and (for the queue) records the shared cgr-queue-<date> branch. Start exactly ONE.`,
    `An in-progress goal would have been resumed automatically; this choice only appears because nothing is mid-flight and both tracks are unblocked.`,
  );
  return lines.join("\n");
}

const NO_ARCH = "No .arch/ project found here. Run /archkit-init to set one up, then decompose your ask with /mcp__archkit__intake (archkit_goal_intake).";

// Single-goal foreground relay: pick the next eligible goal, mark it
// in-progress, and return its payload to work in THIS context. Extracted from
// the former goal_next prompt — the unified `conductor` relay falls back to this
// when the board has no parallelism to orchestrate (the common one-goal case).
// Returns the message string, or null when no goal is eligible (caller decides
// the idle message).
function singleGoalRelayMessage(archDir) {
  const route = routeNextGoal(archDir);
  if (route.kind === "none") return null;
  // Both the queue and a project track have ready work → surface the choice
  // rather than silently auto-picking (cgr-relay-queue-vs-project-routing).
  if (route.kind === "choice") return relayRoutingChoice(route);
  // resume / single → auto-pick. Render BEFORE starting so the first ungrouped
  // queue goal sees "create -c cgr-queue-<date>" (startGoal records the branch
  // afterward, so subsequent picks render "switch").
  const goal = route.goal;
  const { payload } = renderPayload(archDir, goal.slug, { budget: RELAY_PAYLOAD_BUDGET });
  startGoal(archDir, goal.slug);
  const today = new Date().toISOString().slice(0, 10);
  return relayHeader(goal.slug, "in-progress", { tallyLine: doneTodayTally(archDir, today), windDownThreshold: windDownAt(archDir, {}) }) + payload;
}

export const prompts = {

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
          "No goal is in progress. Run /mcp__archkit__conductor to start the next eligible goal, or archkit_goal_list to see the queue."
        );
      }
      const { payload } = renderPayload(archDir, goal.slug, { budget: RELAY_PAYLOAD_BUDGET });
      const today = new Date().toISOString().slice(0, 10);
      return textMessage(relayHeader(goal.slug, statusOf(goal), { tallyLine: doneTodayTally(archDir, today), windDownThreshold: windDownAt(archDir, {}) }) + payload);
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
        `Leave anything they neither promote nor dismiss as pending. After promoting, tell them to /clear then /mcp__archkit__conductor to start the first new goal.`
      );
      return textMessage(lines.join("\n"));
    },
  },

  conductor: {
    config: {
      title: "archkit: advance the relay (conductor)",
      description:
        "CGR relay — the ONE command to advance work after /clear or compaction. Folds the board and auto-picks the mode: with parallel lanes (or workers in flight / a non-empty merge queue / expired leases) it runs the CGR 2.0 conductor pass — claim the frontier under a lease, spawn one worktree-isolated worker per lane, collect handoffs, deep-review only exceptions, then drain the dependency-ordered merge queue verify-after-each; with a single eligible goal it loads that goal's payload to work in THIS context (no worker spawn). Pair with /mcp__archkit__intake to decompose an ask and /clear to reset context.",
    },
    handler: async () => {
      const archDir = archDirOrNull();
      if (!archDir) return textMessage(NO_ARCH);
      const plan = conductorPlan(archDir);
      const c = plan.counts;
      // Orchestrate only when there's genuine parallelism (>=2 claimable lanes)
      // or live worker/merge state to manage; otherwise fall back to the
      // single-goal foreground relay so the common one-goal case stays a simple
      // /clear -> /conductor loop instead of spawning a worker for a lone goal.
      const orchestrate =
        c.claimableLanes >= 2 || c.in_flight > 0 || c.merge_queue > 0 || c.leases_expired > 0;
      if (!orchestrate) {
        const single = singleGoalRelayMessage(archDir);
        if (single) return textMessage(single);
        return textMessage([
          `[archkit CGR] Nothing to advance — no eligible goal, no parallel lanes, empty merge queue.`,
          `The board is purely derived from .arch/board/events.ndjson + the CGR files.`,
          `Decompose a new ask with /mcp__archkit__intake (archkit_goal_intake), then /clear and run /mcp__archkit__conductor.`,
        ].join("\n"));
      }
      const lines = [
        `[archkit CGR conductor] Orchestration pass — you are the CONDUCTOR, not a worker. Do NOT code in this context; dispatch and integrate.`,
        ``,
        `Board: ${c.frontier} frontier (${c.claimableLanes} claimable lane${c.claimableLanes === 1 ? "" : "s"}${c.barriers ? ` + ${c.barriers} barrier${c.barriers === 1 ? "" : "s"}` : ""}), ${c.in_flight} in flight, ${c.merge_queue} to merge, ${c.blocked} blocked, ${c.exceptions} exception${c.exceptions === 1 ? "" : "s"}, ${c.leases_expired} expired lease${c.leases_expired === 1 ? "" : "s"}.`,
        ``,
        `Run the loop:`,
        `1. RECLAIM ${c.leases_expired} orphan lease${c.leases_expired === 1 ? "" : "s"}${c.leases_expired ? ` (${plan.leasesExpired.map((l) => l.slug).join(", ")})` : ""} — their TTL elapsed; they're free to re-claim.`,
      ];
      const laneList = Object.entries(plan.claimableLanes);
      if (laneList.length) {
        lines.push(`2. CLAIM + DISPATCH — spawn ONE worker subagent per claimable lane, each in an isolated git worktree (lanes have disjoint ownership → run them in parallel):`);
        for (const [lane, slugs] of laneList) lines.push(`   • lane ${lane}: ${slugs.join(" → ")}`);
      } else {
        lines.push(`2. CLAIM + DISPATCH — no claimable lanes right now.`);
      }
      if (plan.barriers.length) lines.push(`   • BARRIERS (run SOLO, everything before merges first): ${plan.barriers.join(", ")}`);
      lines.push(
        `3. COLLECT each worker's handoff return (archkit_goal_handoff authored at wind-down).`,
        plan.exceptions.length
          ? `4. DEEP-REVIEW ONLY these exceptions — rubber-stamp the rest:\n${plan.exceptions.map((e) => `   • ${e.slug}: ${e.reasons.join(", ")}`).join("\n")}`
          : `4. DEEP-REVIEW: no exceptions — the returns are clean, rubber-stamp them.`,
        plan.mergeOrder.length
          ? `5. MERGE the queue SEQUENTIALLY in this dependency order, verifying after EACH: ${plan.mergeOrder.map((m) => m.slug).join(" → ")}`
          : `5. MERGE: queue empty, nothing to integrate.`,
        ``,
        `Read archkit_conductor / archkit_session_state for the structured plan. archkit emits the plan; YOU spawn workers, review, and run the git merges.`,
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
        lines.push(`Resume with /mcp__archkit__goal_resume, or finish it then /clear + /mcp__archkit__conductor.`);
      } else if (testing.length) {
        lines.push(`${testing.length} goal(s) await verification. Run /clear + /mcp__archkit__conductor to drain the testing backlog (verify green, then archkit_goal_complete).`);
      } else if (pending.length) {
        lines.push(`Start with /clear + /mcp__archkit__conductor.`);
      } else if (onHold.length) {
        lines.push(`Only on-hold (parked) goals remain. Run /clear + /mcp__archkit__conductor to resume one, or archkit_goal_abandon to drop it.`);
      } else {
        lines.push(`Queue empty. Run archkit_goal_consolidate to fold any un-consolidated done/ goals into a dated digest, or /mcp__archkit__intake to decompose a new ask.`);
      }
      return textMessage(lines.join("\n"));
    },
  },

  intake: {
    config: {
      title: "archkit: decompose an ask into goals",
      description:
        "CGR relay — the entry point for a sprawling or multi-part ask. Decompose the user's request into discrete CGR goals (one per fresh context) via archkit_goal_intake: split it into 1..N goals, each with a kebab-case slug, a one-line title, 2-5 exit-criteria, and optionally filesToTouch / requiredReading / dependsOn / owns / feature / exclusive so intake can partition the batch into parallel lanes. After intake persists the goals, the loop is: /clear → /mcp__archkit__conductor (which works a lone goal in the foreground or orchestrates parallel lanes automatically).",
    },
    handler: async () => {
      const archDir = archDirOrNull();
      if (!archDir) return textMessage(NO_ARCH);
      return textMessage([
        `[archkit CGR intake] Decompose the user's ask into discrete CGR goals, then call archkit_goal_intake.`,
        ``,
        `Do this now:`,
        `1. Take the user's most recent ask (if none is in view, ask them for it).`,
        `2. Split it into 1..N goals — each a self-contained unit of work for one fresh context. Per goal: a kebab-case slug, a one-line title, 2-5 concrete exit-criteria, and optionally filesToTouch, requiredReading, dependsOn (DAG edges), owns (predicted file-ownership globs), feature (cohesion tag), exclusive (run-solo barrier).`,
        `3. Call archkit_goal_intake with the goals array. It persists each to .arch/goals/<slug>.md and partitions them into parallel lanes (disjoint ownership → run concurrently; exclusive → solo barrier).`,
        `4. If the ask is genuinely a single goal, pass a one-element array. If it's ambiguous, ASK the user to clarify BEFORE calling intake.`,
        ``,
        `Then advance the loop: tell the user to run /clear, then /mcp__archkit__conductor — it works a lone goal in the foreground or orchestrates the lanes automatically.`,
      ].join("\n"));
    },
  },
};
