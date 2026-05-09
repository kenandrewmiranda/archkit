#!/usr/bin/env node

// UserPromptSubmit hook for Claude Code. Fires before each user prompt is
// processed. THIS IS THE HIGHEST-LEVERAGE HOOK FOR THE V1.6 UTILIZATION GOAL
// (12% → ≥75%): it runs before the agent reasons, so the context it injects
// front-loads relevant archkit conventions before the agent decides whether
// to call archkit_resolve_lookup / preflight on its own.
//
// Two jobs:
//   1. Start a new "task" in session-stats (per-task instrumentation tracking
//      resets here — every prompt = new task window).
//   2. Keyword-match the prompt against .arch/INDEX.md. If ≥2 keywords hit
//      a known feature/skill node, prepend the routing as additionalContext
//      with a specific call-to-action: "Call archkit_resolve_lookup with
//      symbol='<x>' before reading raw .arch/ files or editing code."
//
// Latency budget: <100ms. Fires on every prompt, blocks the agent.
//
// Skip rules:
//   - No .arch/SYSTEM.md → exit 0 silent
//   - No .arch/INDEX.md → start task only, no skill pre-loading
//   - Slash commands (^/) → start task only
//   - Single-keyword match → no pre-loading (low-relevance threshold)
//   - Context cap: ~2000 chars (~500 tokens)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIB = path.resolve(__dirname, "..", "src", "lib");
const { loadOrInit, startTask, save } = await import(path.join(LIB, "session-stats.mjs"));
const { parseIndex } = await import(path.join(LIB, "parsers.mjs"));

const CONTEXT_CAP_CHARS = 2000;
const MIN_KEYWORD_HITS = 2;

// Tokens that hit too commonly to be useful — would over-trigger pre-loading.
const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","to","of","in","on","at","by","for","with","and","or","but","if","then","this","that","these","those","i","you","we","it","do","does","did","can","could","should","would","will","my","your","our","their","what","which","when","where","how","why","let","make","add","update","remove","check","please","help",
]);

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

function tokenize(prompt) {
  return [
    ...new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9_\-\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    ),
  ];
}

// Score keyword index entries against tokens. Returns matches sorted by hits desc.
function matchEntries(keywordMap, tokens, kind) {
  const scores = {};
  for (const [keyword, ref] of Object.entries(keywordMap)) {
    // INDEX may have multi-word keywords joined by commas at the line level;
    // parsers split those into individual entries already. But each remaining
    // entry can still be multi-word (e.g. "auth flow"). Match each word.
    const kwTokens = keyword.split(/\s+/).filter(Boolean);
    let hits = 0;
    for (const kw of kwTokens) if (tokens.includes(kw)) hits += 1;
    if (hits === 0) continue;
    if (!scores[ref]) scores[ref] = { ref, kind, hits: 0, keywords: [] };
    scores[ref].hits += hits;
    scores[ref].keywords.push(keyword);
  }
  return Object.values(scores).sort((a, b) => b.hits - a.hits);
}

function buildPreloadContext(matches) {
  const nodes = matches.filter((m) => m.kind === "feature").slice(0, 5);
  const skills = matches.filter((m) => m.kind === "skill").slice(0, 5);

  const sections = [];
  if (nodes.length) {
    const list = nodes.map((n) => `${n.ref} (matched: ${n.keywords.slice(0, 3).join(", ")})`).join("\n  • ");
    sections.push(
      `archkit-INDEX matched ${nodes.length} feature node${nodes.length === 1 ? "" : "s"} for this prompt:\n  • ${list}\n\nBefore editing code or reading raw .arch/*.md, call archkit_resolve_lookup with the matched symbol. That instruments this task as "consulted archkit before acting" — the v1.6 utilization metric (target ≥75%) tracks this.`
    );
  }
  if (skills.length) {
    const list = skills.map((s) => `${s.ref} (matched: ${s.keywords.slice(0, 3).join(", ")})`).join("\n  • ");
    sections.push(`Relevant skills for this prompt:\n  • ${list}\n\nIf you're about to do something this skill covers, read .arch/skills/<skill>.skill before acting.`);
  }
  let out = sections.join("\n\n");
  if (out.length > CONTEXT_CAP_CHARS) out = out.slice(0, CONTEXT_CAP_CHARS - 1) + "…";
  return out;
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let event = {};
  try { event = JSON.parse(raw); } catch { /* ignore */ }

  const cwd = event.cwd || process.cwd();
  const archDir = findArchDir(cwd);
  if (!archDir) process.exit(0);

  const sessionId = event.session_id;
  const prompt = event.prompt || "";

  // Job 1: start a new task window (best-effort).
  if (sessionId) {
    try {
      const stats = loadOrInit(sessionId);
      startTask(stats, prompt);
      save(stats);
    } catch { /* ignore */ }
  }

  // Job 2: skill / node pre-loading.
  if (!prompt || prompt.startsWith("/")) process.exit(0);

  const indexPath = path.join(archDir, "INDEX.md");
  if (!fs.existsSync(indexPath)) process.exit(0);

  let parsed;
  try {
    parsed = parseIndex(fs.readFileSync(indexPath, "utf8"));
  } catch {
    process.exit(0);
  }

  const tokens = tokenize(prompt);
  if (!tokens.length) process.exit(0);

  const nodeMatches = matchEntries(parsed.keywordNodes || {}, tokens, "feature");
  const skillMatches = matchEntries(parsed.keywordSkills || {}, tokens, "skill");
  const all = [...nodeMatches, ...skillMatches].filter((m) => m.hits >= MIN_KEYWORD_HITS);

  if (!all.length) process.exit(0);

  const additionalContext = buildPreloadContext(all);
  if (!additionalContext) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  }));
  process.exit(0);
}

main().catch(() => process.exit(0));
