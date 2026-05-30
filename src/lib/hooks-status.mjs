// Detect whether archkit's guardrail hooks are actually wired into Claude Code.
//
// The MCP server is the one archkit surface guaranteed to be connected even
// when the hooks aren't installed (it's registered globally, independent of any
// project's settings). So it's the only layer that can detect the *absence* of
// the hook layer — which is exactly what this powers (archkit_doctor's D-HOOKS
// check and the archkit_install_hooks helper).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readClaudeSettings,
  detectArchkitHooks,
  ARCHKIT_GUARDRAIL_HOOKS,
} from "./claude-settings.mjs";

// The project's .claude dir: walk up from cwd for a dir that has .arch/ or
// .claude/ (the project root Claude Code is operating in), else cwd/.claude.
export function projectClaudeDir(cwd) {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".arch")) || fs.existsSync(path.join(dir, ".claude"))) {
      return path.join(dir, ".claude");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(cwd, ".claude");
}

// Read the candidate settings files + plugin state and aggregate which of the
// four guardrail hooks are wired, in which scope, and via what mechanism.
export function gatherHooksStatus(cwd, { home = os.homedir() } = {}) {
  const claudeDir = projectClaudeDir(cwd);
  const userSettingsPath = path.join(home, ".claude", "settings.json");
  const sources = [
    { scope: "project", path: path.join(claudeDir, "settings.json") },
    { scope: "project-local", path: path.join(claudeDir, "settings.local.json") },
    { scope: "user", path: userSettingsPath },
  ];

  const present = new Set();
  const perSource = [];
  for (const s of sources) {
    const settings = readClaudeSettings(s.path);
    const found = [...detectArchkitHooks(settings)];
    perSource.push({ scope: s.scope, path: s.path, found });
    for (const e of found) present.add(e);
  }

  // Plugin path: an enabled archkit plugin ships all four via hooks.json.
  const userSettings = readClaudeSettings(userSettingsPath);
  const enabled = userSettings.enabledPlugins || {};
  const pluginEnabled = Object.keys(enabled).some((k) => /archkit/i.test(k) && enabled[k]);

  const required = ARCHKIT_GUARDRAIL_HOOKS.map((h) => h.event);
  const rawMissing = required.filter((e) => !present.has(e));
  // If the plugin is enabled it provides the full set even when settings.json
  // carries nothing, so nothing is effectively missing.
  const missing = pluginEnabled ? [] : rawMissing;
  const via = pluginEnabled ? "plugin" : present.size > 0 ? "settings" : "none";
  const installed = missing.length === 0;

  return {
    installed,
    via,
    required,
    present: [...present],
    missing,
    pluginEnabled,
    perSource,
    projectSettingsPath: path.join(claudeDir, "settings.json"),
    userSettingsPath,
  };
}
