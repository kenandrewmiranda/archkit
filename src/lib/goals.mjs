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
//   .arch/goals/testing/<slug>.md      — edits applied, verification pending
//   .arch/goals/done/<slug>.md         — completed goals (kept for history)
//
// Goal-file format: simple key:value frontmatter (we don't take a YAML dep)
// followed by free-form markdown body.

import fs from "node:fs";
import path from "node:path";
import { createArchReader, loadGraphCluster } from "./parsers.mjs";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
// Copy-paste ceiling: the `archkit goal payload` / `/goal` fallback path pastes
// the payload as a slash-command argument, which Claude Code caps. 3800 leaves
// slack for inline edits. Still the default for renderPayload.
export const PAYLOAD_BUDGET = 3800;

// Relay ceiling: the /mcp__archkit__goal_next prompt injects the payload as an
// MCP message directly into the conversation — no slash-command arg limit binds
// it, so the relay path (now the primary workflow) can carry a fuller graph
// slice + untruncated exit-criteria/source-ask. Kept finite so an injected goal
// stays a compact pointer-into-.arch/, not a context dump.
export const RELAY_PAYLOAD_BUDGET = 9000;

export function goalsDir(archDir) {
  return path.join(archDir, "goals");
}
export function doneDir(archDir) {
  return path.join(goalsDir(archDir), "done");
}

// The ONE loud dedicated per-state folder (see ADR 0003). A goal in `testing`
// has its edits applied but verification still pending — it lives here so a
// fresh session can SEE and drain the verification debt instead of it hiding in
// done/. Every other state stays in goals/ root and is distinguished by its
// `status:` field (status is the source of truth, not the folder).
export function testingDir(archDir) {
  return path.join(goalsDir(archDir), "testing");
}

export function proposedDir(archDir) {
  return path.join(goalsDir(archDir), "proposed");
}

export function ensureGoalsLayout(archDir) {
  fs.mkdirSync(doneDir(archDir), { recursive: true });
  fs.mkdirSync(testingDir(archDir), { recursive: true });
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
    status: goal.status || STATUS_PENDING,
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

// Active goals are the flat .md files in goals/ root PLUS the verification-debt
// files in goals/testing/. Subdirs (done/, proposed/, archive/, digest/) hold
// terminal/proposal artifacts and are skipped — only testing/ contributes live
// goals, so a goal awaiting verification stays in the queue.
export function listGoals(archDir) {
  const out = [];
  for (const dir of [goalsDir(archDir), testingDir(archDir)]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const filepath = path.join(dir, name);
      try {
        if (!fs.statSync(filepath).isFile()) continue;
        const { meta } = parseGoal(fs.readFileSync(filepath, "utf8"));
        out.push({ slug: meta.slug || name.replace(/\.md$/, ""), filepath, meta });
      } catch {}
    }
  }
  return out;
}

// Resolve a goal by slug across both live locations: goals/ root and
// goals/testing/. Terminal goals (done/, archive/) are intentionally NOT
// resolved here — loadGoal is the handle the relay uses to act on live work.
export function loadGoal(archDir, slug) {
  for (const dir of [goalsDir(archDir), testingDir(archDir)]) {
    const filepath = path.join(dir, `${slug}.md`);
    if (fs.existsSync(filepath)) {
      return { ...parseGoal(fs.readFileSync(filepath, "utf8")), filepath, slug };
    }
  }
  return null;
}

export function completeGoal(archDir, slug, { notes = "", extraMeta = {} } = {}) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  ensureGoalsLayout(archDir);
  goal.meta.status = STATUS_COMPLETED;
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

// Build a compact graph neighborhood for the files a goal will touch, scoped by
// files-to-touch, so the injected payload hands the agent the related nodes +
// edges up front instead of making it re-derive the whole graph or guess which
// files are connected. Each touched path is matched to its INDEX node by
// basePath prefix; the matching per-file lines from that cluster's .graph (role
// + in/out flow) plus the cross-reference edges touching those clusters are
// returned as ready-to-print lines. Returns [] when no touched file maps onto a
// known node — keeps the common case (edits to already-mapped or non-code paths)
// silent rather than emitting empty scaffolding. Pure read of .arch/; never
// throws on a missing/empty graph.
export function graphSlice(archDir, files) {
  const paths = ensureArray(files).map(f => String(f).trim()).filter(Boolean);
  if (paths.length === 0) return [];

  let nodeCluster, crossRefs;
  try {
    const index = createArchReader(archDir).index();
    nodeCluster = index.nodeCluster || {};
    crossRefs = index.crossRefs || [];
  } catch { return []; }
  if (Object.keys(nodeCluster).length === 0) return [];

  // touched file → INDEX node(s) whose basePath prefixes it. A node's basePath
  // may be a comma-separated list; glob bases (src/features/*) are skipped — we
  // only claim a file when a concrete prefix matches.
  const matched = new Map(); // nodeId -> { cluster, basePath, files:Set }
  for (const file of paths) {
    for (const [nodeId, info] of Object.entries(nodeCluster)) {
      const bases = String(info.basePath || "").split(",").map(s => s.trim()).filter(Boolean);
      if (bases.some(b => !b.includes("*") && file.startsWith(b))) {
        const entry = matched.get(nodeId) || { cluster: info.cluster, basePath: info.basePath, files: new Set() };
        entry.files.add(file);
        matched.set(nodeId, entry);
      }
    }
  }
  if (matched.size === 0) return [];

  const lines = [];
  const clusters = new Set();
  for (const [nodeId, info] of matched) {
    clusters.add(info.cluster);
    lines.push(`  @${nodeId} (${info.basePath})`);
    // Surface only the per-file .graph node lines that name a touched file —
    // the agent gets that file's role + in/out flow without the whole cluster.
    const graph = loadGraphCluster(archDir, info.cluster);
    if (graph) {
      for (const node of graph.nodes) {
        if (![...info.files].some(f => (node.summary || "").includes(f))) continue;
        const flow = node.flow ? `  [${node.flow}]` : "";
        lines.push(`    ${node.id}: ${node.summary}${flow}`);
      }
    }
  }

  // Cross-reference edges touching any involved cluster — tells the agent which
  // other areas import from / are imported by what it's about to change.
  const edges = [...new Set(
    crossRefs
      .filter(e => clusters.has(e.from) || clusters.has(e.to) || matched.has(e.from) || matched.has(e.to))
      .map(e => `@${e.from} → @${e.to}`),
  )];
  if (edges.length) lines.push(`  Edges: ${edges.join(", ")}`);

  return lines;
}

// The graph maps source modules — not spec/meta/config/dotfiles. Reconciliation
// only considers real code files so a goal that only edits .arch/ or docs never
// proposes a node.
const GRAPH_CANDIDATE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|py|go|rs|rb|java|kt|swift|php|cs)$/;
// Test/spec/mock paths aren't graph nodes — the graph maps source modules. Most
// goals touch a test, so without this every completion would propose noise.
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|__mocks__|spec|e2e)\/|\.(test|spec)\.[^/]+$|_test\.[^/]+$/;
function isGraphCandidate(file) {
  const f = String(file || "").replace(/^\.\//, "").trim();
  if (!f || f.startsWith(".") || f.startsWith(".arch/")) return false;
  if (f.includes("node_modules/")) return false;
  if (TEST_PATH_RE.test(f)) return false;
  return GRAPH_CANDIDATE_EXT.test(f);
}

// Derive a PascalCase node id from a file path: src/lib/test-runner.mjs → TestRunner.
function nodeNameFor(file) {
  const base = String(file).split("/").pop().replace(/\.[^.]+$/, "");
  const name = base.split(/[-_.]/).filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join("");
  return name || "Node";
}

// Reconciliation detector — the write-back half of the graph flywheel. Given the
// files a just-finished goal touched, find the ones the node graph doesn't yet
// represent, so completion can PROPOSE (never auto-write) graph deltas while the
// authoring agent's context is still warm. Mirrors the boundary/gotcha propose
// idiom: archkit detects the gap mechanically; a human (or the warm agent)
// authors the node prose and accepts it. Two gap kinds:
//   undocumented-file — file sits under an existing cluster's basePath but has
//                       no node line in that cluster's .graph (→ add a node).
//   unmapped-area     — file sits under NO cluster basePath (→ new cluster/@node).
// "Established" = the file already appears in a node line of its cluster's
// .graph; established files are silently skipped, so the common case (edits to
// already-mapped files) proposes nothing. Pure read of .arch/; never throws.
export function detectGraphGaps(archDir, files) {
  const candidates = [...new Set(
    ensureArray(files).map(f => String(f).replace(/^\.\//, "").trim()).filter(isGraphCandidate),
  )];
  if (candidates.length === 0) return [];

  let nodeCluster;
  try { nodeCluster = createArchReader(archDir).index().nodeCluster || {}; }
  catch { return []; }

  const graphCache = new Map();
  const loadCluster = (id) => {
    if (!graphCache.has(id)) graphCache.set(id, loadGraphCluster(archDir, id));
    return graphCache.get(id);
  };

  const gaps = [];
  for (const file of candidates) {
    // Longest-prefix wins so a nested basePath (src/lib/sub/) beats a broad one.
    let best = null;
    for (const [nodeId, info] of Object.entries(nodeCluster)) {
      const bases = String(info.basePath || "").split(",").map(s => s.trim()).filter(b => b && !b.includes("*"));
      for (const b of bases) {
        if (file.startsWith(b) && (!best || b.length > best.base.length)) {
          best = { nodeId, cluster: info.cluster, base: b };
        }
      }
    }

    if (!best) {
      gaps.push({ kind: "unmapped-area", file, suggestedCluster: file.split("/").slice(0, 2).pop() || file });
      continue;
    }

    const graph = loadCluster(best.cluster);
    if (graph && graph.nodes.some(n => (n.summary || "").includes(file))) continue; // established → silent

    gaps.push({
      kind: "undocumented-file",
      file,
      cluster: best.cluster,
      node: `@${best.nodeId}`,
      suggestedLine: `${nodeNameFor(file)} [U] : ${file} — <role — fill in> | <flow — fill in>`,
    });
  }
  return gaps;
}

export function graphProposalsDir(archDir) {
  return path.join(archDir, "graph-proposals");
}

// Persist a reconciliation proposal so a goal's detected graph gaps outlive the
// completing session (mirrors boundary-proposals/). Propose-only by design:
// archkit NEVER auto-writes INDEX.md or a .graph — a wrong node misleads every
// future warmup — so this only records the gap + a fill-in node line for a human
// or the warm agent to author and accept. Returns null (writes nothing) when
// there are no gaps, keeping the common case clean.
export function writeGraphProposal(archDir, slug, gaps) {
  const list = ensureArray(gaps);
  if (list.length === 0) return null;
  const dir = graphProposalsDir(archDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.json`);
  const proposal = {
    slug,
    created: new Date().toISOString().slice(0, 10),
    gaps: list,
    note: "Files this goal touched that the node graph does not yet represent. For each undocumented-file: fill the suggestedLine's <role>/<flow> and append it to .arch/clusters/<cluster>.graph. For each unmapped-area: scaffold a new cluster + INDEX node. archkit does not auto-merge graph changes.",
  };
  fs.writeFileSync(file, JSON.stringify(proposal, null, 2));
  return { proposalPath: file, count: list.length };
}

// Read-side for graph proposals — sibling to listDigests/listGoalProposals.
export function listGraphProposals(archDir) {
  const dir = graphProposalsDir(archDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))); }
    catch { /* skip unreadable */ }
  }
  return out;
}

// Append an authored node line to a cluster's .graph — but ONLY after confirming
// the result still parses and the line added EXACTLY one node. Validation runs
// THROUGH loadGraphCluster (the same parser warmup/preflight read with) on a
// throwaway probe cluster, so "parses as a node" means precisely what every read
// path means by it, and a malformed line can never touch the real .graph. Returns
// { ok, ... }; on a parse failure ok:false and the target file is left untouched.
function appendValidatedNodeLine(archDir, cluster, authoredLine) {
  const dir = path.join(archDir, "clusters");
  const target = path.join(dir, `${cluster}.graph`);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const before = loadGraphCluster(archDir, cluster);
  const beforeCount = before ? before.nodes.length : 0;
  const candidate = (existing.trimEnd() ? existing.trimEnd() + "\n" : "") + authoredLine.trim() + "\n";

  // Probe through loadGraphCluster on a throwaway cluster id so a bad line never
  // reaches the real .graph. Always cleaned up, even on a parser throw.
  fs.mkdirSync(dir, { recursive: true });
  const probeId = `.accept-probe-${process.pid}`;
  const probePath = path.join(dir, `${probeId}.graph`);
  let probedCount = 0;
  try {
    fs.writeFileSync(probePath, candidate);
    const probed = loadGraphCluster(archDir, probeId);
    probedCount = probed ? probed.nodes.length : 0;
  } finally {
    fs.rmSync(probePath, { force: true });
  }
  if (probedCount !== beforeCount + 1) return { ok: false, beforeCount, probedCount };

  fs.writeFileSync(target, candidate);
  return { ok: true, beforeCount, afterCount: probedCount, clusterPath: target };
}

// Accept the write-back half of the graph flywheel (ADR 0004): apply ONE authored
// node line from a persisted graph-proposal to its cluster .graph, then drop the
// consumed gap (deleting the proposal once its last gap is resolved). Mirrors the
// boundary/gotcha propose→accept idiom — archkit detected the gap; a human or the
// warm agent authors the node prose and this commits it. Never auto-merges: the
// line is supplied by the caller, parse-validated, and only undocumented-file
// gaps (a file under an existing cluster) are appendable. unmapped-area gaps need
// a whole new cluster + INDEX node, so they are refused here (reason:'unmapped_area')
// with no silent no-op rather than guessed at. Returns { ok, ... } | { ok:false, reason }.
export function acceptGraphProposal(archDir, slug, { file, line } = {}) {
  const proposalPath = path.join(graphProposalsDir(archDir), `${slug}.json`);
  if (!fs.existsSync(proposalPath)) return { ok: false, reason: "unknown_proposal" };
  let proposal;
  try { proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8")); }
  catch { return { ok: false, reason: "unreadable_proposal" }; }
  const gaps = Array.isArray(proposal.gaps) ? proposal.gaps : [];

  // Pick the gap: by file when given, else the sole gap. Ambiguity is surfaced,
  // never silently resolved to the first gap.
  let gap;
  if (file) gap = gaps.find((g) => g.file === file);
  else if (gaps.length === 1) gap = gaps[0];
  if (!gap) {
    return { ok: false, reason: file ? "gap_not_found" : "ambiguous_gap", gaps };
  }

  if (gap.kind === "unmapped-area") return { ok: false, reason: "unmapped_area", gap };

  const authoredLine = String(line || "").trim();
  if (!authoredLine) return { ok: false, reason: "missing_line", gap };

  const appended = appendValidatedNodeLine(archDir, gap.cluster, authoredLine);
  if (!appended.ok) return { ok: false, reason: "malformed_line", gap, authoredLine };

  // Drop the consumed gap; delete the proposal once nothing is left in it.
  const remaining = gaps.filter((g) => g.file !== gap.file);
  let proposalRemoved = false;
  if (remaining.length === 0) {
    fs.rmSync(proposalPath, { force: true });
    proposalRemoved = true;
  } else {
    fs.writeFileSync(proposalPath, JSON.stringify({ ...proposal, gaps: remaining }, null, 2));
  }

  return {
    ok: true,
    slug,
    file: gap.file,
    cluster: gap.cluster,
    node: gap.node || `@${gap.cluster}`,
    appendedLine: authoredLine,
    clusterPath: path.relative(archDir, appended.clusterPath),
    remainingGaps: remaining.length,
    proposalRemoved,
  };
}

// Render a tight, copy-pasteable payload for the user to paste after `/goal`
// in a fresh /clear'ed session. Stays under PAYLOAD_BUDGET — the full goal
// context lives on disk; the payload just points to it.
export function renderPayload(archDir, slug, { budget = PAYLOAD_BUDGET } = {}) {
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
  const slice = graphSlice(archDir, filesToTouch);
  if (slice.length > 0) {
    lines.push(`Graph slice (related nodes & edges — use instead of guessing):`);
    lines.push(...slice);
    lines.push("");
  }
  if (verifyCommand) {
    lines.push(`Test gate: \`${verifyCommand}\` must pass — goal complete will run it and refuse on red.`);
    lines.push("");
  }
  lines.push(`When done: archkit goal complete ${slug}`);
  const ask = (m["source-ask"] || "").trim();
  if (ask) {
    // The relay path has room to carry more of the originating ask; the tight
    // copy-paste path keeps the terse 240-char teaser.
    const askCap = budget > PAYLOAD_BUDGET ? 800 : 240;
    lines.push("");
    lines.push(`Source ask: ${ask.slice(0, askCap)}${ask.length > askCap ? "…" : ""}`);
  }

  let payload = lines.join("\n");
  if (payload.length > budget) {
    // Trim source-ask and files-to-touch first — they're least load-bearing.
    payload = payload.slice(0, budget - 4) + "\n...";
  }
  return { payload, length: payload.length, withinBudget: payload.length <= budget };
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

// Canonical lifecycle vocabulary (ADR 0003): pending → in-progress → testing →
// completed, plus side states on-hold and abandoned. The old values `planned`
// and `done` are accepted as READ aliases (normalized in statusOf) so existing
// .arch/goals/*.md and goals/done/*.md keep parsing — only the values we WRITE
// changed. The `goals/done/` FOLDER name is unchanged; this reconciles the
// `status:` value, not the archive path.
export const STATUS_PENDING = "pending";
const STATUS_ACTIVE = "in-progress";
export const STATUS_COMPLETED = "completed";
const STATUS_ALIASES = Object.freeze({ planned: STATUS_PENDING, done: STATUS_COMPLETED });
// Edits applied, verification still pending (ADR 0003). A PERSISTENT state that
// survives /clear — it replaces today's premature goal_complete. A `testing`
// goal is NOT done: it stays guarded by the Stop hook until a (possibly later,
// fresh) session runs the verify-command/exit-criteria green and completes it.
export const STATUS_TESTING = "testing";
// The deliberately-set-aside ACTIVE goal (ADR 0003). `on-hold` is the chosen
// rename that resolves the `deferred` collision: it means a human/agent chose
// to PARK real, queued work — distinct from `proposed`/`deferred` (follow-up
// PROPOSALS awaiting promotion) and from `depends-on` blocking (auto-resolved).
// Unlike `testing`, an on-hold goal is NOT guarded — parking is a deliberate
// stop, so the Stop hook lets the session end. It lives in goals/ root (status
// is the source of truth, not a folder) and is resumed via startGoal.
export const STATUS_ON_HOLD = "on-hold";
// States that keep the relay guard engaged — the goal is live work the Stop
// hook must not let the session walk away from. `testing` is guarded precisely
// because it is NOT done; `on-hold` is deliberately EXCLUDED (parking releases
// the guard).
const GUARDED_STATUSES = [STATUS_ACTIVE, STATUS_TESTING];

export function isGoalDone(archDir, slug) {
  // Terminal goals live at the top level of done/ until consolidation moves the
  // raw file verbatim into done/archive/ — both locations count as "done" so
  // depends-on resolution survives a consolidation pass (see consolidateGoals).
  return (
    fs.existsSync(path.join(doneDir(archDir), `${slug}.md`)) ||
    fs.existsSync(path.join(archiveDir(archDir), `${slug}.md`))
  );
}

// Canonical status for a goal — normalizes the legacy aliases (`planned`→
// `pending`, `done`→`completed`) so callers compare against one vocabulary
// regardless of when the file was written. Default is `pending`.
export function statusOf(goal) {
  const raw = goal?.meta?.status || STATUS_PENDING;
  return STATUS_ALIASES[raw] || raw;
}

export function exitCriteriaOf(goal) {
  return ensureArray(goal?.meta?.["exit-criteria"]);
}

export function verifyCommandOf(goal) {
  const v = goal?.meta?.["verify-command"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// The single guarded goal, or null. A goal is guarded while in-progress OR in
// `testing` (verification pending) — both keep the Stop-hook relay engaged. In
// fresh-context relay there should be at most one; prefer an in-progress goal,
// then a testing goal, by listGoals order.
export function getActiveGoal(archDir) {
  const goals = listGoals(archDir);
  return goals.find((g) => statusOf(g) === STATUS_ACTIVE)
    || goals.find((g) => statusOf(g) === STATUS_TESTING)
    || null;
}

// Mark a goal in-progress — the relay "start" transition. Idempotent.
// Clears any stale turn-cap counter so the guard starts fresh for this goal.
// If the goal was sitting in goals/testing/ (resumed for verification), it is
// relocated back to goals/ root so an in-progress goal never lingers in the
// testing drawer — status frontmatter and folder stay consistent.
export function startGoal(archDir, slug) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  ensureGoalsLayout(archDir);
  goal.meta.status = STATUS_ACTIVE;
  if (!goal.meta.started) goal.meta.started = new Date().toISOString().slice(0, 10);
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  const targetPath = path.join(goalsDir(archDir), `${slug}.md`);
  fs.writeFileSync(targetPath, out);
  if (path.resolve(goal.filepath) !== path.resolve(targetPath)) {
    fs.rmSync(goal.filepath, { force: true });
  }
  const state = readLoopState(archDir);
  if (state[slug]) { delete state[slug]; writeLoopState(archDir, state); }
  return { slug, status: STATUS_ACTIVE };
}

// The relay "verification" transition: move an active goal into `testing` —
// edits applied, verification still pending. Physically relocates the file into
// goals/testing/ (the loud verification drawer) and flips status to `testing`.
// Persistent across /clear: the goal stays guarded (see getActiveGoal) until a
// session runs verify green and completes it. Idempotent.
export function markTesting(archDir, slug) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  ensureGoalsLayout(archDir);
  goal.meta.status = STATUS_TESTING;
  if (!goal.meta["testing-since"]) goal.meta["testing-since"] = new Date().toISOString().slice(0, 10);
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  const targetPath = path.join(testingDir(archDir), `${slug}.md`);
  fs.writeFileSync(targetPath, out);
  if (path.resolve(goal.filepath) !== path.resolve(targetPath)) {
    fs.rmSync(goal.filepath, { force: true });
  }
  return { slug, status: STATUS_TESTING, filepath: targetPath };
}

// The relay "park" transition (ADR 0003): flip an active goal to `on-hold` —
// deliberately set aside, but resumable. Unlike markTesting this does NOT move
// the file (on-hold lives in goals/ root, distinguished by status). Releasing
// the guard is the point: clears the turn-cap counter so the Stop hook lets the
// session end, and nextEligibleGoal won't auto-pick it ahead of real pending
// work (it returns only as a last-resort resume). Idempotent. If the goal was
// parked from goals/testing/, it is relocated back to goals/ root so an on-hold
// goal never lingers in the verification drawer.
export function markOnHold(archDir, slug) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  ensureGoalsLayout(archDir);
  goal.meta.status = STATUS_ON_HOLD;
  if (!goal.meta["on-hold-since"]) goal.meta["on-hold-since"] = new Date().toISOString().slice(0, 10);
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  const targetPath = path.join(goalsDir(archDir), `${slug}.md`);
  fs.writeFileSync(targetPath, out);
  if (path.resolve(goal.filepath) !== path.resolve(targetPath)) {
    fs.rmSync(goal.filepath, { force: true });
  }
  // Parking releases the guard — drop any stale turn-cap counter for this goal.
  const state = readLoopState(archDir);
  if (state[slug]) { delete state[slug]; writeLoopState(archDir, state); }
  return { slug, status: STATUS_ON_HOLD, filepath: targetPath };
}

// ── Backlog-threshold ordering knob (cgr-backlog-ordering) ──
//
// Pure pending-first ordering optimizes for the reported failure mode: testing
// (verification-debt) goals pile up mid-sprint and grow unbounded. The hybrid:
// prefer pending work while the testing backlog is small, then force-drain
// testing once the backlog crosses a configurable threshold (count OR age).
//
// Config knob — .arch/config.json → cgr.backlogThreshold (all optional):
//   { "cgr": { "backlogThreshold": { "count": 5, "ageDays": 7 } } }
// `count`   — switch to testing-first when the testing backlog reaches this many
//             items. Set null/0 to disable the count trigger.
// `ageDays` — switch to testing-first when the OLDEST testing goal has waited
//             this many days (by testing-since). Set null/0 to disable.
// The default below is deliberately slack so out-of-the-box behavior is the
// simple pending-first batch — the threshold only fires when debt genuinely
// accumulates.
export const DEFAULT_BACKLOG_THRESHOLD = Object.freeze({ count: 5, ageDays: 7 });

// Resolve the effective threshold: defaults overlaid with .arch/config.json.
// A malformed/absent config silently falls back to defaults (never throws —
// goal selection must not be blocked by a bad config file).
export function backlogThreshold(archDir) {
  let fromFile = {};
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(archDir, "config.json"), "utf8"));
    if (cfg && typeof cfg === "object" && cfg.cgr && typeof cfg.cgr.backlogThreshold === "object") {
      fromFile = cfg.cgr.backlogThreshold;
    }
  } catch { /* no/invalid config → defaults */ }
  return { ...DEFAULT_BACKLOG_THRESHOLD, ...fromFile };
}

function daysBetween(fromISODate, now) {
  const d = new Date(`${fromISODate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

// Has the testing backlog crossed the threshold? True once EITHER trigger fires:
// the count reaches `count`, or the oldest testing goal's age reaches `ageDays`.
// Exported for the relay/tests to introspect the ordering decision.
export function testingBacklogOverThreshold(testing, threshold, now = new Date()) {
  if (!Array.isArray(testing) || testing.length === 0) return false;
  const { count, ageDays } = threshold || {};
  if (count && testing.length >= count) return true;
  if (ageDays) {
    for (const g of testing) {
      const since = g?.meta?.["testing-since"] || g?.meta?.started || g?.meta?.created;
      if (!since) continue;
      const age = daysBetween(String(since), now);
      if (age != null && age >= ageDays) return true;
    }
  }
  return false;
}

// Next goal to hand to the agent. Precedence:
//   1. Resume an in-progress goal (genuine active work) — always first.
//   2. Among eligible (deps-satisfied) goals, apply the backlog-threshold knob:
//      pending-first by default, but testing-first once the testing backlog
//      crosses the threshold (drain verification debt before it grows unbounded).
//      Whichever bucket is preferred, fall through to the other if it's empty.
// depends-on resolution and in-progress resume both take precedence over the
// threshold ordering (see ADR 0003 / cgr-backlog-ordering exit criteria).
export function nextEligibleGoal(archDir) {
  const goals = listGoals(archDir);

  // (1) Resume actively-worked goal first — never deferred by the threshold.
  const inProgress = goals.find((g) => statusOf(g) === STATUS_ACTIVE);
  if (inProgress) return inProgress;

  // deps-satisfied = every depends-on already complete.
  const depsSatisfied = (g) => {
    const deps = ensureArray(g.meta["depends-on"]);
    return !deps.some((d) => !isGoalDone(archDir, d));
  };

  // Eligible = not done, not parked (on-hold), and deps satisfied. `on-hold`
  // goals are deliberately set aside, so they are NOT auto-selected ahead of
  // real pending/testing work — they only surface as a last-resort resume below.
  const eligible = goals.filter((g) => {
    const s = statusOf(g);
    if (s === STATUS_COMPLETED || s === STATUS_ON_HOLD) return false;
    return depsSatisfied(g);
  });
  const testing = eligible.filter((g) => statusOf(g) === STATUS_TESTING);
  const pending = eligible.filter((g) => statusOf(g) !== STATUS_TESTING);

  // (2) Threshold ordering. Below threshold → pending-first (the simple default
  // batch); at/above → testing-first to drain the backlog. Either way, fall
  // through to the non-preferred bucket when the preferred one is empty.
  const drainTesting = testingBacklogOverThreshold(testing, backlogThreshold(archDir));
  const [preferred, fallback] = drainTesting ? [testing, pending] : [pending, testing];
  if (preferred[0] || fallback[0]) return preferred[0] || fallback[0];

  // (3) Nothing live to do — offer a deliberately-parked goal as a last resort.
  // Resuming it is an explicit act (the user ran goal_next), so this respects
  // "parked" while still keeping on-hold work discoverable instead of lost.
  const onHold = goals.filter((g) => statusOf(g) === STATUS_ON_HOLD && depsSatisfied(g));
  return onHold[0] || null;
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
    status: STATUS_PENDING,
  });
  fs.rmSync(file, { force: true });
  return { slug };
}

// ───────────────────────────────────────────────────────────────────────────
// Incremental consolidation / digest (cgr-consolidation-digest)
//
// Completed/abandoned goals land as raw files at the TOP LEVEL of goals/done/.
// Consolidation is an INCREMENTAL step — it is NOT gated on the queue being
// empty. It summarizes every terminal goal currently sitting at the top level
// of done/ into a dated per-day digest (goals/done/digest/<YYYY-MM-DD>.md),
// then moves each raw CGR file verbatim into goals/done/archive/<slug>.md so an
// agent can still pull full context after the summary is written. Because it
// only ever drains what is already terminal, calling it while other goals are
// still pending/in-progress is safe — that is what makes it incremental. The
// relay triggers it at queue-drain / session-end (see runGoalComplete + the
// Stop hook), and `archkit goal consolidate` triggers it on demand.
// ───────────────────────────────────────────────────────────────────────────

export function archiveDir(archDir) {
  return path.join(doneDir(archDir), "archive");
}
export function digestDir(archDir) {
  return path.join(doneDir(archDir), "digest");
}

const DIGEST_SLUG_RE = /<!-- cgr-digest-slug: (.+?) -->/g;

function oneLine(text, max = 200) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// Terminal goals sitting at the TOP LEVEL of done/ — completed/abandoned but
// not yet consolidated. Subdirs (archive/, digest/) are skipped; only flat .md
// files are un-consolidated terminal goals.
export function listTerminalGoals(archDir) {
  const dir = doneDir(archDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const filepath = path.join(dir, name);
    try {
      if (!fs.statSync(filepath).isFile()) continue;
      const { meta, body } = parseGoal(fs.readFileSync(filepath, "utf8"));
      out.push({ slug: meta.slug || name.replace(/\.md$/, ""), filepath, meta, body });
    } catch { /* skip unreadable/malformed */ }
  }
  return out;
}

function digestEntry(goal) {
  const m = goal.meta || {};
  const status = m.status || "completed";
  const completedOn = m.completed || m.abandoned || m.created || "";
  const tests = m["tests-passed"] ? ` (tests: ${m["tests-command"] || "verify"} passed)` : "";
  const note = m["completion-notes"] || m["abandon-reason"] || "";
  const lines = [];
  lines.push(`<!-- cgr-digest-slug: ${goal.slug} -->`);
  lines.push(`## ${goal.slug} — ${m.title || goal.slug}`);
  lines.push(`- Outcome: ${status}${tests}`);
  if (completedOn) lines.push(`- Date: ${completedOn}`);
  if (note) lines.push(`- Notes: ${oneLine(note, 300)}`);
  lines.push(`- Raw: goals/done/archive/${goal.slug}.md`);
  return lines.join("\n");
}

// Drain every terminal goal currently at the top level of done/ into the dated
// digest and preserve each raw file verbatim under done/archive/. Idempotent:
// once drained, the raw files are gone from the top level so a re-run is a
// no-op. Pass `date` to pin the digest day (tests / deterministic runs).
export function consolidateGoals(archDir, { date } = {}) {
  const day = date || new Date().toISOString().slice(0, 10);
  const terminal = listTerminalGoals(archDir);
  if (terminal.length === 0) {
    return { date: day, consolidated: 0, archived: [], slugs: [], digestPath: null };
  }

  const aDir = archiveDir(archDir);
  const dDir = digestDir(archDir);
  fs.mkdirSync(aDir, { recursive: true });
  fs.mkdirSync(dDir, { recursive: true });

  const digestPath = path.join(dDir, `${day}.md`);
  let existing = "";
  try { existing = fs.readFileSync(digestPath, "utf8"); } catch { /* new digest */ }
  const already = new Set();
  for (const mm of existing.matchAll(DIGEST_SLUG_RE)) already.add(mm[1]);

  const newEntries = [];
  const archived = [];
  const slugs = [];
  for (const goal of terminal) {
    // Preserve the raw CGR verbatim BEFORE removing the top-level copy:
    // copy-then-unlink so a crash mid-consolidation can't lose content.
    const target = path.join(aDir, `${goal.slug}.md`);
    const raw = fs.readFileSync(goal.filepath, "utf8");
    fs.writeFileSync(target, raw);
    fs.rmSync(goal.filepath, { force: true });
    archived.push(path.relative(archDir, target));
    slugs.push(goal.slug);
    if (!already.has(goal.slug)) newEntries.push(digestEntry(goal));
  }

  if (newEntries.length > 0) {
    let content;
    if (existing.trim()) {
      content = existing.trimEnd() + "\n\n" + newEntries.join("\n\n") + "\n";
    } else {
      const header = [
        `# CGR digest — ${day}`,
        ``,
        `Consolidated summary of CGR goals finished on ${day}. The raw goal files`,
        `are preserved verbatim under goals/done/archive/ for full-context recovery.`,
        ``,
        ``,
      ].join("\n");
      content = header + newEntries.join("\n\n") + "\n";
    }
    fs.writeFileSync(digestPath, content);
  }

  return { date: day, consolidated: terminal.length, archived, slugs, digestPath };
}

// Read-side for digests — discoverable surface, sibling to listDecisions.
// Most-recent day first.
export function listDigests(archDir) {
  const dir = digestDir(archDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const filepath = path.join(dir, name);
    try {
      if (!fs.statSync(filepath).isFile()) continue;
      const content = fs.readFileSync(filepath, "utf8");
      const slugs = [...content.matchAll(DIGEST_SLUG_RE)].map((m) => m[1]);
      const titles = [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
      out.push({
        date: name.replace(/\.md$/, ""),
        filepath,
        relativePath: path.relative(archDir, filepath),
        slugs,
        count: slugs.length,
        summary: oneLine(titles.join("; "), 200),
        content,
      });
    } catch { /* skip unreadable */ }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

// Keyword-rank digests (slug matches weighted over body). No query → recent
// list. Mirrors searchDecisions so digests are recallable the same way ADRs are.
export function searchDigests(archDir, { query = "", limit = 10 } = {}) {
  const all = listDigests(archDir);
  const q = String(query || "").trim().toLowerCase();
  if (!q) return all.slice(0, limit).map(({ content, ...d }) => d);
  const terms = q.split(/\s+/).filter(Boolean);
  return all
    .map((d) => {
      const slugStr = d.slugs.join(" ").toLowerCase();
      const hay = `${d.date} ${d.content}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (slugStr.includes(t)) score += 4;
        if (hay.includes(t)) score += 1;
      }
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.d.date < b.d.date ? 1 : -1))
    .slice(0, limit)
    .map((x) => { const { content, ...rest } = x.d; return { ...rest, score: x.score }; });
}
