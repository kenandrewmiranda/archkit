// Structured agent-style logging for all archkit operations.
// Every action the system takes gets a visible log line so users
// are never left guessing what's happening.

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
};

const PREFIXES = {
  agent:    `${C.cyan}${C.bold}[AGENT]${C.reset}`,
  review:   `${C.blue}${C.bold}[REVIEW]${C.reset}`,
  resolve:  `${C.magenta}${C.bold}[RESOLVE]${C.reset}`,
  guard:    `${C.yellow}${C.bold}[GUARD]${C.reset}`,
  generate: `${C.green}${C.bold}[GENERATE]${C.reset}`,
  scaffold: `${C.cyan}${C.bold}[SCAFFOLD]${C.reset}`,
  gotcha:   `${C.yellow}${C.bold}[GOTCHA]${C.reset}`,
  stats:    `${C.blue}${C.bold}[STATS]${C.reset}`,
  extend:   `${C.magenta}${C.bold}[EXTEND]${C.reset}`,
  system:   `${C.gray}${C.bold}[SYSTEM]${C.reset}`,
  warn:     `${C.yellow}${C.bold}[WARN]${C.reset}`,
  error:    `${C.red}${C.bold}[ERROR]${C.reset}`,
  ok:       `${C.green}${C.bold}[OK]${C.reset}`,
};

let quiet = false;

export function setQuiet(val) {
  quiet = val;
}

export function log(prefix, message) {
  if (quiet) return;
  const tag = PREFIXES[prefix] || `${C.gray}${C.bold}[${prefix.toUpperCase()}]${C.reset}`;
  console.error(`  ${tag} ${C.dim}${message}${C.reset}`);
}

// Convenience shortcuts
export const agent    = (msg) => log("agent", msg);
export const review   = (msg) => log("review", msg);
export const resolve  = (msg) => log("resolve", msg);
export const guard    = (msg) => log("guard", msg);
export const generate = (msg) => log("generate", msg);
export const scaffold = (msg) => log("scaffold", msg);
export const gotcha   = (msg) => log("gotcha", msg);
export const stats    = (msg) => log("stats", msg);
export const extend   = (msg) => log("extend", msg);
export const system   = (msg) => log("system", msg);
export const warn     = (msg) => log("warn", msg);
export const error    = (msg) => log("error", msg);
export const ok       = (msg) => log("ok", msg);
