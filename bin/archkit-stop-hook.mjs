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
//
// Safety:
//   - Walks up looking for .arch/SYSTEM.md. If not found, exits 0 silent
//     (don't fire on non-archkit projects).
//   - Always exits 0; never blocks the stop event.
//   - Output is informational additionalContext only — never decision: block.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIB = path.resolve(__dirname, "..", "src", "lib");
const { loadOrInit, computeUtilization, formatUtilizationLine, save } = await import(path.join(LIB, "session-stats.mjs"));
const { detectViolations, formatViolation } = await import(path.join(LIB, "boundary-patterns.mjs"));
const { detectDecisions } = await import(path.join(LIB, "decision-detector.mjs"));

const UTILIZATION_TARGET = 75;
const BOUNDARIES_RULE_CAP = 12;

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

  if (!sections.length) {
    process.exit(0);
  }

  const additionalContext = sections.join("\n\n");

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext,
    },
  }));

  // Persist updated session stats (no-op if no sessionId).
  if (sessionId) {
    try { save(loadOrInit(sessionId)); } catch { /* ignore */ }
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
