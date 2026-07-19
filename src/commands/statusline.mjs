#!/usr/bin/env node
// archkit statusline — emit a compact CGR heads-up segment for the Claude Code
// status line. The status line runs as a plain shell SUBPROCESS: it cannot call
// archkit MCP tools, but it CAN shell out to this command, which reads .arch/
// goal state off disk and prints the active goal slug + pending-queue depth.
//
//   archkit statusline                 — segment for the .arch/ found from CWD
//   archkit statusline <dir>           — search for .arch/ starting at <dir>
//   archkit statusline --color         — wrap the segment in ANSI (bright red)
//   archkit statusline --json          — { text, slug, status, queued } (or {text:""})
//   archkit statusline --help          — usage + the settings.json snippet
//
// Data source (exit-criterion 1): a dedicated CLI subcommand over the on-disk
// .arch/ goal state (via lib/goals.statuslineSegment), NOT the MCP server — the
// status line can't speak MCP, and a CLI is reproducible + unit-testable and
// reuses the exact goal-state model the rest of archkit reads.
//
// Degradation (exit-criteria 2 & 3): OUTSIDE an archkit project, or when no goal
// is in-progress/testing, this prints NOTHING and exits 0 so the segment
// silently disappears. A missing/malformed .arch/ never crashes or prints
// garbage — statuslineSegment swallows it to null. The status line must stay
// quiet on failure, so even unexpected errors here exit 0 with no output.
//
// ── settings.json snippet (exit-criteria 4 & 5) ──────────────────────────────
// The command emits PLAIN text; the status-line wrapper applies the color so the
// segment matches the existing bright dark-mode scheme (94 blue dir · 92 green
// vcs · 95 magenta model · 93 yellow ctx% · 96 cyan style · 90 gray separators).
// Add a bright-red (91) CGR segment. In your ~/.claude/settings.json statusLine
// command, alongside the other segment blocks, add:
//
//   cgr=""
//   command -v archkit >/dev/null 2>&1 && cgr=$(archkit statusline "$cwd" 2>/dev/null)
//
// then, where the line is assembled (after the git_info segment reads well):
//
//   CGR_C='\033[91m'
//   [ -n "$cgr" ] && line="$line${SEP}${CGR_C}${cgr}${RST}"
//
// `$cwd` is the workspace dir the wrapper already derives from the status-line
// JSON (jq -r '.workspace.current_dir'); `SEP` and `RST` are its existing
// separator / reset vars. The `[ -n "$cgr" ]` guard is what keeps the segment
// absent outside archkit projects, so no other segment is affected.

import { isMainModule, C, findArchDir as _findArchDir } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import { statuslineSegment } from "../lib/goals.mjs";

// Bright red (91) — a slot not already used by the default status-line scheme,
// reading as "active work". Kept in sync with the documented CGR_C above.
const CGR_COLOR = "\x1b[91m";

// Resolve the segment for a search root. `root`, when given, sets CWD so
// findArchDir walks up from there (the status line passes "$cwd"). Never throws.
export function runStatusline({ root = "", color = false } = {}) {
  let archDir = null;
  try {
    const cwd = process.cwd();
    if (root) {
      try { process.chdir(root); } catch { /* bad/missing dir → treat as no project */ }
    }
    try {
      archDir = _findArchDir({ requireFile: "SYSTEM.md" });
    } finally {
      if (root) { try { process.chdir(cwd); } catch {} }
    }
  } catch {
    archDir = null;
  }

  let seg = null;
  try {
    seg = statuslineSegment(archDir);
  } catch {
    seg = null;
  }

  const text = seg ? seg.text : "";
  const colored = text && color ? `${CGR_COLOR}${text}${C.reset}` : text;
  return {
    text,
    colored,
    slug: seg ? seg.slug : "",
    status: seg ? seg.status : "",
    queued: seg ? seg.queued : 0,
  };
}

function printHelp() {
  commandBanner("archkit statusline", "compact CGR segment for the Claude Code status line");
  console.log(`${C.yellow}  Usage:${C.reset}`);
  console.log(`${C.gray}    archkit statusline                 Segment for the .arch/ found from CWD${C.reset}`);
  console.log(`${C.gray}    archkit statusline <dir>           Search for .arch/ starting at <dir>${C.reset}`);
  console.log(`${C.gray}    archkit statusline --color         ANSI-wrapped (bright red) for direct printf${C.reset}`);
  console.log(`${C.gray}    archkit statusline --json          { text, slug, status, queued }${C.reset}`);
  console.log("");
  console.log(`${C.dim}  Reads .arch/ goal state on disk — writes nothing. Prints the active goal${C.reset}`);
  console.log(`${C.dim}  slug + pending-queue depth (e.g. "⛏ fix-conductor-triage (3 queued)"), and${C.reset}`);
  console.log(`${C.dim}  stays SILENT outside an archkit project or when no goal is active.${C.reset}`);
  console.log("");
  console.log(`${C.yellow}  ~/.claude/settings.json statusLine — add these to the command:${C.reset}`);
  console.log(`${C.gray}    cgr=""${C.reset}`);
  console.log(`${C.gray}    command -v archkit >/dev/null 2>&1 && cgr=$(archkit statusline "$cwd" 2>/dev/null)${C.reset}`);
  console.log(`${C.gray}    CGR_C='\\033[91m'${C.reset}`);
  console.log(`${C.gray}    [ -n "$cgr" ] && line="$line\${SEP}\${CGR_C}\${cgr}\${RST}"${C.reset}`);
  console.log("");
  console.log(`${C.dim}  The wrapper colors the segment (bright red, matching the dark-mode scheme);${C.reset}`);
  console.log(`${C.dim}  the [ -n "$cgr" ] guard keeps it absent outside archkit projects.${C.reset}`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const isJson = args.includes("--json");
  const color = args.includes("--color");
  // First non-flag arg is an optional search root (the status line passes $cwd).
  const root = args.find((a) => !a.startsWith("-")) || "";

  // The status line must never break: on ANY failure, print nothing and exit 0.
  try {
    const out = runStatusline({ root, color });
    if (isJson) {
      console.log(JSON.stringify({ text: out.text, slug: out.slug, status: out.status, queued: out.queued }));
    } else if (out.text) {
      // No trailing newline noise beyond a single line; the wrapper embeds it.
      console.log(color ? out.colored : out.text);
    }
    // Empty text → print nothing at all (silent segment).
    process.exit(0);
  } catch {
    if (isJson) console.log(JSON.stringify({ text: "", slug: "", status: "", queued: 0 }));
    process.exit(0);
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
