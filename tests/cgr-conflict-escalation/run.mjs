#!/usr/bin/env node
// Tests for TIER 3 of ADR 0013's hybrid conflict strategy — escalating a genuine
// cross-lane conflict to a merge-reconcile CGR.
//
// ADR 0013: "Conflict strategy is hybrid, in order: pre-partition by ownership
// (pessimistic), worktree-isolate (contain), then a reconcile goal for genuine
// merge conflicts (escalate)." Tiers 1 and 2 shipped; tier 3 did not, so a
// cross-lane collision could only ever become an `exception` string for manual
// conductor review and the documented escalation path dead-ended.
//
// What this verifies:
//   - EC1: a detected conflict mints a reconcile CGR that depends_on every
//     conflicting slug and is `exclusive`, so partitionLanes schedules it as a
//     SOLO BARRIER rather than beside the lanes whose output it merges
//   - EC2: the minted CGR's body carries the conflicting slugs AND files, so a
//     fresh worker context resolves it without re-deriving the conflict
//   - EC3: minting is IDEMPOTENT — folding the same conflict event twice yields
//     exactly one reconcile CGR
//   - EC4: the merge sense of "reconcile" is disambiguated from the PLACEMENT
//     sense (archkit_goal_reconcile, ADR 0020/0021) in every tool description
//     that mentions either
//   - EC5: conflict -> minted barrier CGR -> it appears in the frontier ONLY
//     after the conflicting slugs complete

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  recordConflict,
  escalateConflict,
  escalateConflicts,
  conflictEscalations,
  isEscalatableConflict,
  buildReconcileGoal,
  reconcileSlugFor,
  conflictClaimFiles,
  appendEvent,
  readEvents,
  foldEvents,
  sessionState,
  conductorPlan,
  MERGE_RECONCILE_PREFIX,
  MERGE_RECONCILE_FEATURE,
} from "../../src/lib/board.mjs";
import {
  writeGoal,
  loadGoal,
  listGoals,
  startGoal,
  stampGoalFields,
  dependsOnOf,
  exclusiveOf,
  featureOf,
  ownsOf,
  partitionLanes,
} from "../../src/lib/goals.mjs";
import { tools } from "../../src/mcp/tools.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshArch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-escalation-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  return arch;
}

// A live (in-progress) CGR on a named lane owning a named file.
function liveGoal(arch, slug, fields = {}) {
  writeGoal(arch, { slug, title: slug, exitCriteria: ["x"] });
  startGoal(arch, slug);
  if (Object.keys(fields).length) stampGoalFields(arch, slug, fields);
  return slug;
}

const NOW = "2026-08-02T12:00:00.000Z";
const FILES = ["src/lib/board.mjs"];

console.log("\nConflict escalation — ADR 0013 tier 3\n");

// ── EC1: the minted CGR is a dependent, exclusive barrier ────────────────────

test("EC1: a recorded conflict mints a reconcile CGR that depends_on both slugs", () => {
  const arch = freshArch();
  liveGoal(arch, "lane-a-cgr", { lane: "a", owns: FILES });
  liveGoal(arch, "lane-b-cgr", { lane: "b", owns: FILES });

  const res = recordConflict(arch, {
    slugs: ["lane-b-cgr", "lane-a-cgr"], files: FILES, lanes: ["b", "a"], now: NOW,
  });

  assert.ok(res.reconcile.minted, "the conflict escalated");
  const minted = loadGoal(arch, res.reconcile.slug);
  assert.ok(minted, `minted CGR ${res.reconcile.slug} exists on disk`);
  assert.deepEqual(dependsOnOf(minted).sort(), ["lane-a-cgr", "lane-b-cgr"],
    "it depends_on EVERY conflicting slug");
});

test("EC1: the minted CGR is exclusive, so partitionLanes schedules it as a SOLO barrier", () => {
  const arch = freshArch();
  liveGoal(arch, "lane-a-cgr", { lane: "a", owns: FILES });
  liveGoal(arch, "lane-b-cgr", { lane: "b", owns: FILES });
  const { reconcile } = recordConflict(arch, { slugs: ["lane-a-cgr", "lane-b-cgr"], files: FILES, now: NOW });

  const minted = loadGoal(arch, reconcile.slug);
  assert.equal(exclusiveOf(minted), true, "exclusive:true");
  assert.equal(featureOf(minted), MERGE_RECONCILE_FEATURE);

  const plan = partitionLanes(listGoals(arch));
  const barrier = plan.barriers.find((b) => b.goals.includes(reconcile.slug));
  assert.ok(barrier, "the reconcile CGR is a BARRIER, not a parallel lane");
  assert.deepEqual(barrier.goals, [reconcile.slug], "the barrier is solo");
  assert.equal(barrier.exclusive, true);
  assert.ok(
    plan.stages.some((s) => s.kind === "barrier" && s.goal === reconcile.slug),
    "it gets its own barrier stage in the staged plan",
  );
});

test("EC1: the reconcile slug is greppably merge-sense and derived from the sorted slugs", () => {
  assert.equal(reconcileSlugFor(["b-cgr", "a-cgr"]), `${MERGE_RECONCILE_PREFIX}a-cgr-b-cgr`);
  assert.equal(reconcileSlugFor(["a-cgr", "b-cgr"]), reconcileSlugFor(["b-cgr", "a-cgr"]),
    "slug order does not change the derived slug (idempotency key)");
  assert.equal(reconcileSlugFor([]), null);
  // Long pairs stay filename-safe, deterministic and distinct.
  const long = ["x".repeat(60), "y".repeat(60)];
  const s1 = reconcileSlugFor(long);
  assert.ok(s1.length <= 80, `truncated slug is filename-safe (${s1.length})`);
  assert.equal(s1, reconcileSlugFor([...long].reverse()), "truncation is still deterministic");
  assert.notEqual(s1, reconcileSlugFor([long[0], "z".repeat(60)]), "hash suffix keeps long pairs distinct");
});

// ── EC2: the body carries the conflict, so no re-derivation is needed ────────

test("EC2: the minted CGR's body carries the conflicting slugs and files verbatim", () => {
  const arch = freshArch();
  liveGoal(arch, "board-cgr", { lane: "board" });
  liveGoal(arch, "goals-cgr", { lane: "goals" });
  const files = ["src/lib/board.mjs", "src/lib/goals.mjs"];
  const { reconcile } = recordConflict(arch, {
    slugs: ["board-cgr", "goals-cgr"], files, lanes: ["board", "goals"],
    note: "surfaced during the convergence drain", now: NOW,
  });

  const body = fs.readFileSync(reconcile.path, "utf8");
  for (const s of ["board-cgr", "goals-cgr"]) {
    assert.ok(body.includes(`- ${s}`), `body lists conflicting CGR ${s}`);
  }
  for (const f of files) {
    assert.ok(body.includes(`- ${f}`), `body lists conflicting file ${f}`);
  }
  assert.match(body, /## Conflicting CGRs/);
  assert.match(body, /## Conflicting files/);
  assert.match(body, /lanes: board, goals/, "provenance carries the lanes");
  assert.match(body, /surfaced during the convergence drain/, "provenance carries the note");
  assert.match(body, /ADR 0013/, "the body names the tier-3 decision it came from");
});

test("EC2: the conflicting files become the CGR's ownership prediction", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr");
  liveGoal(arch, "b-cgr");
  const { reconcile } = recordConflict(arch, {
    slugs: ["a-cgr", "b-cgr"], files: ["src/lib/goals.mjs", "src/lib/board.mjs"], now: NOW,
  });
  const minted = loadGoal(arch, reconcile.slug);
  assert.deepEqual(ownsOf(minted), ["src/lib/board.mjs", "src/lib/goals.mjs"]);
});

test("EC2: a derived a∩b overlap marker is expanded back into both real claims", () => {
  assert.deepEqual(
    conflictClaimFiles(["src/lib/*∩src/lib/board.mjs", "docs/x.md"]),
    ["docs/x.md", "src/lib/*", "src/lib/board.mjs"],
  );
  const goal = buildReconcileGoal({ slugs: ["a", "b"], files: ["src/lib/*∩src/lib/board.mjs"] });
  assert.deepEqual(goal.owns, ["src/lib/*", "src/lib/board.mjs"]);
});

// ── EC3: idempotent minting ──────────────────────────────────────────────────

test("EC3: folding the same conflict event TWICE mints exactly one reconcile CGR", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr", { lane: "a", owns: FILES });
  liveGoal(arch, "b-cgr", { lane: "b", owns: FILES });

  const first = recordConflict(arch, { slugs: ["a-cgr", "b-cgr"], files: FILES, now: NOW });
  const second = recordConflict(arch, { slugs: ["b-cgr", "a-cgr"], files: FILES, now: NOW });

  assert.equal(first.reconcile.minted, true);
  assert.equal(second.reconcile.minted, false, "the second fold does NOT mint");
  assert.equal(second.reconcile.reason, "already-queued");
  assert.equal(second.reconcile.slug, first.reconcile.slug);

  // The append-only log DOES carry both events (ADR 0014) — only the mint dedupes.
  const conflicts = foldEvents(readEvents(arch)).conflicts;
  assert.equal(conflicts.length, 2, "both conflict events are on the log");

  const reconciles = listGoals(arch).filter((g) => g.slug.startsWith(MERGE_RECONCILE_PREFIX));
  assert.equal(reconciles.length, 1, "exactly ONE reconcile CGR exists");
});

test("EC3: the board-wide escalation sweep is idempotent too", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr", { lane: "a", owns: FILES });
  liveGoal(arch, "b-cgr", { lane: "b", owns: FILES });
  appendEvent(arch, { type: "conflict", slugs: ["a-cgr", "b-cgr"], files: FILES, at: NOW });
  appendEvent(arch, { type: "conflict", slugs: ["a-cgr", "b-cgr"], files: FILES, at: NOW });

  const one = escalateConflicts(arch, { now: NOW });
  const two = escalateConflicts(arch, { now: NOW });
  assert.equal(one.minted.length, 1, "first sweep mints once");
  assert.equal(two.minted.length, 0, "second sweep mints nothing");
  assert.equal(two.skipped[0].reason, "already-escalated");
  assert.equal(
    listGoals(arch).filter((g) => g.slug.startsWith(MERGE_RECONCILE_PREFIX)).length, 1,
  );
});

test("EC3: a conflict whose reconcile CGR is already DONE is not re-minted", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr");
  liveGoal(arch, "b-cgr");
  const slug = reconcileSlugFor(["a-cgr", "b-cgr"]);
  // Plant the resolved copy in done/, as completeGoal would leave it.
  const done = path.join(arch, "goals", "done");
  fs.mkdirSync(done, { recursive: true });
  fs.writeFileSync(path.join(done, `${slug}.md`), `---\nslug: ${slug}\nstatus: completed\n---\n\n# done\n`);

  const res = escalateConflict(arch, { slugs: ["a-cgr", "b-cgr"], files: FILES, at: NOW });
  assert.equal(res.minted, false);
  assert.equal(res.reason, "already-resolved");
});

// ── EC5: the barrier reaches the frontier only after the conflict clears ─────

test("EC5: conflict -> barrier CGR -> frontier ONLY after both conflicting slugs complete", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr", { lane: "a", owns: FILES });
  liveGoal(arch, "b-cgr", { lane: "b", owns: FILES });
  const { reconcile } = recordConflict(arch, { slugs: ["a-cgr", "b-cgr"], files: FILES, now: NOW });
  const slug = reconcile.slug;

  // 1) Nothing completed → blocked on BOTH, absent from the frontier.
  let board = sessionState(arch, { now: NOW });
  assert.ok(!board.frontier.some((f) => f.slug === slug), "not on the frontier yet");
  const blocked = board.blocked.find((b) => b.slug === slug);
  assert.ok(blocked, "it is BLOCKED, not silently dropped");
  assert.deepEqual(blocked.blockedOn, ["a-cgr", "b-cgr"]);

  // 2) One conflicting CGR completes → still blocked on the other.
  appendEvent(arch, { type: "completed", slug: "a-cgr", at: NOW });
  board = sessionState(arch, { now: NOW });
  assert.ok(!board.frontier.some((f) => f.slug === slug), "one dep met is not enough");
  assert.deepEqual(board.blocked.find((b) => b.slug === slug).blockedOn, ["b-cgr"]);

  // 3) Both complete → it surfaces on the frontier as an exclusive barrier.
  appendEvent(arch, { type: "completed", slug: "b-cgr", at: NOW });
  board = sessionState(arch, { now: NOW });
  const front = board.frontier.find((f) => f.slug === slug);
  assert.ok(front, "now on the frontier");
  assert.equal(front.exclusive, true, "and it is an exclusive barrier");

  // The conductor plan surfaces it as a solo barrier, never as a claimable lane.
  const plan = conductorPlan(arch, { now: NOW });
  assert.ok(plan.barriers.includes(slug), "conductorPlan lists it under barriers");
  assert.ok(
    !Object.values(plan.claimableLanes).flat().includes(slug),
    "never grouped into a parallel claimable lane",
  );
});

test("EC5: conductorPlan surfaces UNESCALATED conflicts and stops once they are escalated", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr", { lane: "a", owns: FILES });
  liveGoal(arch, "b-cgr", { lane: "b", owns: FILES });
  appendEvent(arch, { type: "conflict", slugs: ["a-cgr", "b-cgr"], files: FILES, at: NOW });

  const before = conductorPlan(arch, { now: NOW });
  assert.equal(before.counts.escalations_pending >= 1, true, "the dead-end is visible");
  assert.ok(before.pendingEscalations.some((e) => e.slugs.includes("a-cgr")));

  escalateConflicts(arch, { now: NOW });
  const after = conductorPlan(arch, { now: NOW });
  assert.equal(after.counts.escalations_pending, 0, "nothing left unescalated");
  assert.ok(after.conflictEscalations.every((e) => e.escalated));
  // And the minted CGR does not feed itself: it OWNS the conflicting files, so a
  // naive derived-overlap sweep would escalate it against the CGRs it reconciles.
  assert.ok(
    !after.pendingEscalations.some((e) => e.slugs.some((s) => s.startsWith(MERGE_RECONCILE_PREFIX))),
    "escalation does not recurse on the reconcile CGR it just minted",
  );
});

test("escalation never recurses: a reconcile CGR's own predicted overlap is not re-escalated", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr", { lane: "a", owns: FILES });
  liveGoal(arch, "b-cgr", { lane: "b", owns: FILES });
  recordConflict(arch, { slugs: ["a-cgr", "b-cgr"], files: FILES, now: NOW });
  // The minted CGR now claims the same file on its own lane — a derived cross-lane
  // overlap by construction. Even the opt-in derived sweep must leave it alone.
  const sweep = escalateConflicts(arch, { now: NOW, includeDerived: true });
  assert.equal(sweep.minted.length, 0, "no reconcile CGR for the reconcile CGR");
  assert.equal(listGoals(arch).filter((g) => g.slug.startsWith(MERGE_RECONCILE_PREFIX)).length, 1);
});

// ── Escalation policy: predicted vs genuine ──────────────────────────────────

test("an EVENT conflict is always escalatable; a merely PREDICTED overlap is not, by default", () => {
  const event = { slugs: ["a", "b"], files: [], source: "event", crossLane: null };
  const derivedCross = { slugs: ["a", "b"], files: [], source: "file-overlap", crossLane: true };
  const derivedSame = { slugs: ["a", "b"], files: [], source: "file-overlap", crossLane: false };

  assert.equal(isEscalatableConflict(event), true);
  assert.equal(isEscalatableConflict(derivedCross), false, "prediction is tier 1's job, not tier 3's");
  assert.equal(isEscalatableConflict(derivedCross, { includeDerived: true }), true);
  assert.equal(isEscalatableConflict(derivedSame, { includeDerived: true }), false,
    "same-lane overlap is sequential in one worker context — never a merge conflict");
  assert.equal(isEscalatableConflict({ slugs: ["a"] }), false, "a one-sided conflict is not a conflict");
});

test("the default sweep escalates event conflicts only, leaving predicted overlap alone", () => {
  const arch = freshArch();
  // Two live CGRs on different lanes claiming the same file → a DERIVED cross-lane
  // conflict, with no conflict event.
  liveGoal(arch, "a-cgr", { lane: "a", owns: FILES });
  liveGoal(arch, "b-cgr", { lane: "b", owns: FILES });

  const derived = sessionState(arch, { now: NOW }).conflicts;
  assert.ok(derived.some((c) => c.source === "file-overlap" && c.crossLane === true),
    "the fixture really does produce a derived cross-lane conflict");

  assert.equal(escalateConflicts(arch, { now: NOW }).minted.length, 0,
    "default sweep mints nothing for a prediction");
  assert.equal(escalateConflicts(arch, { now: NOW, includeDerived: true }).minted.length, 1,
    "opting in escalates it");
});

test("recordConflict refuses a single-sided conflict rather than minting nonsense", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr");
  assert.throws(() => recordConflict(arch, { slugs: ["a-cgr"], now: NOW }), /at least two/);
  assert.throws(() => escalateConflict(arch, { slugs: [] }), /conflicting slugs/);
});

test("escalate:false records the conflict event WITHOUT minting", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr");
  liveGoal(arch, "b-cgr");
  const res = recordConflict(arch, { slugs: ["a-cgr", "b-cgr"], files: FILES, escalate: false, now: NOW });
  assert.equal(res.reconcile, null);
  assert.equal(foldEvents(readEvents(arch)).conflicts.length, 1, "the event is still recorded");
  assert.equal(listGoals(arch).filter((g) => g.slug.startsWith(MERGE_RECONCILE_PREFIX)).length, 0);
});

test("conflictEscalations is READ-ONLY — it never mints", () => {
  const arch = freshArch();
  liveGoal(arch, "a-cgr");
  liveGoal(arch, "b-cgr");
  appendEvent(arch, { type: "conflict", slugs: ["a-cgr", "b-cgr"], files: FILES, at: NOW });
  const view = conflictEscalations(arch, { now: NOW });
  assert.equal(view.length, 1);
  assert.equal(view[0].escalated, false);
  assert.equal(listGoals(arch).filter((g) => g.slug.startsWith(MERGE_RECONCILE_PREFIX)).length, 0,
    "reading the escalation view wrote nothing");
});

test("escalation is instruct-not-act: no git, no child_process anywhere in the tier-3 code", () => {
  const src = fs.readFileSync(new URL("../../src/lib/board.mjs", import.meta.url), "utf8");
  assert.ok(!/from\s+["']node:child_process["']|require\(["']child_process["']\)/.test(src),
    "board.mjs never imports child_process");
  assert.ok(!/\b(execSync|spawnSync|execFileSync|spawn)\(/.test(src), "board.mjs runs no commands");
});

// ── EC4: the two senses of "reconcile" are never confusable ──────────────────

test("EC4: archkit_goal_reconcile's description names itself PLACEMENT-sense and points at the merge sense", () => {
  const d = tools.archkit_goal_reconcile.description;
  assert.match(d, /PLACEMENT-sense/, "it labels its own sense");
  assert.match(d, /archkit_board_conflict/, "it points at the merge-sense tool");
  assert.match(d, /merge-reconcile/, "it names the merge-sense CGR prefix");
  assert.match(d, /never touches file CONTENT|never touches (the )?file CONTENT/,
    "it says explicitly what it does NOT do");
});

test("EC4: archkit_board_conflict's description names itself MERGE-sense and rules out the placement sense", () => {
  const d = tools.archkit_board_conflict.description;
  assert.match(d, /MERGE sense/, "it labels its own sense");
  assert.match(d, /NOT archkit_goal_reconcile/, "it rules out the placement sense by tool name");
  assert.match(d, /ADR 0013/, "it cites the tier-3 decision");
  assert.match(d, /ADR 0020\/0021/, "it cites the placement decision it is NOT");
});

test("EC4: EVERY tool description using the word 'reconcile' disambiguates the two senses", () => {
  const offenders = [];
  for (const [name, tool] of Object.entries(tools)) {
    const d = String(tool.description || "");
    if (!/reconcil/i.test(d)) continue;
    // A description that uses the word must say which sense it means AND rule
    // out the other, so a fresh context can never conflate them.
    const declaresSense = /PLACEMENT-sense|MERGE sense|MERGE-sense/.test(d);
    const rulesOutOther = /archkit_goal_reconcile|archkit_board_conflict|merge-reconcile/.test(d);
    if (!declaresSense || !rulesOutOther) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    `these tool descriptions say "reconcile" without disambiguating the merge vs placement sense: ${offenders.join(", ")}`);
});

test("EC4: the board's merge-sense vocabulary is greppable — slug prefix + feature tag", () => {
  const goal = buildReconcileGoal({ slugs: ["a", "b"], files: FILES, source: "event" });
  assert.ok(goal.slug.startsWith(MERGE_RECONCILE_PREFIX), "slug is prefixed merge-reconcile-");
  assert.equal(goal.feature, MERGE_RECONCILE_FEATURE);
  assert.match(goal.why, /MERGE-sense/);
  assert.match(goal.why, /NOT archkit_goal_reconcile/);
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
