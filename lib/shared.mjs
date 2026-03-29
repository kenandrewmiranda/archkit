import fs from "fs";
import path from "path";

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
      // Also check if the required path exists directly (for gotcha.mjs's "skills" check)
      if (fs.existsSync(path.join(dir, opts.requireFile))) return dir;
    } else {
      if (fs.existsSync(archPath)) return archPath;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function divider() {
  console.log(`${C.gray}  ${"─".repeat(64)}${C.reset}`);
}

export function banner(name, description) {
  console.log("");
  console.log(`${C.cyan}${C.bold}  ${ICONS.arch} ${name}${C.reset}`);
  console.log(`${C.gray}  ${description}${C.reset}`);
  console.log("");
}
