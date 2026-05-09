#!/usr/bin/env node

// PostToolUse hook for Claude Code. Fires after every successful tool call.
//
// Two jobs (per v1.6 design):
//   1. Increment the session-stats utilization counter for EVERY tool call.
//      This is what feeds the per-task instrumentation rate and per-session
//      ratio that the Stop hook reports back to the agent.
//   2. For Edit/Write/MultiEdit on source files: run archkit_review inline
//      against the edited file and emit findings as additionalContext.
//
// Sidesteps the v1.4.x deny-style PreToolUse problem (project_pretooluse_
// spike_findings.md): this is post-action and informational, never blocking.
//
// Skip rules:
//   - No .arch/SYSTEM.md found anywhere up the tree → exit 0 silent
//   - Edited file outside src/ → counter only, no review
//   - Edited file in node_modules/, dist/, build/, .archkit/ → counter only
//   - Edited file is not a code file (.ts/.tsx/.js/.jsx/.mjs/.cjs/.py/.go) → counter only
//
// Always exits 0; never blocks the tool call (which already ran anyway).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIB = path.resolve(__dirname, "..", "src", "lib");
const { loadOrInit, recordToolCall, save } = await import(path.join(LIB, "session-stats.mjs"));

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".rs", ".java"]);
const SKIP_DIRS = ["node_modules", "dist", "build", ".archkit", ".next", ".turbo", "coverage"];

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

function extractEditedFile(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object") return null;
  // Edit, Write, MultiEdit all surface file_path on tool_input.
  return toolInput.file_path || null;
}

function shouldSkipReview(filePath, projectRoot) {
  if (!filePath) return true;
  const rel = path.relative(projectRoot, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return true;

  const segs = rel.split(path.sep);
  for (const skip of SKIP_DIRS) if (segs.includes(skip)) return true;

  // Per v1.6 design — only review src/ by default.
  if (!segs[0] || segs[0] !== "src") return true;

  const ext = path.extname(filePath).toLowerCase();
  if (!CODE_EXTENSIONS.has(ext)) return true;

  return false;
}

function summarizeFindings(reviewResult) {
  if (!reviewResult || !reviewResult.findings) return null;
  const findings = reviewResult.findings.slice(0, 3);
  if (!findings.length) return null;
  const lines = findings.map((f) => {
    const sev = (f.severity || "info").toUpperCase();
    const loc = f.line ? ` (line ${f.line})` : "";
    return `[${sev}] ${f.rule || f.code || "rule"}${loc}: ${f.message}`;
  });
  const more = reviewResult.findings.length > 3 ? `\n…and ${reviewResult.findings.length - 3} more.` : "";
  return lines.join("\n") + more;
}

async function tryReview(filePath, archDir, projectRoot) {
  try {
    // Lazy import — avoids cost on every PostToolUse for non-edit tools.
    const { runReviewJson } = await import(path.resolve(__dirname, "..", "src", "commands", "review.mjs"));
    const result = await runReviewJson({
      files: [filePath],
      archDir,
      cwd: projectRoot,
    });
    return result;
  } catch (err) {
    // Review failures are non-fatal — the hook should never block.
    return null;
  }
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let event = {};
  try { event = JSON.parse(raw); } catch { /* ignore */ }

  const cwd = event.cwd || process.cwd();
  const archDir = findArchDir(cwd);
  if (!archDir) process.exit(0);

  const projectRoot = path.dirname(archDir);
  const sessionId = event.session_id;
  const toolName = event.tool_name || "";
  const toolInput = event.tool_input || {};

  // Job 1: counter increment (always, regardless of review eligibility).
  if (sessionId) {
    try {
      const stats = loadOrInit(sessionId);
      recordToolCall(stats, toolName);
      save(stats);
    } catch { /* ignore — counter is best-effort */ }
  }

  // Job 2: review-on-write for Edit/Write/MultiEdit.
  const isEditTool = toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit";
  if (!isEditTool) process.exit(0);

  const filePath = extractEditedFile(toolName, toolInput);
  if (shouldSkipReview(filePath, projectRoot)) process.exit(0);

  const result = await tryReview(filePath, archDir, projectRoot);
  const summary = summarizeFindings(result);
  if (!summary) process.exit(0);

  const rel = path.relative(projectRoot, filePath);
  const additionalContext = `archkit_review on ${rel}:\n${summary}`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext,
    },
  }));
  process.exit(0);
}

main().catch(() => process.exit(0));
