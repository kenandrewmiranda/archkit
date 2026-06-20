// CGR (Clear Goal Run) artifact library.
//
// Workflow: in a fresh session, the user types a sprawling ask. The agent
// digests it (with help from warmup + INDEX context), produces a structured
// decomposition, and calls archkit_goal_intake — which writes one
// .arch/goals/<slug>.md per goal and returns a tight, copy-pasteable payload
// (<=3800 chars) per goal that the user pastes after `/goal` in a fresh,
// /clear'ed session.
//
// Storage layout (cgr-queue-folder-layout — symmetric queue·testing·done map):
//   .arch/goals/queue/<slug>.md            — pending (queued) goals
//   .arch/goals/queue/<project>/<slug>.md  — pending goals grouped by feature set
//   .arch/goals/<slug>.md                  — in-progress / on-hold (live, root)
//   .arch/goals/testing/<slug>.md          — edits applied, verification pending
//   .arch/goals/done/<slug>.md             — completed goals (kept for history)
//
// Backward-compat: pending goals historically sat at the goals/ ROOT. listGoals
// and loadGoal DUAL-READ both root and queue/ so existing projects keep working,
// and a one-time idempotent migration (migratePendingGoalsToQueue, run on any
// write via ensureGoalsLayout) relocates legacy root pending goals into queue/.
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

// The queue drawer (cgr-queue-folder-layout): where PENDING goals live, mirroring
// testing/ and done/ so the state→folder map is symmetric (queue · testing · done).
// A project's goals nest one level deeper under queue/<project>/ so a feature set
// clusters on disk. In-progress and on-hold goals stay in goals/ root (status is
// still the source of truth, ADR 0003) — only "queued, not started" lives here.
export function queueDir(archDir) {
  return path.join(goalsDir(archDir), "queue");
}

export function ensureGoalsLayout(archDir) {
  fs.mkdirSync(doneDir(archDir), { recursive: true });
  fs.mkdirSync(testingDir(archDir), { recursive: true });
  fs.mkdirSync(queueDir(archDir), { recursive: true });
  // Lazy, idempotent: relocate any legacy root pending goals into queue/ on the
  // first write after upgrade. Pure-read paths (listGoals/loadGoal) deliberately
  // do NOT trigger this — they dual-read instead, so reads never move files.
  migratePendingGoalsToQueue(archDir);
}

// Top-level *.md goal files directly in `dir` (NOT subdirs), excluding the
// coordination board. Shared by listGoals' dual-read across goals/ root + testing/.
function flatGoalFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    if (name === CHAT_BOARD_FILENAME) continue;
    out.push(path.join(dir, name));
  }
  return out;
}

// Every queued goal file: the .md files directly in goals/queue/ PLUS the .md
// files one level deeper in per-project subfolders (goals/queue/<project>/). Only
// one level of nesting is scanned — projects don't nest. Tolerant of an absent
// queue dir (returns []).
function queueGoalFiles(archDir) {
  const qDir = queueDir(archDir);
  if (!fs.existsSync(qDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(qDir)) {
    const full = path.join(qDir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      for (const sub of fs.readdirSync(full)) {
        if (!sub.endsWith(".md")) continue;
        out.push(path.join(full, sub));
      }
    } else if (name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// One-time, idempotent migration (cgr-queue-folder-layout): relocate legacy
// root-level *.md PENDING goals into goals/queue/. Pending is the only state that
// belongs in the queue — in-progress/on-hold stay in goals/ root, and
// testing/done/proposed already live in their own subdirs (never scanned here, as
// this only reads top-level files of goals/ root). A project goal is filed under
// queue/<project>/. Safe to call repeatedly: once moved, root holds no pending .md
// so re-runs are a no-op readdir, and a name already present in the destination is
// not overwritten. Never throws — a migration hiccup must not block the relay.
export function migratePendingGoalsToQueue(archDir) {
  const root = goalsDir(archDir);
  let names;
  try { names = fs.readdirSync(root); } catch { return { moved: [] }; }
  const moved = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    if (name === CHAT_BOARD_FILENAME) continue;
    const src = path.join(root, name);
    try {
      if (!fs.statSync(src).isFile()) continue;
      const raw = fs.readFileSync(src, "utf8");
      if (statusOf(parseGoal(raw)) !== STATUS_PENDING) continue; // only pending migrates
      const project = String(parseGoal(raw).meta.project || "").trim();
      const destDir = project ? path.join(queueDir(archDir), project) : queueDir(archDir);
      const dest = path.join(destDir, name);
      if (fs.existsSync(dest)) { fs.rmSync(src, { force: true }); continue; } // already migrated
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(dest, raw);
      fs.rmSync(src, { force: true });
      moved.push(name.replace(/\.md$/, ""));
    } catch { /* skip this file, keep going */ }
  }
  return { moved };
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
  if (!m) return { meta: {}, body: content, elapsedMs: null };
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
  // elapsedMs exposed on the parsed goal record — derived wall-clock from the
  // datetime stamps, or null for legacy date-only goals (deriveElapsedMs is
  // hoisted; it's defined lower in the file).
  return { meta, body: m[2], elapsedMs: deriveElapsedMs(meta.started, meta.completed) };
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
  // New goals are QUEUED under goals/queue/ (cgr-queue-folder-layout). A goal
  // tagged with a `project` is filed under goals/queue/<project>/ so a feature
  // set's CGRs cluster on disk — the agent works them on one branch (ADR 0010).
  const projectSlug = goal.project ? slugify(goal.project) : "";
  const targetDir = projectSlug ? path.join(queueDir(archDir), projectSlug) : queueDir(archDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const filepath = path.join(targetDir, `${slug}.md`);
  const orderNum = Number(goal.order);
  const hasOrder = goal.order !== undefined && goal.order !== null && goal.order !== "" && Number.isFinite(orderNum);
  const meta = {
    slug,
    title: goal.title || slug,
    status: goal.status || STATUS_PENDING,
    created: goal.created || new Date().toISOString().slice(0, 10),
    // Intentional sequencing (cgr-goal-ordering): `epic` groups a goal under a
    // larger objective; `order` is the relay sort key (lower runs first). Both
    // optional and only stamped when provided, so existing goals are untouched.
    ...(goal.epic ? { epic: slugify(goal.epic) } : {}),
    ...(hasOrder ? { order: orderNum } : {}),
    // Branch-isolated feature set (cgr-project-branch-grouping, ADR 0007):
    // `project` marks a goal as part of a feature set that lives on its own git
    // branch (feat/<project>). Distinct from `epic` (a sequencing group): a
    // project drives the branch-prework guidance in renderPayload so parallel
    // agents isolate their work. Slugified on write; absent on legacy goals.
    ...(projectSlug ? { project: projectSlug } : {}),
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

// Active goals, DUAL-READ across all live locations (cgr-queue-folder-layout):
//   - goals/queue/ (+ per-project subfolders) — pending, the new home
//   - goals/ root — legacy pending (pre-migration) + live in-progress/on-hold
//   - goals/testing/ — verification debt
// Terminal subdirs (done/, proposed/, archive/, digest/) hold terminal/proposal
// artifacts and are skipped. The coordination board (chat.md) lives in goals/ for
// discoverability but is NOT a goal — excluded by name (cgr-agent-chat-coordination-board).
export function listGoals(archDir) {
  const out = [];
  const files = [
    ...queueGoalFiles(archDir),
    ...flatGoalFiles(goalsDir(archDir)),
    ...flatGoalFiles(testingDir(archDir)),
  ];
  for (const filepath of files) {
    try {
      if (!fs.statSync(filepath).isFile()) continue;
      const { meta } = parseGoal(fs.readFileSync(filepath, "utf8"));
      out.push({ slug: meta.slug || path.basename(filepath).replace(/\.md$/, ""), filepath, meta });
    } catch {}
  }
  return sortGoals(out);
}

// ── Intentional sequencing (cgr-goal-ordering; epic-primary per ADR 0006) ────
// Goals carry an optional numeric `order` (stamped at intake from decomposition
// order, or set by hand) and an optional `epic` group label. listGoals returns
// goals sorted by intent so nextEligibleGoal and goal_list pick the next
// INTENDED goal instead of incidental readdir/alphabetical order.
//
// Ordering is EPIC-PRIMARY: an epic runs to completion before the next begins
// ("finish objective X before starting Y"). Epics are sequenced by their
// EARLIEST `order` (the epic whose lowest-numbered goal comes first runs first),
// and within an epic by `order`. Ungrouped goals (no epic) each stand alone,
// slotted among the epics by their own order — so a lone goal is neither forced
// ahead of nor behind every epic. Goals with no `order` rank last (Infinity),
// preserving stable alpha-by-slug among them.
//
// Backward compatible: with no epics anywhere, every goal's group rank IS its
// own order, so this collapses to pure order-ascending — identical to the
// order-primary behavior shipped in v1.11.0 and to alpha-by-slug for goals
// predating the fields entirely.
function orderKey(g) {
  const n = Number(g?.meta?.order);
  return Number.isFinite(n) ? n : Infinity;
}
export function sortGoals(goals) {
  // Rank each epic by the minimum `order` among its goals — this is what keeps
  // an epic's goals contiguous AND sequences the epics by where they started.
  const epicRank = new Map();
  for (const g of goals) {
    const e = String(g?.meta?.epic || "");
    if (!e) continue;
    const o = orderKey(g);
    if (!epicRank.has(e) || o < epicRank.get(e)) epicRank.set(e, o);
  }
  // Group rank: an epic'd goal inherits its epic's earliest order; an ungrouped
  // goal is its own group, ranked by its own order.
  const groupRank = (g) => {
    const e = String(g?.meta?.epic || "");
    return e ? epicRank.get(e) : orderKey(g);
  };
  return [...goals].sort((a, b) => {
    const ra = groupRank(a), rb = groupRank(b);
    if (ra !== rb) return ra - rb;
    // Same group rank: keep an epic's goals together (epic label), then by
    // order within the epic, then slug as the final stable tie-break.
    const ea = String(a?.meta?.epic || ""), eb = String(b?.meta?.epic || "");
    if (ea !== eb) return ea < eb ? -1 : 1;
    const oa = orderKey(a), ob = orderKey(b);
    if (oa !== ob) return oa - ob;
    const sa = a?.slug || "", sb = b?.slug || "";
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

// Highest `order` currently assigned across live goals, +1 — the base for the
// next intake batch so sequential decompositions append after existing work
// instead of colliding at 0. Returns 0 when no goal carries an order yet.
export function nextOrderBase(archDir) {
  let max = -1;
  for (const g of listGoals(archDir)) {
    const n = Number(g?.meta?.order);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

// Resolve a goal by slug across every live location, DUAL-READ
// (cgr-queue-folder-layout): goals/queue/ (+ project subfolders) first, then the
// legacy goals/ root, then goals/testing/. Queue-first so a migrated copy wins
// over a stale root one. Terminal goals (done/, archive/) are intentionally NOT
// resolved here — loadGoal is the handle the relay uses to act on live work.
export function loadGoal(archDir, slug) {
  const want = `${slug}.md`;
  const candidates = [
    ...queueGoalFiles(archDir).filter((f) => path.basename(f) === want),
    path.join(goalsDir(archDir), want),
    path.join(testingDir(archDir), want),
  ];
  for (const filepath of candidates) {
    if (fs.existsSync(filepath)) {
      return { ...parseGoal(fs.readFileSync(filepath, "utf8")), filepath, slug };
    }
  }
  return null;
}

export function completeGoal(archDir, slug, { notes = "", extraMeta = {}, timeSpent = "" } = {}) {
  // ensureGoalsLayout FIRST so its lazy migration relocates any legacy root
  // pending goal into queue/ BEFORE we load it — otherwise loadGoal would capture
  // the root path, migration would move it, and the relocate-write below would
  // leave a duplicate. With layout ensured first, loadGoal resolves the final
  // location and the filepath!=target rmSync cleans the source.
  ensureGoalsLayout(archDir);
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  goal.meta.status = STATUS_COMPLETED;
  // Full ISO-8601 datetime (not date-only) so elapsed wall-clock is derivable
  // from started→completed.
  goal.meta["completed"] = new Date().toISOString();
  if (notes) goal.meta["completion-notes"] = notes;
  // Explicit effort override (e.g. '2h'/'90m'): persisted as the time-spent
  // frontmatter key and taking precedence over derived elapsed (wall-clock
  // counts idle gaps, so an honest hand-entered figure is the truer effort).
  const effort = normalizeEffort(timeSpent);
  if (effort) goal.meta["time-spent"] = effort;
  // Stamp objective completion evidence (e.g. tests-passed/-command/-at) so the
  // archived goal records HOW it was verified, not just that it was claimed done.
  for (const [k, v] of Object.entries(extraMeta)) {
    if (v != null && v !== "") goal.meta[k] = v;
  }
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  const targetPath = path.join(doneDir(archDir), `${slug}.md`);
  fs.writeFileSync(targetPath, out);
  fs.rmSync(goal.filepath, { force: true });
  // If completing this goal drains the ungrouped queue, drop the recorded
  // cgr-queue-<date> branch so the next batch mints a fresh dated branch.
  clearQueueBranchIfDrained(archDir);
  return { slug, archivedAt: targetPath, elapsedMs: deriveElapsedMs(goal.meta.started, goal.meta["completed"]), effort: effortOf({ meta: goal.meta }) };
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
  // Branch-prework block (cgr-project-branch-grouping, ADR 0007): when a goal
  // belongs to a `project`, instruct the agent to isolate the feature set on its
  // own git branch so parallel agents don't collide. archkit only EMITS this
  // guidance — it never runs git itself (instruct-not-act).
  const project = typeof m.project === "string" ? m.project.trim() : "";
  if (project) {
    lines.push(`Branch prework (project: ${project}) — do this BEFORE editing:`);
    lines.push(`- Put this feature set on its own branch: \`git switch -c feat/${project}\` (or \`git switch feat/${project}\` if it already exists).`);
    lines.push(`- Commit each completed CGR to that branch before advancing the queue.`);
    lines.push(`- archkit only emits this guidance — YOU run the git commands.`);
    lines.push("");
  } else if (listGoals(archDir).some((g) => String(g?.meta?.project || "").trim())) {
    // Queue-branch prework (cgr-relay-queue-vs-project-routing): the ungrouped
    // complement to feat/<project>. Only emitted when the parallel-work regime is
    // active (some live goal carries a project) — single-track projects keep their
    // pre-feature behavior (no branch ceremony). All ungrouped queue goals in the
    // batch share ONE dated branch: if archkit has already recorded it, switch to
    // it; otherwise this is the first queue goal — create it. archkit stamps the
    // date and records the name; it never runs git (instruct-not-act). The two
    // schemes never collide: feat/<project> vs cgr-queue-<date>.
    const recorded = readQueueBranch(archDir);
    const branch = recorded || queueBranchName();
    lines.push(`Branch prework (shared queue branch) — do this BEFORE editing:`);
    if (recorded) {
      lines.push(`- This batch's queue branch already exists: \`git switch ${branch}\`.`);
    } else {
      lines.push(`- Put the ungrouped queue on its shared dated branch: \`git switch -c ${branch}\`.`);
    }
    lines.push(`- Every ungrouped queue goal in this batch shares ${branch} — reuse it, don't create a new branch per pick.`);
    lines.push(`- Commit each completed CGR to that branch before advancing the queue.`);
    lines.push(`- archkit only emits this guidance — YOU run the git commands.`);
    lines.push("");
  }
  // Conflict prework block (cgr-files-to-touch-conflict-detection): when another
  // LIVE goal (in-progress/testing) declares a file this goal will also touch,
  // warn up front so parallel agents coordinate instead of colliding. Silent when
  // there's no overlap. Cross-branch (cross-project) overlaps are the dangerous
  // case — flagged loudly; same-branch overlaps are noted as lower-risk.
  const conflicts = detectFileConflicts(archDir, slug);
  if (conflicts.length > 0) {
    lines.push(`⚠ CONFLICT — other live CGRs touch files you will edit (coordinate BEFORE editing):`);
    for (const c of conflicts) {
      const proj = c.project ? ` [feat/${c.project}]` : "";
      const risk = c.crossProject ? " (cross-branch — high risk)" : "";
      lines.push(`- ${c.slug}${proj}${risk}: ${c.files.join(", ")}`);
    }
    lines.push(`- These goals are in-progress or testing right now. Expect edit/merge collisions on the shared files — sequence, rebase, or split the work rather than editing blind.`);
    lines.push("");
  }
  // Coordination-board prework (cgr-agent-chat-coordination-board): always point
  // the agent at the SHARED gitignored board — the human-readable layer over the
  // structured conflict detection above. archkit only instructs; the agent does
  // the read/append.
  lines.push(`Coordination board — \`${CHAT_BOARD_REL}\` (shared, gitignored):`);
  lines.push(`- BEFORE editing: READ the board to see what other agents are touching, then APPEND an announce-entry — this goal (${slug})${project ? `, branch feat/${project}` : ""}, and your files-to-touch.`);
  if (conflicts.length > 0) {
    lines.push(`- A conflict is flagged above — CHECK the board and coordinate there before you touch the shared files.`);
  }
  lines.push(`- archkit only emits this guidance — YOU read and append the board.`);
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
// Per-goal time capture (goal-time-capture)
//
// Transition stamps (started / testing-since / completed) are written as full
// ISO-8601 datetimes so wall-clock elapsed is derivable. Goals written before
// this carry date-only (YYYY-MM-DD) stamps with NO time component; derivation
// declines on those rather than fabricating a midnight-to-midnight span, so
// legacy goals degrade gracefully (no elapsed shown, no parse crash).
// ───────────────────────────────────────────────────────────────────────────

// The calendar-day portion (YYYY-MM-DD) of a stamp that may be a full datetime
// or already date-only. Used wherever a DAY is wanted (digests, the done-today
// breadcrumb, backlog-age) regardless of stamp precision — so day-grouping keeps
// working across the date-only→datetime upgrade.
export function stampDate(stamp) {
  return String(stamp || "").trim().slice(0, 10);
}

// True only for a full ISO-8601 datetime stamp (carries a time component) — the
// discriminator between a new datetime stamp and a legacy date-only one.
function hasTimeComponent(stamp) {
  return typeof stamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(stamp.trim());
}

// Wall-clock elapsed (ms) from started→completed, or null when it can't be
// honestly derived: either stamp missing/unparseable, date-only (legacy — no
// time component, so a span would be fiction), or completed-before-started.
export function deriveElapsedMs(started, completed) {
  if (!hasTimeComponent(started) || !hasTimeComponent(completed)) return null;
  const a = Date.parse(started), b = Date.parse(completed);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return b - a;
}

// Humanize a millisecond span compactly: "2h 15m", "45m", "30s". null/NaN/
// negative → null (nothing worth showing).
export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Tidy an explicit effort entry ('2h', '90m', ' 1h30m ') for the time-spent
// frontmatter key. Lenient — collapses inner whitespace but otherwise passes the
// value through so a user's honest figure is never dropped. Blank → null.
export function normalizeEffort(input) {
  const s = String(input || "").replace(/\s+/g, " ").trim();
  return s || null;
}

// Effective per-goal effort for a parsed goal record. The explicit user-entered
// time-spent override WINS when present — wall-clock counts idle gaps, so an
// honest hand-entered figure is the truer effort. Falls back to derived elapsed,
// else nothing. `source` tells the caller which path produced `display`.
export function effortOf(goal) {
  const meta = goal?.meta || {};
  const elapsedMs = deriveElapsedMs(meta.started, meta.completed);
  const explicit = normalizeEffort(meta["time-spent"]);
  if (explicit) return { source: "explicit", display: explicit, timeSpent: explicit, elapsedMs };
  if (elapsedMs != null) return { source: "derived", display: formatDuration(elapsedMs), timeSpent: null, elapsedMs };
  return { source: "none", display: null, timeSpent: null, elapsedMs: null };
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

// ── Cross-CGR file-overlap detection (cgr-files-to-touch-conflict-detection) ──
//
// Every goal already declares files-to-touch, so archkit can mechanically warn
// when a goal would edit a file another LIVE goal is also editing — the reliable
// backbone for parallel work. "Live" = in-progress OR testing (the set the Stop
// hook guards): a goal can only collide with yours while it's actually being
// worked; pending/on-hold/completed/abandoned goals can't. This is the same set
// as GUARDED_STATUSES by definition, kept as its own constant so the conflict
// scope is self-documenting and won't drift if the guard set ever diverges.
const LIVE_STATUSES = [STATUS_ACTIVE, STATUS_TESTING];

// A goal's declared files-to-touch, normalized for overlap comparison (strip a
// leading ./, trim, drop blanks, dedupe). Tolerant of a missing/scalar/empty
// field — always returns an array, never throws.
export function filesToTouchOf(goal) {
  const out = [];
  const seen = new Set();
  for (const f of ensureArray(goal?.meta?.["files-to-touch"])) {
    const p = String(f).replace(/^\.\//, "").trim();
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

// PURE overlap core: given a target goal and the full goal set, return the
// conflicts — other LIVE goals whose files-to-touch intersect the target's.
// Each conflict: { slug, title, project, crossProject, files: [shared paths] }.
//
// Scoping (exit-criterion 4): cross-project overlap is the HIGH-SIGNAL case —
// two goals on different feature branches (feat/<project>) editing the same file
// will collide at merge time, so each conflict carries `crossProject` to let the
// payload flag those loudly. Same-project (or both project-less) overlaps share a
// branch and are sequential, so they're surfaced but marked lower-risk. The
// target itself is excluded by slug. Tolerant of empty files-to-touch on either
// side (no overlap → not reported); never throws.
export function computeFileConflicts(target, allGoals) {
  const targetFiles = new Set(filesToTouchOf(target));
  if (targetFiles.size === 0) return [];
  const targetSlug = target?.slug || target?.meta?.slug || "";
  const targetProject = String(target?.meta?.project || "").trim();

  const out = [];
  for (const g of ensureArray(allGoals)) {
    const slug = g?.slug || g?.meta?.slug || "";
    if (!slug || slug === targetSlug) continue;
    if (!LIVE_STATUSES.includes(statusOf(g))) continue;
    const shared = filesToTouchOf(g).filter((f) => targetFiles.has(f));
    if (shared.length === 0) continue;
    const project = String(g?.meta?.project || "").trim();
    out.push({
      slug,
      title: g?.meta?.title || slug,
      project: project || null,
      crossProject: project !== targetProject,
      files: shared.sort(),
    });
  }
  // Cross-project (high-risk) first, then by slug for stable output.
  return out.sort((a, b) =>
    (a.crossProject === b.crossProject)
      ? (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
      : (a.crossProject ? -1 : 1));
}

// archDir read wrapper around computeFileConflicts: load the target goal + every
// live goal and compute the overlap. Pure read of .arch/ — returns [] (never
// throws) for an unknown slug, an unreadable goals dir, or a target that declares
// no files-to-touch.
export function detectFileConflicts(archDir, slug) {
  let target, all;
  try {
    target = loadGoal(archDir, slug);
    all = listGoals(archDir);
  } catch { return []; }
  if (!target) return [];
  return computeFileConflicts(target, all);
}

// ── Shared agent coordination board (cgr-agent-chat-coordination-board) ──
//
// A human-readable layer on top of the structured file-overlap detection above:
// a single SHARED chat.md where parallel agents announce what they're about to
// touch and talk through potential collisions. Critical design constraint: the
// board must live in a NON-branch-isolated location, so it is GITIGNORED — a
// chat.md committed per feature branch is invisible across branches and defeats
// the purpose. It sits under goals/ for discoverability but is NOT a goal: it is
// excluded from listGoals scanning by filename (see listGoals).
export const CHAT_BOARD_FILENAME = "chat.md";

// Conventional repo-relative path shown to the agent in payload prework. archDir
// is conventionally <repo>/.arch, so the board reads as .arch/goals/chat.md —
// matching how renderPayload prints the other goal paths.
export const CHAT_BOARD_REL = `.arch/goals/${CHAT_BOARD_FILENAME}`;

export function chatBoardPath(archDir) {
  return path.join(goalsDir(archDir), CHAT_BOARD_FILENAME);
}

// Machine-readable half of each entry: a JSON blob in an HTML comment so reads
// round-trip exactly while the rendered markdown below it stays human-readable.
const CHAT_ENTRY_RE = /<!-- cgr-chat (\{[\s\S]*?\}) -->/g;

const CHAT_BOARD_HEADER = [
  "# CGR agent coordination board",
  "",
  "Shared, GITIGNORED scratchpad for parallel agents. BEFORE editing, READ what",
  "others have posted and APPEND an announce-entry (your goal, branch, and the",
  "files you're about to touch). If someone is already in a file you need,",
  "coordinate here instead of colliding. Not committed, not a goal — safe to prune.",
  "",
  "",
].join("\n");

// Append a stamped entry to the coordination board, creating it (with a header)
// on first write. Each entry records WHO (goal slug + project/branch), WHEN (ISO
// timestamp) and WHAT (files-touched) so an agent reading the board sees who is
// in which files. Tolerant of a missing goals dir/file — it creates the layout
// first and never throws on a failed write (returns written:false instead).
export function appendChatEntry(archDir, { slug = "", project = "", branch = "", files = [], note = "" } = {}) {
  const filepath = chatBoardPath(archDir);
  const at = new Date().toISOString();
  const fileList = [...new Set(
    ensureArray(files).map((f) => String(f).replace(/^\.\//, "").trim()).filter(Boolean),
  )];
  const proj = String(project || "").trim();
  const branchLabel = String(branch || (proj ? `feat/${proj}` : "")).trim();
  const entry = {
    at,
    slug: String(slug || "").trim(),
    project: proj || null,
    branch: branchLabel || null,
    files: fileList,
    note: String(note || "").trim(),
  };
  const block = [
    `<!-- cgr-chat ${JSON.stringify(entry)} -->`,
    `**${at}** · \`${entry.slug || "unknown"}\`${branchLabel ? ` on \`${branchLabel}\`` : ""}`,
    fileList.length ? `- Files: ${fileList.join(", ")}` : `- Files: (none declared)`,
    ...(entry.note ? [`- ${entry.note}`] : []),
  ].join("\n");

  try {
    ensureGoalsLayout(archDir);
    const existing = fs.existsSync(filepath) ? fs.readFileSync(filepath, "utf8") : "";
    const content = existing.trim()
      ? existing.trimEnd() + "\n\n" + block + "\n"
      : CHAT_BOARD_HEADER + block + "\n";
    fs.writeFileSync(filepath, content);
  } catch {
    return { ...entry, filepath, written: false };
  }
  return { ...entry, filepath, written: true };
}

// Read recent board entries, NEWEST FIRST. Tolerant of a missing file (returns
// []) and unparseable entries (skipped) — never throws. `limit` caps the count
// (<=0 / non-number → all).
export function readChatBoard(archDir, { limit = 20 } = {}) {
  let content;
  try { content = fs.readFileSync(chatBoardPath(archDir), "utf8"); }
  catch { return []; }
  const entries = [];
  for (const m of content.matchAll(CHAT_ENTRY_RE)) {
    try {
      const e = JSON.parse(m[1]);
      entries.push({
        at: e.at || "",
        slug: e.slug || "",
        project: e.project || null,
        branch: e.branch || null,
        files: Array.isArray(e.files) ? e.files : [],
        note: e.note || "",
      });
    } catch { /* skip a malformed entry, keep the rest */ }
  }
  entries.reverse(); // appended in time order → reverse for newest-first
  return (typeof limit === "number" && limit > 0) ? entries.slice(0, limit) : entries;
}

// Mark a goal in-progress — the relay "start" transition. Idempotent.
// Clears any stale turn-cap counter so the guard starts fresh for this goal.
// If the goal was sitting in goals/testing/ (resumed for verification), it is
// relocated back to goals/ root so an in-progress goal never lingers in the
// testing drawer — status frontmatter and folder stay consistent.
export function startGoal(archDir, slug) {
  // ensureGoalsLayout FIRST so its lazy migration relocates any legacy root
  // pending goal into queue/ BEFORE we load it — otherwise loadGoal would capture
  // the root path, migration would move it, and the relocate-write below would
  // leave a duplicate. With layout ensured first, loadGoal resolves the final
  // location and the filepath!=target rmSync cleans the source.
  ensureGoalsLayout(archDir);
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  goal.meta.status = STATUS_ACTIVE;
  if (!goal.meta.started) goal.meta.started = new Date().toISOString();
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  const targetPath = path.join(goalsDir(archDir), `${slug}.md`);
  fs.writeFileSync(targetPath, out);
  if (path.resolve(goal.filepath) !== path.resolve(targetPath)) {
    fs.rmSync(goal.filepath, { force: true });
  }
  const state = readLoopState(archDir);
  if (state[slug]) { delete state[slug]; writeLoopState(archDir, state); }
  // Queue-branch routing (cgr-relay-queue-vs-project-routing): starting an
  // UNGROUPED (no-project) goal mints/records the batch's shared cgr-queue-<date>
  // branch on first use; project goals branch per feat/<project> instead.
  // renderPayload reads this AFTER (the relay renders before starting), so the
  // first queue goal sees "create -c" and every later one sees "switch".
  if (!String(goal.meta.project || "").trim()) ensureQueueBranch(archDir);
  return { slug, status: STATUS_ACTIVE };
}

// The relay "verification" transition: move an active goal into `testing` —
// edits applied, verification still pending. Physically relocates the file into
// goals/testing/ (the loud verification drawer) and flips status to `testing`.
// Persistent across /clear: the goal stays guarded (see getActiveGoal) until a
// session runs verify green and completes it. Idempotent.
export function markTesting(archDir, slug) {
  // ensureGoalsLayout FIRST so its lazy migration relocates any legacy root
  // pending goal into queue/ BEFORE we load it — otherwise loadGoal would capture
  // the root path, migration would move it, and the relocate-write below would
  // leave a duplicate. With layout ensured first, loadGoal resolves the final
  // location and the filepath!=target rmSync cleans the source.
  ensureGoalsLayout(archDir);
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  goal.meta.status = STATUS_TESTING;
  if (!goal.meta["testing-since"]) goal.meta["testing-since"] = new Date().toISOString();
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
  // ensureGoalsLayout FIRST so its lazy migration relocates any legacy root
  // pending goal into queue/ BEFORE we load it — otherwise loadGoal would capture
  // the root path, migration would move it, and the relocate-write below would
  // leave a duplicate. With layout ensured first, loadGoal resolves the final
  // location and the filepath!=target rmSync cleans the source.
  ensureGoalsLayout(archDir);
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
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
  // Tolerate both date-only (legacy) and full-datetime stamps by comparing on
  // the calendar day — a datetime `testing-since` must still age correctly.
  const d = new Date(`${stampDate(fromISODate)}T00:00:00Z`);
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

// ── Queue-vs-project routing (cgr-relay-queue-vs-project-routing) ──
//
// `project` (ADR 0010) splits the live queue into two tracks: project-grouped
// goals (each a branch-isolated feature set on feat/<project>) and UNGROUPED
// goals (the plain "queue", worked on a single shared dated branch — see
// ensureQueueBranch). When BOTH tracks have ready work, auto-picking one silently
// is wrong — the user may want to push a feature set or drain the queue. So the
// relay SURFACES A CHOICE instead of guessing. When only one track has work it
// auto-picks exactly as nextEligibleGoal does (no extra prompt).
//
// Precedence is preserved (exit-criterion 4): an in-progress goal is resumed
// before any choice (a genuinely active goal is never interrupted), and the
// choice considers only deps-satisfied goals (a dependency-blocked goal never
// triggers a prompt). The testing-backlog threshold is a WITHIN-track refinement
// and does not pre-empt the cross-track choice.
//
// Returns one of:
//   { kind: "resume", goal }   — an in-progress goal to continue
//   { kind: "single", goal }   — exactly one track had work; auto-picked
//   { kind: "choice", queue, queueNext, projects, projectNext }
//                              — both tracks have work; caller prompts the user
//   { kind: "none" }           — nothing eligible (empty/blocked queue)
export function routeNextGoal(archDir) {
  const goals = listGoals(archDir);

  // (1) Resume actively-worked goal first — never interrupted by the choice.
  const inProgress = goals.find((g) => statusOf(g) === STATUS_ACTIVE);
  if (inProgress) return { kind: "resume", goal: inProgress };

  const depsSatisfied = (g) => {
    const deps = ensureArray(g.meta["depends-on"]);
    return !deps.some((d) => !isGoalDone(archDir, d));
  };
  // Eligible = not done, not parked, deps satisfied — the same gate
  // nextEligibleGoal applies before its threshold ordering.
  const eligible = goals.filter((g) => {
    const s = statusOf(g);
    if (s === STATUS_COMPLETED || s === STATUS_ON_HOLD) return false;
    return depsSatisfied(g);
  });
  const projectOf = (g) => String(g?.meta?.project || "").trim();
  const grouped = eligible.filter((g) => projectOf(g));
  const ungrouped = eligible.filter((g) => !projectOf(g));

  // (2) Both tracks have ready work → surface a choice rather than auto-pick.
  if (grouped.length > 0 && ungrouped.length > 0) {
    const projects = {};
    for (const g of grouped) (projects[projectOf(g)] ||= []).push(g.slug);
    const projectNext = {};
    for (const [p, slugs] of Object.entries(projects)) projectNext[p] = slugs[0];
    return {
      kind: "choice",
      queue: ungrouped.map((g) => g.slug),
      queueNext: ungrouped[0].slug,
      projects,
      projectNext,
    };
  }

  // (3) One track (or neither) → auto-pick with the existing threshold ordering.
  const goal = nextEligibleGoal(archDir);
  return goal ? { kind: "single", goal } : { kind: "none" };
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

// ── Shared dated queue branch (cgr-relay-queue-vs-project-routing) ──
//
// The ungrouped (no-project) complement to feat/<project>: every plain queue
// goal in the current batch is worked on ONE shared branch named
// cgr-queue-<YYYY-MM-DD>. The name is RECORDED ONCE when first minted (state
// below) so every subsequent queue goal REUSES it instead of spawning a branch
// per pick. archkit stamps the date and records the NAME only — it never runs
// git (instruct-not-act, ADR 0010). State lives beside the goals as JSON, so
// listGoals (which only scans .md) never picks it up. Cleared when the ungrouped
// queue drains (completeGoal) so the next batch mints a fresh dated branch.
function queueStatePath(archDir) {
  return path.join(goalsDir(archDir), ".queue-state.json");
}

// Derive the queue branch name for a given day (defaults to today). archkit owns
// the date stamp; `date` is injectable for deterministic tests.
export function queueBranchName(date) {
  const day = stampDate(date) || new Date().toISOString().slice(0, 10);
  return `cgr-queue-${day}`;
}

// The recorded queue branch for the current batch, or null when none is minted
// yet. Pure read; tolerant of a missing/garbage state file (never throws).
export function readQueueBranch(archDir) {
  try {
    const s = JSON.parse(fs.readFileSync(queueStatePath(archDir), "utf8"));
    const b = String(s?.branch || "").trim();
    return b || null;
  } catch { return null; }
}

// Record the batch's queue branch the FIRST time an ungrouped goal is started,
// then REUSE it for every later queue goal. Returns the effective branch name.
// Idempotent: once recorded it returns the existing name unchanged (so the whole
// batch shares one branch). Best-effort write — a state-write hiccup degrades to
// re-deriving today's name, never blocks the relay.
export function ensureQueueBranch(archDir, { date } = {}) {
  const existing = readQueueBranch(archDir);
  if (existing) return existing;
  const branch = queueBranchName(date);
  try {
    ensureGoalsLayout(archDir);
    fs.writeFileSync(queueStatePath(archDir), JSON.stringify({
      branch,
      minted: stampDate(date) || new Date().toISOString().slice(0, 10),
    }, null, 2));
  } catch { /* best-effort: re-derivable from date */ }
  return branch;
}

// Drop the recorded queue branch once no ungrouped (queue) goal remains live, so
// the next batch of plain goals mints a fresh cgr-queue-<date> rather than
// reusing a stale day's branch. Project goals are irrelevant here (they branch
// per feat/<project>). Never throws.
export function clearQueueBranchIfDrained(archDir) {
  try {
    const stillQueued = listGoals(archDir).some((g) =>
      statusOf(g) !== STATUS_COMPLETED && !String(g?.meta?.project || "").trim());
    if (!stillQueued) fs.rmSync(queueStatePath(archDir), { force: true });
  } catch { /* ignore */ }
}

// ── End-of-bucket completion: merge-or-archive (cgr-project-completion-merge-or-archive) ──
//
// Teardown counterpart to the branch-prework block renderPayload emits at the
// START of a feature set. When completing a goal DRAINS the last live goal of its
// bucket — a project feature set (feat/<project>) or the ungrouped queue
// (cgr-queue-<date>) — the branch-isolated work is finished, and there is a
// landing choice: merge the branch into a mainline, or archive only (let the
// CGRs consolidate into done/ as every completion already does, leaving the
// branch unmerged). archkit only EMITS git guidance here; it never runs git
// (instruct-not-act, ADR 0010) — the agent presents the choice and the user runs
// the commands on 'merge'.
//
// "Live" for drain purposes = pending | in-progress | testing (the states that
// represent unfinished work). on-hold (deliberately parked), completed, and
// abandoned do NOT keep a bucket alive — a bucket holding only parked/terminal
// goals counts as drained.
const DRAIN_LIVE_STATUSES = [STATUS_PENDING, STATUS_ACTIVE, STATUS_TESTING];

// PURE: does completing `slug` drain the last live goal of its bucket? `goals` is
// the full live goal set (as from listGoals, INCLUDING the goal being completed,
// which is typically still in-progress). The goal being completed is excluded
// from the remaining-count (we ask "after this completes, is anything live left
// in the same bucket?"). Returns { drained, bucket:'project'|'queue', project,
// remaining }. drained is false (bucket/project still resolved) when other live
// goals remain; { drained:false, bucket:null, project:null } when the slug isn't
// in the set. Tolerates ungrouped goals (bucket:'queue', project:null) and never
// throws.
export function detectBucketDrain(goals, slug) {
  const list = ensureArray(goals);
  const want = String(slug || "");
  const target = list.find((g) => (g?.slug || g?.meta?.slug) === want);
  if (!target) return { drained: false, bucket: null, project: null, remaining: 0 };
  const project = String(target?.meta?.project || "").trim();
  const bucket = project ? "project" : "queue";
  const sameBucket = (g) => {
    const p = String(g?.meta?.project || "").trim();
    return project ? p === project : !p;
  };
  let remaining = 0;
  for (const g of list) {
    const s = g?.slug || g?.meta?.slug;
    if (!s || s === want) continue;
    if (!sameBucket(g)) continue;
    if (DRAIN_LIVE_STATUSES.includes(statusOf(g))) remaining++;
  }
  return { drained: remaining === 0, bucket, project: project || null, remaining };
}

// The mainline branch a drained bucket's feature branch merges INTO. Config wins
// (.arch/config.json → cgr.mainline); otherwise detect main/master from the
// repo's refs WITHOUT running git (instruct-not-act — archkit reads the
// filesystem, never shells out), defaulting to "main". archDir is conventionally
// <repo>/.arch, so .git sits one level up. Never throws.
export function detectMainline(archDir) {
  // 1) explicit config override.
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(archDir, "config.json"), "utf8"));
    const m = cfg?.cgr?.mainline;
    if (typeof m === "string" && m.trim()) return { mainline: m.trim(), source: "config" };
  } catch { /* no/invalid config → detect */ }
  const gitDir = path.join(path.dirname(archDir), ".git");
  // 2) loose refs: .git/refs/heads/<name>.
  for (const name of ["main", "master"]) {
    try {
      if (fs.existsSync(path.join(gitDir, "refs", "heads", name))) {
        return { mainline: name, source: "detected" };
      }
    } catch { /* ignore */ }
  }
  // 2b) packed-refs fallback (refs get packed away from loose files).
  try {
    const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
    for (const name of ["main", "master"]) {
      if (new RegExp(`\\srefs/heads/${name}$`, "m").test(packed)) {
        return { mainline: name, source: "detected" };
      }
    }
  } catch { /* no packed-refs */ }
  // 3) modern default.
  return { mainline: "main", source: "default" };
}

// The git branch a drained bucket lives on: feat/<project> for a project bucket,
// the recorded shared cgr-queue-<date> for the ungrouped queue (falling back to
// today's derived name if the queue-state file is already gone). Read this BEFORE
// completeGoal clears the queue state, or the queue branch resolves to today's
// derived name instead of the recorded batch branch.
export function bucketBranch(archDir, { bucket, project } = {}) {
  if (bucket === "project" && project) return `feat/${project}`;
  return readQueueBranch(archDir) || queueBranchName();
}

// Git guidance to LAND a drained bucket's branch into mainline. archkit only
// EMITS this string — it never runs git (instruct-not-act, ADR 0010). Withheld
// entirely on the archive-only path.
export function bucketMergeGuidance({ branch, mainline }) {
  return `git switch ${mainline} && git merge ${branch}`;
}

// Compose the end-of-bucket merge-or-archive choice for a completing goal, or
// null when the completion does NOT drain the bucket (an ordinary mid-bucket
// completion). `goals` is the full live set (pre-completion). Resolves the bucket
// branch + mainline target + the merge-guidance string up front so the relay/CLI
// can surface the choice. Pure read of .arch/; never throws.
export function bucketCompletion(archDir, goals, slug) {
  let drain;
  try { drain = detectBucketDrain(goals, slug); } catch { return null; }
  if (!drain || !drain.drained) return null;
  const branch = bucketBranch(archDir, drain);
  const { mainline, source: mainlineSource } = detectMainline(archDir);
  return {
    bucket: drain.bucket,          // 'project' | 'queue'
    project: drain.project,        // <slug> | null
    branch,
    mainline,
    mainlineSource,                // 'config' | 'detected' | 'default'
    mergeGuidance: bucketMergeGuidance({ branch, mainline }),
  };
}

// Drop a goal without marking it done — archived to done/ with status
// "abandoned" (kept for history, distinguishable from completed). Releases the
// relay guard by clearing the active goal + its turn-cap counter.
export function abandonGoal(archDir, slug, { reason = "" } = {}) {
  // ensureGoalsLayout FIRST so its lazy migration relocates any legacy root
  // pending goal into queue/ BEFORE we load it — otherwise loadGoal would capture
  // the root path, migration would move it, and the relocate-write below would
  // leave a duplicate. With layout ensured first, loadGoal resolves the final
  // location and the filepath!=target rmSync cleans the source.
  ensureGoalsLayout(archDir);
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
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
  // Day-granular for the digest summary (completed may now be a full datetime).
  const completedOn = stampDate(m.completed || m.abandoned || m.created || "");
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

// Split a digest file's body into per-goal entries (slug/title/date/outcome),
// mirroring digestEntry()'s emitted shape. Each entry is delimited by the
// `<!-- cgr-digest-slug: SLUG -->` marker. Pure; tolerant of missing lines.
function parseDigestEntries(content) {
  const text = String(content || "");
  const entries = [];
  const re = /<!-- cgr-digest-slug: (.+?) -->([\s\S]*?)(?=<!-- cgr-digest-slug:|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const slug = m[1].trim();
    const block = m[2] || "";
    const titleM = block.match(/^##\s+.+?—\s+(.+)$/m);
    const dateM = block.match(/^-\s+Date:\s+(.+)$/m);
    const outcomeM = block.match(/^-\s+Outcome:\s+(.+)$/m);
    entries.push({
      slug,
      title: titleM ? titleM[1].trim() : slug,
      date: dateM ? dateM[1].trim() : "",
      outcome: outcomeM ? outcomeM[1].trim() : "",
    });
  }
  return entries;
}

// Goals marked completed on a given ISO day (YYYY-MM-DD), deduped by slug,
// drawn from BOTH the un-consolidated raw files at done/ root AND consolidated
// digest entries — so the relay's "done today" breadcrumb stays correct whether
// or not consolidation has run. Abandoned goals are excluded (not "completed").
// Title falls back to slug. Pure read of .arch/; never throws.
export function goalsCompletedOn(archDir, day) {
  const seen = new Set();
  const out = [];
  const add = (slug, title) => {
    const s = String(slug || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push({ slug: s, title: String(title || "").trim() || s });
  };

  // 1) Un-consolidated raw terminal files at done/ root.
  for (const g of listTerminalGoals(archDir)) {
    if (statusOf(g) !== STATUS_COMPLETED) continue;
    if (stampDate(g.meta?.completed) === day) add(g.slug, g.meta?.title);
  }

  // 2) Consolidated digest entries dated `day` with a completed outcome. Match
  // on the per-entry Date (the goal's completion day), not the digest filename.
  for (const dgst of listDigests(archDir)) {
    for (const e of parseDigestEntries(dgst.content)) {
      if (e.date === day && /^completed/i.test(e.outcome)) add(e.slug, e.title);
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Worklog export (goal-worklog-export)
//
// A copy-pasteable day-by-day log of COMPLETED goals — title, outcome, time, and
// completion notes — built as a pure report over completed-goal data already on
// disk. The deliverable users asked for: something to post to Jira / standups so
// the goal_next→/clear→goal_next loop stops losing track of what got done.
//
// Time honesty (mirrors effortOf): the explicit hand-entered effort (time-spent)
// wins when set; otherwise the derived started→completed wall-clock is shown
// tagged '(elapsed)' so an estimate is never misreported as logged effort; a
// legacy date-only goal (no derivable span, no override) shows no time at all.
// ───────────────────────────────────────────────────────────────────────────

// Parse a humanized duration ('2h', '90m', '1h 30m', '1h30m', '30s', '2h 15m')
// back to milliseconds for summing into a range total. Tolerates the exact
// strings formatDuration emits plus loose user input. Returns null when nothing
// time-like is found (so an unparseable value is excluded from a total, never
// counted as zero). Pure.
export function effortToMs(text) {
  const s = String(text || "").toLowerCase();
  const re = /(\d+(?:\.\d+)?)\s*([hms])/g;
  let m, ms = 0, matched = false;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    const n = parseFloat(m[1]);
    if (m[2] === "h") ms += n * 3600000;
    else if (m[2] === "m") ms += n * 60000;
    else ms += n * 1000;
  }
  return matched ? Math.round(ms) : null;
}

// Resolve a worklog date range from optional --from/--to. Default is TODAY;
// `from` alone runs from that day through today; `to` alone is open-started
// (everything up to that day); both pins both ends (swapped order normalized).
// Days are ISO YYYY-MM-DD, so lexical comparison is chronological.
function resolveWorklogRange({ from, to, today }) {
  const f = stampDate(from);
  const t = stampDate(to);
  if (!f && !t) return { from: today, to: today };
  if (f && !t) return { from: f, to: today };
  if (!f && t) return { from: "", to: t }; // open start
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

// One worklog entry per COMPLETED goal, drawn from every source that records a
// completion: un-consolidated raw files at done/ root, raw archives under
// done/archive/, and — as a sparse fallback for goals whose raw file is gone —
// consolidated digest entries. Deduped by slug, preferring a full-frontmatter
// source (root/archive, which carry notes + time) over the sparse digest entry,
// so each entry is as rich as the surviving data allows. Filtered to completions
// whose day falls within [from,to] inclusive (an empty bound is open on that
// side). Abandoned goals are excluded — a worklog is what got DONE. Pure read of
// .arch/; never throws. Sorted most-recent completion first.
export function collectWorklogEntries(archDir, { from = "", to = "" } = {}) {
  const lo = stampDate(from);
  const hi = stampDate(to);
  const inRange = (day) => !!day && (!lo || day >= lo) && (!hi || day <= hi);

  const bySlug = new Map();
  const addRich = (goal) => {
    if (statusOf(goal) !== STATUS_COMPLETED) return;
    const day = stampDate(goal.meta?.completed);
    if (!inRange(day)) return;
    const eff = effortOf(goal);
    const tests = goal.meta?.["tests-passed"]
      ? ` (tests: ${goal.meta["tests-command"] || "verify"} passed)`
      : "";
    bySlug.set(goal.slug, {
      slug: goal.slug,
      title: goal.meta?.title || goal.slug,
      day,
      completed: goal.meta?.completed || day,
      outcome: `${STATUS_COMPLETED}${tests}`,
      notes: goal.meta?.["completion-notes"] || "",
      effort: { source: eff.source, display: eff.display, elapsedMs: eff.elapsedMs },
    });
  };

  // 1) Un-consolidated raw terminal files at done/ root (richest, freshest).
  for (const g of listTerminalGoals(archDir)) addRich(g);

  // 2) Raw archives preserved verbatim at consolidation — same full frontmatter.
  const aDir = archiveDir(archDir);
  if (fs.existsSync(aDir)) {
    for (const name of fs.readdirSync(aDir)) {
      if (!name.endsWith(".md")) continue;
      const fp = path.join(aDir, name);
      try {
        if (!fs.statSync(fp).isFile()) continue;
        const parsed = parseGoal(fs.readFileSync(fp, "utf8"));
        const slug = parsed.meta.slug || name.replace(/\.md$/, "");
        if (bySlug.has(slug)) continue; // a root copy is already at least as rich
        addRich({ slug, meta: parsed.meta, body: parsed.body });
      } catch { /* skip unreadable */ }
    }
  }

  // 3) Sparse fallback — a consolidated digest entry whose raw archive is gone.
  // Carries title/outcome/day only (no notes, no time), so it's used ONLY when
  // nothing richer for that slug exists.
  for (const dgst of listDigests(archDir)) {
    for (const e of parseDigestEntries(dgst.content)) {
      if (bySlug.has(e.slug)) continue;
      if (!/^completed/i.test(e.outcome)) continue;
      if (!inRange(e.date)) continue;
      bySlug.set(e.slug, {
        slug: e.slug,
        title: e.title || e.slug,
        day: e.date,
        completed: e.date,
        outcome: e.outcome,
        notes: "",
        effort: { source: "none", display: null, elapsedMs: null },
      });
    }
  }

  return [...bySlug.values()].sort((a, b) =>
    a.completed < b.completed ? 1 : a.completed > b.completed ? -1 : a.slug < b.slug ? -1 : 1);
}

// Render the worklog as copy-pasteable markdown over a date or date range,
// grouped by day (most recent first). Each entry shows title, outcome, time
// (explicit effort, else elapsed-tagged wall-clock, else nothing) and completion
// notes. A range total sums whatever effort is quantifiable (parsed explicit +
// derived elapsed) and flags how many entries had untracked time, so the figure
// is never silently incomplete. `today` is injectable for deterministic tests.
// Returns { from, to, count, totalMs, totalDisplay, entries, markdown }.
export function renderWorklog(archDir, { from = "", to = "", today } = {}) {
  const day0 = today || new Date().toISOString().slice(0, 10);
  const range = resolveWorklogRange({ from, to, today: day0 });
  const entries = collectWorklogEntries(archDir, range);

  const label = range.from === range.to
    ? range.from
    : `${range.from || "…"} → ${range.to}`;

  let totalMs = 0, timed = 0;
  for (const e of entries) {
    const ms = e.effort.source === "explicit" ? effortToMs(e.effort.display)
      : e.effort.source === "derived" ? e.effort.elapsedMs
        : null;
    if (ms != null) { totalMs += ms; timed++; }
  }
  const totalDisplay = timed > 0 ? formatDuration(totalMs) : null;

  const lines = [`# Worklog — ${label}`, ""];
  if (entries.length === 0) {
    lines.push(`_No completed goals in ${label}._`);
  } else {
    let lastDay = null;
    for (const e of entries) {
      if (e.day !== lastDay) {
        if (lastDay !== null) lines.push("");
        lines.push(`## ${e.day}`, "");
        lastDay = e.day;
      }
      const time = e.effort.display
        ? ` — ${e.effort.display}${e.effort.source === "derived" ? " (elapsed)" : ""}`
        : "";
      lines.push(`- **${e.title}** (\`${e.slug}\`) — ${e.outcome}${time}`);
      if (e.notes) lines.push(`  ${oneLine(e.notes, 300)}`);
    }
    lines.push("");
    lines.push(totalDisplay
      ? `_${entries.length} goal(s) · ~${totalDisplay} logged${timed < entries.length ? ` (${entries.length - timed} untracked)` : ""}_`
      : `_${entries.length} goal(s) · time untracked_`);
  }

  return {
    from: range.from,
    to: range.to,
    count: entries.length,
    totalMs: timed > 0 ? totalMs : null,
    totalDisplay,
    entries,
    markdown: lines.join("\n") + "\n",
  };
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
