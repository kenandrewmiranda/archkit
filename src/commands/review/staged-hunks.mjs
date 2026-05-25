// Parse `git diff -U0` output to get the set of changed line numbers per file.
// Used by `review --staged` / `--diff` to scope findings to the actual change,
// dropping noisy pre-existing findings on untouched lines.
//
// Source: arch-poly dogfood (2026-05) — review --staged consistently reported
// TODO findings on pre-existing lines outside the user's diff, training users
// to ignore the warning count. Filtering to hunks restores signal.

import { execFileSync } from "node:child_process";
import path from "node:path";

// Returns Map<absolutePath, Set<lineNumber>> for the changed lines in the
// new-file side of each hunk. Empty map on git failure (e.g. not a repo).
export function getDiffHunkLines(cwd, { staged = true } = {}) {
  const args = staged
    ? ["diff", "--cached", "-U0", "--diff-filter=ACM"]
    : ["diff", "-U0", "--diff-filter=ACM"];
  let out;
  try {
    // stderr suppressed: outside a git repo, `git diff --cached` falls back
    // to --no-index mode and dumps usage text. We just want a clean empty map.
    out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return new Map();
  }
  return parseDiff(out, cwd);
}

function parseDiff(diff, cwd) {
  const ranges = new Map();
  let currentPath = null;
  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentPath = path.resolve(cwd, fileMatch[1]);
      if (!ranges.has(currentPath)) ranges.set(currentPath, new Set());
      continue;
    }
    // @@ -oldStart[,oldCount] +newStart[,newCount] @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentPath) {
      const start = parseInt(hunkMatch[1], 10);
      const count = hunkMatch[2] === undefined ? 1 : parseInt(hunkMatch[2], 10);
      const set = ranges.get(currentPath);
      for (let i = 0; i < count; i++) set.add(start + i);
    }
  }
  return ranges;
}

// Filter findings to only those whose `line` falls inside the changed hunks.
// Findings with no `line` field (file-level) are always kept.
// If `hunkLines` is undefined or empty, no filtering happens.
export function filterFindingsByHunks(findings, hunkLines) {
  if (!hunkLines || hunkLines.size === 0) return findings;
  return findings.filter((f) => {
    if (typeof f.line !== "number") return true;
    return hunkLines.has(f.line);
  });
}
