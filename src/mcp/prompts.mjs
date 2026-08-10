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
// The MCP output contract (ADR 0026): every prompt below renders through the
// shared graph/symbol vocabulary in format.mjs — never hand-rolled prose, never
// ANSI. `conductorGraph` is the whole orchestration pass in graph form.
import { SYM, GLYPH, LEGEND, conductorGraph, stats, tree, strong } from "../lib/format.mjs";
import {
  getActiveGoal,
  triageNextGoal,
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
  return `${SYM.ok} Done today (${done.length}): ${names}`;
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
    `${SYM.action} Work ONLY this goal to its exit-criteria. Do not start other goals in this context.`,
  );
  // Attention-gradient wind-down policy (ADR 0015): the tail of the context window
  // is for handoff authoring, not for accepting more work. Surface the threshold so
  // the worker self-enforces the mode switch (archkit is stateless — it can't read
  // your fill; it emits the policy, you act on it).
  if (!inTesting && windDownThreshold != null) {
    lines.push(
      `${SYM.attention} Wind-down policy: once your context fill reaches ~${windDownThreshold}, STOP accepting new goals and author your handoff with archkit_goal_handoff ${slug} (done+evidence, decisions, remaining, continuation-notes) — the degraded tail is for writing down, not novel work.`,
    );
  }
  if (inTesting) {
    lines.push(
      `${SYM.attention} This goal is in the verification window: its edits already landed. Re-run the verify-command and confirm every exit-criterion is green, then call archkit_goal_complete ${slug} (it re-runs the gate and refuses on red). It is NOT done until verified.`,
      `${SYM.action} First, restate in ONE sentence what was already built and what still needs verifying — then verify it.`,
    );
  } else {
    lines.push(
      `${SYM.ok} When ALL exit-criteria are met, call archkit_goal_complete ${slug} — that releases the Stop-hook guard and advances the queue. If edits are applied but you want a later session to verify, park it with archkit_goal_testing ${slug}; to deliberately set it aside, archkit_goal_hold ${slug}.`,
      `${SYM.action} First, restate this goal in ONE sentence (what you're about to build and its done-condition) — then start.`,
    );
  }
  lines.push(``, `────────────────────────────────────────`, ``);
  return lines.join("\n");
}

// Ambiguity-gated triage choice (cgr-conductor-ambiguity-triage, ADR 0019). When
// the board has more than one thing worth pulling in next — an ungrouped queue AND
// a project track, multiple project tracks, verification debt alongside pending
// work, ANY parked (on-hold) work, or triageMode=always — the relay does NOT
// auto-pick. It hands the agent a single-select choice to put to the user, one
// option per axis (queue / each project / drain testing / resume parked / plan
// something new). Each option names the concrete follow-up the agent runs WITHOUT
// another round-trip: archkit_goal_start <slug> to begin a specific goal (queue
// goals record the shared cgr-queue-<date> branch; project goals branch feat/
// <project>), or /mcp__archkit__intake to decompose a fresh ask. Subsumes the old
// queue-vs-project relayRoutingChoice — that case is just the two-track instance
// of this generalized choice, so there is a single prompt, never a double one.
export function relayTriageChoice(triage) {
  const queue = triage.queue || [];
  const projectEntries = Object.entries(triage.projects || {});
  const testing = triage.testing || { count: 0, slugs: [] };
  const onHold = triage.onHold || { count: 0, slugs: [] };

  const lines = [
    `[archkit CGR relay] The board has more than one thing you could reasonably pull in next — auto-picking here would be exactly the "mindlessly grab the next queue number" behavior. Ask the user which track to advance instead of guessing.`,
    ``,
    `Present this to the user with the AskUserQuestion tool (single-select). Each option maps to a concrete next action — take it directly once they choose, no extra round-trip:`,
  ];
  if (queue.length) {
    lines.push(
      `  ${SYM.action} Advance the queue — ${queue.length} ungrouped goal${queue.length === 1 ? "" : "s"} (shared branch cgr-queue-<date>), next: ${triage.queueNext}`,
      `      ${GLYPH.flow} archkit_goal_start ${triage.queueNext}`,
    );
  }
  for (const [proj, slugs] of projectEntries) {
    lines.push(
      `  ${SYM.action} Project ${proj} — ${slugs.length} goal${slugs.length === 1 ? "" : "s"} (branch feat/${proj}), next: ${triage.projectNext[proj]}`,
      `      ${GLYPH.flow} archkit_goal_start ${triage.projectNext[proj]}`,
    );
  }
  if (testing.count) {
    lines.push(
      `  ${SYM.attention} Drain verification debt — ${testing.count} goal${testing.count === 1 ? "" : "s"} in testing (${testing.slugs.join(", ")})`,
      `      ${GLYPH.flow} archkit_goal_start ${testing.slugs[0]}, re-run its verify-command, then archkit_goal_complete`,
    );
  }
  if (onHold.count) {
    lines.push(
      `  ${SYM.attention} Resume parked work — ${onHold.count} on-hold goal${onHold.count === 1 ? "" : "s"} (${onHold.slugs.join(", ")})`,
      `      ${GLYPH.flow} archkit_goal_start ${onHold.slugs[0]}`,
    );
  }
  lines.push(
    `  ${SYM.action} Plan something new — none of the above; decompose a fresh ask`,
    `      ${GLYPH.flow} run /mcp__archkit__intake (archkit_goal_intake) to split a new request into goals`,
    ``,
    `If they just want to keep moving, the frictionless default is: ${triage.recommended || "(none)"}.`,
    `Call exactly ONE archkit_goal_start after they pick — it marks the goal in-progress, injects its payload, and records the branch. Nothing is started until they choose.`,
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
  // Ambiguity-gated triage (ADR 0019) generalizes the old queue-vs-project route:
  // it classifies the WHOLE board (tracks, testing debt, parked work, empty) into
  // resume/single/choice/none, gated by cgr.triageMode (ambiguity default | always
  // | off). `off` collapses to pure auto-pick (single/none), preserving today's
  // silent behavior byte-for-byte.
  const triage = triageNextGoal(archDir);
  // Nothing eligible and nothing parked → let the conductor's empty branch offer
  // the plan/intake path (returning null keeps that dead-end-free message as the
  // single source of the "decompose a new ask" nudge).
  if (triage.kind === "none") return null;
  // Ambiguous board (>1 axis, testing debt alongside pending work, ANY parked
  // work, or triageMode=always) → do NOT auto-pick; hand the agent a choice to put
  // to the user. Subsumes the old relayRoutingChoice — one prompt, never a double.
  if (triage.kind === "choice") return relayTriageChoice(triage);
  // resume / single → auto-pick. Render BEFORE starting so the first ungrouped
  // queue goal sees "create -c cgr-queue-<date>" (startGoal records the branch
  // afterward, so subsequent picks render "switch").
  const goal = triage.goal;
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
        `  ${SYM.action} promote the chosen ones: archkit_goal_promote with hashes:[...] (or all:true if they picked everything)`,
        `  ${SYM.error} dismiss the rest if they explicitly reject them: archkit_goal_dismiss with hashes:[...]`,
        `Leave anything they neither promote nor dismiss as pending. After promoting, tell them to /clear then /mcp__archkit__conductor to start the first new goal.`
      );
      return textMessage(lines.join("\n"));
    },
  },

  conductor: {
    config: {
      title: "archkit: advance the relay (conductor)",
      description:
        "CGR relay — the ONE command to advance work after /clear or compaction. Folds the board and auto-picks the mode: with parallel lanes (or workers in flight / a non-empty merge queue / expired leases) it runs the CGR 2.0 conductor pass — claim the frontier under a lease, spawn one worktree-isolated worker per lane, collect handoffs, deep-review only exceptions, then run the LANE CONVERGENCE stage — the dependency-ordered merge queue grouped into one integration point per lane, each rebased onto the branch tip before it lands, verify-after-each; with a single eligible goal it loads that goal's payload to work in THIS context (no worker spawn). Pair with /mcp__archkit__intake to decompose an ask and /clear to reset context.",
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
          `[archkit CGR] ${SYM.ok} Nothing to advance — no eligible goal, no parallel lanes, empty merge queue.`,
          `The board is purely derived from .arch/board/events.ndjson + the CGR files.`,
          `${SYM.action} Decompose a new ask with /mcp__archkit__intake (archkit_goal_intake), then /clear and run /mcp__archkit__conductor.`,
        ].join("\n"));
      }
      // The ENTIRE orchestration pass is rendered by the shared graph renderer
      // (ADR 0026). Step 1 reclaim, step 2 the lane tree + barriers, step 3
      // handoff collection, step 4 the deep-review exception list, step 5 the
      // LANE CONVERGENCE stage (ADR 0023 — rebase-onto-tip precondition +
      // path-extract fallback, emitted once as a substitution template rather
      // than repeated per lane), step 6 the INTEGRATION DEBT ledger (ADR 0024).
      // prompts.mjs contributes no prose of its own: one contract, one renderer.
      return textMessage(conductorGraph(plan).join("\n"));
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
      // Same output contract as the conductor (ADR 0026): a stat strip, then the
      // buckets as a tree with the severity vocabulary — no numbered prose.
      const slugs = (gs) => gs.map((g) => g.slug).join(" ");
      const lines = [
        `[archkit CGR queue] pending ${GLYPH.flow} in-progress ${GLYPH.flow} testing ${GLYPH.flow} completed (side: on-hold, abandoned)`,
        LEGEND,
        stats([
          ["testing", testing.length, "attention"],
          ["pending", pending.length],
          ["on-hold", onHold.length, "attention"],
          ["done", done.length, "ok"],
        ]),
        ...tree([
          active
            ? `${SYM.action} in-progress ${strong(active.slug)}${active.meta.title ? ` — ${active.meta.title}` : ""}`
            : `${SYM.ok} in-progress: none`,
          testing.length ? `${SYM.attention} testing: ${slugs(testing)}` : null,
          pending.length ? `${SYM.action} pending: ${slugs(pending)}` : null,
          onHold.length ? `${SYM.attention} on-hold: ${slugs(onHold)}` : null,
          `${SYM.ok} done: ${done.length} un-consolidated${archived ? ` + ${archived} archived` : ""}${digests.length ? ` + ${digests.length} digest day${digests.length === 1 ? "" : "s"}` : ""}`,
        ]),
      ];
      if (active) {
        lines.push(`${SYM.action} resume: /mcp__archkit__goal_resume — or finish it, then /clear + /mcp__archkit__conductor.`);
      } else if (testing.length) {
        lines.push(`${SYM.attention} ${testing.length} goal(s) await verification: /clear + /mcp__archkit__conductor to drain the testing backlog (verify green, then archkit_goal_complete).`);
      } else if (pending.length) {
        lines.push(`${SYM.action} start: /clear + /mcp__archkit__conductor.`);
      } else if (onHold.length) {
        lines.push(`${SYM.attention} only parked (on-hold) goals remain: /clear + /mcp__archkit__conductor to resume one, or archkit_goal_abandon to drop it.`);
      } else {
        lines.push(`${SYM.ok} queue empty: archkit_goal_consolidate folds un-consolidated done/ goals into a dated digest, or /mcp__archkit__intake to decompose a new ask.`);
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
        `${SYM.action} Do this now:`,
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
