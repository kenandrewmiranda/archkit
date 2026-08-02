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
import crypto from "node:crypto";
import {
  listGoals,
  loadGoal,
  writeGoal,
  nextOrderBase,
  statusOf,
  isGoalDone,
  laneOf,
  dependsOnOf,
  ownsOf,
  leaseOf,
  completionOf,
  exclusiveOf,
  filesToTouchOf,
  verifyCommandOf,
  globsIntersect,
  handoffOf,
  stampGoalFields,
  leaseTtlHours,
  STATUS_PENDING,
  triageNextGoal,
} from "./goals.mjs";
// Detection ONLY (a package.json read) — board.mjs never RUNS a command. The
// post-integration verify command is resolved here and EMITTED in the plan; the
// agent runs it and reports the result back via recordMerge (instruct-not-act).
import { detectTestCommand } from "./test-runner.mjs";

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
        // Post-integration verification carried by the `merged` event (ADR 0024).
        verification: null, mergedBranch: null,
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
        a.lifecycle = "merged"; a.mergedAt = ev.at || a.mergedAt;
        // A merged event with no verification payload folds to an explicit
        // unverified outcome — never to "assumed green" (ADR 0024).
        a.verification = normalizeMergeVerification({ ...(ev.verification || {}), at: ev.verification?.at || ev.at || null });
        if (ev.branch != null) a.mergedBranch = ev.branch;
        break;
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
//   merged         — CGRs whose integration landed, with the recorded verify
//                    outcome (green|red|unverified) — never assumed green
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

  // merged: CGRs whose integration point LANDED, each carrying the recorded
  // post-integration verification outcome (ADR 0024). This is what lets the
  // folded board distinguish a VERIFIED integration from an assumed-green one:
  // an event with no verification payload folds to status "unverified", never to
  // green, so integration debt is visible instead of silent.
  const merged = [];
  for (const [slug, a] of bySlug) {
    if (a.lifecycle !== "merged") continue;
    const g = liveBySlug.get(slug);
    const v = a.verification || normalizeMergeVerification({});
    merged.push({
      slug,
      lane: (g && laneOf(g)) || a.lane || "default",
      at: a.mergedAt || null,
      branch: a.mergedBranch || null,
      verifyStatus: v.status,
      verifyCommand: v.command,
      verifySource: v.source,
      verified: v.status === "green",
      verification: v,
    });
  }
  merged.sort(bySlugAsc);

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

  return { lanes, frontier, blocked, in_flight, merge_queue, merged, conflicts, leases_expired, handoffs };
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

// ── Lane CONVERGENCE stage (lane-convergence-stage, ADR 0023) ────────────────
//
// NAMING — deliberately NOT "reconcile". archkit already owns that word for
// GOAL-FILE PLACEMENT (archkit_goal_reconcile / reconcileGoalsLayout, ADR
// 0020/0021: re-file a goal into the folder its status dictates). This is an
// unrelated concept — BRANCH-level convergence before the merge queue drains —
// so it gets its own vocabulary (converge / convergence / integration point) and
// the two can never be confused in tool output, docs, or a grep.
//
// Why the stage exists: conductor step 5 drained the dependency-ordered merge
// queue as N INDEPENDENT merges onto the branch, one per CGR, with no
// rebase-onto-tip precondition. Agent-tool worktree workers branch from a STALE
// base — the worktree is cut when the worker spawns, not when its work lands — so
// a naive sequential `git merge` of worker branch #2 can REVERT what worker
// branch #1's merge landed moments earlier in the SAME drain: #2's tree still
// carries the pre-#1 content of any shared file, and the merge resolves it as an
// intentional change. The fix is a convergence stage: group the ordered queue BY
// LANE, converge each lane onto the branch TIP first (rebase), and land each lane
// as ONE integration point, verifying after each.
//
// archkit NEVER runs git (instruct-not-act, ADR 0010). Everything here COMPUTES
// and EMITS a plan — a pure structure plus rendered text — and the agent performs
// the rebases/merges. No shelling out, no child_process, ever.

// The primary integration primitive: converge the lane's worktree onto the
// branch tip before it lands, so it can only ever fast-forward-or-conflict, and
// can never silently revert an earlier integration point in this drain.
export const CONVERGENCE_PRECONDITION = "rebase-onto-tip";

// The escape hatch for a lane whose worker base is UNRECOVERABLY stale (the
// rebase can't be completed — base commit gone, worktree pruned, or the conflict
// surface is the whole tree): take ONLY the lane's owned paths out of its branch
// while standing on the integration branch. Bounded by ownership, so intervening
// work outside those paths survives by construction.
export const CONVERGENCE_FALLBACK = "path-extract";

export const DEFAULT_INTEGRATION_BRANCH = "main";

// The branch lanes converge onto (.arch/config.json → cgr.integrationBranch,
// default "main"). Tolerant: a missing/invalid config falls back, never throws.
export function integrationBranch(archDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(archDir, "config.json"), "utf8"));
    const v = cfg?.cgr?.integrationBranch;
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch { /* no/invalid config → default */ }
  return DEFAULT_INTEGRATION_BRANCH;
}

function uniqSorted(xs) {
  const out = new Set();
  for (const x of xs || []) {
    if (x == null) continue;
    const s = String(x).trim();
    if (s) out.add(s);
  }
  return [...out].sort();
}

// Same de-dup, but FIRST-APPEARANCE order (the queue's own ordering signal) —
// used where sorting would scramble a meaningful sequence, e.g. the commands of
// a lane's integration point, which read best in the order the CGRs land.
function uniqInOrder(xs) {
  const seen = new Set();
  const out = [];
  for (const x of xs || []) {
    if (x == null) continue;
    const s = String(x).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ── Post-integration VERIFICATION (merge-verify-command, ADR 0024) ───────────
//
// "verify after EACH merge" named no command and recorded no result, so it was
// advisory prose: the CGR test gate runs at goal_complete INSIDE the worker's
// worktree, PRE-merge — a green worktree does not prove a green branch after
// integration. This block makes it concrete on both ends:
//   resolve  — every integration point carries a CONCRETE command (or an explicit
//              "none", never a silent gap), and
//   record   — the `merged` event carries the OUTCOME, so the fold can tell a
//              verified integration from an assumed-green one.
//
// The fallback chain (per CGR, then unioned per lane):
//   1. the CGR's own `verify-command` frontmatter (scoped to its slice), else
//   2. the project test command (package.json scripts.test via detectTestCommand), else
//   3. none — surfaced as source "none" so the merge is recorded as UNVERIFIED
//      rather than assumed green.

// Where a resolved verify command came from. "mixed" = a lane whose CGRs
// resolved to more than one distinct command (they're unioned, all must pass).
export const VERIFY_SOURCES = Object.freeze(["cgr", "project", "mixed", "none"]);

// The recorded outcome of a post-integration verify run.
//   green      — the command ran and passed
//   red        — the command ran and FAILED (the worst integration debt)
//   unverified — no command resolved, or one resolved but no result was recorded
export const MERGE_VERIFY_STATUSES = Object.freeze(["green", "red", "unverified"]);

// The project's test command for a project rooted at archDir's parent. Detection
// only (reads package.json → scripts.test); null when the project has no real
// test script, which is a legitimate "none" tail of the fallback chain, not an
// error. Tolerant — never throws.
export function projectVerifyCommand(archDir, { cwd } = {}) {
  const root = cwd || path.dirname(String(archDir || "."));
  try { return detectTestCommand(root)?.command || null; }
  catch { return null; }
}

// THE fallback chain, pure and injectable: resolve the post-integration verify
// command for a set of CGRs (one lane's integration point, or a single slug).
// Each slug resolves independently (its own verify-command → the project command
// → none); the lane's command is the DE-DUPED UNION of what its CGRs resolved,
// joined with `&&` so all of them must pass. Returns:
//   { command, commands, source, perSlug:[{slug,command,source}], mixed, unresolved }
// command is null (source "none", unresolved true) when nothing resolved — the
// caller must then record the merge as unverified rather than assume green.
export function resolveVerifyCommand(slugs, { verifyOf = () => null, projectCommand = null } = {}) {
  const list = (Array.isArray(slugs) ? slugs : [slugs]).filter(Boolean).map(String);
  const project = typeof projectCommand === "string" && projectCommand.trim() ? projectCommand.trim() : null;
  const perSlug = list.map((slug) => {
    let own = null;
    try { own = verifyOf(slug); } catch { own = null; }
    const cgr = typeof own === "string" && own.trim() ? own.trim() : null;
    if (cgr) return { slug, command: cgr, source: "cgr" };
    if (project) return { slug, command: project, source: "project" };
    return { slug, command: null, source: "none" };
  });
  const commands = uniqInOrder(perSlug.map((p) => p.command));
  const sources = new Set(perSlug.filter((p) => p.command).map((p) => p.source));
  const source = commands.length === 0 ? "none" : (sources.size > 1 ? "mixed" : [...sources][0]);
  return {
    command: commands.length ? commands.join(" && ") : null,
    commands,
    source,
    perSlug,
    mixed: commands.length > 1,
    unresolved: commands.length === 0,
  };
}

// Normalize a reported verify outcome into the payload the `merged` event
// carries. Pure. The status is derived, never taken on trust:
//   no command            → unverified (reason no-verify-command)
//   command + passed:true → green
//   command + passed:false→ red        (reason verify-failed)
//   command, no result    → unverified (reason verify-not-run)
export function normalizeMergeVerification({ command = null, source = null, passed = null, exitCode = null, at = null, note = null } = {}) {
  const cmd = typeof command === "string" && command.trim() ? command.trim() : null;
  const src = VERIFY_SOURCES.includes(String(source)) ? String(source) : (cmd ? "cgr" : "none");
  let status, reason;
  if (!cmd) { status = "unverified"; reason = "no-verify-command"; }
  else if (passed === true) { status = "green"; reason = null; }
  else if (passed === false) { status = "red"; reason = "verify-failed"; }
  else { status = "unverified"; reason = "verify-not-run"; }
  return {
    command: cmd,
    source: src,
    status,
    reason,
    passed: status === "green" ? true : status === "red" ? false : null,
    exitCode: Number.isFinite(Number(exitCode)) ? Number(exitCode) : null,
    at: at || null,
    note: note || null,
  };
}

// Group an ALREADY dependency-ordered merge queue (the output of orderMergeQueue /
// mergeQueueOrder) into per-lane integration points, each carrying its
// rebase-onto-tip precondition and its path-extract fallback.
//
// Ordering contract (the load-bearing invariant): cross-lane dependency order
// survives the grouping. Lane-level edges are induced from the CGR-level
// depends_on that orderMergeQueue already honored — a CGR depending on a CGR in
// ANOTHER lane makes that lane a predecessor — and the lanes are Kahn-sorted with
// the queue's first-appearance index as the tie-break, so independent lanes keep
// the queue's relative order and a dependent lane can never land first.
//
// Degenerate case: if two lanes depend on each other (a genuine cross-lane
// cycle), no per-lane collapse is possible without breaking dependency order. The
// plan then falls back to SEGMENTS — maximal contiguous same-lane runs of the flat
// queue, which preserves the flat order exactly — and marks `split: true` so the
// conductor sees the lanes were too entangled to collapse.
//
// Pure: no clock, no IO, no git. Injectable accessors keep it testable:
//   depsOf(slug)   → depends_on slugs
//   pathsOf(slug)  → owned paths/globs for the CGR
//   branchOf(slug) → the worker's worktree branch, when known (else a placeholder)
//   verifyOf(slug) → the CGR's own verify-command (head of the fallback chain)
//   projectVerify  → the project test command (the chain's fallback)
// `verify` is the pre-ADR-0024 single-command option, kept as a back-compat
// ALIAS for projectVerify so older callers keep resolving the same command.
export function laneConvergencePlan(orderedQueue, {
  branch = DEFAULT_INTEGRATION_BRANCH,
  depsOf = () => [],
  pathsOf = () => [],
  branchOf = () => null,
  verifyOf = () => null,
  projectVerify = null,
  verify = null,
} = {}) {
  const projectCommand = projectVerify != null ? projectVerify : verify;
  const items = (Array.isArray(orderedQueue) ? orderedQueue : []).filter((m) => m && m.slug);
  const target = String(branch || "").trim() || DEFAULT_INTEGRATION_BRANCH;
  const laneOfItem = (m) => String(m.lane || "default");
  const inQueue = new Set(items.map((m) => m.slug));
  const laneBySlug = new Map(items.map((m) => [m.slug, laneOfItem(m)]));

  // Lanes in first-appearance order (the queue's own ordering signal).
  const lanes = [];
  const firstIndex = new Map();
  items.forEach((m, i) => {
    const lane = laneOfItem(m);
    if (!firstIndex.has(lane)) { firstIndex.set(lane, i); lanes.push(lane); }
  });

  // Induced lane-level dependency edges. Same-lane deps need no edge — queue
  // order inside a lane already sequences them within the one integration point.
  const waitsFor = new Map(lanes.map((l) => [l, new Set()]));
  const crossLaneEdges = [];
  for (const m of items) {
    const lane = laneOfItem(m);
    for (const d of depsOf(m.slug) || []) {
      if (!inQueue.has(d)) continue;
      const depLane = laneBySlug.get(d);
      if (!depLane || depLane === lane) continue;
      waitsFor.get(lane).add(depLane);
      crossLaneEdges.push({ from: depLane, to: lane, dependent: m.slug, dependsOn: d });
    }
  }

  // Kahn over the lane graph, tie-broken by first appearance in the queue.
  const laneOrder = [];
  const placed = new Set();
  let cyclic = false;
  while (placed.size < lanes.length) {
    const ready = lanes
      .filter((l) => !placed.has(l) && [...waitsFor.get(l)].every((d) => placed.has(d)))
      .sort((a, b) => firstIndex.get(a) - firstIndex.get(b));
    if (ready.length === 0) { cyclic = true; break; }
    for (const l of ready) { laneOrder.push(l); placed.add(l); }
  }

  // Acyclic → one integration point per lane. Cyclic → contiguous segments of the
  // flat queue (flat order preserved verbatim; never drop an item).
  const buckets = [];
  if (!cyclic) {
    for (const lane of laneOrder) {
      buckets.push({ lane, slugs: items.filter((m) => laneOfItem(m) === lane).map((m) => m.slug) });
    }
  } else {
    for (const m of items) {
      const lane = laneOfItem(m);
      const last = buckets[buckets.length - 1];
      if (last && last.lane === lane) last.slugs.push(m.slug);
      else buckets.push({ lane, slugs: [m.slug] });
    }
  }

  const bySlugItem = new Map(items.map((m) => [m.slug, m]));
  const groups = buckets.map((b, i) => {
    const paths = uniqSorted(b.slugs.flatMap((s) => pathsOf(s) || []));
    const branches = uniqSorted(b.slugs.map((s) => branchOf(s)));
    const workers = uniqSorted(b.slugs.map((s) => bySlugItem.get(s)?.worker));
    const branchRef = branches.length === 1 ? branches[0] : `<worktree-branch:${b.lane}>`;
    const pathArgs = paths.length ? paths.join(" ") : "<owned paths>";
    // The concrete post-integration verify command for THIS lane (ADR 0024):
    // per-CGR verify-command → project test command → none. Resolved per group,
    // never plan-wide, so a lane with a scoped command keeps it.
    const v = resolveVerifyCommand(b.slugs, { verifyOf, projectCommand });
    return {
      lane: b.lane,
      order: i + 1,
      slugs: b.slugs,
      segment: cyclic ? i + 1 : null,
      dependsOnLanes: [...(waitsFor.get(b.lane) || [])].sort(),
      paths,
      workers,
      branches,
      branchRef,
      // The precondition IS the point of this stage — never emit a group without it.
      precondition: {
        kind: CONVERGENCE_PRECONDITION,
        branch: target,
        command: `git -C <worktree-for-${b.lane}> fetch && git -C <worktree-for-${b.lane}> rebase ${target}`,
        why: `worker worktrees branch from a STALE base — converge ${b.lane} onto the ${target} TIP before landing it, or this merge can revert an integration point that landed earlier in this same drain`,
      },
      integration: {
        command: `git merge --no-ff ${branchRef}`,
        on: target,
        // verify stays a plain string for existing consumers; the resolution
        // provenance rides alongside it so an unverifiable lane is VISIBLE.
        verify: v.command,
        verifySource: v.source,
        verifyCommands: v.commands,
        verifyBySlug: v.perSlug,
        verifiable: !v.unresolved,
      },
      // The other half of "verify after EACH": the outcome must be RECORDED, or
      // the fold can't tell a verified integration from an assumed-green one.
      record: {
        tool: "archkit_board_merged",
        args: { slugs: b.slugs, lane: b.lane, branch: target, verifyCommand: v.command, passed: "<true|false>" },
        why: v.unresolved
          ? `no verify command resolved for ${b.lane} (no verify-command on its CGRs and no project test command) — record the merge so it lands as visible integration debt instead of assumed green`
          : `record the result of \`${v.command}\` on the merged event, so the board can distinguish a verified integration from an assumed-green one`,
      },
      fallback: {
        kind: CONVERGENCE_FALLBACK,
        command: `git checkout ${branchRef} -- ${pathArgs}`,
        on: target,
        when: `the rebase precondition cannot be completed (worker base unrecoverably stale)`,
        why: `path-extract takes ONLY this lane's owned paths, so intervening work outside them survives — a whole-tree merge from a stale base does not`,
      },
    };
  });

  return {
    branch: target,
    groups,
    laneOrder: cyclic ? uniqSorted(buckets.map((b) => b.lane)) : laneOrder,
    split: cyclic,
    splitReason: cyclic ? "cross-lane-dependency-cycle" : null,
    crossLaneEdges,
    precondition: CONVERGENCE_PRECONDITION,
    fallback: CONVERGENCE_FALLBACK,
    projectVerify: projectCommand || null,
    counts: {
      groups: groups.length,
      lanes: new Set(groups.map((g) => g.lane)).size,
      cgrs: items.length,
      crossLaneEdges: crossLaneEdges.length,
      // How much of the drain can actually be verified after it lands.
      verifiableGroups: groups.filter((g) => g.integration.verifiable).length,
      unverifiableGroups: groups.filter((g) => !g.integration.verifiable).length,
    },
  };
}

// Render the convergence plan as the instruction block conductor step 5 emits.
// Returns an array of lines (the caller joins) — the emitted-plan half of
// instruct-not-act: the agent runs these commands, archkit only writes them down.
export function renderConvergencePlan(plan, { maxPaths = 6 } = {}) {
  const p = plan || {};
  const groups = p.groups || [];
  if (!groups.length) return [`MERGE: queue empty, nothing to converge or integrate.`];

  const lines = [
    `CONVERGE + MERGE — ${groups.length} integration point${groups.length === 1 ? "" : "s"} (one per lane), landed in THIS order onto ${p.branch}, verifying after EACH:`,
    `   Worker worktrees branch from a STALE base, so a naive merge of a worker branch can REVERT what an earlier merge in this same drain landed. Every lane converges onto the ${p.branch} TIP before it lands.`,
  ];
  if (p.split) {
    lines.push(
      `   ! lanes are mutually dependent (${p.splitReason}) — they could NOT collapse to one point each; the queue is split into ordered segments instead.`,
    );
  }
  for (const g of groups) {
    const shown = g.paths.slice(0, maxPaths).join(", ");
    const more = g.paths.length > maxPaths ? ` (+${g.paths.length - maxPaths} more)` : "";
    const after = g.dependsOnLanes.length ? ` — lands AFTER lane${g.dependsOnLanes.length === 1 ? "" : "s"} ${g.dependsOnLanes.join(", ")}` : "";
    const rec = g.record || {};
    lines.push(
      `   ${g.order}) lane ${g.lane}${g.segment ? ` (segment ${g.segment})` : ""}: ${g.slugs.join(" → ")}${after}`,
      `      owns: ${shown || "(unpredicted)"}${more}`,
      `      1. PRECONDITION (${g.precondition.kind}): ${g.precondition.command}`,
      `      2. INTEGRATE on ${g.integration.on}: ${g.integration.command}`,
      g.integration.verify
        ? `      3. VERIFY (from ${g.integration.verifySource}): ${g.integration.verify}`
        : `      3. VERIFY: NO command resolved — no verify-command on ${g.slugs.join("/")} and no project test command. This integration point CANNOT be verified; record it as unverified rather than assuming green.`,
      `      4. RECORD: ${rec.tool || "archkit_board_merged"} slugs=${g.slugs.join(",")} lane=${g.lane} branch=${g.integration.on}${g.integration.verify ? ` verifyCommand="${g.integration.verify}" passed=<true|false>` : ` (no verifyCommand → recorded unverified)`}`,
      `      5. FALLBACK (${g.fallback.kind}) only if the rebase can't be completed: from ${g.fallback.on}, ${g.fallback.command}`,
    );
  }
  lines.push(
    `   Never merge a worker branch onto ${p.branch} without step 1. The path-extract fallback is bounded by the lane's OWNED paths, so intervening work outside them survives — a whole-tree merge from a stale base does not.`,
    `   Verify AFTER each integration point and RECORD the result — a merge with no recorded outcome is integration debt, not a green branch. The worker's pre-merge test gate ran inside its worktree; it does not prove ${p.branch} is green.`,
  );
  return lines;
}

// archDir wrapper: build the convergence plan for the LIVE board — dependency
// order from each CGR's frontmatter, owned paths from `owns` ∪ files-to-touch,
// integration branch from cgr.integrationBranch. Read-only (folds + reads goal
// files; writes nothing, runs nothing).
export function laneConvergence(archDir, { now = new Date().toISOString(), board, mergeOrder, branch, projectVerify } = {}) {
  const ordered = mergeOrder || mergeQueueOrder(archDir, { now, board });
  const goalCache = new Map();
  const goal = (slug) => {
    if (!goalCache.has(slug)) goalCache.set(slug, loadGoal(archDir, slug));
    return goalCache.get(slug);
  };
  return laneConvergencePlan(ordered, {
    branch: branch || integrationBranch(archDir),
    depsOf: (slug) => { const g = goal(slug); return g ? dependsOnOf(g) : []; },
    pathsOf: (slug) => { const g = goal(slug); return g ? [...ownsOf(g), ...filesToTouchOf(g)] : []; },
    // The fallback chain, live: the CGR's own verify-command first, the project
    // test command behind it (ADR 0024). Each lane resolves independently.
    verifyOf: (slug) => verifyCommandOf(goal(slug)),
    projectVerify: projectVerify !== undefined ? projectVerify : projectVerifyCommand(archDir),
  });
}

// Record an integration point landing: append ONE `merged` event per CGR in the
// group, each carrying the post-integration verification OUTCOME (command +
// pass/fail). This is the write half of ADR 0024 — the conductor runs the verify
// command the plan emitted and reports the result here, so a later pass can tell
// a verified integration from an assumed-green one instead of inferring silence
// as success. archkit still runs no git and no tests: it only records what the
// agent reports. Returns { merged:[event], verification, slugs }.
export function recordMerge(archDir, {
  slug, slugs, lane = null, branch = null, worker = null,
  verifyCommand = null, verifySource = null, passed = null, exitCode = null, note = null,
  now = new Date().toISOString(),
} = {}) {
  const list = uniqInOrder([...(Array.isArray(slugs) ? slugs : []), ...(slug ? [slug] : [])]);
  if (!list.length) throw new Error("recordMerge requires slug or slugs");
  const verification = normalizeMergeVerification({
    command: verifyCommand, source: verifySource, passed, exitCode, at: now, note,
  });
  const merged = list.map((s) => appendEvent(archDir, {
    type: "merged",
    slug: s,
    lane: lane || (loadGoal(archDir, s) && laneOf(loadGoal(archDir, s))) || null,
    worker: worker || null,
    branch: branch || null,
    verification,
    at: now,
  }));
  return { slugs: list, verification, merged };
}

// ── Tier 3: ESCALATE a genuine conflict to a merge-reconcile CGR (ADR 0013) ──
//
// ADR 0013's conflict strategy is a three-tier HYBRID, in order:
//   1. pre-partition by ownership (pessimistic)  — partitionLanes, goals.mjs
//   2. worktree-isolate                          — the conductor's dispatch unit
//   3. escalate to a reconcile goal              — THIS block
// Tiers 1+2 shipped; tier 3 did not, so a cross-lane collision could only ever
// become an `exception` string for manual conductor review and the documented
// escalation path dead-ended. Escalation MINTS a real CGR so the resolution gets
// a fresh worker context, a dependency edge, and a place on the board.
//
// NAMING (the load-bearing disambiguation): archkit uses "reconcile" in TWO
// unrelated senses and they must never be confusable in a fresh context —
//   MERGE-sense   (HERE, ADR 0013 tier 3): resolve conflicting file CONTENT
//                 produced by two CGRs that collided. Minted CGRs are always
//                 prefixed `merge-reconcile-` and tagged feature `merge-reconcile`,
//                 so the sense is greppable from the slug alone.
//   PLACEMENT-sense (archkit_goal_reconcile / reconcileGoalsLayout, ADR 0020/0021):
//                 move goal FILES into the folder their status dictates. Touches
//                 no file content and no git.
// Branch-level convergence is a third, separately named thing (ADR 0023).
//
// archkit still runs no git: escalation writes a CGR record, nothing else. The
// worker the conductor dispatches for that CGR does the actual resolution.

export const MERGE_RECONCILE_PREFIX = "merge-reconcile-";
export const MERGE_RECONCILE_FEATURE = "merge-reconcile";

// The deterministic slug for the reconcile CGR of a given conflict. Derived
// PURELY from the sorted conflicting slugs, which is what makes minting
// idempotent: folding the same conflict twice resolves to the same slug, and the
// second mint sees the CGR already on disk. Long slug pairs are truncated with a
// stable hash suffix so the derivation stays collision-free and filename-safe.
export function reconcileSlugFor(slugs) {
  const parts = uniqSorted(slugs);
  if (parts.length === 0) return null;
  const base = `${MERGE_RECONCILE_PREFIX}${parts.join("-")}`;
  if (base.length <= 80) return base;
  const h = crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 8);
  return `${base.slice(0, 71)}-${h}`;
}

// Normalize a conflict's file list into concrete claim patterns. The derived
// file-overlap slice reports an intersection of two DIFFERENT patterns as
// "a∩b" (see fileOverlapConflicts); a reconcile CGR needs both sides as real
// claims, so those are split back out. Event-sourced conflicts carry plain paths
// and pass through untouched.
export function conflictClaimFiles(files) {
  return uniqSorted((files || []).flatMap((f) => String(f).split("∩")));
}

// Build (PURELY) the reconcile CGR record for one conflict. It is:
//   - dependsOn every conflicting slug — so the board's frontier withholds it
//     until the work it must reconcile has actually completed, and
//   - exclusive — so partitionLanes pulls it out as a SOLO BARRIER stage rather
//     than running it beside the lanes whose output it is merging.
// The body carries the conflicting slugs and files verbatim, so a fresh worker
// context can resolve the conflict without re-deriving it from the board.
export function buildReconcileGoal({
  slugs = [], files = [], lanes = [], source = "event", at = null, order, note = "",
} = {}) {
  const conflicting = uniqSorted(slugs);
  if (conflicting.length === 0) return null;
  const slug = reconcileSlugFor(conflicting);
  const claims = conflictClaimFiles(files);
  const laneList = uniqSorted(lanes);

  const pretty = conflicting.join(" ↔ ");
  const exitCriteria = [
    `Each conflicting file has ONE reconciled version that preserves the intent of every colliding CGR (${conflicting.join(", ")})`,
    `No conflict markers or duplicated/reverted hunks remain in the conflicting files`,
    `The reconciled result is VERIFIED green by the project verify command — conflict-free is not the same as correct`,
  ];

  const body = [
    `# Reconcile merge conflict: ${pretty}`,
    ``,
    `## Why`,
    `Tier 3 of ADR 0013's hybrid conflict strategy (pre-partition → worktree-isolate →`,
    `ESCALATE). Ownership pre-partitioning and worktree isolation did not keep these`,
    `CGRs apart, so the collision is genuine and needs its own context to resolve.`,
    ``,
    `MERGE-sense reconcile — conflicting file CONTENT. This is NOT archkit_goal_reconcile`,
    `(goal-FILE placement, ADR 0020/0021), which only moves goal files between`,
    `.arch/goals/ folders and never touches content or git.`,
    ``,
    `## Conflicting CGRs`,
    ...conflicting.map((s) => `- ${s}`),
    ``,
    `## Conflicting files`,
    ...(claims.length ? claims.map((f) => `- ${f}`) : [`- (none recorded — inspect the colliding CGRs' owns/files-to-touch)`]),
    ``,
    `## Conflict provenance`,
    `- source: ${source}`,
    `- lanes: ${laneList.length ? laneList.join(", ") : "(unrecorded)"}`,
    `- detected: ${at || "(unrecorded)"}`,
    ...(note ? [`- note: ${note}`] : []),
    ``,
    `## Exit criteria`,
    ...exitCriteria.map((c) => `- [ ] ${c}`),
    ``,
    `## How to resolve`,
    `Read each conflicting CGR's landed change for the files above, then author ONE`,
    `version that satisfies both. Do not pick a side by default — a revert of the`,
    `other CGR's intent is a failed reconcile, not a resolved one.`,
  ].join("\n");

  return {
    slug,
    title: `Reconcile merge conflict: ${pretty}`,
    exitCriteria,
    dependsOn: conflicting,
    // Solo barrier: it merges other lanes' output, so it must not run beside them.
    exclusive: true,
    feature: MERGE_RECONCILE_FEATURE,
    owns: claims,
    filesToTouch: claims,
    ...(order !== undefined ? { order } : {}),
    why:
      `Escalated by archkit (ADR 0013 tier 3) — ${conflicting.join(" and ")} collided on ` +
      `${claims.length ? claims.join(", ") : "shared files"}. MERGE-sense reconcile (file CONTENT), ` +
      `NOT archkit_goal_reconcile (goal-file placement, ADR 0020/0021).`,
    body,
    sourceAsk: `cross-lane conflict between ${conflicting.join(" and ")}`,
  };
}

// Mint the reconcile CGR for ONE conflict, IDEMPOTENTLY. The slug is derived
// deterministically from the conflicting slugs, so a second call (or a second
// fold of the same conflict event) sees the CGR already live or already done and
// returns minted:false instead of writing a duplicate. Writes exactly one goal
// file; appends nothing and runs nothing.
export function escalateConflict(archDir, {
  slugs = [], files = [], lanes = [], source = "event", at = null, note = "", order,
} = {}) {
  const conflicting = uniqSorted(slugs);
  if (conflicting.length === 0) throw new Error("escalateConflict requires the conflicting slugs");
  const slug = reconcileSlugFor(conflicting);

  // Idempotency: live copy, or one already archived in done/.
  let existing = null;
  try { existing = loadGoal(archDir, slug); } catch { existing = null; }
  if (existing) {
    return { slug, minted: false, reason: "already-queued", conflictSlugs: conflicting, goal: null, path: null };
  }
  if (isGoalDone(archDir, slug)) {
    return { slug, minted: false, reason: "already-resolved", conflictSlugs: conflicting, goal: null, path: null };
  }

  let resolvedOrder = order;
  if (resolvedOrder === undefined) {
    try { resolvedOrder = nextOrderBase(archDir); } catch { resolvedOrder = undefined; }
  }
  const goal = buildReconcileGoal({ slugs: conflicting, files, lanes, source, at, note, order: resolvedOrder });
  const written = writeGoal(archDir, goal);
  return {
    slug,
    minted: true,
    reason: "minted",
    conflictSlugs: conflicting,
    files: goal.owns,
    exclusive: true,
    dependsOn: goal.dependsOn,
    goal,
    path: written.filepath,
  };
}

// Is a board conflict ESCALATABLE to tier 3?
//   event-sourced      — always. Someone REPORTED a real collision; that is the
//                        genuine merge conflict ADR 0013 escalates.
//   derived cross-lane — only with includeDerived. A file-overlap among live CGRs
//                        is a PREDICTION, and predictions are what tiers 1+2 exist
//                        to handle; auto-minting for every predicted overlap would
//                        bury the board in reconcile CGRs for conflicts that never
//                        happen. Surfaced as a candidate, minted only on request.
//   derived same-lane  — never. Same lane = sequential in one worker context.
export function isEscalatableConflict(conflict, { includeDerived = false } = {}) {
  const c = conflict || {};
  if (!Array.isArray(c.slugs) || c.slugs.length < 2) return false;
  if (c.source === "event") return true;
  if (includeDerived !== true || c.crossLane !== true) return false;
  // A reconcile CGR OWNS the files it was minted to reconcile, so it necessarily
  // overlaps the CGRs it depends on. Escalating that predicted overlap would mint
  // a reconcile CGR for the reconcile CGR, forever. Genuine (event) collisions
  // involving one still escalate — only the prediction is suppressed.
  return !c.slugs.some((s) => String(s).startsWith(MERGE_RECONCILE_PREFIX));
}

// READ-ONLY escalation view: for every escalatable conflict on the board, the
// reconcile slug it maps to and whether that CGR already exists. This is what
// lets conductorPlan surface "this collision has not been escalated yet" without
// writing anything.
export function conflictEscalations(archDir, { board, now = new Date().toISOString(), includeDerived = false } = {}) {
  const state = board || sessionState(archDir, { now });
  const out = [];
  for (const c of state.conflicts || []) {
    if (!isEscalatableConflict(c, { includeDerived })) continue;
    const slugs = uniqSorted(c.slugs);
    const slug = reconcileSlugFor(slugs);
    let live = null;
    try { live = loadGoal(archDir, slug); } catch { live = null; }
    const done = live ? false : isGoalDone(archDir, slug);
    out.push({
      reconcileSlug: slug,
      slugs,
      files: conflictClaimFiles(c.files),
      source: c.source || "event",
      crossLane: c.crossLane ?? null,
      at: c.at || null,
      escalated: Boolean(live) || done,
      status: live ? statusOf(live) : done ? "completed" : null,
    });
  }
  out.sort((a, b) => (a.reconcileSlug < b.reconcileSlug ? -1 : a.reconcileSlug > b.reconcileSlug ? 1 : 0));
  return out;
}

// Sweep the board and mint a reconcile CGR for every escalatable conflict that
// does not have one yet. Idempotent end-to-end: re-running over an already
// escalated board mints nothing. Returns { minted, skipped, escalations }.
export function escalateConflicts(archDir, { board, now = new Date().toISOString(), includeDerived = false } = {}) {
  const escalations = conflictEscalations(archDir, { board, now, includeDerived });
  const minted = [];
  const skipped = [];
  for (const e of escalations) {
    if (e.escalated) { skipped.push({ ...e, reason: "already-escalated" }); continue; }
    const res = escalateConflict(archDir, {
      slugs: e.slugs, files: e.files, source: e.source, at: e.at || now,
    });
    if (res.minted) minted.push(res); else skipped.push({ ...e, reason: res.reason });
  }
  return { minted, skipped, escalations };
}

// The WRITE entry the conductor calls when a real collision surfaces: append the
// `conflict` event (the durable record — the fold is the source of truth) and, by
// default, escalate it to a merge-reconcile CGR. The event append is intentionally
// NOT deduped (the log is append-only by contract, ADR 0014); the MINT is what's
// idempotent, so folding the same conflict twice still yields ONE reconcile CGR.
export function recordConflict(archDir, {
  slugs = [], slug, files = [], lane = null, lanes = [], note = "",
  escalate = true, now = new Date().toISOString(),
} = {}) {
  const list = uniqSorted([...(Array.isArray(slugs) ? slugs : []), ...(slug ? [slug] : [])]);
  if (list.length < 2) {
    throw new Error("recordConflict requires at least two conflicting slugs");
  }
  const fileList = uniqSorted(files);
  const laneList = uniqSorted([...(Array.isArray(lanes) ? lanes : []), ...(lane ? [lane] : [])]);
  const event = appendEvent(archDir, {
    type: "conflict", slugs: list, files: fileList,
    ...(laneList.length ? { lanes: laneList } : {}),
    ...(note ? { note } : {}),
    at: now,
  });
  const reconcile = escalate
    ? escalateConflict(archDir, { slugs: list, files: fileList, lanes: laneList, source: "event", at: now, note })
    : null;
  return { slugs: list, files: fileList, lanes: laneList, event, reconcile };
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
  // Lane convergence (ADR 0023): the same ordered queue, grouped into one
  // integration point per lane with the rebase-onto-tip precondition. mergeOrder
  // is kept alongside it — existing consumers (session-start digest, the
  // archkit_conductor tool) still read the flat order; step 5 reads convergence.
  const convergence = laneConvergence(archDir, { now, board, mergeOrder });
  const review = conductorExceptions(board, { ownershipFloor });

  // Tier 3 escalation status (ADR 0013): which conflicts already have a
  // merge-reconcile CGR and which are still dead-ending as a bare exception
  // string. READ-ONLY here — minting is an explicit write step
  // (archkit_board_conflict / escalateConflicts), never a side effect of planning.
  // includeDerived stays FALSE: a predicted file-overlap is what tiers 1+2 exist
  // to handle, and it already surfaces in `conflicts`/`exceptions`. Only a
  // REPORTED (event) collision counts as an unescalated tier-3 dead-end here.
  const escalations = conflictEscalations(archDir, { board, now, includeDerived: false });
  const pendingEscalations = escalations.filter((e) => !e.escalated);

  // Claimable = frontier CGRs not already in-flight, grouped by lane. Exclusive
  // ones are solo barriers (their own dispatch unit).
  const claimableLanes = {};
  const barriers = [];
  for (const f of board.frontier) {
    if (f.exclusive) { barriers.push(f.slug); continue; }
    (claimableLanes[f.lane || "default"] ||= []).push(f.slug);
  }
  for (const k of Object.keys(claimableLanes)) claimableLanes[k].sort();

  // INTEGRATION DEBT (ADR 0024): CGRs that MERGED without a green recorded
  // verify. Surfaced as its own slice — silence about a merge is not evidence it
  // was green, and a later pass must be able to see what it inherited.
  const unverifiedMerges = (board.merged || [])
    .filter((m) => m.verifyStatus !== "green")
    .map((m) => ({
      slug: m.slug,
      lane: m.lane,
      at: m.at,
      branch: m.branch,
      status: m.verifyStatus,
      command: m.verifyCommand,
      reason: m.verification?.reason || "verify-not-run",
    }));

  const counts = {
    frontier: board.frontier.length,
    claimableLanes: Object.keys(claimableLanes).length,
    barriers: barriers.length,
    in_flight: board.in_flight.length,
    merge_queue: mergeOrder.length,
    convergenceGroups: convergence.counts.groups,
    unverifiableGroups: convergence.counts.unverifiableGroups,
    merged: (board.merged || []).length,
    unverified_merges: unverifiedMerges.length,
    blocked: board.blocked.length,
    exceptions: review.exceptions.length,
    leases_expired: board.leases_expired.length,
    escalations_pending: pendingEscalations.length,
  };

  return {
    now,
    board,
    claimableLanes,
    barriers: barriers.sort(),
    inFlight: board.in_flight,
    mergeOrder,
    convergence,
    merged: board.merged || [],
    unverifiedMerges,
    exceptions: review.exceptions,
    clean: review.clean,
    conflicts: review.conflicts,
    conflictEscalations: escalations,
    pendingEscalations,
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

// ── Compact SessionStart board snapshot (cgr-conductor-startup-board-awareness) ─
//
// The SessionStart digest only rehydrated the board when there was LIVE parallel
// conductor state (frontier / in-flight / merge / leases). In the common
// single-goal case the user opened a session BLIND to what's queued, in testing,
// on-hold, or split across project tracks — the board, a durable orientation
// surface, was doing none of that job. boardSnapshot folds the WHOLE board into a
// single compact line via triageNextGoal (the same pure classifier the conductor
// relay uses — no new mutable state), so both surfaces agree on what's live.
//
// Shape: "queue N (next <slug>) - testing N - projects (label:count, ...) - on-hold N",
// optionally prefixed with "active <slug>" when a goal is mid-flight. Returns ""
// when NOTHING is live (greenfield / no-CGR / all-done boards stay noise-free).
// When the board is MIXED — triage would surface a choice rather than auto-pick —
// a second line nudges toward /clear + /mcp__archkit__conductor, matching the
// ambiguity-gated selection (ADR 0019) instead of implying a mindless next pick.
export function boardSnapshot(archDir) {
  let t;
  try { t = triageNextGoal(archDir); } catch { return ""; }

  const queueN = t.queue.length;
  const testingN = t.testing.count;
  const onHoldN = t.onHold.count;
  const projectEntries = Object.entries(t.projects);
  const active = t.kind === "resume" ? (t.goal?.slug || null) : null;

  // Nothing live at all → no snapshot (empty / greenfield / all-done stays clean).
  if (!active && !queueN && !testingN && !projectEntries.length && !onHoldN) return "";

  const parts = [];
  if (active) parts.push(`active ${active}`);
  parts.push(`queue ${queueN}${queueN && t.queueNext ? ` (next ${t.queueNext})` : ""}`);
  parts.push(`testing ${testingN}`);
  parts.push(
    projectEntries.length
      ? `projects (${projectEntries.map(([p, slugs]) => `${p}:${slugs.length}`).join(", ")})`
      : `projects 0`,
  );
  parts.push(`on-hold ${onHoldN}`);

  const lines = [`[archkit CGR board] ${parts.join(" - ")}`];
  // Mixed board → the triage would ASK rather than auto-pick; point the user at the
  // one command that runs that choice, so startup orientation matches selection.
  if (t.kind === "choice") {
    lines.push(
      `Mixed board — no single obvious next pick. Run /clear then /mcp__archkit__conductor to choose which track to advance (queue / project / drain testing / plan something new).`,
    );
  }
  return lines.join("\n");
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
