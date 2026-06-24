// Compile .arch/ into AGENTS.md — the canonical, cross-tool orientation core.
//
// AGENTS.md is the single compiled target (the agents.md cross-tool standard):
// a compact INTENT + BOUNDARIES + ROUTING digest that is meant to stay resident
// in an agent's context on every request. Every editor-specific export
// (.cursorrules, .windsurfrules, copilot-instructions.md, .aider-conventions.md)
// is DERIVED from this one artifact via `deriveDownstream` rather than emitted in
// parallel — so there is exactly one source of orientation truth and the editor
// files are thin, tool-shaped wrappers around it.
//
// Pure library (src/lib/): no filesystem writes, no logging. Callers in
// src/commands/ read .arch/ and write the returned strings.

import { loadFile, parseSystem, parseIndex } from "./parsers.mjs";
import { estimateTokens } from "./tokens.mjs";

// Orientation-core token ceiling. AGENTS.md is always-resident context, so it
// must stay lean. Enforced by `archkit stats` (analyzeAgents) and asserted by
// tests/agents-export. ~4 chars/token heuristic (see tokens.mjs).
export const AGENTS_MD_TOKEN_CEILING = 2000;

export const AGENTS_MD_FILE = "AGENTS.md";

// Downstream editor formats, each derived FROM the compiled AGENTS.md.
export const DOWNSTREAM_FORMATS = {
  cursor: { file: ".cursorrules", tool: "Cursor" },
  windsurf: { file: ".windsurfrules", tool: "Windsurf" },
  copilot: { file: ".github/copilot-instructions.md", tool: "GitHub Copilot" },
  aider: { file: ".aider-conventions.md", tool: "Aider" },
};

// ── Canonical compile ───────────────────────────────────────────────

/**
 * Compile the canonical AGENTS.md orientation core from .arch/.
 *
 * Sections: Intent (what + pattern/stack), Boundaries (rules + reserved words +
 * BAN directives), Routing (keywords → nodes → files + cross-refs). Kept compact
 * to stay under AGENTS_MD_TOKEN_CEILING.
 *
 * @param {object} opts
 * @param {string} opts.archDir   resolved .arch/ directory
 * @param {object} [opts.system]  pre-parsed SYSTEM.md (parseSystem result); read if absent
 * @returns {string} AGENTS.md content
 */
export function compileAgentsMd({ archDir, system } = {}) {
  const sys = system || parseSystem(loadFile(archDir, "SYSTEM.md"));
  const index = parseIndex(loadFile(archDir, "INDEX.md"));
  const summary = extractSummary(loadFile(archDir, "SYSTEM.md"));
  const banDirectives = extractBans(loadFile(archDir, "BOUNDARIES.md"));

  const out = [];
  out.push(`# AGENTS.md`);
  out.push("");
  out.push(`> Canonical orientation core compiled by archkit — the cross-tool agents.md standard.`);
  out.push(`> Generated; do not edit by hand. Edit \`.arch/\` and re-run \`archkit export agents\`.`);
  out.push("");

  // ── Intent ──
  out.push(`## Intent`);
  if (summary) out.push(summary.trim());
  const facets = [];
  if (sys.pattern) facets.push(`Pattern: ${sys.pattern}`);
  if (sys.type) facets.push(`Type: ${sys.type}`);
  if (sys.stack) facets.push(`Stack: ${sys.stack}`);
  if (facets.length) {
    out.push("");
    out.push(facets.join(" | "));
  }
  out.push("");

  // ── Boundaries ──
  out.push(`## Boundaries`);
  if (sys.rules.length) {
    sys.rules.forEach(r => out.push(`- ${r}`));
  }
  const rw = Object.entries(sys.reservedWords);
  if (rw.length) {
    out.push(`- Reserved words: ${rw.map(([k, v]) => `${k} (${v.split(/\s+[—(]/)[0].trim()})`).join("; ")}`);
  }
  banDirectives.forEach(b => out.push(`- ${b}`));
  out.push("");

  // ── Routing ──
  out.push(`## Routing`);
  const nodes = Object.keys(index.nodeCluster);
  if (nodes.length) {
    for (const node of nodes) {
      const { basePath } = index.nodeCluster[node];
      const keywords = Object.entries(index.keywordNodes)
        .filter(([, n]) => n === `@${node}` || n === node)
        .map(([k]) => k);
      const kw = keywords.length ? ` — ${keywords.slice(0, 6).join(", ")}` : "";
      out.push(`- @${node} → ${basePath}${kw}`);
    }
  }
  if (index.crossRefs.length) {
    out.push(`- Edges: ${index.crossRefs.map(c => `@${c.from}→@${c.to}`).join(", ")}`);
  }
  out.push("");

  return out.join("\n");
}

/**
 * Token + ceiling report for a compiled AGENTS.md string.
 * @returns {{ tokens:number, ceiling:number, withinCeiling:boolean, overBy:number }}
 */
export function agentsTokenReport(content) {
  const tokens = estimateTokens(content || "");
  const withinCeiling = tokens <= AGENTS_MD_TOKEN_CEILING;
  return {
    tokens,
    ceiling: AGENTS_MD_TOKEN_CEILING,
    withinCeiling,
    overBy: withinCeiling ? 0 : tokens - AGENTS_MD_TOKEN_CEILING,
  };
}

// ── Downstream derivation ───────────────────────────────────────────

/**
 * Derive an editor-specific export FROM the compiled AGENTS.md content.
 *
 * The downstream file is the SAME orientation core with a thin, tool-shaped
 * header — never an independently-assembled artifact. This is what makes the
 * editor exports "derived from AGENTS.md rather than emitted in parallel".
 *
 * @param {string} agentsMd  output of compileAgentsMd
 * @param {string} format    one of DOWNSTREAM_FORMATS keys
 * @returns {{ file:string, content:string }}
 */
export function deriveDownstream(agentsMd, format) {
  const spec = DOWNSTREAM_FORMATS[format];
  if (!spec) throw new Error(`Unknown downstream format: ${format}`);

  // Strip the AGENTS.md H1 so the derived file leads with its own tool header,
  // but otherwise carries the canonical body verbatim.
  const body = agentsMd.replace(/^# AGENTS\.md\n?/, "").trimStart();

  const header =
    `# ${spec.tool} instructions\n` +
    `> Derived by archkit from AGENTS.md — the canonical orientation core. Do not edit; edit .arch/ and re-run \`archkit export ${format}\`.\n\n`;

  return { file: spec.file, content: header + body };
}

// ── Helpers ─────────────────────────────────────────────────────────

// Pull the prose under "## Summary" out of SYSTEM.md (stops at next "## ").
function extractSummary(content) {
  if (!content) return "";
  const lines = content.split("\n");
  let inSummary = false;
  const buf = [];
  for (const line of lines) {
    if (line.startsWith("## Summary")) { inSummary = true; continue; }
    if (inSummary && line.startsWith("## ")) break;
    if (inSummary) buf.push(line);
  }
  return buf.join("\n").trim();
}

// Pull "(BAN: ... )" machine-enforceable directives out of BOUNDARIES.md.
function extractBans(content) {
  if (!content) return [];
  const bans = [];
  const re = /\(BAN:\s*([^)]+)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    bans.push(`BAN: ${m[1].trim()}`);
  }
  return bans;
}
