// Safe read/merge/write for .claude/settings.json. Always preserves existing
// hooks; only adds the archkit hook if not already present.

import fs from "fs";
import path from "path";

export function mergeClaudeSettings(existing, matcher, command) {
  const settings = JSON.parse(JSON.stringify(existing || {}));
  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  // Skip if an archkit hook already exists with same matcher and command
  const dup = settings.hooks.PreToolUse.find(h =>
    h.matcher === matcher &&
    h.hooks?.some(hh => hh.command?.includes("archkit-claude-hook"))
  );
  if (dup) return settings;

  settings.hooks.PreToolUse.push({
    matcher,
    hooks: [
      { type: "command", command, timeout: 3000 },
    ],
  });
  return settings;
}

export function addSessionStartHook(existing, command) {
  const settings = JSON.parse(JSON.stringify(existing || {}));
  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];

  // Skip if an archkit SessionStart hook is already wired up
  const dup = settings.hooks.SessionStart.find(h =>
    h.hooks?.some(hh => hh.command?.includes("archkit-session-start"))
  );
  if (dup) return settings;

  settings.hooks.SessionStart.push({
    hooks: [
      { type: "command", command, timeout: 5000 },
    ],
  });
  return settings;
}

export function readClaudeSettings(filepath) {
  if (!fs.existsSync(filepath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {}; // corrupt file — treat as empty
  }
}

export function writeClaudeSettings(filepath, settings) {
  fs.writeFileSync(filepath, JSON.stringify(settings, null, 2) + "\n");
}

// ───────────────────────────────────────────────────────────────────────────
// v1.6 guardrail hooks (the four archkit ships in the plugin's hooks.json).
//
// `archkit init --install-hooks` predates these and only wires a git pre-commit
// hook + the legacy PreToolUse claude-hook + SessionStart — so the Stop-hook
// CGR guard never gets installed via the npm path. These helpers let the MCP
// layer detect + install the full set into a project's .claude/settings.json.
//
// Hook commands are emitted in one of two PORTABLE, committable forms — never a
// machine-specific absolute path like `node /Users/you/.../bin/x.mjs`, which
// would break on a teammate's clone and force .claude/settings.json to stay
// gitignored:
//   1. `node $CLAUDE_PROJECT_DIR/bin/<bin>.mjs` — when the archkit bins live
//      inside the project tree (the archkit repo itself, or a vendored copy).
//      Claude Code expands $CLAUDE_PROJECT_DIR to the project root at hook time,
//      so this resolves on any checkout without a global/linked install.
//   2. bare `<bin>` — resolves via PATH for npm-global / `npm link` installs.
// ───────────────────────────────────────────────────────────────────────────

export const ARCHKIT_GUARDRAIL_HOOKS = [
  { event: "SessionStart", bin: "archkit-session-start", timeout: 10 },
  { event: "Stop", bin: "archkit-stop-hook", timeout: 8 },
  // CGR 2.0 conductor: flush in-context state to disk before compaction
  // (conductor-loop-hooks, ADR 0013/0014). No matcher — fires on every compact.
  { event: "PreCompact", bin: "archkit-precompact-hook", timeout: 8 },
  { event: "PreToolUse", bin: "archkit-pretooluse-hook", timeout: 5,
    matcher: "Edit|Write|MultiEdit" },
  { event: "PostToolUse", bin: "archkit-posttooluse-hook", timeout: 8,
    matcher: "Edit|Write|MultiEdit|Read|Bash|Glob|Grep|mcp__archkit__.*" },
  { event: "UserPromptSubmit", bin: "archkit-userpromptsubmit-hook", timeout: 5 },
];

// Resolve the portable hook command for a guardrail bin. When `projectDir` is
// given and the bin actually exists at `<projectDir>/bin/<bin>.mjs`, emit the
// $CLAUDE_PROJECT_DIR form (committable, resolves on any checkout). Otherwise
// fall back to the bare bin name (PATH resolution for global/linked installs).
// Either way the result contains no absolute filesystem path.
export function guardrailHookCommand(bin, { projectDir } = {}) {
  if (projectDir && fs.existsSync(path.join(projectDir, "bin", `${bin}.mjs`))) {
    return `node $CLAUDE_PROJECT_DIR/bin/${bin}.mjs`;
  }
  return bin;
}

function hookEntry(spec, opts = {}) {
  const command = guardrailHookCommand(spec.bin, opts);
  const entry = { hooks: [{ type: "command", command, timeout: spec.timeout }] };
  if (spec.matcher) entry.matcher = spec.matcher;
  return entry;
}

// Which archkit guardrail hooks are wired in a settings object? Scans every
// hook command for the bin marker — matches both the plugin form
// (`node ${CLAUDE_PLUGIN_ROOT}/bin/archkit-stop-hook.mjs`) and the npm form
// (`archkit-stop-hook`). Returns a Set of event names.
export function detectArchkitHooks(settings) {
  const present = new Set();
  const hooks = settings?.hooks || {};
  for (const event of Object.keys(hooks)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    for (const group of groups) {
      for (const h of (group?.hooks || [])) {
        const cmd = String(h?.command || "");
        for (const spec of ARCHKIT_GUARDRAIL_HOOKS) {
          if (cmd.includes(spec.bin)) present.add(spec.event);
        }
      }
    }
  }
  return present;
}

// A settings-shaped { hooks: {...} } object containing the full guardrail set —
// for emitting to the agent to merge (so the user sees the diff). Pass
// `{ projectDir }` to prefer the $CLAUDE_PROJECT_DIR command form when the bins
// live in the project tree.
export function renderGuardrailHooks(opts = {}) {
  const hooks = {};
  for (const spec of ARCHKIT_GUARDRAIL_HOOKS) hooks[spec.event] = [hookEntry(spec, opts)];
  return { hooks };
}

// Idempotently merge any missing guardrail hooks into an existing settings
// object (preserves all existing hooks). Returns { settings, added:[events] }.
// Pass `{ projectDir }` to prefer the $CLAUDE_PROJECT_DIR command form.
export function addGuardrailHooks(existing, opts = {}) {
  const settings = JSON.parse(JSON.stringify(existing || {}));
  settings.hooks = settings.hooks || {};
  const present = detectArchkitHooks(settings);
  const added = [];
  for (const spec of ARCHKIT_GUARDRAIL_HOOKS) {
    if (present.has(spec.event)) continue;
    settings.hooks[spec.event] = settings.hooks[spec.event] || [];
    settings.hooks[spec.event].push(hookEntry(spec, opts));
    added.push(spec.event);
  }
  return { settings, added };
}
