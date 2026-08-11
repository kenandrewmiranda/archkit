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
//
// THIS WALK IS DELIBERATELY NOT ROUTED THROUGH src/lib/archdir.mjs, AND IT DOES
// NOT READ ARCHKIT_ARCH_DIR. That is ADR 0032, a scope clarification of ADR
// 0031 — not an oversight, and not an exemption. Do not "fix" it; §9 of
// tests/archdir-resolution/run.mjs will go red, naming this comment.
//
// ADR 0031's contract governs which `.arch/` a call READS AND WRITES. This
// function neither reads nor writes an `.arch/` — it returns a `.claude/` path,
// and touches `.arch/` only as one of two marker files for "is this a project
// root?". The two resolutions answer different questions and may disagree.
//
// Why cwd wins here, shortest first:
//
//   1. ARCHKIT_ARCH_DIR promises nothing about its PARENT. It names the .arch
//      directory itself; nothing requires it to sit inside a checkout, beside a
//      .claude/, or inside anything Claude Code ever opened. Deriving a root
//      from it would turn ARCHKIT_ARCH_DIR=/shared/specs/.arch into
//      /shared/specs/.claude — a settings file no session will ever load, that
//      doctor would report on and that archkit_install_hooks(apply) would
//      CREATE and write hook config into.
//   2. The question being asked is "will the guardrails fire FOR ME?" What
//      fires is the settings.json Claude Code loaded next to this checkout,
//      plus the user file and plugin registry (both read from $HOME below —
//      also not archDir-scoped). Re-pointing at the named spec dir would report
//      the wiring of a session that is not running. A worktree worker sharing
//      the conductor's board shares STATE; it does not inherit the conductor's
//      hook CONFIG, and the hooks that fire in it are its own.
//   3. Following the variable would ADD an implicit coupling rather than remove
//      one: it would give ARCHKIT_ARCH_DIR a second, undocumented meaning —
//      "which repo's .claude/settings.json archkit may write to" — which bites
//      hardest when the variable is merely left exported in a shell. That is
//      the class of bug ADR 0031 removes, one level up.
//
// The accepted cost (ADR 0032 Consequences): `archkit doctor` in a worktree
// with the variable set can report the conductor's goals beside this checkout's
// hook wiring. Every path involved is already in the returned payload
// (projectSettingsPath, userSettingsPath, perSource[].path), so the cure is
// disclosure in doctor's output, not forced alignment here.
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
