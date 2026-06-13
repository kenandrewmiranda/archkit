#!/usr/bin/env node

// PreToolUse guardrail hook for Claude Code. Fires BEFORE every Edit/Write/
// MultiEdit lands. This is the v1.9 flagship feature: it turns archkit from a
// post-hoc reviewer (PostToolUse) into an up-front GUARDRAIL by BLOCKING a tool
// call whose proposed edit would introduce an import that violates a BAN rule
// in .arch/BOUNDARIES.md.
//
// Contrast with bin/archkit-posttooluse-hook.mjs, which only annotates AFTER
// the write. Here we deny the write up front, with a clear, actionable reason
// the agent sees and can act on.
//
// Precision-first (see src/lib/pretooluse-eval.mjs): only imports the edit
// INTRODUCES are evaluated, so touching an already-violating file or removing a
// banned import never blocks. And the hook fails OPEN — any error, missing
// BOUNDARIES.md, non-edit tool, or unparseable input → exit 0 (allow). A
// guardrail that wrongly blocks edits destroys trust faster than one that
// occasionally misses.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// import() of an absolute path needs a file:// URL on Windows
// (ERR_UNSUPPORTED_ESM_URL_SCHEME otherwise); no-op-shaped on POSIX.
const importPath = (p) => import(pathToFileURL(p).href);
const LIB = path.resolve(__dirname, "..", "src", "lib");
const { isEditTool, evaluateProposedEdit, formatBlockReason } = await importPath(path.join(LIB, "pretooluse-eval.mjs"));

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

// Allow: stay silent, exit 0. Claude Code proceeds with the tool call.
function allow() {
  process.exit(0);
}

// Deny: emit the PreToolUse deny envelope. permissionDecisionReason is shown to
// the agent (and the user) so it can fix the edit rather than retry blindly.
function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let event = {};
  try { event = JSON.parse(raw); } catch { return allow(); }

  const toolName = event.tool_name || "";
  if (!isEditTool(toolName)) return allow();

  const cwd = event.cwd || process.cwd();
  const archDir = findArchDir(cwd);
  if (!archDir) return allow();

  const projectRoot = path.dirname(archDir);
  const boundariesPath = path.join(archDir, "BOUNDARIES.md");
  if (!fs.existsSync(boundariesPath)) return allow(); // nothing to enforce

  const toolInput = event.tool_input || {};
  const filePath = toolInput.file_path;
  if (!filePath) return allow();

  const absFile = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  const fileRel = path.relative(projectRoot, absFile);
  // Edits outside the project tree aren't ours to judge.
  if (fileRel.startsWith("..") || path.isAbsolute(fileRel)) return allow();

  let boundariesContent = "";
  try { boundariesContent = fs.readFileSync(boundariesPath, "utf8"); } catch { return allow(); }

  // Current on-disk content; a brand-new file (Write) reads as "".
  let currentContent = "";
  try { currentContent = fs.readFileSync(absFile, "utf8"); } catch { currentContent = ""; }

  let result;
  try {
    result = evaluateProposedEdit({
      fileRel,
      filePath: absFile,
      toolName,
      toolInput,
      currentContent,
      boundariesContent,
    });
  } catch {
    return allow(); // fail open — never block on an evaluation bug
  }

  if (!result.violations.length) return allow();
  return deny(formatBlockReason(result.violations));
}

main().catch(() => process.exit(0));
