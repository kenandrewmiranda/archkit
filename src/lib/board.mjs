// src/lib/board.mjs
// CGR 2.0 persistent board (board-state-manager, ADR 0014).
//
// The board is the keystone of conductor/worker parallel-lane orchestration. It
// must survive both a human /clear AND Claude Code's automatic compaction, so it
// CANNOT live in context — it lives entirely on disk and is RECONSTITUTED by
// folding an append-only event log, never hand-maintained.
//
// Two on-disk inputs, ONE derived view:
//   .arch/board/events.ndjson   — append-only event log (THE source of truth).
//                                  Workers only ever APPEND; the board is
//                                  fold(events). Append-only = parallel-safe
//                                  without locks (POSIX O_APPEND makes a single
//                                  sub-PIPE_BUF line atomic) and rehydration-safe
//                                  (a fresh conductor folds the log).
//   .arch/goals/**/<slug>.md     — CGR records (current declared structure: lane,
//                                  owns, depends_on, exclusive, lease, lineage,
//                                  completion). Read via goals.mjs accessors.
//
// There is NO separate mutable board file. sessionState() folds the events and
// scans the CGR files on every call, so the board can never drift from its
// inputs. The fold is PURE (no Date/random) — the only time-dependent input is
// `now`, injected for lease-expiry, so the same inputs always fold identically.

import fs from "node:fs";
import path from "node:path";
import {
  listGoals,
  loadGoal,
  statusOf,
  isGoalDone,
  laneOf,
  dependsOnOf,
  ownsOf,
  leaseOf,
  completionOf,
  exclusiveOf,
  filesToTouchOf,
  globsIntersect,
  handoffOf,
  stampGoalFields,
  leaseTtlHours,
  STATUS_PENDING,
} from "./goals.mjs";

// The closed vocabulary of board events (ADR 0014). Anything else is refused at
// append time — a typo'd event type would silently corrupt the fold.
export const EVENT_TYPES = Object.freeze([
  "claimed",       // a worker took a CGR (carries lane/worker/lease)
  "completed",     // a CGR met its exit-criteria (carries completion: full|partial)
  "fissioned",     // a partial CGR split; a lean successor was forked (carries lineage)
  "merged",        // a completed CGR's branch landed on mainline
  "conflict",      // two CGRs collided on a shared file (carries slugs + files)
  "lease-expired", // a claim's TTL elapsed; the CGR is reclaimable as an orphan
]);

export function boardDir(archDir) {
  return path.join(archDir, "board");
}

export function eventsPath(archDir) {
  return path.join(boardDir(archDir), "events.ndjson");
}

// ── Handoff artifact (handoff-and-winddown, ADR 0015) ─────────────────────────
//
// The linchpin carry-forward object: the worker return, PreCompact flush,
// rehydration input, and fission successor-input are all THIS one artifact,
// authored in the degradation-tolerant tail (the wind-down). It lives on disk at
// .arch/board/handoff/<slug>.md so it survives /clear and auto-compaction (the
// same survival contract as the event log), and it is referenced by the successor
// CGR's `handoff` frontmatter pointer (handoffOf) so a fresh head can read where
// the prior session left off.
//
// On-disk shape: simple scalar frontmatter (slug/model/at/verification-status/
// ownership-accuracy — human-greppable) + a human-readable body of sections +
// ONE fenced ```json block that is the canonical machine-readable round-trip
// source. writeHandoff renders both from the same input (so they can't drift at
// write time); readHandoff parses the json block back. Pure file IO; tolerant.

export const VERIFICATION_STATUSES = Object.freeze(["green", "red", "partial", "unverified"]);

export function handoffDir(archDir) {
  return path.join(boardDir(archDir), "handoff");
}

export function handoffPath(archDir, slug) {
  return path.join(handoffDir(archDir), `${slug}.md`);
}

function handoffList(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === "") return [];
  return [v];
}

function normalizeVerification(v) {
  const s = String(v || "").trim().toLowerCase();
  return VERIFICATION_STATUSES.includes(s) ? s : "unverified";
}

// Ownership-accuracy signal (exit-criterion 4): how well the goal's PREDICTED
// file-ownership (its `owns` globs ∪ declared files-to-touch) matched the files it
// ACTUALLY touched. Glob-aware via globsIntersect (the shared overlap core), so a
// predicted `src/lib/*` counts as covering an actual `src/lib/board.mjs`.
//   matched    — actual files covered by some prediction (the hits)
//   unexpected — actual files NO prediction covered (under-prediction)
//   missed     — predictions that matched no actual file (over-prediction)
//   accuracy   — matched / actual (0..1); 1 when nothing was touched AND nothing
//                was predicted, 0 when files were touched but none predicted.
// Pure; tolerant of empty/garbage on either side; never throws.
export function computeOwnershipAccuracy(predicted, actual) {
  const pred = [...new Set(handoffList(predicted).map((s) => String(s).replace(/^\.\//, "").trim()).filter(Boolean))];
  const act = [...new Set(handoffList(actual).map((s) => String(s).replace(/^\.\//, "").trim()).filter(Boolean))];
  const matched = [];
  const unexpected = [];
  for (const f of act) {
    if (pred.some((p) => globsIntersect(p, f))) matched.push(f);
    else unexpected.push(f);
  }
  const missed = pred.filter((p) => !act.some((f) => globsIntersect(p, f)));
  const accuracy = act.length === 0 ? (pred.length === 0 ? 1 : 0) : matched.length / act.length;
  return {
    predicted: pred.sort(),
    actual: act.sort(),
    matched: matched.sort(),
    unexpected: unexpected.sort(),
    missed: missed.sort(),
    accuracy: Math.round(accuracy * 100) / 100,
  };
}

function renderHandoffMarkdown(data) {
  const fm = [
    `slug: ${data.slug}`,
    `at: ${data.at}`,
    `verification-status: ${data.verificationStatus}`,
    `ownership-accuracy: ${data.filesActualVsPredicted.accuracy}`,
  ];
  if (data.model) fm.push(`model: ${data.model}`);

  const lines = [`---`, ...fm, `---`, ``, `# Handoff — ${data.slug}`, ``];

  lines.push(`## Done (with evidence)`);
  if (data.done.length === 0) lines.push(`- (none recorded)`);
  for (const d of data.done) lines.push(`- ${d.criterion}${d.evidence ? ` — _${d.evidence}_` : ""}`);
  lines.push(``);

  lines.push(`## Decisions`);
  if (data.decisions.length === 0) lines.push(`- (none recorded)`);
  for (const d of data.decisions) lines.push(`- ${d}`);
  lines.push(``);

  const o = data.filesActualVsPredicted;
  lines.push(`## Files: actual vs predicted (ownership accuracy ${o.accuracy})`);
  lines.push(`- predicted: ${o.predicted.join(", ") || "(none)"}`);
  lines.push(`- actual: ${o.actual.join(", ") || "(none)"}`);
  lines.push(`- matched: ${o.matched.join(", ") || "(none)"}`);
  lines.push(`- unexpected (touched, not predicted): ${o.unexpected.join(", ") || "(none)"}`);
  lines.push(`- missed (predicted, not touched): ${o.missed.join(", ") || "(none)"}`);
  lines.push(``);

  lines.push(`## Remaining`);
  if (data.remaining.length === 0) lines.push(`- (none — fully complete)`);
  for (const r of data.remaining) lines.push(`- ${r}`);
  lines.push(``);

  lines.push(`## Continuation notes`);
  lines.push(data.continuationNotes || "_(none)_");
  lines.push(``);

  lines.push(`## Open questions`);
  if (data.openQuestions.length === 0) lines.push(`- (none)`);
  for (const q of data.openQuestions) lines.push(`- ${q}`);
  lines.push(``);

  lines.push(`## Verification status`);
  lines.push(`${data.verificationStatus}`);
  lines.push(``);

  // Canonical machine-readable round-trip source. readHandoff parses THIS.
  lines.push(`<!-- handoff:data — canonical, machine-read by readHandoff -->`);
  lines.push("```json");
  lines.push(JSON.stringify(data, null, 2));
  lines.push("```");
  lines.push(``);
  return lines.join("\n");
}

// Author (or overwrite) the handoff artifact for a CGR. Computes the ownership
// accuracy from predicted vs actual files and embeds it. Returns a summary the
// relay surfaces; the caller stamps the goal's `handoff` pointer separately.
export function writeHandoff(archDir, slug, input = {}) {
  const done = handoffList(input.done).map((d) =>
    typeof d === "string"
      ? { criterion: d, evidence: "" }
      : { criterion: String(d?.criterion || "").trim(), evidence: String(d?.evidence || "").trim() },
  ).filter((d) => d.criterion);
  const data = {
    slug,
    model: String(input.model || "").trim() || null,
    at: input.at || new Date().toISOString(),
    verificationStatus: normalizeVerification(input.verificationStatus),
    done,
    decisions: handoffList(input.decisions).map((s) => String(s).trim()).filter(Boolean),
    filesActualVsPredicted: computeOwnershipAccuracy(input.predicted, input.actual),
    remaining: handoffList(input.remaining).map((s) => String(s).trim()).filter(Boolean),
    continuationNotes: String(input.continuationNotes || "").trim(),
    openQuestions: handoffList(input.openQuestions).map((s) => String(s).trim()).filter(Boolean),
  };
  const fp = handoffPath(archDir, slug);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, renderHandoffMarkdown(data));
  return {
    slug,
    path: fp,
    relPath: path.join("board", "handoff", `${slug}.md`),
    pointer: `.arch/board/handoff/${slug}.md`,
    ownershipAccuracy: data.filesActualVsPredicted.accuracy,
    ownership: data.filesActualVsPredicted,
    verificationStatus: data.verificationStatus,
  };
}

// Read a handoff back into its structured form (round-trip with writeHandoff) by
// parsing the canonical fenced json block. Missing file / unparseable block →
// null (tolerant by construction). `slug` may be a bare slug or a pointer path
// (e.g. ".arch/board/handoff/x.md") — the basename's slug is used.
export function readHandoff(archDir, slug) {
  const s = String(slug || "").trim().replace(/^.*\//, "").replace(/\.md$/, "");
  if (!s) return null;
  let raw;
  try { raw = fs.readFileSync(handoffPath(archDir, s), "utf8"); }
  catch { return null; }
  const m = raw.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); }
  catch { return null; }
}

// Every authored handoff artifact, parsed. Tolerant of an absent dir (→ []).
export function listHandoffs(archDir) {
  const dir = handoffDir(archDir);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const data = readHandoff(archDir, name);
    if (data) out.push(data);
  }
  return out.sort(bySlugAsc);
}

// Append one event as a single NDJSON line. `at` is stamped if absent. Atomic
// per call: appendFileSync opens with O_APPEND, so concurrent appenders (parallel
// workers) never tear each other's lines as long as a line stays under PIPE_BUF
// (~4 KB) — board events are tiny. Refuses an unknown type rather than writing a
// line the fold can't interpret.
export function appendEvent(archDir, event) {
  const type = event && event.type;
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`unknown board event type: ${type} (expected one of ${EVENT_TYPES.join("|")})`);
  }
  const record = { ...event, type, at: (event && event.at) || new Date().toISOString() };
  const fp = eventsPath(archDir);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.appendFileSync(fp, JSON.stringify(record) + "\n");
  return record;
}

// Read every event in append order. Blank and torn/partial lines are skipped
// (a half-written line from a crashed appender must never poison the fold), so
// readEvents is tolerant by construction. Missing log → [].
export function readEvents(archDir) {
  let raw;
  try { raw = fs.readFileSync(eventsPath(archDir), "utf8"); }
  catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip torn/partial line */ }
  }
  return out;
}

// Fold the event stream into a per-slug lifecycle aggregate + the conflict
// events. PURE: a reduce with no clock/random, so folding the same events twice
// is byte-identical. Last lifecycle event wins (claimed → completed → merged),
// while lane/worker/lease/completion/lineage accumulate from whichever event
// last carried them.
export function foldEvents(events) {
  const bySlug = new Map();
  const conflicts = [];
  const get = (slug) => {
    let a = bySlug.get(slug);
    if (!a) {
      a = {
        slug, lifecycle: null, lane: null, worker: null, lease: null,
        completion: null, lineage: null,
        claimedAt: null, completedAt: null, mergedAt: null, events: 0,
      };
      bySlug.set(slug, a);
    }
    return a;
  };

  for (const ev of events) {
    if (!ev || !EVENT_TYPES.includes(ev.type)) continue;
    if (ev.type === "conflict") {
      const slugs = Array.isArray(ev.slugs) ? [...ev.slugs] : (ev.slug ? [ev.slug] : []);
      conflicts.push({ slugs: slugs.slice().sort(), files: Array.isArray(ev.files) ? ev.files : [], at: ev.at || null });
      continue;
    }
    const slug = ev.slug;
    if (!slug) continue;
    const a = get(slug);
    a.events++;
    if (ev.lane != null) a.lane = ev.lane;
    if (ev.worker != null) a.worker = ev.worker;
    if (ev.lease != null) a.lease = ev.lease;
    switch (ev.type) {
      case "claimed":
        a.lifecycle = "claimed"; a.claimedAt = ev.at || a.claimedAt; break;
      case "completed":
        a.lifecycle = "completed"; a.completedAt = ev.at || a.completedAt;
        if (ev.completion != null) a.completion = ev.completion; break;
      case "merged":
        a.lifecycle = "merged"; a.mergedAt = ev.at || a.mergedAt; break;
      case "fissioned":
        a.lifecycle = "fissioned";
        if (ev.lineage != null) a.lineage = ev.lineage; break;
      case "lease-expired":
        a.lifecycle = "lease-expired"; break;
    }
  }
  return { bySlug, conflicts };
}

const bySlugAsc = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

// Glob-aware claim overlap (claimPrefix/globsIntersect) is shared with the intake
// lane partitioner — imported from goals.mjs as the single source of truth so the
// board's conflict slice and the partitioner can never disagree about whether two
// claims collide.

// Pairwise file-overlap among the given (workable) goals, over the UNION of each
// goal's `owns` globs and declared files-to-touch. crossLane marks the dangerous
// case — two goals on different lanes claiming the same file collide at merge.
function fileOverlapConflicts(goals) {
  const claims = goals.map((g) => ({
    slug: g.slug,
    lane: laneOf(g) || "default",
    patterns: [...new Set([...ownsOf(g), ...filesToTouchOf(g)])],
  }));
  const out = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const A = claims[i], B = claims[j];
      const shared = [];
      for (const x of A.patterns) {
        for (const y of B.patterns) {
          if (globsIntersect(x, y)) shared.push(x === y ? x : `${x}∩${y}`);
        }
      }
      if (shared.length === 0) continue;
      out.push({
        slugs: [A.slug, B.slug].sort(),
        files: [...new Set(shared)].sort(),
        crossLane: A.lane !== B.lane,
      });
    }
  }
  return out;
}

// THE folded board. Reconstituted on every call from events.ndjson + the CGR
// files — no cached/mutable board state exists. Returns the seven-slice view the
// conductor reads:
//   lanes          — { lane: [slug,...] } grouping of every live CGR
//   frontier       — pending CGRs whose deps are met and that aren't in-flight
//   blocked        — live CGRs with an unmet depends_on (→ blockedOn list)
//   in_flight      — CGRs claimed but not yet completed (carry lane/worker/lease)
//   merge_queue    — CGRs completed but not yet merged (carry completion)
//   conflicts      — file-overlap among live CGRs + conflict events
//   leases_expired — in-flight CGRs whose lease TTL elapsed (reclaim as orphans)
//
// `now` (ISO) is the ONLY time input — injected so lease-expiry is deterministic
// and testable. Same events + same CGR files + same now → identical board.
export function sessionState(archDir, { now = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(now);
  const { bySlug, conflicts: eventConflicts } = foldEvents(readEvents(archDir));
  const goals = listGoals(archDir);
  const liveBySlug = new Map(goals.map((g) => [g.slug, g]));

  // listGoals returns live goals; parked/terminal states never count as workable.
  const PARKED = new Set(["on-hold", "completed", "abandoned"]);
  const workable = goals.filter((g) => !PARKED.has(statusOf(g)));

  const satisfied = (slug) => {
    const lc = bySlug.get(slug)?.lifecycle;
    return lc === "completed" || lc === "merged" || isGoalDone(archDir, slug);
  };

  // lanes: every live CGR, grouped by its declared lane (or the event lane, or
  // "default"). Values sorted for a stable, deterministic projection.
  const lanes = {};
  for (const g of goals) {
    const lane = laneOf(g) || bySlug.get(g.slug)?.lane || "default";
    (lanes[lane] ||= []).push(g.slug);
  }
  for (const k of Object.keys(lanes)) lanes[k].sort();

  // in_flight: lifecycle stuck at "claimed" (no later completed/merged). Lane and
  // lease prefer the live CGR's current frontmatter, falling back to the claim event.
  const in_flight = [];
  for (const [slug, a] of bySlug) {
    if (a.lifecycle !== "claimed") continue;
    const g = liveBySlug.get(slug);
    const lease = (g && leaseOf(g)) || a.lease || null;
    in_flight.push({
      slug,
      lane: (g && laneOf(g)) || a.lane || "default",
      worker: a.worker || lease?.worker || null,
      since: a.claimedAt || null,
      lease: lease || null,
    });
  }
  in_flight.sort(bySlugAsc);

  // merge_queue: completed but not merged. Completion (full|partial) prefers the
  // event payload, then the CGR's `completion` field, default full.
  const merge_queue = [];
  for (const [slug, a] of bySlug) {
    if (a.lifecycle !== "completed") continue;
    const g = liveBySlug.get(slug);
    merge_queue.push({
      slug,
      lane: (g && laneOf(g)) || a.lane || "default",
      completion: a.completion || (g && completionOf(g)) || "full",
      worker: a.worker || null,
      since: a.completedAt || null,
    });
  }
  merge_queue.sort(bySlugAsc);

  // leases_expired: explicit lease-expired events, plus any in-flight claim whose
  // lease.expires is already in the past relative to `now` (orphan reclaim).
  const expired = new Map();
  for (const [slug, a] of bySlug) {
    if (a.lifecycle === "lease-expired") {
      expired.set(slug, { slug, worker: a.worker || null, expires: a.lease?.expires || null });
    }
  }
  for (const f of in_flight) {
    const exp = f.lease?.expires ? Date.parse(f.lease.expires) : NaN;
    if (!Number.isNaN(exp) && !Number.isNaN(nowMs) && exp < nowMs) {
      expired.set(f.slug, { slug: f.slug, worker: f.worker, expires: f.lease.expires });
    }
  }
  const leases_expired = [...expired.values()].sort(bySlugAsc);

  // frontier vs blocked, driven by depends_on. A dep is satisfied when it has
  // completed/merged in the log or already sits in done/.
  const inFlightSet = new Set(in_flight.map((f) => f.slug));
  const blocked = [];
  const frontier = [];
  for (const g of workable) {
    const unmet = dependsOnOf(g).filter((d) => !satisfied(d));
    if (unmet.length > 0) {
      blocked.push({ slug: g.slug, lane: laneOf(g) || "default", blockedOn: unmet.sort() });
      continue;
    }
    if (statusOf(g) === STATUS_PENDING && !inFlightSet.has(g.slug)) {
      frontier.push({ slug: g.slug, lane: laneOf(g) || "default", exclusive: exclusiveOf(g) });
    }
  }
  blocked.sort(bySlugAsc);
  frontier.sort(bySlugAsc);

  // conflicts: derived file-overlap among live CGRs + event-sourced conflicts,
  // deduped by (source, slug-pair) and stably ordered.
  const derived = fileOverlapConflicts(workable).map((c) => ({ ...c, source: "file-overlap" }));
  const fromEvents = eventConflicts.map((c) => ({
    slugs: [...c.slugs].sort(), files: c.files || [], crossLane: null, source: "event", at: c.at || null,
  }));
  const seen = new Set();
  const conflicts = [];
  for (const c of [...derived, ...fromEvents]) {
    const key = `${c.source}|${c.slugs.join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push(c);
  }
  conflicts.sort((a, b) => {
    const ka = a.slugs.join("|"), kb = b.slugs.join("|");
    return ka < kb ? -1 : ka > kb ? 1 : (a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
  });

  // handoffs: carry-forward artifacts REFERENCED by a live CGR's `handoff`
  // frontmatter pointer (handoff-and-winddown, ADR 0015) — the rehydration input a
  // fresh head reads. For each live goal carrying a pointer, surface the resolved
  // handoff's verification-status + ownership-accuracy (read from the on-disk
  // artifact) so the conductor sees where work was left off without opening files.
  // A dangling pointer (no artifact yet) is still surfaced (resolved:false) rather
  // than dropped, so a broken reference is visible, not silent.
  const handoffs = [];
  for (const g of goals) {
    const pointer = handoffOf(g);
    if (!pointer) continue;
    const data = readHandoff(archDir, pointer);
    handoffs.push({
      slug: g.slug,
      handoff: pointer,
      forSlug: data?.slug || String(pointer).replace(/^.*\//, "").replace(/\.md$/, ""),
      verificationStatus: data?.verificationStatus || null,
      ownershipAccuracy: data?.filesActualVsPredicted?.accuracy ?? null,
      remaining: Array.isArray(data?.remaining) ? data.remaining.length : null,
      resolved: Boolean(data),
    });
  }
  handoffs.sort(bySlugAsc);

  return { lanes, frontier, blocked, in_flight, merge_queue, conflicts, leases_expired, handoffs };
}

// ── Conductor orchestration loop (conductor-loop-hooks, ADR 0013) ─────────────
//
// The conductor is the lean foreground session that, after a /clear or
// compaction, ORCHESTRATES rather than codes: it reads the folded board, claims
// the next frontier CGR(s) under a lease, dispatches worker subagents per lane
// (worktree-isolated — the agent does the spawning; archkit emits the plan),
// collects their handoff returns, deep-reviews ONLY the exceptions, and drains a
// sequential merge queue with verify-after-each. archkit is stateless and
// instruct-not-act: these helpers compute the DERIVED plan + perform the on-disk
// state transitions (claim, reclaim) the loop needs; the worker spawning, review,
// and git merges are the agent's actions, guided by the emitted plan.
//
// Survival contract (ADR 0014): every input is on-disk (the event log + CGR
// files + handoff artifacts), so the loop reconstitutes identically after any
// context reset. `now` is the only time input, injected for deterministic
// lease-expiry, exactly as sessionState takes it.

// Hours → milliseconds, guarded.
function hoursToMs(h) {
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? n * 3600000 : 0;
}

// Claim a frontier CGR under a lease: stamp the goal's `lease` ({worker, expires})
// AND append a `claimed` event carrying lane/worker/lease so the fold reflects the
// reservation. `expires` = now + ttlHours (resolved from cgr.leaseTtlHours unless
// overridden). The board derives in_flight + lease-expiry from this. Returns the
// appended event + the lease. This is the "claim frontier (lease)" loop step.
export function claimFrontier(archDir, { slug, worker = null, lane = null, now = new Date().toISOString(), ttlHours } = {}) {
  if (!slug) throw new Error("claimFrontier requires a slug");
  const ttl = ttlHours != null ? ttlHours : leaseTtlHours(archDir);
  const nowMs = Date.parse(now);
  const expires = Number.isNaN(nowMs) ? null : new Date(nowMs + hoursToMs(ttl)).toISOString();
  const goal = loadGoal(archDir, slug);
  const resolvedLane = lane || (goal && laneOf(goal)) || "default";
  const lease = { worker, expires };
  // Stamp the live CGR so leaseOf(goal) reflects the claim even before folding.
  if (goal) stampGoalFields(archDir, slug, { lease });
  const event = appendEvent(archDir, {
    type: "claimed", slug, worker, lane: resolvedLane, lease, at: now,
  });
  return { slug, lane: resolvedLane, worker, lease, event };
}

// Orphan-lease reclaim (exit-criterion 3): for every in-flight CGR whose lease
// TTL has elapsed (relative to `now`), append a `lease-expired` event and clear
// the stale `lease` field off the live CGR so it returns to the frontier as a
// reclaimable orphan. Idempotent — a slug already folded to `lease-expired` is
// skipped, so re-running (e.g. on every SessionStart) never double-appends.
// Returns { reclaimed:[{slug,worker,expires}], now }.
export function reclaimExpiredLeases(archDir, { now = new Date().toISOString() } = {}) {
  const board = sessionState(archDir, { now });
  const { bySlug } = foldEvents(readEvents(archDir));
  const reclaimed = [];
  for (const exp of board.leases_expired) {
    // Skip the ones already recorded as lease-expired (idempotent reclaim).
    if (bySlug.get(exp.slug)?.lifecycle === "lease-expired") continue;
    appendEvent(archDir, { type: "lease-expired", slug: exp.slug, worker: exp.worker || null, at: now });
    // Drop the stale lease so the orphan is cleanly re-claimable.
    if (loadGoal(archDir, exp.slug)) {
      try { stampGoalFields(archDir, exp.slug, { lease: null }); } catch { /* tolerant */ }
    }
    reclaimed.push({ slug: exp.slug, worker: exp.worker || null, expires: exp.expires || null });
  }
  return { reclaimed: reclaimed.sort(bySlugAsc), now };
}

// Stable dependency-respecting order for the merge queue (exit-criterion 1+6).
// Sequential integration merges a CGR only AFTER any CGR it depends_on that is
// ALSO awaiting merge — so a stack lands bottom-up. Within the dependency
// constraint the order is deterministic: completion time (`since`) then slug.
// Kahn's algorithm over the subgraph induced by the merge-queue slugs (deps
// pointing outside the queue — already merged/done — impose no constraint).
// A dependency CYCLE can't fully order; the remaining nodes fall back to
// (since, slug) so the queue is always fully returned, never dropped. Pure.
export function orderMergeQueue(mergeQueue, depsOf = () => []) {
  const items = Array.isArray(mergeQueue) ? mergeQueue.filter((m) => m && m.slug) : [];
  const inQueue = new Set(items.map((m) => m.slug));
  const bySlug = new Map(items.map((m) => [m.slug, m]));
  // Edge dep→slug: slug waits for dep. Only deps that are themselves in the queue.
  const waitsFor = new Map(items.map((m) => [m.slug, new Set()]));
  for (const m of items) {
    for (const d of depsOf(m.slug)) {
      if (inQueue.has(d) && d !== m.slug) waitsFor.get(m.slug).add(d);
    }
  }
  const tieBreak = (a, b) => {
    const sa = bySlug.get(a)?.since || "", sb = bySlug.get(b)?.since || "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const ordered = [];
  const placed = new Set();
  // Repeatedly emit the ready set (all deps already placed), tie-broken stably.
  while (placed.size < items.length) {
    const ready = items
      .map((m) => m.slug)
      .filter((s) => !placed.has(s) && [...waitsFor.get(s)].every((d) => placed.has(d)))
      .sort(tieBreak);
    if (ready.length === 0) {
      // Cycle / unresolvable remainder — emit the rest by tie-break, never drop.
      const rest = items.map((m) => m.slug).filter((s) => !placed.has(s)).sort(tieBreak);
      for (const s of rest) { ordered.push(bySlug.get(s)); placed.add(s); }
      break;
    }
    for (const s of ready) { ordered.push(bySlug.get(s)); placed.add(s); }
  }
  return ordered;
}

// archDir wrapper: order the live board's merge_queue by depends_on (read from
// each CGR's frontmatter via dependsOnOf), falling back to (since, slug).
export function mergeQueueOrder(archDir, { now = new Date().toISOString(), board } = {}) {
  const state = board || sessionState(archDir, { now });
  const depCache = new Map();
  const depsOf = (slug) => {
    if (!depCache.has(slug)) {
      const g = loadGoal(archDir, slug);
      depCache.set(slug, g ? dependsOnOf(g) : []);
    }
    return depCache.get(slug);
  };
  return orderMergeQueue(state.merge_queue, depsOf);
}

// The deep-review EXCEPTIONS (exit-criterion 1: "deep-review only exceptions").
// A lean conductor rubber-stamps the clean returns and spends attention only on
// what's risky. An item is an exception when ANY of:
//   - it's a PARTIAL completion (fissioned remainder landed in the merge queue),
//   - its handoff verification-status is not green (red/partial/unverified),
//   - its ownership-accuracy fell below `ownershipFloor` (mis-predicted files —
//     a merge-conflict risk), or
//   - it sits in a cross-lane file CONFLICT.
// Plus the orphan leases to reclaim. Returns { exceptions:[{slug,reasons[]}],
// conflicts, leasesExpired, clean:[slug] } where `clean` is the merge-queue
// items needing no deep review (verify-after-each merge, no manual look). Pure
// over a board snapshot.
export function conductorExceptions(board, { ownershipFloor = 0.5 } = {}) {
  const b = board || {};
  const reasonsBySlug = new Map();
  const addReason = (slug, reason) => {
    if (!slug) return;
    if (!reasonsBySlug.has(slug)) reasonsBySlug.set(slug, new Set());
    reasonsBySlug.get(slug).add(reason);
  };

  for (const m of b.merge_queue || []) {
    if (m.completion === "partial") addReason(m.slug, "partial-completion");
  }
  for (const h of b.handoffs || []) {
    if (h.resolved && h.verificationStatus && h.verificationStatus !== "green") {
      addReason(h.slug, `verification-${h.verificationStatus}`);
    }
    if (h.resolved && typeof h.ownershipAccuracy === "number" && h.ownershipAccuracy < ownershipFloor) {
      addReason(h.slug, `low-ownership-accuracy(${h.ownershipAccuracy})`);
    }
  }
  const conflicts = (b.conflicts || []).filter((c) => c.crossLane !== false);
  for (const c of conflicts) for (const s of c.slugs || []) addReason(s, "cross-lane-conflict");

  const exceptions = [...reasonsBySlug.entries()]
    .map(([slug, reasons]) => ({ slug, reasons: [...reasons].sort() }))
    .sort(bySlugAsc);
  const exceptionSlugs = new Set(exceptions.map((e) => e.slug));
  const clean = (b.merge_queue || []).map((m) => m.slug).filter((s) => !exceptionSlugs.has(s)).sort();

  return {
    exceptions,
    conflicts,
    leasesExpired: (b.leases_expired || []).map((l) => l.slug).sort(),
    clean,
  };
}

// The full conductor plan — the orchestration view the conductor session reads to
// drive one loop pass. Assembles the folded board, the dependency-ordered merge
// queue, the deep-review exceptions, and the claimable frontier grouped BY LANE
// (the dispatch unit: one worker subagent per lane, worktree-isolated; exclusive
// frontier CGRs are surfaced as solo barriers). Read-only — folds, never writes
// (claiming/reclaiming are separate explicit steps). Returns a structured plan +
// counts the relay/tool render from. `now` is the only time input.
export function conductorPlan(archDir, { now = new Date().toISOString(), ownershipFloor = 0.5 } = {}) {
  const board = sessionState(archDir, { now });
  const mergeOrder = mergeQueueOrder(archDir, { now, board });
  const review = conductorExceptions(board, { ownershipFloor });

  // Claimable = frontier CGRs not already in-flight, grouped by lane. Exclusive
  // ones are solo barriers (their own dispatch unit).
  const claimableLanes = {};
  const barriers = [];
  for (const f of board.frontier) {
    if (f.exclusive) { barriers.push(f.slug); continue; }
    (claimableLanes[f.lane || "default"] ||= []).push(f.slug);
  }
  for (const k of Object.keys(claimableLanes)) claimableLanes[k].sort();

  const counts = {
    frontier: board.frontier.length,
    claimableLanes: Object.keys(claimableLanes).length,
    barriers: barriers.length,
    in_flight: board.in_flight.length,
    merge_queue: mergeOrder.length,
    blocked: board.blocked.length,
    exceptions: review.exceptions.length,
    leases_expired: board.leases_expired.length,
  };

  return {
    now,
    board,
    claimableLanes,
    barriers: barriers.sort(),
    inFlight: board.in_flight,
    mergeOrder,
    exceptions: review.exceptions,
    clean: review.clean,
    conflicts: review.conflicts,
    leasesExpired: board.leases_expired,
    blocked: board.blocked,
    counts,
  };
}

// ── PreCompact flush marker (exit-criterion 2) ────────────────────────────────
//
// PreCompact fires just before Claude Code summarizes-away earlier context. The
// model authors its in-context state to disk (handoffs + events) at the wind-down
// threshold; this marker is the deterministic on-disk BREADCRUMB the PreCompact
// hook drops so the post-compaction SessionStart hook KNOWS a compaction happened
// and which CGRs were mid-flight, even if the model didn't get to author a fresh
// handoff. It is NOT an event (the event vocabulary is closed, ADR 0014) — it's a
// transient sidecar, consumed-and-cleared by rehydration. Tolerant file IO.
export function flushMarkerPath(archDir) {
  return path.join(boardDir(archDir), "precompact-flush.json");
}

// Snapshot the board-derivable in-flight/merge state into the flush marker.
export function writeFlushMarker(archDir, { now = new Date().toISOString(), trigger = null, sessionId = null, board } = {}) {
  const b = board || sessionState(archDir, { now });
  const marker = {
    at: now,
    trigger: trigger || null,
    sessionId: sessionId || null,
    inFlight: b.in_flight.map((f) => f.slug),
    mergeQueue: b.merge_queue.map((m) => m.slug),
    handoffsPending: b.in_flight.filter((f) => !b.handoffs.some((h) => h.forSlug === f.slug && h.resolved)).map((f) => f.slug),
  };
  const fp = flushMarkerPath(archDir);
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(marker, null, 2));
  } catch { return { ...marker, path: fp, written: false }; }
  return { ...marker, path: fp, written: true };
}

// Read the flush marker, or null when absent/unparseable. Tolerant.
export function readFlushMarker(archDir) {
  try { return JSON.parse(fs.readFileSync(flushMarkerPath(archDir), "utf8")); }
  catch { return null; }
}

// Remove the flush marker (consumed by rehydration). Never throws.
export function clearFlushMarker(archDir) {
  try { fs.rmSync(flushMarkerPath(archDir), { force: true }); } catch { /* ignore */ }
}

// ── SessionStart rehydration (exit-criterion 3) ───────────────────────────────
//
// The conductor's wake-up after a /clear or compaction: reclaim orphan leases
// (TTL elapsed → reclaimable), consume the PreCompact flush marker, and fold the
// board back into a fresh conductor plan. This is the single entry the
// SessionStart(clear|compact) hook calls. WRITES (reclaim appends lease-expired
// events + clears stale leases); everything else is derived. Returns
// { reclaimed, flush, plan } so the hook can render the rehydration digest.
export function rehydrateConductor(archDir, { now = new Date().toISOString(), ownershipFloor = 0.5 } = {}) {
  const { reclaimed } = reclaimExpiredLeases(archDir, { now });
  const flush = readFlushMarker(archDir);
  clearFlushMarker(archDir);
  const plan = conductorPlan(archDir, { now, ownershipFloor });
  return { reclaimed, flush, plan };
}

// ── Per-lane Stop-guard release (exit-criterion 5) ────────────────────────────
//
// CGR 1.0 guarded per GOAL: the Stop hook blocked until the single active goal
// completed. CGR 2.0 runs lanes, so the guard releases per LANE: a worker's
// context is done with a lane when the lane is DRAINED (no live unfinished CGR
// left on it) OR it has produced its wind-down HANDOFF (the carry-forward exists,
// so the remaining work is safely banked for a fresh head — the tail authored its
// flush, exactly what ADR 0015 asks of the degraded zone). Either condition means
// "this session can stop without losing the lane," so the guard need not trap it.
//
// `goal` is the active (in-progress/testing) CGR. Returns
// { lane, laneDrained, handoffProduced, release, reason }. A release reason of
// null means BLOCK (keep working) — the default for a fresh, handoff-less,
// still-populated lane, preserving CGR 1.0's per-goal blocking behavior.
export function stopGuardDecision(archDir, goal) {
  if (!goal) return { lane: null, laneDrained: true, handoffProduced: false, release: true, reason: "no-active-goal" };
  const slug = goal.slug || goal?.meta?.slug;
  const lane = laneOf(goal) || "default";

  // Wind-down handoff produced for THIS goal? (artifact resolves on disk.)
  const handoffProduced = Boolean(handoffOf(goal) && readHandoff(archDir, handoffOf(goal)));

  // Lane drained? Fold completions so a CGR closed/merged via events (not yet
  // moved to done/) also counts as finished. A lane is drained when no goal on it
  // is still live UNFINISHED — i.e. every same-lane goal is completed/merged in
  // the fold or terminal on disk, OR is itself the active goal carrying a handoff.
  const { bySlug } = foldEvents(readEvents(archDir));
  const PARKED = new Set(["on-hold", "completed", "abandoned"]);
  const finishedByFold = (s) => {
    const lc = bySlug.get(s)?.lifecycle;
    return lc === "completed" || lc === "merged" || isGoalDone(archDir, s);
  };
  let laneDrained = true;
  for (const g of listGoals(archDir)) {
    const gl = laneOf(g) || "default";
    if (gl !== lane) continue;
    const gs = g.slug;
    if (PARKED.has(statusOf(g))) continue;
    if (finishedByFold(gs)) continue;
    // The active goal counts as finished-for-drain only once it has a handoff.
    if (gs === slug && handoffProduced) continue;
    laneDrained = false;
    break;
  }

  const release = laneDrained || handoffProduced;
  const reason = laneDrained ? "lane-drained" : handoffProduced ? "wind-down-handoff" : null;
  return { lane, laneDrained, handoffProduced, release, reason };
}
