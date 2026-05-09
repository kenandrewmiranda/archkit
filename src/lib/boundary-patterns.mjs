// Boundary-violation pattern library for the v1.6 Stop hook.
//
// Each pattern detects one of the universal NEVER rules from
// src/data/boundaries.mjs in assistant response text (including code blocks
// inside markdown). Calibrated for HIGH PRECISION (>90%) — false positives
// here ("you violated rule X" when the agent didn't) destroy trust in the
// entire boundary system fast.
//
// v1.6.0 ships three patterns. The remaining universals (plain-text passwords,
// stack-traces-to-client, HTTP-without-timeout) need cross-line semantic
// analysis or are too framework-dependent to pattern-match precisely. They
// land as v1.6.x patches once real-world data informs calibration.

const PROVIDER_KEY_PREFIXES = [
  // OpenAI / Anthropic style
  { regex: /\bsk-[a-zA-Z0-9_\-]{20,}\b/g, label: "OpenAI/Anthropic-style key" },
  // AWS access key
  { regex: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS access key" },
  // GitHub PAT
  { regex: /\bghp_[a-zA-Z0-9]{30,}\b/g, label: "GitHub PAT" },
  // Google API key
  { regex: /\bAIza[a-zA-Z0-9_\-]{30,}\b/g, label: "Google API key" },
  // npm token
  { regex: /\bnpm_[a-zA-Z0-9]{30,}\b/g, label: "npm token" },
];

const VALIDATOR_HINTS = /\b(?:z\.|Zod|safeParse|\.parse\(|validate\(|joi\.|yup\.|valibot|ajv|express-validator|class-validator)\b/;

// Markers that the snippet is illustrative / placeholder rather than a real
// secret. We keep the list short and obvious — if these appear inside the
// matched key, suppress.
const PLACEHOLDER_MARKERS = /(?:your[-_]|example|placeholder|xxxx|<\w|\.\.\.)/i;

function lineFor(text, idx) {
  return text.slice(0, idx).split("\n").length;
}

function snippetFor(text, idx, len, radius = 60) {
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + len + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const PATTERNS = [
  {
    name: "sql_string_concat",
    ruleId: "U-001",
    ruleText: "NEVER use string concatenation for SQL queries. Use parameterized queries.",
    detect(text) {
      // SQL keyword (case-insensitive), then within ~80 chars: a closing quote
      // followed by + operator + identifier — classic concat injection shape.
      const re = /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b[^\n;]{0,80}["'`]\s*\+\s*[a-zA-Z_$][\w$]*/gi;
      const out = [];
      for (const m of text.matchAll(re)) {
        out.push({
          idx: m.index,
          line: lineFor(text, m.index),
          matchedText: m[0].slice(0, 100),
          snippet: snippetFor(text, m.index, m[0].length),
        });
      }
      return out;
    },
  },
  {
    name: "hardcoded_credential",
    ruleId: "U-002",
    ruleText: "NEVER commit secrets, API keys, or credentials to code. Use environment variables.",
    detect(text) {
      const out = [];
      for (const { regex, label } of PROVIDER_KEY_PREFIXES) {
        for (const m of text.matchAll(regex)) {
          if (PLACEHOLDER_MARKERS.test(m[0])) continue;
          out.push({
            idx: m.index,
            line: lineFor(text, m.index),
            matchedText: m[0].slice(0, 12) + "…",
            snippet: snippetFor(text, m.index, m[0].length),
            label,
          });
        }
      }
      return out;
    },
  },
  {
    name: "unvalidated_input",
    ruleId: "U-005",
    ruleText: "NEVER trust client-side input. Validate at the API boundary.",
    detect(text) {
      // req.(body|query|params).x in code with no validator hint within ~250
      // chars on either side. Window must be small enough that "validation
      // happens elsewhere in the file" doesn't suppress legitimate flags,
      // but large enough that a parse() call near the use site does.
      const re = /\breq\.(?:body|query|params)\b/g;
      const out = [];
      for (const m of text.matchAll(re)) {
        const idx = m.index;
        const start = Math.max(0, idx - 250);
        const end = Math.min(text.length, idx + 250);
        const window = text.slice(start, end);
        if (VALIDATOR_HINTS.test(window)) continue;
        out.push({
          idx,
          line: lineFor(text, idx),
          matchedText: m[0],
          snippet: snippetFor(text, idx, m[0].length),
        });
      }
      return out;
    },
  },
];

export function detectViolations(text) {
  if (!text || typeof text !== "string") return [];
  const all = [];
  for (const p of PATTERNS) {
    for (const v of p.detect(text)) {
      all.push({
        patternName: p.name,
        ruleId: p.ruleId,
        ruleText: p.ruleText,
        ...v,
      });
    }
  }
  // Stable sort by file position so output reads top-to-bottom.
  all.sort((a, b) => a.idx - b.idx);
  return all;
}

// Compact one-liner per violation for hook additionalContext.
export function formatViolation(v) {
  return `BOUNDARY VIOLATION (${v.ruleId}) at line ${v.line}: ${v.ruleText} — matched ${JSON.stringify(v.matchedText)}.`;
}

export const _internals = { PATTERNS, PROVIDER_KEY_PREFIXES, VALIDATOR_HINTS, PLACEHOLDER_MARKERS };
