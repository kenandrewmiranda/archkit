// src/lib/archdir.mjs
// The ONE archDir resolver (ADR 0031). Every surface — the MCP server, the CLI,
// and every hook bin — resolves `.arch/` through here; no handler re-derives it.
//
// Precedence, highest first:
//   1. an explicit argument (`opts.archDir`) — for callers that already know;
//   2. ARCHKIT_ARCH_DIR — the explicit signal. When set it wins over cwd
//      entirely and NO walk-up happens. It names the `.arch` directory itself
//      (matching the `archDir` parameter threaded through every lib function);
//      a relative value resolves against cwd;
//   3. process.cwd(), walked upward to the nearest `.arch/` — the documented
//      fallback, and byte-identical to what single-tree usage already had.
//
// A set-but-nonexistent ARCHKIT_ARCH_DIR is an ERROR, not a fallback: a caller
// that set the variable meant it, and silently degrading to cwd would recreate
// exactly the accidental resolution this contract removes.
//
// WHY THIS EXISTS. Before ADR 0031 there were 18 copies of `findArchDir` with
// three signatures and two existence checks, so WHICH `.arch/` a call touched
// was a function of where the process happened to be started. For a worktree
// worker that is silently wrong: `.arch/board/` is gitignored so the worktree
// has no board at all, and `.arch/goals/` is tracked so it carries a copy
// forked at the base commit. A worker spawned with ARCHKIT_ARCH_DIR pointing at
// the conductor's `.arch/` reads and writes the CONDUCTOR's board, goal tree,
// and locks regardless of its own cwd. A worker spawned without it gets its own
// tree — still legal (an isolated experiment), but chosen rather than accidental.

import fs from "node:fs";
import path from "node:path";
import { archkitError } from "./errors.mjs";

export const ARCH_DIR_ENV = "ARCHKIT_ARCH_DIR";

// The raw explicit signal, or null when unset/blank. A whitespace-only value is
// treated as unset — an exported-but-empty shell variable is not an intent.
export function archDirFromEnv(env = process.env) {
  const raw = env ? env[ARCH_DIR_ENV] : undefined;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

// The single existence check. `requireFile` (e.g. "SYSTEM.md", "BOUNDARIES.md")
// is what the caller demands INSIDE .arch/; omitted, a bare .arch/ counts.
function isArchDir(candidate, requireFile) {
  return fs.existsSync(requireFile ? path.join(candidate, requireFile) : candidate);
}

/**
 * Resolve the `.arch/` directory for this call. See the precedence rules above.
 * @param {Object} [opts]
 * @param {string|null} [opts.archDir] - explicit `.arch` path (tier 1)
 * @param {string} [opts.cwd] - start of the walk-up fallback, and the base a
 *   relative explicit value resolves against. Defaults to process.cwd().
 * @param {string|null} [opts.requireFile] - file that must exist inside `.arch/`
 *   for the WALK to accept a candidate. Not enforced on an explicit value: a
 *   caller that names a directory outright has already made the choice.
 * @param {Object} [opts.env] - environment to read ARCHKIT_ARCH_DIR from.
 * @returns {string|null} absolute path to `.arch/`, or null when the walk finds none
 * @throws {ArchkitError} when an explicit value points at something absent
 */
export function resolveArchDir({ archDir = null, cwd = null, requireFile = null, env = process.env } = {}) {
  const base = cwd || process.cwd();

  // Tiers 1 and 2 are the same code path — an explicit value, differing only in
  // where it came from (which the error message names, so a stale exported
  // variable is diagnosable from the message alone).
  const fromEnv = archDirFromEnv(env);
  const explicit = archDir || fromEnv;
  if (explicit) {
    const abs = path.resolve(base, explicit);
    if (!fs.existsSync(abs)) {
      const origin = archDir ? "explicit archDir" : ARCH_DIR_ENV;
      throw archkitError("invalid_arch_dir", `${origin} points at ${abs}, which does not exist`, {
        suggestion: `${origin} must name the .arch directory itself (e.g. /path/to/project/.arch), not the project root. Unset it to fall back to walking up from the working directory.`,
      });
    }
    return abs;
  }

  // Tier 3: walk up to the filesystem root. One walk bound for every surface.
  let dir = path.resolve(base);
  for (;;) {
    const candidate = path.join(dir, ".arch");
    if (isArchDir(candidate, requireFile)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * resolveArchDir, but a miss is the structured `no_arch_dir` error rather than
 * null. The MCP surface's shape — every tool needs a project to answer about.
 * @param {Object} [opts] - as resolveArchDir; `requireFile` defaults to SYSTEM.md
 * @returns {string} absolute path to `.arch/`
 */
export function requireArchDir({ requireFile = "SYSTEM.md", ...rest } = {}) {
  const archDir = resolveArchDir({ requireFile, ...rest });
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init` in your project root.",
      docsUrl: "https://github.com/kenandrewmiranda/archkit#getting-started",
    });
  }
  return archDir;
}

/**
 * The hook-bin variant. A hook must never take down a Claude Code session, so a
 * bad ARCHKIT_ARCH_DIR is REPORTED on stderr (where the hook log shows it) and
 * then read as "no project". That is not the silent cwd fallback the contract
 * forbids — the variable was set, so cwd is never consulted; the hook simply
 * declines to act and exits 0.
 * @param {string} label - hook name for the stderr line, e.g. "archkit-stop-hook"
 * @param {Object} [opts] - as resolveArchDir
 * @returns {string|null}
 */
export function resolveArchDirForHook(label, opts = {}) {
  try {
    return resolveArchDir(opts);
  } catch (err) {
    try { process.stderr.write(`[${label}] ${err?.message || "archDir resolution failed"}\n`); } catch { /* stderr gone — still never throw */ }
    return null;
  }
}
