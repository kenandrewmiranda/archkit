// Parse .arch/BOUNDARIES.md for machine-enforceable BAN directives.
//
// arch-poly dogfood: BOUNDARIES.md is the most valuable .arch/ artifact but
// has zero enforcement — purely "Claude reads and complies." A `BAN: src ->
// target` directive lets boundary-check grep staged diffs for violations.
//
// Supported formats inside BOUNDARIES.md:
//
//   - BAN: copilot/* -> execution/*
//   - NEVER call X. (BAN: copilot/* -> execution/*)
//   - BAN: domain/* -> infrastructure/*
//
// Both -> and the unicode arrow are accepted.
// Globs: `prefix/*` matches a path starting with `prefix/`. `*` is single-
// segment wildcard. More complex syntax produces a parse warning.

const BAN_RE = /\bBAN\s*:\s*([^\s→\->]+)\s*(?:→|->)\s*([^\s)]+)/g;

export function parseBoundaries(content) {
  const rules = [];
  const warnings = [];
  if (!content) return { rules, warnings };

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = [...line.matchAll(BAN_RE)];
    for (const m of matches) {
      const source = m[1].trim();
      const target = m[2].trim();
      const sourceRe = globToRegex(source);
      const targetRe = globToRegex(target);
      if (!sourceRe || !targetRe) {
        warnings.push({
          line: i + 1,
          message: `unsupported glob in BAN directive: ${source} -> ${target}`,
        });
        continue;
      }
      rules.push({
        source,
        target,
        sourceRe,
        targetRe,
        line: i + 1,
        raw: line.trim(),
      });
    }
  }
  return { rules, warnings };
}

// Tiny glob -> regex.
//   `*`        — single-segment wildcard (does not cross /)
//   trailing `/*` — special: matches the prefix OR anything beneath it,
//                   so `bot/execution/*` matches both `bot/execution` and
//                   `bot/execution/broker/sub`.
// Returns null on unsupported syntax.
function globToRegex(glob) {
  if (/[\[\]{}?!]/.test(glob)) return null;
  let s = glob;
  const trailingStar = s.endsWith("/*");
  if (trailingStar) s = s.slice(0, -2);
  const escaped = s
    .split("*")
    .map((part) => part.replace(/[.+^$()|\\]/g, "\\$&"))
    .join("[^/]*");
  const suffix = trailingStar ? "(?:/.*)?" : "";
  return new RegExp(`^${escaped}${suffix}`);
}

// Normalize an imported module string into a path-like form so a single
// `targetRe` matches across language conventions.
//   "bot.execution.broker" -> "bot/execution/broker"
//   "./util/foo"           -> "util/foo"
//   "../execution/broker"  -> "execution/broker"
//   "@app/copilot/x"       -> "app/copilot/x"
export function normalizeImport(spec) {
  if (!spec) return "";
  let s = String(spec).trim();
  s = s.replace(/^@/, "");
  s = s.replace(/^\.\.?\//, "");
  s = s.replace(/^\.+/, "");
  if (!s.includes("/") && s.includes(".")) {
    s = s.replace(/\./g, "/");
  }
  return s;
}
