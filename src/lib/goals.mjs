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
import { archkitError } from "./errors.mjs";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
// Copy-paste ceiling: the `archkit goal payload` / `/goal` fallback path pastes
// the payload as a slash-command argument, which Claude Code caps. 3800 leaves
// slack for inline edits. Still the default for renderPayload.
export const PAYLOAD_BUDGET = 3800;

// Relay ceiling: the /mcp__archkit__conductor prompt injects the payload as an
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

// The quarantine drawer: where reconcileGoalsLayout parks .md files it can't
// place — no frontmatter, or frontmatter with no `status:` field. They're moved
// OUT of the live goals tree (not deleted) so a junk file can never masquerade
// as a goal and get picked up by the relay, while a human can still recover it.
export function quarantineDir(archDir) {
  return path.join(goalsDir(archDir), "quarantine");
}

// ───────────────────────────────────────────────────────────────────────────
// Full-tree placement reconciliation (reconcile-goals-layout)
//
// Status is the source of truth; the folder is a DERIVED cache (ADR 0003). After
// working several projects, CGR files drift into the narrow scan's blind spots
// (queueGoalFiles only looks one level deep; flatGoalFiles only at each dir's top
// level) and get skipped — or a stale zombie copy shadows the live one and the
// relay picks the wrong goal. migratePendingGoalsToQueue fixes ONLY legacy root
// pending; this is the general form: walk the ENTIRE goals tree at any depth,
// read each file's status, and re-file it into the folder that status dictates.
//
// Canonical folder per (normalized) status:
//   pending                 → queue/  (or queue/<project>/ when project-tagged)
//   in-progress | on-hold   → goals/ root   (live work; status distinguishes them)
//   testing                 → testing/
//   completed | abandoned   → done/   (a copy already under done/archive/ counts as placed)
// Any other/unknown-but-present status is left where it is (conservative — only
// the states we own are re-filed). A file with NO status is not a goal → quarantined.
// ───────────────────────────────────────────────────────────────────────────

// Normalized status if the file actually declares one, else null. Unlike
// statusOf, this does NOT default a status-less file to `pending` — a missing
// status is the signal that the file isn't a goal (→ quarantine), so we must be
// able to tell "no status" apart from "status: pending".
function declaredStatus(meta) {
  const raw = meta?.status;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  return STATUS_ALIASES[v] || v;
}

// The folder a goal's status dictates. Returns null for statuses we don't own
// (e.g. proposed, or anything unrecognized) so those files are left untouched.
function canonicalDirFor(archDir, status, project) {
  switch (status) {
    case STATUS_PENDING:
      return project ? path.join(queueDir(archDir), slugify(project)) : queueDir(archDir);
    case STATUS_ACTIVE:
    case STATUS_ON_HOLD:
      return goalsDir(archDir);
    case STATUS_TESTING:
      return testingDir(archDir);
    case STATUS_COMPLETED:
    case "abandoned":
      return doneDir(archDir);
    default:
      return null;
  }
}

// Is this goal file already in the folder its status dictates? For terminal
// goals, an already-consolidated copy under done/archive/ also counts as placed
// (so reconcile never drags archived history back up to done/ top-level).
function isPlacedCorrectly(archDir, g) {
  const canonical = canonicalDirFor(archDir, g.status, g.project);
  if (!canonical) return true; // status we don't re-file → leave it
  const dir = path.resolve(g.dir);
  if (dir === path.resolve(canonical)) return true;
  if ((g.status === STATUS_COMPLETED || g.status === "abandoned") &&
      dir === path.resolve(archiveDir(archDir))) return true;
  return false;
}

// Every *.md file anywhere under goals/, at any depth — EXCEPT the coordination
// board (chat.md, not a goal) and the non-goal drawers (digest/ holds digests,
// proposed/ holds proposals, quarantine/ is already-parked junk). Never throws;
// an unreadable dir is skipped. This is the wide scan migratePendingGoalsToQueue
// deliberately isn't.
function walkGoalMarkdownFiles(archDir) {
  const root = goalsDir(archDir);
  const skip = new Set(
    [digestDir(archDir), proposedDir(archDir), quarantineDir(archDir)].map((d) => path.resolve(d)),
  );
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(path.resolve(full))) continue;
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".md") && e.name !== CHAT_BOARD_FILENAME) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

// Park a file in quarantine/ (never delete). Keeps the basename, disambiguating
// on collision so two junk `notes.md` files don't clobber each other. Tolerant —
// a hiccup skips the file rather than throwing.
function quarantineFile(archDir, file) {
  try {
    const qDir = quarantineDir(archDir);
    fs.mkdirSync(qDir, { recursive: true });
    const base = path.basename(file);
    let dest = path.join(qDir, base);
    let n = 1;
    while (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(file)) {
      dest = path.join(qDir, base.replace(/\.md$/, `-${n}.md`));
      n++;
    }
    if (path.resolve(dest) !== path.resolve(file)) {
      fs.writeFileSync(dest, fs.readFileSync(file, "utf8"));
      fs.rmSync(file, { force: true });
    }
    return path.relative(archDir, dest);
  } catch { return null; }
}

// Reconcile every goal file to the folder its status dictates. Pure dry-run when
// apply:false (computes the report, writes nothing); apply:true performs the
// moves, resolves zombie duplicate slugs (keeps the copy whose location already
// matches its status, removes the rest), and quarantines status-less/unparseable
// .md files. Never throws — a reconcile hiccup must not block the relay (mirrors
// migratePendingGoalsToQueue's tolerance) — and idempotent: a second run over a
// reconciled tree reports nothing and moves nothing. Returns a structured report:
//   { moved:[{slug,from,to,status}], duplicates:[{slug,kept,removed}],
//     quarantined:[{file,reason}], outOfPlaceCount }
// where outOfPlaceCount is the number of misfiled goals (== moved.length) — the
// health signal a startup auto-fix keys off of.
export function reconcileGoalsLayout(archDir, { apply = false } = {}) {
  const report = { moved: [], duplicates: [], quarantined: [], outOfPlaceCount: 0 };
  const rel = (f) => path.relative(archDir, f);

  let files;
  try { files = walkGoalMarkdownFiles(archDir); } catch { return report; }

  // Pass 1: parse. Status-less / unreadable files are quarantined; the rest
  // become goal records carrying their slug, normalized status, and project.
  const goals = [];
  for (const file of files) {
    let meta;
    try { ({ meta } = parseGoal(fs.readFileSync(file, "utf8"))); }
    catch {
      report.quarantined.push({ file: rel(file), reason: "unreadable" });
      if (apply) quarantineFile(archDir, file);
      continue;
    }
    const status = declaredStatus(meta);
    if (!status) {
      report.quarantined.push({
        file: rel(file),
        reason: meta && Object.keys(meta).length ? "missing status field" : "no parseable frontmatter",
      });
      if (apply) quarantineFile(archDir, file);
      continue;
    }
    goals.push({
      file,
      dir: path.dirname(file),
      slug: String(meta.slug || path.basename(file).replace(/\.md$/, "")).trim(),
      status,
      project: String(meta.project || "").trim(),
    });
  }

  // Pass 2: resolve zombie duplicate slugs. Keep the copy whose location already
  // matches its status (deterministic tie-break by path); remove the rest.
  const bySlug = new Map();
  for (const g of goals) {
    if (!bySlug.has(g.slug)) bySlug.set(g.slug, []);
    bySlug.get(g.slug).push(g);
  }
  const survivors = [];
  for (const [slug, group] of bySlug) {
    if (group.length === 1) { survivors.push(group[0]); continue; }
    const byPath = [...group].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    const placed = byPath.filter((g) => isPlacedCorrectly(archDir, g));
    const keeper = placed[0] || byPath[0];
    for (const g of byPath) {
      if (g === keeper) continue;
      report.duplicates.push({ slug, kept: rel(keeper.file), removed: rel(g.file) });
      if (apply) { try { fs.rmSync(g.file, { force: true }); } catch {} }
    }
    survivors.push(keeper);
  }

  // Pass 3: re-file misplaced survivors into their canonical folder.
  for (const g of survivors) {
    if (isPlacedCorrectly(archDir, g)) continue;
    const canonical = canonicalDirFor(archDir, g.status, g.project);
    if (!canonical) continue; // status we don't own — left in place
    const dest = path.join(canonical, `${g.slug}.md`);
    report.moved.push({ slug: g.slug, from: rel(g.file), to: rel(dest), status: g.status });
    if (apply) {
      try {
        fs.mkdirSync(canonical, { recursive: true });
        if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(g.file)) {
          // A different file already sits at the destination — treat as a zombie
          // duplicate: keep the one already in place, drop the mover.
          report.duplicates.push({ slug: g.slug, kept: rel(dest), removed: rel(g.file) });
          fs.rmSync(g.file, { force: true });
        } else {
          fs.writeFileSync(dest, fs.readFileSync(g.file, "utf8"));
          if (path.resolve(dest) !== path.resolve(g.file)) fs.rmSync(g.file, { force: true });
        }
      } catch { /* skip this file, keep going */ }
    }
  }

  report.outOfPlaceCount = report.moved.length;
  return report;
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
    // CGR 2.0 parallel-lane prediction (intake-dag-ownership): `owns` are the file
    // globs this goal claims (the unit of conflict/lane partitioning), `feature` is
    // the cohesion tag lanes group by, and `exclusive` flags a cross-cutting goal
    // that must run solo as a barrier. All optional and only stamped when provided,
    // so goals predating these fields are untouched. dependsOn above already carries
    // the DAG edges (dependsOnOf unions depends-on + depends_on).
    ...(goal.owns && goal.owns.length ? { owns: goal.owns } : {}),
    ...(goal.feature ? { feature: goal.feature } : {}),
    ...(goal.exclusive ? { exclusive: true } : {}),
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
// exit-criteria to guard, and the /mcp__archkit__conductor prompt can advance
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

// ───────────────────────────────────────────────────────────────────────────
// CGR 2.0 extended frontmatter (board-state-manager / ADR 0014)
//
// The persistent board needs richer per-CGR structure than the base lifecycle
// fields: `lane` (which parallel track the CGR runs on), `owns` (file globs this
// CGR claims — the unit of conflict detection), `depends_on` (cross-CGR ordering),
// `exclusive` (must run alone in its lane), `completion` (full|partial — fission
// marks a split CGR partial), `lease` ({worker, expires} — the claim TTL so an
// orphaned in-flight CGR can be reclaimed), `lineage` ({forked_from, supersedes,
// superseded_by} — fission ancestry, linked both ways), per-criterion `met` flags,
// and a `handoff` pointer (the carry-forward artifact authored at wind-down).
//
// Object fields (lease/lineage) are stored as INLINE JSON in the simple
// key:value frontmatter — this keeps the no-YAML-dependency format (parseGoal
// stores a `{...}` value verbatim as a string, emitFrontmatter writes it back
// unchanged) while still round-tripping. The accessors below parse them back.
// Every accessor is tolerant (missing / scalar / malformed → null or []) and
// never throws, mirroring the rest of this module.
// ───────────────────────────────────────────────────────────────────────────

function parseJsonField(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  try { const o = JSON.parse(s); return o && typeof o === "object" ? o : null; }
  catch { return null; }
}

export function laneOf(goal) {
  const v = goal?.meta?.lane;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// File globs a CGR claims ownership of — the basis for conflict/exclusivity.
export function ownsOf(goal) {
  return ensureArray(goal?.meta?.owns).map((s) => String(s).trim()).filter(Boolean);
}

// Cross-CGR ordering. The new underscore form (`depends_on`) is canonical and is
// unioned with the base `depends-on` field so the two vocabularies stay one set.
export function dependsOnOf(goal) {
  const out = [];
  const seen = new Set();
  for (const d of [...ensureArray(goal?.meta?.depends_on), ...ensureArray(goal?.meta?.["depends-on"])]) {
    const s = String(d).trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

// Must this CGR run alone in its lane? Tolerates the frontmatter scalar being the
// string "true" (parseGoal reads everything as strings) or a real boolean.
export function exclusiveOf(goal) {
  const v = goal?.meta?.exclusive;
  return v === true || v === "true";
}

// The feature-cohesion tag — the PRIMARY lane-grouping signal (intake-dag-ownership).
// CGRs sharing a feature touch the same surface, so they're kept in one lane (serial,
// context-warm). Slugified-ish: trimmed, lowercased so "Auth UI" and "auth ui" group.
// Empty/missing → null (an untagged goal groups only by owns-overlap).
export function featureOf(goal) {
  const v = goal?.meta?.feature;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s || null;
}

export function completionOf(goal) {
  const v = goal?.meta?.completion;
  return v === "full" || v === "partial" ? v : null;
}

// The claim lease: { worker, expires }. Parsed from inline JSON; missing keys
// degrade to null rather than throwing.
export function leaseOf(goal) {
  const o = parseJsonField(goal?.meta?.lease);
  if (!o) return null;
  return { worker: o.worker ?? null, expires: o.expires ?? null };
}

// Fission ancestry: { forked_from, supersedes, superseded_by }. Parsed from
// inline JSON; a CGR with no lineage returns null.
export function lineageOf(goal) {
  const o = parseJsonField(goal?.meta?.lineage);
  if (!o) return null;
  return {
    forked_from: o.forked_from ?? null,
    supersedes: o.supersedes ?? null,
    superseded_by: o.superseded_by ?? null,
  };
}

// Per-criterion met flags, aligned by index with exit-criteria. Coerces the
// string "true"/booleans the block-array parser yields into real booleans.
export function criteriaMetOf(goal) {
  return ensureArray(goal?.meta?.["criteria-met"]).map((v) => v === true || v === "true");
}

// Pointer to the carry-forward handoff artifact (e.g. .arch/board/handoff/<slug>.md).
export function handoffOf(goal) {
  const v = goal?.meta?.handoff;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// The board-extended frontmatter keys, mapping a friendly input name to its
// frontmatter key. lease/lineage are object fields serialized to inline JSON;
// everything else is a scalar or block-array emitFrontmatter already handles.
const EXTENDED_FIELD_MAP = Object.freeze({
  lane: "lane",
  owns: "owns",
  dependsOn: "depends_on",
  exclusive: "exclusive",
  completion: "completion",
  lease: "lease",
  lineage: "lineage",
  criteriaMet: "criteria-met",
  handoff: "handoff",
});
const EXTENDED_JSON_FIELDS = new Set(["lease", "lineage"]);

// Stamp CGR 2.0 extended frontmatter onto an existing live goal IN PLACE (the
// file stays in its current location). Only the keys present in `fields` are
// touched; passing a key as null/undefined deletes it. Object fields (lease,
// lineage) are serialized to inline JSON so the no-YAML frontmatter round-trips.
// This is how the conductor records lane/owns/depends_on/lease/lineage onto a CGR
// — the board itself stays derived (it only READS these via the accessors above).
export function stampGoalFields(archDir, slug, fields = {}) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  for (const [inputKey, metaKey] of Object.entries(EXTENDED_FIELD_MAP)) {
    if (!(inputKey in fields)) continue;
    const val = fields[inputKey];
    if (val == null) { delete goal.meta[metaKey]; continue; }
    goal.meta[metaKey] = EXTENDED_JSON_FIELDS.has(metaKey) ? JSON.stringify(val) : val;
  }
  const out = `---\n${emitFrontmatter(goal.meta)}\n---\n\n${goal.body || ""}`;
  fs.writeFileSync(goal.filepath, out);
  return { slug, filepath: goal.filepath };
}

// ── Fission: partial-complete split (fission-transition, ADR 0014/0015) ──
//
// At wind-down a fully-met CGR closes normally; a partially-met CGR SPLITS: the
// finished portion closes as a terminal `partial` record and a LEAN successor CGR
// is forked carrying ONLY the unmet exit-criteria + a carry-forward handoff +
// lineage linked both ways (forked_from / superseded_by). These PURE helpers do
// the criteria partition + successor authoring; the verify GATE that guards the
// split (block on unverifiable/red — no silent debt fork) lives in the command
// layer (runGoalFission) where the test-runner runs, mirroring runGoalComplete.

// True when a goal is a fission CONTINUATION — it carries a lineage.forked_from
// pointer. The scheduler prefers continuations (warm carry-forward) over cold
// pending work (ADR 0014). Tolerant: a goal with no lineage → false.
export function isContinuation(goal) {
  const l = lineageOf(goal);
  return Boolean(l && l.forked_from);
}

// Stable partition that floats fission continuations to the front while
// preserving listGoals order within each group — the scheduler's "prefer the
// continuation over cold pending work" rule, expressed as a reordering.
function preferContinuations(goals) {
  return [...goals.filter(isContinuation), ...goals.filter((g) => !isContinuation(g))];
}

// Split a goal's exit-criteria into MET / UNMET by a per-criterion boolean flag
// vector (the worker's report), falling back to the goal's stamped criteria-met.
// PURE; tolerant of a missing/short flag vector (an absent flag reads as unmet).
// Returns { criteria:[{index,text,met}], met:[…], unmet:[…], metFlags:[bool],
// total, fullyMet, noneMet, partiallyMet }.
export function partitionCriteria(goal, metOverride) {
  const criteria = exitCriteriaOf(goal);
  const flags = Array.isArray(metOverride)
    ? metOverride.map((v) => v === true || v === "true")
    : criteriaMetOf(goal);
  const items = criteria.map((text, i) => ({ index: i, text, met: Boolean(flags[i]) }));
  const met = items.filter((x) => x.met).map((x) => x.text);
  const unmet = items.filter((x) => !x.met).map((x) => x.text);
  const total = criteria.length;
  return {
    criteria: items,
    met,
    unmet,
    metFlags: items.map((x) => x.met),
    total,
    fullyMet: total > 0 && unmet.length === 0,
    noneMet: met.length === 0,
    partiallyMet: met.length > 0 && unmet.length > 0,
  };
}

// The wind-down close decision (exit-criterion 1): a fully-met CGR completes
// normally, a partially-met CGR fissions, anything else (none met / no criteria
// at all) is a no-op the caller surfaces. PURE.
export function fissionDecision(goal, metOverride) {
  const p = partitionCriteria(goal, metOverride);
  const action = p.fullyMet ? "complete" : p.partiallyMet ? "fission" : "none";
  return { action, ...p };
}

// A collision-free successor slug for a fission split: `<slug>-cont`, then
// `<slug>-cont-2`, … skipping any slug already taken by a live OR archived goal.
export function successorSlugFor(archDir, slug) {
  const taken = (s) => Boolean(loadGoal(archDir, s)) || isGoalDone(archDir, s);
  const base = `${slug}-cont`;
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// Fork a LEAN successor CGR from a partially-met parent: a new pending goal
// carrying ONLY the unmet criteria, inheriting the parent's verify-command,
// files-to-touch/owns/lane/feature/depends-on/epic/project so it can be worked as
// its own goal, with lineage (forked_from + supersedes → parent) and the
// carry-forward handoff pointer. Links the parent forward (lineage.superseded_by
// → successor) while preserving the parent's own prior forked_from (lineage
// chains across repeated fissions). The successor inherits the parent's `order`
// so it slots where the parent ran; the scheduler's continuation-preference
// floats it ahead of cold pending work regardless. Returns { successor, filepath }.
export function forkSuccessor(archDir, slug, { successorSlug, unmet, handoff } = {}) {
  const parent = loadGoal(archDir, slug);
  if (!parent) throw new Error(`unknown goal: ${slug}`);
  const succ = String(successorSlug || "").trim() || successorSlugFor(archDir, slug);
  const m = parent.meta;
  const orderNum = Number(m.order);
  const { filepath } = writeGoal(archDir, {
    slug: succ,
    title: `${m.title || slug} (cont.)`,
    exitCriteria: ensureArray(unmet),
    filesToTouch: filesToTouchOf(parent),
    requiredReading: ensureArray(m["required-reading"]),
    dependsOn: dependsOnOf(parent),
    owns: ownsOf(parent),
    ...(featureOf(parent) ? { feature: featureOf(parent) } : {}),
    ...(exclusiveOf(parent) ? { exclusive: true } : {}),
    ...(m.epic ? { epic: m.epic } : {}),
    ...(Number.isFinite(orderNum) ? { order: orderNum } : {}),
    ...(m.project ? { project: m.project } : {}),
    verifyCommand: verifyCommandOf(parent) || "",
    sourceAsk: m["source-ask"] || "",
  });
  // Successor lineage + carry-forward handoff + inherited lane.
  stampGoalFields(archDir, succ, {
    lineage: { forked_from: slug, supersedes: slug, superseded_by: null },
    ...(handoff ? { handoff } : {}),
    ...(laneOf(parent) ? { lane: laneOf(parent) } : {}),
  });
  // Link the parent forward — preserve its existing lineage (repeated fissions).
  const prior = lineageOf(parent) || {};
  stampGoalFields(archDir, slug, {
    lineage: { forked_from: prior.forked_from ?? null, supersedes: prior.supersedes ?? null, superseded_by: succ },
  });
  return { successor: succ, filepath };
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

// ── Status-line segment (statusline-archkit-context) ─────────────────────────
//
// The Claude Code status line is a plain shell subprocess — it CANNOT call MCP
// tools — but it can shell out to `archkit statusline`, which reads .arch/ goal
// state off disk and emits a compact heads-up-display segment: the active goal
// slug plus how much pending work is queued behind it (e.g. the shape used in
// the goal example, `⛏ fix-conductor-triage (3 queued)`).
//
// Contract (exit-criteria 2 & 3):
//   • Returns null — the "show NOTHING" signal — when there is no archDir
//     (outside an archkit project) OR no active/in-progress (or testing) goal.
//     The CLI turns null into empty output so the segment silently disappears.
//   • NEVER throws. A missing/malformed .arch/ is swallowed and treated as
//     "nothing to show" so the status line can never crash or print garbage.
//   • The queue count is the number of PENDING goals; it is omitted from the
//     text when zero (`⛏ slug` with no "(0 queued)" noise).
//   • A testing-state active goal uses a distinct glyph so "edits applied,
//     verification pending" reads differently from live in-progress work.
//
// Returns { text, slug, status, queued, glyph } or null. `text` is plain (no
// ANSI) — the status-line wrapper applies color so the segment matches the rest
// of the layout; the CLI's --color flag wraps it for direct use.
export function statuslineSegment(archDir, { glyph = "⛏", testingGlyph = "🧪" } = {}) {
  if (!archDir) return null;
  let goals;
  try {
    goals = listGoals(archDir);
  } catch {
    // Malformed/unreadable .arch/ — degrade to silence, never throw.
    return null;
  }
  let active = null;
  let queued = 0;
  try {
    active = goals.find((g) => statusOf(g) === STATUS_ACTIVE)
      || goals.find((g) => statusOf(g) === STATUS_TESTING)
      || null;
    queued = goals.filter((g) => statusOf(g) === STATUS_PENDING).length;
  } catch {
    return null;
  }
  if (!active) return null;
  const slug = String(active.slug || "").trim();
  if (!slug) return null;
  const status = statusOf(active);
  const g = status === STATUS_TESTING ? testingGlyph : glyph;
  const text = queued > 0 ? `${g} ${slug} (${queued} queued)` : `${g} ${slug}`;
  return { text, slug, status, queued, glyph: g };
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

// ── Glob-aware ownership overlap (intake-dag-ownership) ──
//
// The single source of truth for "do these two file claims collide?", shared by
// the board's conflict slice (board.mjs imports these) and the intake lane
// partitioner below. Deliberately NOT a full glob engine: a claim's literal
// PREFIX (everything before the first `*`) is what matters for ownership, so two
// patterns intersect when one prefix prefixes the other. This catches `src/lib/*`
// vs `src/lib/board.mjs` and `src/auth/` vs `src/auth/login.mjs` without depending
// on a matcher. Pure; tolerant of blanks (a blank claim owns nothing → no overlap).

// Everything before the first glob `*` in a pattern, with a leading ./ stripped.
export function claimPrefix(pattern) {
  const p = String(pattern || "").replace(/^\.\//, "").trim();
  const star = p.indexOf("*");
  return star === -1 ? p : p.slice(0, star);
}

// Do two individual claim patterns intersect? Identical non-empty patterns do;
// otherwise their literal prefixes must be prefix-comparable.
export function globsIntersect(a, b) {
  if (a === b) return Boolean(String(a || "").trim());
  const pa = claimPrefix(a), pb = claimPrefix(b);
  if (!pa || !pb) return false;
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// Do two SETS of claim globs overlap on any pair? The set-level test used to
// decide whether two goals contend for the same files.
export function ownsOverlap(globsA, globsB) {
  const A = ensureArray(globsA), B = ensureArray(globsB);
  for (const x of A) for (const y of B) if (globsIntersect(x, y)) return true;
  return false;
}

// ── Lane partitioning (intake-dag-ownership / ADR 0013) ──
//
// Group a batch of CGRs into parallel LANES for conductor/worker execution. A lane
// is a set of CGRs run SEQUENTIALLY in one worker context; lanes run in PARALLEL
// only when their predicted file-ownership is disjoint. The partition enforces two
// rules from ADR 0013 simultaneously, via one union-find:
//
//   (1) Feature cohesion — CGRs sharing a `feature` tag land in the same lane
//       (same feature ≈ same files; keeps a worker's context warm).
//   (2) Disjoint ownership — any two CGRs whose `owns` globs overlap are FORCED
//       into the same lane (serialized), so across the resulting parallel lanes
//       ownership is provably disjoint. This is the parallel-safety keystone.
//
// Both are expressed as union edges: union when (same feature) OR (owns overlap).
// The connected components are the lanes — which means a chain of owns-overlaps
// transitively serializes (A∩B, B∩C ⇒ A,B,C one lane) even when A and C don't
// directly touch, exactly as merge-safety requires.
//
// EXCLUSIVE goals are cross-cutting (repo-wide rename, "add logging everywhere"):
// they're pulled OUT of the parallel partition and emitted as solo BARRIERS. The
// staged plan interleaves fan-out stages with barrier stages by relay `order`, so
// a barrier means "everything before it merges, then it runs alone, then fan-out
// resumes" — the exact semantics ADR 0013 specifies.
//
// PURE: no clock/IO. `owns` for a goal is the union of its declared owns globs and
// its files-to-touch (the same union the board's conflict slice uses), so a goal
// that only declared files-to-touch still partitions safely.

function partitionOwnsOf(goal) {
  return [...new Set([...ownsOf(goal), ...filesToTouchOf(goal)])];
}

// Order key for sequencing within/among lanes: the relay `order` (lower first),
// Infinity when unset so ordered goals lead and unordered ones tie-break by slug.
function laneOrderKey(goal) {
  const n = Number(goal?.meta?.order);
  return Number.isFinite(n) ? n : Infinity;
}

// A stable lane label: the shared feature when every goal in the lane agrees on
// one, else `lane-<lowest-order slug>` so the name is deterministic and readable.
function laneLabel(goalsInLane) {
  const features = new Set(goalsInLane.map((g) => featureOf(g)).filter(Boolean));
  if (features.size === 1) return [...features][0];
  const lead = goalsInLane[0];
  return `lane-${lead?.slug || lead?.meta?.slug || "0"}`;
}

// Partition `goals` into parallel lanes + exclusive barriers and a staged plan.
// Returns:
//   { lanes, barriers, stages, parallelWidth }
//   lanes        — parallel (non-exclusive) lanes, each
//                  { lane, feature, exclusive:false, goals:[slug…], owns:[glob…] };
//                  across any two lanes the owns sets are disjoint (the invariant).
//   barriers     — exclusive goals, each a solo lane
//                  { lane, feature, exclusive:true, goals:[slug], owns:[glob…] }.
//   stages       — execution order: { kind:'fan-out', lanes:[lane…] } and
//                  { kind:'barrier', lane } interleaved by `order`. Consecutive
//                  parallelizable lanes coalesce into one fan-out stage; each
//                  exclusive goal forces its own barrier stage between them.
//   parallelWidth— the widest fan-out stage's lane count (1 ⇒ effectively serial).
// Pure; tolerant of an empty batch (everything empty) and never throws.
export function partitionLanes(goals) {
  const list = ensureArray(goals).filter((g) => g && (g.slug || g?.meta?.slug));
  const slugOf = (g) => g.slug || g.meta.slug;

  const exclusive = list.filter((g) => exclusiveOf(g));
  const regular = list.filter((g) => !exclusiveOf(g));

  // Union-find over the regular goals (feature cohesion + owns overlap).
  const parent = new Map(regular.map((g) => [slugOf(g), slugOf(g)]));
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const owns = new Map(regular.map((g) => [slugOf(g), partitionOwnsOf(g)]));
  for (let i = 0; i < regular.length; i++) {
    for (let j = i + 1; j < regular.length; j++) {
      const a = regular[i], b = regular[j];
      const fa = featureOf(a), fb = featureOf(b);
      const sameFeature = fa && fb && fa === fb;
      if (sameFeature || ownsOverlap(owns.get(slugOf(a)), owns.get(slugOf(b)))) {
        union(slugOf(a), slugOf(b));
      }
    }
  }

  // Collect components → lanes, ordering goals within a lane by (order, slug).
  const components = new Map(); // root → [goal…]
  for (const g of regular) {
    const root = find(slugOf(g));
    (components.get(root) || components.set(root, []).get(root)).push(g);
  }
  const sortGoalsForLane = (gs) => [...gs].sort((a, b) => {
    const oa = laneOrderKey(a), ob = laneOrderKey(b);
    if (oa !== ob) return oa - ob;
    const sa = slugOf(a), sb = slugOf(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  const lanes = [];
  for (const gs of components.values()) {
    const ordered = sortGoalsForLane(gs);
    const mergedOwns = [...new Set(ordered.flatMap((g) => owns.get(slugOf(g))))].sort();
    lanes.push({
      lane: laneLabel(ordered),
      feature: (() => { const f = new Set(ordered.map((g) => featureOf(g)).filter(Boolean)); return f.size === 1 ? [...f][0] : null; })(),
      exclusive: false,
      goals: ordered.map(slugOf),
      owns: mergedOwns,
      order: laneOrderKey(ordered[0]),
    });
  }

  const barriers = exclusive.map((g) => ({
    lane: `barrier-${slugOf(g)}`,
    feature: featureOf(g),
    exclusive: true,
    goals: [slugOf(g)],
    owns: partitionOwnsOf(g).slice().sort(),
    order: laneOrderKey(g),
  }));

  // Build the staged plan: merge lanes + barriers by `order`, coalescing runs of
  // parallel lanes into one fan-out stage and breaking on every barrier.
  const units = [
    ...lanes.map((l) => ({ ...l, isBarrier: false })),
    ...barriers.map((b) => ({ ...b, isBarrier: true })),
  ].sort((a, b) => (a.order - b.order) || (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : 0));

  const stages = [];
  let current = null; // accumulating fan-out stage
  for (const u of units) {
    if (u.isBarrier) {
      if (current) { stages.push(current); current = null; }
      stages.push({ kind: "barrier", lane: u.lane, goal: u.goals[0] });
    } else {
      if (!current) current = { kind: "fan-out", lanes: [] };
      current.lanes.push(u.lane);
    }
  }
  if (current) stages.push(current);

  const parallelWidth = stages.reduce(
    (max, s) => s.kind === "fan-out" ? Math.max(max, s.lanes.length) : max, 0);

  // Drop the internal `order` helper from the public lane/barrier records.
  const strip = ({ order, ...rest }) => rest;
  return {
    lanes: lanes.map(strip),
    barriers: barriers.map(strip),
    stages,
    parallelWidth,
  };
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

// ── Attention-gradient wind-down + lease policy knobs (ADR 0015) ─────────────
//
// The context window is a quality gradient: the PEAK zone (first ~65%) is for
// high-attention work (novel code, conflict resolution); the TAIL zone is for
// degradation-TOLERANT work (documenting, authoring the handoff). A worker stops
// ACCEPTING new goals once its context fill reaches `cgr.windDownAt` and switches
// to wind-down authoring only — so a goal never balloons into the degraded tail.
// archkit is stateless and cannot measure context fill itself; the worker reports
// its fill and these PURE helpers decide the mode (the same instruct-not-act
// split as the rest of the relay — archkit decides policy, the worker acts).
//
// Config surface (.arch/config.json → cgr.*, all optional):
//   windDownAt        — entry threshold (0..1), default 0.65
//   windDownAtByModel — { "<model-id>": 0.xx } per-model override of windDownAt
//   leaseTtlHours     — in-flight claim TTL (hours), default 24
export const DEFAULT_WIND_DOWN_AT = 0.65;
export const DEFAULT_LEASE_TTL_HOURS = 24;

// The cgr.* config block, or {} on a missing/invalid config. Never throws —
// policy resolution must never be blocked by a bad config file.
function readCgrConfig(archDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(archDir, "config.json"), "utf8"));
    if (cfg && typeof cfg === "object" && cfg.cgr && typeof cfg.cgr === "object") return cfg.cgr;
  } catch { /* no/invalid config → {} */ }
  return {};
}

// A fraction in (0,1], or null when the value isn't a usable threshold.
function asFraction(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : null;
}

// Resolve the effective wind-down threshold: base cgr.windDownAt (default 0.65),
// overridden by cgr.windDownAtByModel[model] when a model is given and carries a
// usable override. Out-of-range / malformed values fall back rather than throw.
export function windDownAt(archDir, { model } = {}) {
  const cgr = readCgrConfig(archDir);
  let threshold = asFraction(cgr.windDownAt) ?? DEFAULT_WIND_DOWN_AT;
  const m = String(model || "").trim();
  if (m && cgr.windDownAtByModel && typeof cgr.windDownAtByModel === "object") {
    const override = asFraction(cgr.windDownAtByModel[m]);
    if (override != null) threshold = override;
  }
  return threshold;
}

// PURE wind-down decision: given the worker's reported context fill (0..1) and a
// resolved threshold, decide whether to keep ACCEPTING goals or switch to
// wind-down (handoff authoring only). A missing/invalid fill reading NEVER blocks
// work — only a real reading at/above the threshold flips the mode. Returns
// { fill, threshold, windDown, mode } where mode is "accept" | "wind-down".
export function windDownMode(fill, threshold) {
  const f = Number(fill);
  const t = Number.isFinite(threshold) ? threshold : DEFAULT_WIND_DOWN_AT;
  const hasFill = Number.isFinite(f);
  const windDown = hasFill && f >= t;
  return { fill: hasFill ? f : null, threshold: t, windDown, mode: windDown ? "wind-down" : "accept" };
}

// Convenience: resolve the threshold from config (model-aware) AND decide the
// mode from a reported fill, in one call. The relay/tool entry point.
export function windDownDecision(archDir, { fill, model } = {}) {
  return windDownMode(fill, windDownAt(archDir, { model }));
}

// In-flight claim lease TTL in hours (cgr.leaseTtlHours, default 24). A claim past
// this is a reclaimable orphan (ADR 0015). Invalid → default.
export function leaseTtlHours(archDir) {
  const v = Number(readCgrConfig(archDir).leaseTtlHours);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_LEASE_TTL_HOURS;
}

// ── CGR finalization (cgr.finalize) ──────────────────────────────────────────
// A configurable wrap-up goal auto-appended to every intake batch so a sprawling
// ask always ends with the release chores done in a fresh, focused context:
// update the changelog, refresh docs, finalize commits with notes, push, set up a
// release, deploy to development. Each step is opt-in/out per project. The
// outward-facing steps (push / release / deployDev) default OFF so they are a
// deliberate choice, never a surprise the agent takes on its own. Persisted under
// .arch/config.json → cgr.finalize so the one-time setup isn't re-asked.
//
// archkit never runs git/deploy itself (same principle as the branch guidance):
// the finalize goal carries the steps as exit-criteria; the agent executes the
// local ones (changelog/docs/commit) and instructs the user for push/release/deploy.
export const FINALIZE_STEPS = [
  { key: "changelog", label: "Update the changelog", default: true,
    criterion: "CHANGELOG updated with an entry covering this batch's changes" },
  { key: "docs", label: "Update documentation", default: true,
    criterion: "Docs (README / docs/) updated to match the changes" },
  { key: "commit", label: "Finalize commits with notes/comments", default: true,
    criterion: "Work committed with descriptive messages and the project's commit trailer" },
  { key: "push", label: "Push to remote", default: false,
    criterion: "Branch pushed to the remote" },
  { key: "release", label: "Set up a release", default: false,
    criterion: "Release prepared (version bump + tag) per the project's release flow" },
  { key: "deployDev", label: "Deploy to development", default: false,
    criterion: "Deployed to the development environment" },
];

export const FINALIZE_SLUG = "finalize-release";

const DEFAULT_FINALIZE = Object.freeze({
  enabled: true,
  configured: false,
  steps: Object.freeze(Object.fromEntries(FINALIZE_STEPS.map((s) => [s.key, s.default]))),
  ciCd: "none", // none | github-actions | custom
  deployCommand: "",
});

// Read cgr.finalize merged over defaults — every field coerced, never throws.
export function readFinalizeConfig(archDir) {
  const raw = readCgrConfig(archDir).finalize;
  const f = raw && typeof raw === "object" ? raw : {};
  const steps = {};
  for (const s of FINALIZE_STEPS) {
    steps[s.key] = (f.steps && typeof f.steps === "object" && f.steps[s.key] !== undefined)
      ? f.steps[s.key] === true
      : s.default;
  }
  return {
    enabled: f.enabled !== undefined ? f.enabled === true : DEFAULT_FINALIZE.enabled,
    configured: f.configured === true,
    steps,
    ciCd: typeof f.ciCd === "string" ? f.ciCd : DEFAULT_FINALIZE.ciCd,
    deployCommand: typeof f.deployCommand === "string" ? f.deployCommand : "",
  };
}

// True once the user has run the one-time setup (so intake stops nudging).
export function isFinalizeConfigured(archDir) {
  return readFinalizeConfig(archDir).configured;
}

// Merge-write cgr.finalize into .arch/config.json, preserving every other config
// key. Stamps configured:true by default so the one-time setup isn't re-asked.
// Returns the resolved finalize config. Never partially writes — a single
// JSON.stringify of the whole file.
export function writeFinalizeConfig(archDir, patch = {}) {
  const fp = path.join(archDir, "config.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { cfg = {}; }
  if (!cfg || typeof cfg !== "object") cfg = {};
  if (!cfg.cgr || typeof cfg.cgr !== "object") cfg.cgr = {};
  const cur = readFinalizeConfig(archDir);
  const steps = { ...cur.steps };
  if (patch.steps && typeof patch.steps === "object") {
    for (const s of FINALIZE_STEPS) {
      if (patch.steps[s.key] !== undefined) steps[s.key] = patch.steps[s.key] === true;
    }
  }
  const next = {
    enabled: patch.enabled !== undefined ? patch.enabled === true : cur.enabled,
    configured: patch.configured !== undefined ? patch.configured === true : true,
    steps,
    ciCd: patch.ciCd !== undefined ? String(patch.ciCd) : cur.ciCd,
    deployCommand: patch.deployCommand !== undefined ? String(patch.deployCommand) : cur.deployCommand,
  };
  cfg.cgr.finalize = next;
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(cfg, null, 2) + "\n");
  return next;
}

// Synthesize the finalization goal for a batch, or null when finalize is disabled
// or no steps are enabled. It depends on every batch slug and is an exclusive
// barrier, so the lane partition schedules it LAST and SOLO — correct, because it
// touches changelog/docs/git across the whole batch. Exit-criteria are exactly the
// enabled steps (so a project that only wants changelog+docs gets a 2-line goal).
export function buildFinalizeGoal(archDir, { batchSlugs = [], order, sourceAsk = "" } = {}) {
  const cfg = readFinalizeConfig(archDir);
  if (!cfg.enabled) return null;
  const enabled = FINALIZE_STEPS.filter((s) => cfg.steps[s.key]);
  if (enabled.length === 0) return null;
  const outward = cfg.steps.push || cfg.steps.release || cfg.steps.deployDev;
  const exitCriteria = enabled.map((s) => {
    if (s.key === "deployDev" && cfg.deployCommand) return `${s.criterion} (\`${cfg.deployCommand}\`)`;
    return s.criterion;
  });
  const ciCdNote = cfg.ciCd && cfg.ciCd !== "none" ? ` CI/CD: ${cfg.ciCd}.` : "";
  const why =
    `Auto-appended by archkit (cgr.finalize) so this batch ends with its release chores in a fresh context: ` +
    enabled.map((s) => s.label.toLowerCase()).join(", ") + `.` + ciCdNote +
    ` archkit never runs git/deploy itself — do the local steps and instruct the user for push/release/deploy. ` +
    `Adjust or opt out with archkit_finalize_config (or \`archkit finalize\`).`;
  return {
    slug: FINALIZE_SLUG,
    title: outward ? "Finalize: changelog, docs, commits + release" : "Finalize: changelog, docs, commits",
    exitCriteria,
    dependsOn: batchSlugs.slice(),
    exclusive: true,
    feature: "finalize",
    owns: ["CHANGELOG.md", "CHANGELOG", "README.md", "docs/**"],
    order,
    why,
    sourceAsk,
    verifyCommand: "", // meta wrap-up — no test gate
  };
}

// Read or update the CGR finalization config (.arch/config.json → cgr.finalize).
// With show:true (or no mutating fields) it returns the current resolved config;
// otherwise it merge-writes the patch and stamps configured:true so intake stops
// nudging. The persistence side of the one-time setup the agent drives via
// AskUserQuestion when intake surfaces finalize.setup. Lives in the lib (not the
// goal command) so the `archkit finalize` CLI can call it without importing the
// self-executing goal command module.
export function runFinalizeConfig({ archDir, show, enabled, steps, ciCd, deployCommand } = {}) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  const mutating = enabled !== undefined || steps !== undefined || ciCd !== undefined || deployCommand !== undefined;
  if (show || !mutating) {
    const config = readFinalizeConfig(archDir);
    return {
      config,
      configured: config.configured,
      nextStep: config.configured
        ? `Finalization is ${config.enabled ? "ON" : "OFF"}. Change any step with archkit_finalize_config (e.g. steps:{ push:true }), or enabled:false to disable.`
        : `Not configured yet. Present the steps to the user (AskUserQuestion), then call archkit_finalize_config with their choices to save + stop the intake nudge.`,
    };
  }
  const saved = writeFinalizeConfig(archDir, { enabled, steps, ciCd, deployCommand, configured: true });
  const onSteps = FINALIZE_STEPS.filter((s) => saved.steps[s.key]).map((s) => s.key);

  // Back-fill: enabling during a project's FIRST intake (goals already queued, no
  // finalize goal yet) would otherwise leave the current batch without its wrap-up
  // until the next intake. If there are live non-finalize goals and no finalize
  // goal in the queue, append one now over the current pending slugs.
  let backfilled = null;
  if (saved.enabled) {
    const live = listGoals(archDir);
    const hasFinalize = live.some((g) => g.slug === FINALIZE_SLUG);
    const userSlugs = live.map((g) => g.slug).filter((s) => s !== FINALIZE_SLUG);
    if (!hasFinalize && userSlugs.length > 0) {
      const fg = buildFinalizeGoal(archDir, { batchSlugs: userSlugs, order: nextOrderBase(archDir) });
      if (fg) { writeGoal(archDir, fg); backfilled = fg.slug; }
    }
  }

  return {
    saved: true,
    config: saved,
    backfilled,
    nextStep: saved.enabled
      ? `Saved to .arch/config.json → cgr.finalize.${backfilled ? ` Appended a "${backfilled}" goal to the current queue.` : ""} Each archkit_goal_intake now appends a "${FINALIZE_SLUG}" goal with: ${onSteps.join(", ") || "(no steps — effectively off)"}. Re-run anytime to change.`
      : `Saved — finalization is OFF. No finalize goal will be appended at intake. Re-enable with archkit_finalize_config enabled:true.`,
  };
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
  // Pending, with fission continuations floated to the front (scheduler prefers
  // a warm carry-forward successor over cold pending work — fission-transition).
  const pending = preferContinuations(eligible.filter((g) => statusOf(g) !== STATUS_TESTING));

  // (2) Threshold ordering. Below threshold → pending-first (the simple default
  // batch); at/above → testing-first to drain the backlog. Either way, fall
  // through to the non-preferred bucket when the preferred one is empty.
  const drainTesting = testingBacklogOverThreshold(testing, backlogThreshold(archDir));
  const [preferred, fallback] = drainTesting ? [testing, pending] : [pending, testing];
  if (preferred[0] || fallback[0]) return preferred[0] || fallback[0];

  // (3) Nothing live to do — offer a deliberately-parked goal as a last resort.
  // Resuming it is an explicit act (the user ran the conductor relay), so this respects
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
  const eligible = preferContinuations(goals.filter((g) => {
    const s = statusOf(g);
    if (s === STATUS_COMPLETED || s === STATUS_ON_HOLD) return false;
    return depsSatisfied(g);
  }));
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

// ── Ambiguity-gated triage (cgr-conductor-ambiguity-triage) ──────────────────
//
// routeNextGoal only surfaced a choice on ONE axis of ambiguity — an ungrouped
// queue AND a project track both live. Every OTHER mixed board state was silently
// auto-picked: accumulating verification debt (testing), deliberately-parked work
// (on-hold), multiple project tracks, an empty/blocked queue. That silent
// auto-pick is the root of "the conductor just mindlessly picks the next queue
// number and runs it".
//
// triageNextGoal generalizes the decision across ALL those dimensions. It
// classifies the board into:
//   single — exactly ONE obvious thing to do and no notable debt → auto-pick,
//            preserving the frictionless /clear → /conductor loop for the common
//            case (also what nextEligibleGoal would have returned).
//   choice — mixed / ambiguous (>1 track, OR pending work alongside a non-empty
//            testing backlog, OR any on-hold work, OR only-parked work) → the
//            caller should ASK the user which axis to advance rather than guess.
//   none   — nothing eligible AND nothing parked (empty:true) → the caller offers
//            a plan / intake path instead of pretending there's work.
//   resume — an in-progress goal is mid-flight → always pre-empts any choice.
//
// The `choice`/`none` returns carry every board slice the caller needs to render
// the question WITHOUT re-reading the board: the ungrouped queue (slugs + next),
// each project track (slugs + next), the testing backlog (count + slugs), the
// on-hold set (count + slugs), a `recommended` auto-pick slug, and an explicit
// `empty` flag. `single`/`resume` also carry the slices (harmless, uniform shape).
//
// A `cgr.triageMode` knob (ambiguity default | always | off) overrides the
// gate: `always` forces a choice every pass (whenever there's anything to choose),
// `off` restores pure auto-pick (single/none, exactly nextEligibleGoal). Resolved
// tolerantly from .arch/config.json via readCgrConfig — a missing/invalid config
// falls back to the default, never blocks selection.
export const DEFAULT_TRIAGE_MODE = "ambiguity";
export const TRIAGE_MODES = Object.freeze(["ambiguity", "always", "off"]);
const TRIAGE_MODE_SET = new Set(TRIAGE_MODES);

// Resolve cgr.triageMode from .arch/config.json (readCgrConfig pattern): a
// recognized value wins, anything else (missing / invalid / unknown string) →
// the `ambiguity` default. Never throws.
export function triageMode(archDir) {
  const v = readCgrConfig(archDir).triageMode;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return TRIAGE_MODE_SET.has(s) ? s : DEFAULT_TRIAGE_MODE;
}

// Build the board slices shared by every triage return — computed once so
// `single`, `choice`, and `none` all carry the same uniform shape. `eligible` is
// the deps-satisfied, not-done, not-parked set (pending + testing); `onHold` is
// the deps-satisfied parked set. Kept internal to triageNextGoal.
function triageSlices({ ungrouped, projects, testing, onHold }) {
  const projectNext = {};
  for (const [p, slugs] of Object.entries(projects)) projectNext[p] = slugs[0];
  return {
    queue: ungrouped,
    queueNext: ungrouped[0] || null,
    projects,
    projectNext,
    testing: { count: testing.length, slugs: testing },
    onHold: { count: onHold.length, slugs: onHold },
  };
}

// The generalized next-goal decision (see block comment above). Returns one of:
//   { kind: "resume", goal, mode, ...slices }
//   { kind: "single", goal, recommended, mode, empty:false, ...slices }
//   { kind: "choice", recommended, mode, empty, ...slices }
//   { kind: "none",   recommended:null, mode, empty:true, ...slices }
// where ...slices = { queue, queueNext, projects, projectNext, testing, onHold }.
export function triageNextGoal(archDir) {
  const goals = listGoals(archDir);
  const mode = triageMode(archDir);

  // (1) Resume actively-worked goal first — a genuinely in-progress goal is never
  // interrupted by a choice, regardless of triageMode (exit-criterion 3).
  const inProgress = goals.find((g) => statusOf(g) === STATUS_ACTIVE);

  const depsSatisfied = (g) => {
    const deps = ensureArray(g.meta["depends-on"]);
    return !deps.some((d) => !isGoalDone(archDir, d));
  };
  // Eligible = not done, not parked (on-hold), deps satisfied — the same gate
  // nextEligibleGoal / routeNextGoal apply. Continuations float to the front.
  const eligible = preferContinuations(goals.filter((g) => {
    const s = statusOf(g);
    if (s === STATUS_COMPLETED || s === STATUS_ON_HOLD || s === STATUS_ACTIVE) return false;
    return depsSatisfied(g);
  }));
  const projectOf = (g) => String(g?.meta?.project || "").trim();
  const testingGoals = eligible.filter((g) => statusOf(g) === STATUS_TESTING);
  const pending = eligible.filter((g) => statusOf(g) !== STATUS_TESTING);
  const ungrouped = pending.filter((g) => !projectOf(g)).map((g) => g.slug);
  const projects = {};
  for (const g of pending.filter((g) => projectOf(g))) (projects[projectOf(g)] ||= []).push(g.slug);
  const testing = testingGoals.map((g) => g.slug);
  const onHold = goals.filter((g) => statusOf(g) === STATUS_ON_HOLD && depsSatisfied(g)).map((g) => g.slug);

  const slices = triageSlices({ ungrouped, projects, testing, onHold });
  // `recommended` = what a pure auto-pick would choose (the frictionless default),
  // so a `choice` caller can pre-highlight it. Uses the full precedence
  // (in-progress resume → threshold ordering → on-hold last resort).
  const autoPick = nextEligibleGoal(archDir);
  // Empty = truly nothing to act on: no in-progress, no eligible pending/testing,
  // no parked work. This is the signal for the caller to offer a plan/intake path.
  const empty = !inProgress && eligible.length === 0 && onHold.length === 0;

  if (inProgress) {
    return { kind: "resume", goal: inProgress, recommended: inProgress.slug, mode, empty: false, ...slices };
  }
  if (empty) {
    return { kind: "none", recommended: null, mode, empty: true, ...slices };
  }

  // `off` → pure auto-pick, exactly nextEligibleGoal (single or, if somehow
  // nothing pickable, none). Restores the pre-triage behavior.
  if (mode === "off") {
    return autoPick
      ? { kind: "single", goal: autoPick, recommended: autoPick.slug, mode, empty: false, ...slices }
      : { kind: "none", recommended: null, mode, empty: true, ...slices };
  }

  // How many distinct axes could the user reasonably pick between?
  //   • each pending track (the ungrouped queue counts as one; each project one)
  //   • the testing backlog, if any (drain verification debt)
  //   • the on-hold set, if any (resume parked work vs. plan anew)
  // Exactly one axis and a real auto-pick → the trivial case → single (frictionless).
  // Two or more axes → genuinely ambiguous → choice. `always` forces choice.
  const pendingTracks = (ungrouped.length ? 1 : 0) + Object.keys(projects).length;
  const axes = pendingTracks + (testing.length ? 1 : 0) + (onHold.length ? 1 : 0);

  if (mode !== "always" && axes <= 1 && autoPick && onHold.length === 0) {
    // One obvious thing, no parked debt → auto-pick as today. (on-hold is excluded
    // from the single fast-path: silently resuming parked work is exactly the
    // "mindless auto-pick" this goal removes — parked-only boards go to choice.)
    return { kind: "single", goal: autoPick, recommended: autoPick.slug, mode, empty: false, ...slices };
  }

  // Ambiguous (or `always`, or parked-only) → hand the caller the full slices to
  // put the question to the user.
  return { kind: "choice", recommended: autoPick ? autoPick.slug : null, mode, empty: false, ...slices };
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
// the /conductor→/clear→/conductor loop stops losing track of what got done.
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
