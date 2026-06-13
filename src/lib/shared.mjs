import fs from "fs";
import path from "path";
import { pathToFileURL } from "node:url";

// ═══════════════════════════════════════════════════════════════════════════
// TERMINAL COLORS & ICONS
// ═══════════════════════════════════════════════════════════════════════════

export const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgCyan: "\x1b[46m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

export const ICONS = {
  arch: "◆",
  check: "✓",
  cross: "✗",
  warn: "⚠",
  dot: "●",
  circle: "○",
  star: "★",
  arrow: "→",
  box: "■",
  dash: "─",
  pipe: "│",
  corner: "└",
  tee: "├",
  folder: "📁",
  file: "📄",
  gear: "⚙",
  light: "💡",
  rocket: "🚀",
  brain: "🧠",
  link: "🔗",
  shield: "🛡",
  lock: "🔒",
  package: "📦",
  wrench: "🔧",
  mag: "🔍",
  chart: "📊",
  key: "🔑",
  plug: "🔌",
  plus: "+",
  half: "◐",
  full: "●",
  empty: "○",
  bar: "█",
  barEmpty: "░",
};

// ═══════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Walk up the directory tree looking for a .arch/ directory.
 * @param {Object} [opts] - Options
 * @param {string} [opts.requireFile] - A file that must exist inside .arch/ (e.g. "SYSTEM.md", "skills")
 * @returns {string|null} Path to .arch/ directory, or null if not found
 */
export function findArchDir(opts = {}) {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const archPath = path.join(dir, ".arch");
    if (opts.requireFile) {
      if (fs.existsSync(path.join(archPath, opts.requireFile))) return archPath;
    } else {
      if (fs.existsSync(archPath)) return archPath;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Cross-platform check for whether the given module is being run directly as
 * the entrypoint (i.e. `node src/commands/X.mjs`). Replaces the Windows-broken
 * `import.meta.url === `file://${process.argv[1]}`` idiom: on Windows
 * import.meta.url is `file:///D:/...` while the old template produced
 * `file://D:\...`, so the guard never matched. pathToFileURL builds the URL the
 * same way Node populates import.meta.url, so the comparison is correct on every
 * OS and a no-op-shaped equivalent on POSIX.
 *
 * Preserves the `ARCHKIT_RUN` fallback: bin/archkit.mjs sets it when dispatching
 * to a command module, so that dispatch path runs the entrypoint unchanged.
 * @param {string} importMetaUrl - the caller's `import.meta.url`
 * @returns {boolean}
 */
export function isMainModule(importMetaUrl) {
  const entry = process.argv[1];
  return (!!entry && importMetaUrl === pathToFileURL(entry).href) || !!process.env.ARCHKIT_RUN;
}

export function divider() {
  console.log(`${C.gray}  ${"─".repeat(64)}${C.reset}`);
}

/**
 * Normalize a filesystem path to forward-slash (POSIX) separators. On Windows,
 * path.join / readdir / the Edit-tool file_path all surface backslash paths;
 * the review checks compare against `/`-delimited spec conventions and import
 * specifiers (which are `/` on every OS), so a raw backslash path silently
 * matches nothing. Normalizing at the comparison boundary is a no-op on POSIX.
 * @param {string} p
 * @returns {string}
 */
export function toPosixPath(p) {
  return String(p == null ? "" : p).split(path.sep).join("/").split("\\").join("/");
}

