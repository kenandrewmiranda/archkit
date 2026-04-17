#!/usr/bin/env node

// Standalone hook binary called by Claude Code PreToolUse. Takes a file path
// as argv[2], derives feature+layer from the path, runs preflight, surfaces
// any issues to stderr (which Claude Code shows the agent).
//
// Safety:
// - Exits 0 silently if no path or unrecognizable path
// - Exits 0 silently if archkit not installed or call fails
// - Exits 2 (informational, not fatal) if preflight surfaces real issues

import { execFileSync } from "child_process";

const filePath = process.argv[2] || "";
if (!filePath) process.exit(0);

// Path patterns: src/features/<feature>/<feature>.<layer>.<ext>
//                bot/<layer>/<feature>.py    (Python convention)
const m = filePath.match(/(?:src|app|bot)\/(?:features|streams|domain|services|chains)\/(\w+)\//) ||
          filePath.match(/(?:src|app|bot)\/(\w+)\/(\w+)\.\w+$/);
if (!m) process.exit(0);

const feature = m[1];
const layer = m[2] || "controller";

try {
  const out = execFileSync("archkit", ["resolve", "preflight", feature, layer, "--json"], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 3000,
  });
  const parsed = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] || "{}");
  if (parsed.passWithoutAction) process.exit(0);

  const drifts = parsed.driftFindings?.length || 0;
  const gotchas = parsed.pendingGotchas?.length || 0;
  if (drifts === 0 && gotchas === 0) process.exit(0);

  console.error(`[archkit] ${feature}/${layer}: ${drifts} drift, ${gotchas} pending gotchas — read .arch/ before editing`);
  process.exit(2);
} catch {
  process.exit(0); // best-effort, don't block on errors
}
