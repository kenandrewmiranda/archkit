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

export function completeGoal(archDir, slug, { notes = "" } = {}) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  ensureGoalsLayout(archDir);
  goal.meta.status = "done";
  goal.meta["completed"] = new Date().toISOString().slice(0, 10);
  if (notes) goal.meta["completion-notes"] = notes;
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
