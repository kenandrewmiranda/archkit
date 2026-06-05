// CGR (Clear Goal Run) artifact library.
//
// Workflow: in a fresh session, the user types a sprawling ask. The agent
// digests it (with help from warmup + INDEX context), produces a structured
// decomposition, and calls archkit_goal_intake — which writes one
// .arch/goals/<slug>.md per goal and returns a tight, copy-pasteable payload
// (<=3800 chars) per goal that the user pastes after `/goal` in a fresh,
// /clear'ed session.
//
// Storage layout:
//   .arch/goals/<slug>.md              — active or planned goals
//   .arch/goals/done/<slug>.md         — completed goals (kept for history)
//
// Goal-file format: simple key:value frontmatter (we don't take a YAML dep)
// followed by free-form markdown body.

import fs from "node:fs";
import path from "node:path";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
// Per Claude Code's slash-command argument limit. Empirically users wanted
// "fits on a screen, quick to paste"; 3800 leaves slack for inline edits.
export const PAYLOAD_BUDGET = 3800;

export function goalsDir(archDir) {
  return path.join(archDir, "goals");
}
export function doneDir(archDir) {
  return path.join(goalsDir(archDir), "done");
}

export function proposedDir(archDir) {
  return path.join(goalsDir(archDir), "proposed");
}

export function ensureGoalsLayout(archDir) {
  fs.mkdirSync(doneDir(archDir), { recursive: true });
}

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "goal";
}

export function parseGoal(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      // Bare inline list — for arrays we prefer block form (handled below)
      meta[key] = raw.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      meta[key] = raw;
    }
  }
  // Block-style arrays: lines like `- item` immediately after a `key:` line.
  // Buffer items per key and only promote the scalar to an array when at
  // least one item is found — otherwise an empty `key:` line wrongly
  // overwrites the scalar parsed above with [] and downstream `.trim()` /
  // string-coercion crashes (caught by tests/silent-success-audit).
  const lines = m[1].split("\n");
  let currentKey = null;
  let buffer = [];
  const flush = () => {
    if (currentKey && buffer.length > 0) meta[currentKey] = buffer;
    currentKey = null;
    buffer = [];
  };
  for (const line of lines) {
    const keyMatch = line.match(/^(\w[\w-]*):\s*$/);
    if (keyMatch) { flush(); currentKey = keyMatch[1]; continue; }
    if (currentKey && line.match(/^\s*-\s+/)) {
      const item = line.replace(/^\s*-\s+/, "").trim();
      if (item) buffer.push(item);
    } else if (currentKey && !line.startsWith(" ")) {
      flush();
    }
  }
  flush();
  return { meta, body: m[2] };
}

function emitFrontmatter(meta) {
  const lines = [];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else if (v != null) {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join("\n");
}

export function writeGoal(archDir, goal) {
  ensureGoalsLayout(archDir);
  const slug = goal.slug || slugify(goal.title);
  const filepath = path.join(goalsDir(archDir), `${slug}.md`);
  const meta = {
    slug,
    title: goal.title || slug,
    status: goal.status || "planned",
    created: goal.created || new Date().toISOString().slice(0, 10),
    "exit-criteria": goal.exitCriteria || [],
    "files-to-touch": goal.filesToTouch || [],
    "required-reading": goal.requiredReading || [],
    "depends-on": goal.dependsOn || [],
    "verify-command": goal.verifyCommand || "",
    "source-ask": goal.sourceAsk || "",
  };
  const body = goal.body || defaultBody(goal);
  const content = `---\n${emitFrontmatter(meta)}\n---\n\n${body}\n`;
  fs.writeFileSync(filepath, content);
  return { slug, filepath };
}

function defaultBody(goal) {
  const lines = [];
  lines.push(`# ${goal.title || goal.slug}`);
  lines.push("");
  if (goal.why) {
    lines.push("## Why");
    lines.push(goal.why);
    lines.push("");
  }
  if (goal.exitCriteria && goal.exitCriteria.length > 0) {
    lines.push("## Exit criteria");
    for (const c of goal.exitCriteria) lines.push(`- [ ] ${c}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function listGoals(archDir) {
  const dir = goalsDir(archDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const filepath = path.join(dir, name);
    try {
      const { meta } = parseGoal(fs.readFileSync(filepath, "utf8"));
      out.push({ slug: meta.slug || name.replace(/\.md$/, ""), filepath, meta });
    } catch {}
  }
  return out;
}

export function loadGoal(archDir, slug) {
  const filepath = path.join(goalsDir(archDir), `${slug}.md`);
  if (!fs.existsSync(filepath)) return null;
  return { ...parseGoal(fs.readFileSync(filepath, "utf8")), filepath, slug };
}

export function completeGoal(archDir, slug, { notes = "", extraMeta = {} } = {}) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  ensureGoalsLayout(archDir);
  goal.meta.status = "done";
  goal.meta["completed"] = new Date().toISOString().slice(0, 10);
  if (notes) goal.meta["completion-notes"] = notes;
  // Stamp objective completion evidence (e.g. tests-passed/-command/-at) so the
  // archived goal records HOW it was verified, not just that it was claimed done.
  for (const [k, v] of Object.entries(extraMeta)) {
    if (v != null && v !== "") goal.meta[k] = v;
  }
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  const targetPath = path.join(doneDir(archDir), `${slug}.md`);
  fs.writeFileSync(targetPath, out);
  fs.rmSync(goal.filepath, { force: true });
  return { slug, archivedAt: targetPath };
}

// Render a tight, copy-pasteable payload for the user to paste after `/goal`
// in a fresh /clear'ed session. Stays under PAYLOAD_BUDGET — the full goal
// context lives on disk; the payload just points to it.
export function renderPayload(archDir, slug) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  const m = goal.meta;
  const required = ensureArray(m["required-reading"]);
  const exitCriteria = ensureArray(m["exit-criteria"]);
  const filesToTouch = ensureArray(m["files-to-touch"]);
  const verifyCommand = typeof m["verify-command"] === "string" ? m["verify-command"].trim() : "";

  const lines = [];
  lines.push(`ARCHKIT GOAL: ${slug}`);
  lines.push(`Title: ${m.title || slug}`);
  lines.push("");
  lines.push(`Read first:`);
  lines.push(`- .arch/goals/${slug}.md`);
  for (const r of required) lines.push(`- ${r}`);
  lines.push("");
  lines.push(`Then run: archkit resolve warmup`);
  lines.push("");
  if (exitCriteria.length > 0) {
    lines.push(`Work until ALL exit-criteria are met:`);
    exitCriteria.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    lines.push("");
  }
  if (filesToTouch.length > 0 && filesToTouch.length <= 8) {
    lines.push(`Likely files to touch:`);
    for (const f of filesToTouch) lines.push(`- ${f}`);
    lines.push("");
  }
  if (verifyCommand) {
    lines.push(`Test gate: \`${verifyCommand}\` must pass — goal complete will run it and refuse on red.`);
    lines.push("");
  }
  lines.push(`When done: archkit goal complete ${slug}`);
  const ask = (m["source-ask"] || "").trim();
  if (ask) {
    lines.push("");
    lines.push(`Source ask: ${ask.slice(0, 240)}${ask.length > 240 ? "…" : ""}`);
  }

  let payload = lines.join("\n");
  if (payload.length > PAYLOAD_BUDGET) {
    // Trim source-ask and files-to-touch first — they're least load-bearing.
    payload = payload.slice(0, PAYLOAD_BUDGET - 4) + "\n...";
  }
  return { payload, length: payload.length, withinBudget: payload.length <= PAYLOAD_BUDGET };
}

function ensureArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) return [v];
  return [];
}

// ───────────────────────────────────────────────────────────────────────────
// CGR fresh-context relay loop (prototype, proto/cgr-relay-loop)
//
// The base CGR flow tracks status: planned | done. The relay loop adds an
// "in-progress" state so a goal-aware Stop hook knows which goal's
// exit-criteria to guard, and the /mcp__archkit__goal_next prompt can advance
// the queue without copy-paste.
// ───────────────────────────────────────────────────────────────────────────

const STATUS_DONE = "done";
const STATUS_ACTIVE = "in-progress";

export function isGoalDone(archDir, slug) {
  return fs.existsSync(path.join(doneDir(archDir), `${slug}.md`));
}

export function statusOf(goal) {
  return (goal?.meta?.status || "planned");
}

export function exitCriteriaOf(goal) {
  return ensureArray(goal?.meta?.["exit-criteria"]);
}

export function verifyCommandOf(goal) {
  const v = goal?.meta?.["verify-command"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// The single in-progress goal, or null. In fresh-context relay there should be
// at most one; if several exist we return the first by listGoals order.
export function getActiveGoal(archDir) {
  return listGoals(archDir).find((g) => statusOf(g) === STATUS_ACTIVE) || null;
}

// Mark a goal in-progress — the relay "start" transition. Idempotent.
// Clears any stale turn-cap counter so the guard starts fresh for this goal.
export function startGoal(archDir, slug) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  goal.meta.status = STATUS_ACTIVE;
  if (!goal.meta.started) goal.meta.started = new Date().toISOString().slice(0, 10);
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  fs.writeFileSync(goal.filepath, out);
  const state = readLoopState(archDir);
  if (state[slug]) { delete state[slug]; writeLoopState(archDir, state); }
  return { slug, status: STATUS_ACTIVE };
}

// Next goal to hand to the agent: prefer an already in-progress goal (resume),
// else the first planned goal whose depends-on are all complete.
export function nextEligibleGoal(archDir) {
  const goals = listGoals(archDir);
  const active = goals.find((g) => statusOf(g) === STATUS_ACTIVE);
  if (active) return active;
  for (const g of goals) {
    if (statusOf(g) === STATUS_DONE) continue;
    const deps = ensureArray(g.meta["depends-on"]);
    const blocked = deps.some((d) => !isGoalDone(archDir, d));
    if (!blocked) return g;
  }
  return null;
}

// ── Turn-cap state for the goal-aware Stop hook ──
// Counts how many consecutive turns the hook has blocked the active goal, so a
// stuck loop releases instead of trapping the agent forever (mirrors /goal's
// optional turn bound). Stored beside the goals; .json is skipped by listGoals.
function loopStatePath(archDir) {
  return path.join(goalsDir(archDir), ".loop-state.json");
}
export function readLoopState(archDir) {
  try { return JSON.parse(fs.readFileSync(loopStatePath(archDir), "utf8")); }
  catch { return {}; }
}
function writeLoopState(archDir, state) {
  ensureGoalsLayout(archDir);
  fs.writeFileSync(loopStatePath(archDir), JSON.stringify(state, null, 2));
}
export function bumpLoopBlock(archDir, slug) {
  const state = readLoopState(archDir);
  state[slug] = (state[slug] || 0) + 1;
  writeLoopState(archDir, state);
  return state[slug];
}
export function resetLoopState(archDir) {
  try { fs.rmSync(loopStatePath(archDir), { force: true }); } catch { /* ignore */ }
}

// Drop a goal without marking it done — archived to done/ with status
// "abandoned" (kept for history, distinguishable from completed). Releases the
// relay guard by clearing the active goal + its turn-cap counter.
export function abandonGoal(archDir, slug, { reason = "" } = {}) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  ensureGoalsLayout(archDir);
  goal.meta.status = "abandoned";
  goal.meta["abandoned"] = new Date().toISOString().slice(0, 10);
  if (reason) goal.meta["abandon-reason"] = reason;
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  const targetPath = path.join(doneDir(archDir), `${slug}.md`);
  fs.writeFileSync(targetPath, out);
  fs.rmSync(goal.filepath, { force: true });
  const state = readLoopState(archDir);
  if (state[slug]) { delete state[slug]; writeLoopState(archDir, state); }
  return { slug, archivedAt: targetPath, status: "abandoned" };
}

// ───────────────────────────────────────────────────────────────────────────
// Deferred-goal proposals (v1.9)
//
// Follow-up work surfaced during a session — by the Stop-hook detector or an
// explicit archkit_goal_defer call — lands in .arch/goals/proposed/<hash>.json
// (NOT written as a real goal). A later session reviews them via
// /mcp__archkit__goal_review and promotes the chosen ones into planned goals.
// Mirrors the decisions/ proposal flow: propose → human confirm → promote.
// ───────────────────────────────────────────────────────────────────────────

export function ensureProposedDir(archDir) {
  const dir = proposedDir(archDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Write a proposal. Skips if a file with the same hash already exists
// (cross-turn dedup). Returns true if newly written.
export function writeGoalProposal(archDir, proposal) {
  const dir = ensureProposedDir(archDir);
  const file = path.join(dir, `${proposal.hash}.json`);
  if (fs.existsSync(file)) return false;
  const record = {
    hash: proposal.hash,
    title: proposal.title || proposal.titleHint || "untitled follow-up",
    why: proposal.why || "",
    exitCriteria: Array.isArray(proposal.exitCriteria) ? proposal.exitCriteria : [],
    contextExcerpt: proposal.contextExcerpt || "",
    patternName: proposal.patternName || null,
    source: proposal.source || "unknown",
    createdAt: proposal.createdAt || new Date().toISOString(),
  };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, file);
  return true;
}

export function listGoalProposals(archDir) {
  const dir = proposedDir(archDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))); } catch {}
  }
  return out;
}

export function countGoalProposals(archDir) {
  const dir = proposedDir(archDir);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

export function removeGoalProposal(archDir, hash) {
  const file = path.join(proposedDir(archDir), `${hash}.json`);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

// Promote a proposal into a planned goal and remove the proposal file.
// Returns { slug } or null if the hash isn't a known proposal.
export function promoteGoalProposal(archDir, hash, overrides = {}) {
  const file = path.join(proposedDir(archDir), `${hash}.json`);
  if (!fs.existsSync(file)) return null;
  let p;
  try { p = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  const { slug } = writeGoal(archDir, {
    title: overrides.title || p.title,
    why: overrides.why || p.why || "",
    exitCriteria: overrides.exitCriteria || p.exitCriteria || [],
    verifyCommand: overrides.verifyCommand || "",
    sourceAsk: p.contextExcerpt ? `Deferred during a prior session: ${String(p.contextExcerpt).slice(0, 200)}` : "",
    status: "planned",
  });
  fs.rmSync(file, { force: true });
  return { slug };
}
