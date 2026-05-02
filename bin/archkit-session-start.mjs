#!/usr/bin/env node

// SessionStart hook for Claude Code. Reads the SessionStart event JSON from
// stdin, walks up from cwd looking for `.arch/SYSTEM.md`, and if found emits
// `additionalContext` describing how archkit works in this project.
//
// Phrasing is deliberately FACTUAL, not imperative. Imperative deny-reason
// text ("call X first") triggers prompt-injection skepticism in the model;
// factual session-setup context lands cleanly.
//
// Safety:
// - Always exits 0
// - No output when no .arch/SYSTEM.md is found anywhere up the tree
// - Emits nothing on parse errors or unexpected event shapes

import fs from "node:fs";
import path from "node:path";

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

const ADDITIONAL_CONTEXT = [
  "This project is managed by archkit. The .arch/ directory holds the project's architecture spec.",
  "",
  "Before answering questions about this project's spec, structure, conventions, or where code should go, call archkit_resolve_warmup — it returns a structured digest of .arch/ joined across all spec files. Reading .arch/*.md directly returns raw markdown and partial context.",
  "",
  "Other archkit tools for specific tasks:",
  "  • archkit_resolve_preflight — verify a feature/layer is wired before edits.",
  "  • archkit_resolve_lookup — resolve symbols against .arch/.",
  "  • archkit_resolve_scaffold — generate scaffolding for a new feature.",
  "  • archkit_review / archkit_review_staged — check files against archkit rules.",
  "  • archkit_drift — current drift findings.",
  "  • archkit_gotcha_list / archkit_gotcha_propose — read or propose gotchas.",
  "  • archkit_stats — project stats.",
].join("\n");

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let event = {};
  try { event = JSON.parse(raw); } catch { /* ignore — fall through to cwd */ }

  const cwd = event.cwd || process.cwd();
  if (!findArchDir(cwd)) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: ADDITIONAL_CONTEXT,
    },
  }));
  process.exit(0);
});
