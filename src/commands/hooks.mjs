// archkit hooks — check whether the guardrail hooks are wired, and help install
// the full set (the four v1.6 hooks the plugin ships but `archkit init
// --install-hooks` never caught up to).
//
// Exposed via MCP as archkit_install_hooks. Default is EMIT mode: return the
// exact hooks config for the agent to merge into settings.json (so the user
// sees the diff + permission prompt). Pass apply:true to write it directly into
// the project's .claude/settings.json (scoped, not the global user file).

import fs from "node:fs";
import path from "node:path";
import { gatherHooksStatus } from "../lib/hooks-status.mjs";
import {
  readClaudeSettings,
  writeClaudeSettings,
  addGuardrailHooks,
  renderGuardrailHooks,
} from "../lib/claude-settings.mjs";

// Read-only: what's the current install state?
export function runHooksStatusJson({ cwd }) {
  const status = gatherHooksStatus(cwd);
  const nextStep = status.installed
    ? status.via === "plugin"
      ? "Guardrail hooks are provided by the enabled archkit plugin. Nothing to do."
      : "All four guardrail hooks are wired. Nothing to do."
    : `Missing hook(s): ${status.missing.join(", ")}. Call archkit_install_hooks to wire them (the CGR Stop-hook guard needs Stop).`;
  return { ...status, nextStep };
}

// Emit (default) or apply the guardrail-hooks install.
export function runHooksInstallJson({ cwd, apply = false }) {
  const status = gatherHooksStatus(cwd);

  if (status.installed) {
    return {
      action: "noop",
      installed: true,
      via: status.via,
      missing: [],
      nextStep:
        status.via === "plugin"
          ? "Already provided by the enabled archkit plugin — no settings change needed."
          : "All four guardrail hooks are already wired. No change needed.",
    };
  }

  const settingsPath = status.projectSettingsPath;

  if (apply) {
    const existing = readClaudeSettings(settingsPath);
    const { settings, added } = addGuardrailHooks(existing);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); // .claude/ may not exist yet
    writeClaudeSettings(settingsPath, settings);
    return {
      action: "applied",
      installed: true,
      settingsPath,
      added,
      addedNote: added.length === 0 ? "All guardrail hooks were already present." : undefined,
      nextStep: `Wrote ${added.length} hook(s) to ${path.relative(cwd, settingsPath)}. Tell the user to RESTART Claude Code so they load.`,
    };
  }

  // Emit mode — hand the config to the agent to apply with the user watching.
  return {
    action: "emit",
    installed: false,
    settingsPath,
    missing: status.missing,
    hooksConfig: renderGuardrailHooks(),
    instruction: `Merge hooksConfig.hooks into ${path.relative(cwd, settingsPath)} (create the file if absent; PRESERVE any existing hooks — append, don't overwrite). Then tell the user to restart Claude Code. Or re-call archkit_install_hooks with apply:true to write it directly into the project settings.`,
    nextStep: `Apply hooksConfig to ${path.relative(cwd, settingsPath)} (or re-call apply:true), then have the user restart Claude Code.`,
  };
}
