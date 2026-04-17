// Safe read/merge/write for .claude/settings.json. Always preserves existing
// hooks; only adds the archkit hook if not already present.

import fs from "fs";

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
