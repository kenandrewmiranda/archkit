#!/usr/bin/env node

// Stop hook for Claude Code. Fires after every assistant response.
//
// Four jobs in one hook (per v1.6 design):
//   1. Surface the archkit utilization metric (the v1.6 headline — get
//      per-task instrumentation rate to ≥75%). Compact one-liner reminding
//      the agent to call archkit_resolve_preflight / lookup before the next
//      Edit if the rate is below target.
//   2. Re-inject a compact form of .arch/BOUNDARIES.md into the agent's
//      working context. Keeps NEVER rules fresh after Claude Code's
//      automatic context compression.
//   3. Detect boundary violations in the assistant response and emit a
//      specific warning if any matched (boundary-patterns lib).
//   4. Detect decision-language and write proposal files to
//      .arch/decisions/proposed/<hash>.json for human review (decision-
//      detector lib).
//   5. CGR relay guard (proto/cgr-relay-loop): when a goal is in-progress
//      (started via /mcp__archkit__goal_next), block stopping with
//      decision:"block" until the agent calls archkit_goal_complete — unless
//      the response is a genuine question to the user, or the per-goal turn
//      cap is hit. When no goal is active, nudge toward the next queued goal.
//
// Safety:
//   - Walks up looking for .arch/SYSTEM.md. If not found, exits 0 silent
//     (don't fire on non-archkit projects).
//   - Always exits 0. Only ever blocks when a CGR goal is in-progress; plain
//     (non-CGR) sessions never see decision:block.
//   - Turn cap (RELAY_TURN_CAP / per-goal `max-turns`) guarantees the guard
//     releases so a stuck goal can't trap the agent indefinitely.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIB = path.resolve(__dirname, "..", "src", "lib");
const { loadOrInit, computeUtilization, formatUtilizationLine, save } = await import(path.join(LIB, "session-stats.mjs"));
const { detectViolations, formatViolation } = await import(path.join(LIB, "boundary-patterns.mjs"));
const { detectDecisions } = await import(path.join(LIB, "decision-detector.mjs"));
const {
  getActiveGoal, exitCriteriaOf, nextEligibleGoal, bumpLoopBlock, resetLoopState,
} = await import(path.join(LIB, "goals.mjs"));

const UTILIZATION_TARGET = 75;
const BOUNDARIES_RULE_CAP = 12;
// CGR relay: release the guard after this many consecutive blocked turns so a
// stuck goal can't trap the agent forever. Override per-goal with `max-turns`
// frontmatter. Mirrors /goal's optional turn bound.
const RELAY_TURN_CAP = 30;

// Heuristic: does the assistant's last response read as a question to the user
// (genuine block) rather than a stopping point we should push past? Keeps the
// relay guard from trapping the agent when it actually needs human input.
function looksLikeQuestionToUser(text) {
  if (!text) return false;
  const trimmed = text.trimEnd();
  if (/\?\s*$/.test(trimmed)) return true;
  if (/\b(NEEDS INPUT|BLOCKED|WAITING ON YOU|AWAITING)\b\s*:/i.test(text)) return true;
  const tail = trimmed.slice(-400);
  if (/\b(could you|can you|should i|do you want|would you like|which (one|option|approach))\b[^?]*\?/is.test(tail)) return true;
  return false;
}

function findArchDir(start) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, ".arch");
    if (fs.existsSync(path.join(candidate, "SYSTEM.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function compactBoundaries(archDir) {
  const file = path.join(archDir, "BOUNDARIES.md");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  // Pull just the NEVER lines — that's the compact form.
  const lines = raw.split("\n").filter((l) => /\bNEVER\b/.test(l));
  if (!lines.length) return null;
  const capped = lines.slice(0, BOUNDARIES_RULE_CAP);
  return capped.map((l) => l.replace(/^\s*[-*]\s*/, "• ")).join("\n");
}

function ensureProposalDir(archDir) {
  const dir = path.join(archDir, "decisions", "proposed");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProposal(proposalDir, detection) {
  const file = path.join(proposalDir, `${detection.hash}.json`);
  // Skip if already proposed (cross-turn dedup).
  if (fs.existsSync(file)) return false;
  const proposal = {
    hash: detection.hash,
    titleHint: detection.titleHint,
    regexMatch: detection.matchedText,
    contextExcerpt: detection.contextExcerpt,
    patternName: detection.patternName,
    source: "stop-hook",
    createdAt: new Date().toISOString(),
  };
  // Atomic-ish: write to tmp then rename.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(proposal, null, 2));
  fs.renameSync(tmp, file);
  return true;
}

function countProposals(archDir) {
  const dir = path.join(archDir, "decisions", "proposed");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let event = {};
  try { event = JSON.parse(raw); } catch { /* ignore */ }

  const cwd = event.cwd || process.cwd();
  const archDir = findArchDir(cwd);
  if (!archDir) {
    process.exit(0); // silent on non-archkit projects
  }

  const sessionId = event.session_id;
  const assistantResponse = event.assistant_response || "";

  const sections = [];

  // 1. Utilization metric — headline for v1.6.
  if (sessionId) {
    const stats = loadOrInit(sessionId);
    const util = computeUtilization(stats);
    sections.push(formatUtilizationLine(util, UTILIZATION_TARGET));

    // Specific nudge when below target AND there are editing tasks.
    if (util.perTaskPct !== null && util.perTaskPct < UTILIZATION_TARGET) {
      sections.push(
        `Before your next Edit/Write, call archkit_resolve_preflight (if you know the feature/layer) or archkit_resolve_lookup (if you need to resolve a symbol against .arch/) so the next task counts as instrumented.`
      );
    }
  }

  // 2. Boundary violations in this turn's response.
  const violations = detectViolations(assistantResponse);
  if (violations.length) {
    const lines = violations.slice(0, 5).map(formatViolation);
    sections.push(["Boundary violations detected in your last response:", ...lines].join("\n"));
  }

  // 3. Decision-language → write proposals.
  const detections = detectDecisions(assistantResponse);
  let newProposals = 0;
  if (detections.length) {
    const proposalDir = ensureProposalDir(archDir);
    for (const d of detections) {
      if (writeProposal(proposalDir, d)) newProposals += 1;
    }
  }

  const totalProposals = countProposals(archDir);
  if (newProposals > 0) {
    sections.push(
      `Drafted ${newProposals} proposed ADR${newProposals === 1 ? "" : "s"} from decision-language in your response. Total pending: ${totalProposals} at .arch/decisions/proposed/. Review and call archkit_log_decision to promote, or delete to dismiss.`
    );
  }

  // 4. BOUNDARIES re-injection (last so it doesn't dominate).
  const boundaries = compactBoundaries(archDir);
  if (boundaries) {
    sections.push(["Active BOUNDARIES (from .arch/BOUNDARIES.md — re-injected for working memory):", boundaries].join("\n"));
  }

  // 5. CGR relay guard — block stopping while a goal is in-progress and its
  //    exit-criteria aren't released (released = agent called
  //    archkit_goal_complete, which moves the goal to done/ so it's no longer
  //    active). Naturally scoped: fires only when a goal was started via the
  //    /mcp__archkit__goal_next relay prompt (status in-progress).
  let blockReason = null;
  const activeGoal = getActiveGoal(archDir);
  if (activeGoal) {
    const slug = activeGoal.slug;
    const criteria = exitCriteriaOf(activeGoal);
    const maxTurns = Number(activeGoal.meta["max-turns"]) || RELAY_TURN_CAP;
    if (looksLikeQuestionToUser(assistantResponse)) {
      // Genuine question to the user — surface it, don't trap the agent.
      sections.push(
        `CGR relay: goal "${slug}" is still in progress, but your last response reads as a question to the user — not blocking. When unblocked, finish the exit-criteria and call archkit_goal_complete ${slug}.`
      );
    } else {
      const blocks = bumpLoopBlock(archDir, slug);
      if (blocks > maxTurns) {
        sections.push(
          `CGR relay: goal "${slug}" hit the ${maxTurns}-turn relay cap without completing — releasing the guard. Call archkit_goal_complete ${slug} if it's actually done, or archkit_goal_show ${slug} to re-scope it.`
        );
      } else {
        const list = criteria.length
          ? criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")
          : `  (no exit-criteria recorded — see .arch/goals/${slug}.md)`;
        blockReason = [
          `CGR relay: goal "${slug}" is still in progress (turn ${blocks}/${maxTurns}).`,
          `Keep working until ALL exit-criteria are met:`,
          list,
          ``,
          `When every criterion holds, call archkit_goal_complete ${slug} to release this guard and advance the queue. If you are genuinely blocked and need the user, end your message with a direct question.`,
        ].join("\n");
      }
    }
  } else {
    // No goal in progress. Clear any stale turn-cap counters, and if the queue
    // still has eligible work, nudge the relay forward (non-blocking).
    resetLoopState(archDir);
    const next = nextEligibleGoal(archDir);
    if (next) {
      sections.push(
        `CGR relay: no goal in progress and "${next.slug}" is queued. Run /clear then /mcp__archkit__goal_next to start it in a fresh context.`
      );
    }
  }

  if (!sections.length && !blockReason) {
    process.exit(0);
  }

  // Stop hooks have no `hookSpecificOutput.additionalContext` channel (that
  // only exists for UserPromptSubmit/PostToolUse/PostToolBatch). The two valid
  // channels are `decision: "block"` + `reason` (fed back to the model, forces
  // continuation) and `systemMessage` (shown to the user, non-blocking).
  //
  //   • Relay guard active  → block; fold the working-memory sections into the
  //     reason so the model still carries them while it keeps working.
  //   • No block, just nudges → surface them to the user via systemMessage.
  const out = {};
  if (blockReason) {
    out.decision = "block";
    out.reason = sections.length
      ? [...sections, blockReason].join("\n\n")
      : blockReason;
  } else if (sections.length) {
    out.systemMessage = sections.join("\n\n");
  }

  process.stdout.write(JSON.stringify(out));

  // Persist updated session stats (no-op if no sessionId).
  if (sessionId) {
    try { save(loadOrInit(sessionId)); } catch { /* ignore */ }
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
