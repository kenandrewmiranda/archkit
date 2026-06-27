#!/usr/bin/env node

// SessionStart hook for Claude Code. Reads the SessionStart event JSON from
// stdin, walks up from cwd looking for `.arch/SYSTEM.md`, and emits an
// `additionalContext` payload describing how archkit should be used in this
// session.
//
// Two modes:
//   1. archkit IS set up (.arch/SYSTEM.md found): emit a tools digest so the
//      agent reaches for archkit_resolve_warmup before reading raw .arch/*.md.
//   2. archkit is NOT set up: emit a greenfield-setup nudge pointing at the
//      /archkit-init wizard skill (resolved to an absolute path) — without
//      this, agents discover the legacy `archkit init` CLI scaffolder first
//      and never find the v1.5+ skill-based wizard.
//
// Phrasing is FACTUAL for the in-project case and IMPERATIVE for the setup
// case. Setup is a discrete "do this exact thing first" decision; reads are
// open-ended exploration where imperative deny-reasons trigger injection
// skepticism.
//
// Safety:
// - Always exits 0
// - Emits nothing on parse errors or unexpected event shapes

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const importPath = (p) => import(pathToFileURL(p).href);

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

// Resolve the absolute path to the archkit-init SKILL.md. Two cases:
//   - Plugin install: ${CLAUDE_PLUGIN_ROOT}/skills/archkit-init/SKILL.md
//   - npm install:    derived from this hook script's location (bin/ → ../skills/...)
function resolveSkillPath() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return path.join(process.env.CLAUDE_PLUGIN_ROOT, "skills", "archkit-init", "SKILL.md");
  }
  // npm install path: this file is at <pkg-root>/bin/archkit-session-start.mjs
  return path.resolve(__dirname, "..", "skills", "archkit-init", "SKILL.md");
}

const IN_PROJECT_CONTEXT = [
  "This project is managed by archkit. The .arch/ directory holds the project's architecture spec.",
  "",
  "Before answering questions about this project's spec, structure, conventions, or where code should go, call archkit_resolve_warmup — it returns a structured digest of .arch/ joined across all spec files. Reading .arch/*.md directly returns raw markdown and partial context.",
  "",
  "Other archkit MCP tools available (32 total):",
  "  • archkit_init — initialize archkit on greenfield projects (returns the wizard inline). Use when re-initializing or augmenting setup.",
  "  • archkit_resolve_warmup — pre-session health check.",
  "  • archkit_resolve_preflight — verify a feature/layer is wired before edits.",
  "  • archkit_resolve_lookup — resolve symbols against .arch/.",
  "  • archkit_resolve_scaffold — generate scaffolding for a new feature.",
  "  • archkit_review / archkit_review_staged — check files against archkit rules.",
  "  • archkit_boundary_check — enforce BAN rules; archkit_boundary_propose — queue a new BAN for human review.",
  "  • archkit_drift — current drift findings.",
  "  • archkit_graph_accept — close the CGR graph flywheel (ADR 0004): apply an authored node line from a .arch/graph-proposals/ proposal to its cluster .graph, then drop the gap. Use right after archkit_goal_complete reports graph gaps.",
  "  • archkit_doctor — workflow logistic gauge (is .arch/ actually load-bearing?).",
  "  • archkit_gotcha_list / archkit_gotcha_propose — read or propose gotchas.",
  "  • archkit_stats — project stats.",
  "  • archkit_log_decision — append an ADR to .arch/decisions/ when a non-trivial architectural choice is made. The decisions/ directory is this project's institutional memory across LLM context resets.",
  "  • archkit_decisions_search — read those ADRs back (keyword search or list). Call before changing an area to honor prior decisions; resolve_preflight also surfaces related ADRs automatically.",
  "  • archkit_prd_check — detect a PRD/BRIEF/SPEC and (when .arch/ exists) check it against SYSTEM.md for archetype/mode drift.",
  "",
  "CGR (Clear Goal Run) — the goal relay loop. When the user gives a sprawling or multi-part ask, call archkit_goal_intake to decompose it into discrete goals (one per fresh context). To advance the queue, tell the user to run /clear then the slash command /mcp__archkit__conductor — that injects the next goal automatically (no copy-paste). You CANNOT run /clear or /mcp__archkit__conductor yourself — they are the user's keystrokes; your job is to instruct them. While a goal is in-progress the Stop hook will block stopping until you call archkit_goal_complete <slug>, which releases the guard and advances the queue. Lifecycle (status is the source of truth, ADR 0003): pending -> in-progress -> testing -> completed, plus side states on-hold (deliberately parked) and abandoned. Park edited-but-unverified work as archkit_goal_testing <slug> (stays guarded — NOT done) instead of completing prematurely; set a goal aside with archkit_goal_hold <slug> (releases the guard, resumable). The conductor relay scans pending-first, then drains the testing backlog once it crosses the configured threshold. Relay tools: archkit_goal_intake, archkit_goal_list, archkit_goal_show, archkit_goal_payload (fallback: paste after /goal), archkit_goal_testing, archkit_goal_hold, archkit_goal_verify (evidence before completing), archkit_goal_complete, archkit_goal_abandon (drop without completing), archkit_goal_consolidate (digest completed goals, archive raw CGRs).",
].join("\n");

function buildSetupContext() {
  // Single sentence as of v1.5.4: the archkit_init MCP tool is the canonical
  // discovery surface and returns the full wizard inline. No need to describe
  // SKILL.md paths, escape hatches, or runtime mechanics — those were
  // band-aids in v1.5.0–v1.5.3 over a missing tool. Calling archkit_init
  // returns wizardInstructions + skeleton index + PRD signal + nextStep hint
  // in one response.
  return [
    "This project does not have an .arch/ directory yet — archkit is not set up here.",
    "",
    "If the user asks to set up / initialize / scaffold / configure archkit, call the archkit_init MCP tool. It returns the full wizard instructions inline along with PRD scan results, the skeleton index for all 9 archetypes, and a nextStep hint. Drive the wizard conversation from there using the tools the instructions name (AskUserQuestion for choices, Read for archetype skeletons, Write/Edit for the .arch/ seed, archkit_log_decision for the foundation ADR).",
    "",
    "The legacy `archkit init` CLI is for reverse-engineering an existing codebase — not for greenfield setup. archkit_init is the right tool for new projects.",
  ].join("\n");
}

// CGR 2.0 conductor rehydration (conductor-loop-hooks, ADR 0013/0014): when a
// session opens after a /clear or compaction, reconstitute the conductor from the
// folded board — reclaim orphan leases (TTL elapsed → reclaimable), consume the
// PreCompact flush marker, and surface what is still in flight + the merge order +
// the deep-review exceptions. Best-effort: a rehydration failure degrades to the
// static digest, never blocks the session. Returns "" when there's nothing live.
async function buildRehydrationContext(archDir, source) {
  // Only the reset sources need rehydration — a fresh startup has no prior
  // conductor state to fold back, and resume keeps its context.
  if (source !== "clear" && source !== "compact") return "";
  let rehydrate;
  try {
    ({ rehydrateConductor: rehydrate } = await importPath(path.resolve(__dirname, "..", "src", "lib", "board.mjs")));
  } catch { return ""; }

  let result;
  try { result = rehydrate(archDir); } catch { return ""; }
  const { reclaimed, flush, plan } = result;
  const c = plan.counts;
  const hasState = c.frontier || c.in_flight || c.merge_queue || c.leases_expired || (reclaimed && reclaimed.length);
  if (!hasState) return "";

  const lines = [
    `[archkit CGR conductor — rehydrated after ${source}] The board is folded back from .arch/board/events.ndjson + the CGR files (it survived the ${source}).`,
  ];
  if (reclaimed && reclaimed.length) {
    lines.push(`Reclaimed ${reclaimed.length} orphan lease${reclaimed.length === 1 ? "" : "s"} (TTL elapsed): ${reclaimed.map((r) => r.slug).join(", ")} — back on the frontier.`);
  }
  if (flush) {
    const fp = Array.isArray(flush.handoffsPending) ? flush.handoffsPending : [];
    lines.push(`A PreCompact flush marker was present (trigger: ${flush.trigger || "n/a"})${fp.length ? `; in-flight CGRs that still need a handoff: ${fp.join(", ")}` : ""}.`);
  }
  lines.push(
    `In flight: ${plan.inFlight.map((f) => f.slug).join(", ") || "(none)"}.`,
    `Merge queue (dependency order): ${plan.mergeOrder.map((m) => m.slug).join(" → ") || "(empty)"}.`,
  );
  if (plan.exceptions.length) {
    lines.push(`Deep-review exceptions: ${plan.exceptions.map((e) => `${e.slug} (${e.reasons.join(", ")})`).join("; ")}.`);
  }
  lines.push(`You are the CONDUCTOR — run archkit_conductor (or /mcp__archkit__conductor) to plan the next dispatch pass: claim frontier lanes, spawn worktree-isolated workers, deep-review only the exceptions, merge sequentially with verify-after-each.`);
  return lines.join("\n");
}

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", async () => {
  let event = {};
  try { event = JSON.parse(raw); } catch { /* ignore — fall through to cwd */ }

  const cwd = event.cwd || process.cwd();
  const archDir = findArchDir(cwd);

  let additionalContext;
  if (archDir) {
    additionalContext = IN_PROJECT_CONTEXT;
    // Append a conductor-rehydration digest after a /clear or compaction.
    try {
      const rehydration = await buildRehydrationContext(archDir, event.source);
      if (rehydration) additionalContext = `${additionalContext}\n\n${rehydration}`;
    } catch { /* best-effort — keep the static digest */ }
  } else {
    additionalContext = buildSetupContext();
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  }));
  process.exit(0);
});
