// Read-side for ADRs (the write side is src/commands/decisions.mjs).
//
// archkit_log_decision writes one ADR per file at .arch/decisions/NNNN-slug.md
// (format from renderAdr: `# N. Title`, `- **Date/Status/Tags**:`, then
// `## Context / ## Decision / ## Consequences`). Nothing read them back until
// now — this closes archkit's institutional-memory loop so past decisions can
// resurface (via archkit_decisions_search and inside archkit_resolve_preflight)
// instead of being re-litigated after a context reset.

import fs from "node:fs";
import path from "node:path";

export function decisionsDir(archDir) {
  return path.join(archDir, "decisions");
}

function oneLine(text, max = 200) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// Split an ADR body into its `## Section` → text map.
function parseSections(content) {
  const heads = [];
  for (const m of content.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)) {
    heads.push({ name: m[1].trim().toLowerCase(), matchStart: m.index, bodyStart: m.index + m[0].length });
  }
  const out = {};
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].matchStart : content.length;
    out[heads[i].name] = content.slice(heads[i].bodyStart, end).trim();
  }
  return out;
}

export function parseAdr(content, { filename } = {}) {
  let number = null;
  let title = null;
  const h1 = content.match(/^#\s+(\d+)\.\s+(.+)$/m);
  if (h1) { number = h1[1]; title = h1[2].trim(); }
  if (!number && filename) {
    const fm = filename.match(/^(\d+)-(.+)\.md$/);
    if (fm) { number = fm[1]; if (!title) title = fm[2].replace(/-/g, " "); }
  }

  const field = (label) => {
    const m = content.match(new RegExp(`^[-*]\\s*\\*\\*${label}\\*\\*:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const tagsRaw = field("Tags");
  const sections = parseSections(content);

  return {
    number,
    title: title || (filename ? filename.replace(/\.md$/, "") : "untitled"),
    date: field("Date"),
    status: (field("Status") || "").toLowerCase() || null,
    tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
    context: sections.context || "",
    decision: sections.decision || "",
    consequences: sections.consequences || "",
  };
}

// All ADRs, most-recent (highest number) first. Skips the proposed/ subdir
// (auto-drafted ADR proposals live there as .json, not top-level .md).
export function listDecisions(archDir) {
  const dir = decisionsDir(archDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const filepath = path.join(dir, name);
    try {
      if (!fs.statSync(filepath).isFile()) continue;
      const adr = parseAdr(fs.readFileSync(filepath, "utf8"), { filename: name });
      out.push({ ...adr, filename: name, filepath, relativePath: path.relative(process.cwd(), filepath) });
    } catch { /* skip unreadable/malformed */ }
  }
  out.sort((a, b) => (parseInt(b.number || "0", 10)) - (parseInt(a.number || "0", 10)));
  return out;
}

// Keyword-rank ADRs (title/tags weighted over body). No query → recent list.
// Optional status + tags filters.
export function searchDecisions(archDir, { query = "", status, tags, limit = 10 } = {}) {
  let all = listDecisions(archDir);
  if (status) all = all.filter((d) => (d.status || "").toLowerCase() === String(status).toLowerCase());
  if (Array.isArray(tags) && tags.length) {
    const want = tags.map((t) => t.toLowerCase());
    all = all.filter((d) => d.tags.some((t) => want.includes(t.toLowerCase())));
  }

  const q = String(query || "").trim().toLowerCase();
  if (!q) return all.slice(0, limit).map((d) => ({ ...d, summary: oneLine(d.decision), score: null }));

  const terms = q.split(/\s+/).filter(Boolean);
  return all
    .map((d) => {
      const title = (d.title || "").toLowerCase();
      const tagStr = d.tags.join(" ").toLowerCase();
      const body = `${d.decision} ${d.context} ${d.consequences}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 5;
        if (tagStr.includes(term)) score += 4;
        if (body.includes(term)) score += 1;
      }
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (parseInt(b.d.number || "0", 10) - parseInt(a.d.number || "0", 10)))
    .slice(0, limit)
    .map((x) => ({ ...x.d, summary: oneLine(x.d.decision), score: x.score }));
}
