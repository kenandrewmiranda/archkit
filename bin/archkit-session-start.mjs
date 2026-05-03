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
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  "Other archkit MCP tools available (13 total):",
  "  • archkit_init — initialize archkit on greenfield projects (returns the wizard inline). Use when re-initializing or augmenting setup.",
  "  • archkit_resolve_warmup — pre-session health check.",
  "  • archkit_resolve_preflight — verify a feature/layer is wired before edits.",
  "  • archkit_resolve_lookup — resolve symbols against .arch/.",
  "  • archkit_resolve_scaffold — generate scaffolding for a new feature.",
  "  • archkit_review / archkit_review_staged — check files against archkit rules.",
  "  • archkit_drift — current drift findings.",
  "  • archkit_gotcha_list / archkit_gotcha_propose — read or propose gotchas.",
  "  • archkit_stats — project stats.",
  "  • archkit_log_decision — append an ADR to .arch/decisions/ when a non-trivial architectural choice is made. The decisions/ directory is this project's institutional memory across LLM context resets.",
  "  • archkit_prd_check — detect a PRD/BRIEF/SPEC and (when .arch/ exists) check it against SYSTEM.md for archetype/mode drift.",
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

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let event = {};
  try { event = JSON.parse(raw); } catch { /* ignore — fall through to cwd */ }

  const cwd = event.cwd || process.cwd();
  const archDir = findArchDir(cwd);

  let additionalContext;
  if (archDir) {
    additionalContext = IN_PROJECT_CONTEXT;
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
