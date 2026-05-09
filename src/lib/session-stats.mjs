// Session-scoped utilization counter for archkit hooks.
//
// All three v1.6 hooks share state via this lib. Storage is the OS temp dir
// keyed by Claude Code session_id (present in every hook event), so:
//   - no user gitignore mutation needed
//   - auto-cleanup happens via OS temp eviction
//   - session boundaries are explicit (new session_id = new file)
//
// Compound metric exposed by computeUtilization():
//   - perTaskPct:    % of tasks where archkit_resolve_preflight or
//                    archkit_resolve_lookup was called BEFORE the first edit.
//                    Headline number; target ≥75%.
//   - perSessionRatio: archkit MCP calls / (Edit + Write + MultiEdit + Read).
//                    Secondary noisy signal for long sessions.
//
// A "task" begins on every UserPromptSubmit. PostToolUse increments per-tool
// counters and (if the tool is preflight/lookup or an edit tool) flips the
// corresponding flag on the current task.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const SCHEMA_VERSION = 1;

// Tools that count as "consulting archkit for context before acting."
const PREFLIGHT_TOOLS = new Set([
  "mcp__archkit__archkit_resolve_preflight",
  "mcp__archkit__archkit_resolve_lookup",
  "mcp__archkit__archkit_resolve_warmup",
]);

// Tools that count as "code-changing actions."
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

// All archkit MCP tools — used for the per-session ratio numerator.
const ARCHKIT_TOOL_PREFIX = "mcp__archkit__archkit_";

export function statsPathForSession(sessionId) {
  // Sanitize sessionId to prevent path traversal even though Claude Code
  // generates these. Keep it strict: hex/dashes only.
  const raw = String(sessionId || "");
  if (!/[a-zA-Z0-9]/.test(raw)) return null;
  const safe = raw.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 64);
  return path.join(os.tmpdir(), `archkit-stats-${safe}.json`);
}

export function loadOrInit(sessionId) {
  const file = statsPathForSession(sessionId);
  if (!file) return null;
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === SCHEMA_VERSION && parsed.sessionId === sessionId) {
        return parsed;
      }
    } catch {
      // fall through and reinitialize on any parse error
    }
  }
  return {
    version: SCHEMA_VERSION,
    sessionId,
    startedAt: new Date().toISOString(),
    tasks: [],
    counts: { byTool: {}, archkit: 0, edits: 0, reads: 0, total: 0 },
  };
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function save(stats) {
  if (!stats || !stats.sessionId) return;
  const file = statsPathForSession(stats.sessionId);
  if (!file) return;
  atomicWrite(file, stats);
}

export function hashPrompt(prompt) {
  return crypto
    .createHash("sha1")
    .update(String(prompt || ""))
    .digest("hex")
    .slice(0, 12);
}

export function startTask(stats, prompt) {
  if (!stats) return null;
  const promptHash = hashPrompt(prompt);
  const task = {
    promptHash,
    startedAt: new Date().toISOString(),
    preflightCalled: false,
    edited: false,
    archkitCalls: 0,
    edits: 0,
  };
  stats.tasks.push(task);
  // Cap task history to avoid unbounded growth on very long sessions.
  if (stats.tasks.length > 200) stats.tasks = stats.tasks.slice(-200);
  return task;
}

function currentTask(stats) {
  if (!stats || !stats.tasks.length) return null;
  return stats.tasks[stats.tasks.length - 1];
}

export function recordToolCall(stats, toolName) {
  if (!stats || !toolName) return;
  const counts = stats.counts;
  counts.total += 1;
  counts.byTool[toolName] = (counts.byTool[toolName] || 0) + 1;

  const isArchkit = toolName.startsWith(ARCHKIT_TOOL_PREFIX);
  const isPreflight = PREFLIGHT_TOOLS.has(toolName);
  const isEdit = EDIT_TOOLS.has(toolName);
  const isRead = toolName === "Read";

  if (isArchkit) counts.archkit += 1;
  if (isEdit) counts.edits += 1;
  if (isRead) counts.reads += 1;

  const task = currentTask(stats);
  if (task) {
    if (isArchkit) task.archkitCalls += 1;
    if (isEdit) {
      task.edits += 1;
      task.edited = true;
    }
    // preflightCalled only counts if it happened BEFORE the first edit on the
    // task. After the first edit, calling preflight no longer "instruments"
    // the task — that's how we keep the metric honest.
    if (isPreflight && !task.edited) task.preflightCalled = true;
  }
}

export function computeUtilization(stats) {
  if (!stats) {
    return {
      perTaskPct: null,
      perSessionRatio: null,
      taskCount: 0,
      tasksEdited: 0,
      tasksInstrumented: 0,
      archkitCalls: 0,
      edits: 0,
      reads: 0,
    };
  }

  const tasksEdited = stats.tasks.filter((t) => t.edited).length;
  const tasksInstrumented = stats.tasks.filter(
    (t) => t.edited && t.preflightCalled
  ).length;

  // Per-task metric only makes sense for tasks that actually edited code —
  // a "tell me about this codebase" prompt that ends without edits shouldn't
  // count against utilization.
  const perTaskPct =
    tasksEdited === 0 ? null : Math.round((tasksInstrumented / tasksEdited) * 100);

  const denom =
    stats.counts.edits + stats.counts.reads + (stats.counts.byTool.Glob || 0) + (stats.counts.byTool.Grep || 0);
  const perSessionRatio = denom === 0 ? null : Number((stats.counts.archkit / denom).toFixed(2));

  return {
    perTaskPct,
    perSessionRatio,
    taskCount: stats.tasks.length,
    tasksEdited,
    tasksInstrumented,
    archkitCalls: stats.counts.archkit,
    edits: stats.counts.edits,
    reads: stats.counts.reads,
  };
}

// Compact one-liner suitable for hook additionalContext.
export function formatUtilizationLine(util, target = 75) {
  if (util.perTaskPct === null) {
    return `archkit utilization: no editing tasks yet this session (target ≥${target}% per-task).`;
  }
  const status = util.perTaskPct >= target ? "on target" : "below target";
  return `archkit utilization: ${util.perTaskPct}% per-task (${util.tasksInstrumented}/${util.tasksEdited} editing tasks consulted archkit before first edit) — ${status} (≥${target}%). Per-session ratio: ${util.perSessionRatio ?? "n/a"}.`;
}

// Exposed for tests.
export const _internals = {
  PREFLIGHT_TOOLS,
  EDIT_TOOLS,
  ARCHKIT_TOOL_PREFIX,
  SCHEMA_VERSION,
};
