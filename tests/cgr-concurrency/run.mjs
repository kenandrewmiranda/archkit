#!/usr/bin/env node
// cgr-concurrency — the goal-file mutators under ADR 0030's write contract.
//
// tests/fslock proves the PRIMITIVE (mutual exclusion, stale breaking,
// release-on-throw, no torn read). This suite proves the CALLERS actually use
// it, against the two defects the primitive was landed for:
//
//   1. stampGoalFields lost update. It is the funnel every lifecycle transition
//      passes through, and it was loadGoal -> mutate -> writeFileSync of the
//      whole file. Two concurrent stamps of DIFFERENT fields were last-writer-
//      wins over the entire frontmatter, so one field silently vanished. The fix
//      is not "hold a lock" — it is READ INSIDE THE LOCK (ADR 0030 §4), and that
//      is what the first race here measures.
//
//   2. reclaimExpiredLeases TOCTOU. It folds the board (slow: every event, every
//      CGR file) and then stamps `lease: null` against that snapshot. A worker
//      renewing its lease inside that window lost it anyway and its lane was
//      re-dispatched under it — two workers, one lane. The fix re-checks expiry
//      against the live CGR inside the lock.
//
// REAL PROCESSES, BEHIND A BARRIER. An in-process fake proves nothing about an
// O_EXCL create or a rename, which is exactly where the guarantee lives, and
// children launched in a burst can be accidentally serialised by spawn latency —
// so every child announces itself and blocks until all of them are provably in
// flight.
//
// EVERY RACE HAS A NEGATIVE CONTROL. A locked run that passes because nothing
// interleaved is worthless, so each race is run a second time against a verbatim
// copy of the PRE-fix code (tests/cgr-concurrency/child-*.mjs). The control must
// FAIL — lose a field, drop a renewed lease — or this suite fails loudly and
// says the workload has gone too soft to prove anything.
//
// Every fixture is an mkdtemp'd project with its own .arch/; nothing here can
// reach the live board (scripts/arch-write-guard.cjs would EACCES it anyway).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadGoal,
  leaseOf,
  laneOf,
  statusOf,
  stampGoalFields,
  startGoal,
  dispatchGoal,
  markTesting,
  markOnHold,
  completeGoal,
  abandonGoal,
  reconcileGoalsLayout,
  withGoalsLock,
} from "../../src/lib/goals.mjs";
import { reclaimExpiredLeases, claimFrontier } from "../../src/lib/board.mjs";
import { archLockPath, lockDepth, LOCK_WAIT_MS } from "../../src/lib/fslock.mjs";
import {
  stampFixture,
  reclaimFixture,
  cleanupTemps,
  childPath,
  runChild,
  runTogether,
  readLog,
} from "./fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHILD_STAMP = childPath("child-stamp.mjs");
const CHILD_RECLAIM = childPath("child-reclaim.mjs");
const CHILD_RENEW = childPath("child-renew.mjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

async function atest(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

console.log("\ncgr-concurrency — goal-file mutations under the lock (ADR 0030)\n");

// ═══════════════════════════════════════════════════════════════════════════
console.log("race 1 — concurrent stamps of DIFFERENT fields on one goal");
// ═══════════════════════════════════════════════════════════════════════════

// Five distinct extended-frontmatter fields, one process each. Nobody contends
// for another's field, so under a correct mutator the final file must carry all
// five at their last value — a missing or stale one is a LOST UPDATE, full stop.
const STAMP_FIELDS = ["lane", "handoff", "completion", "owns", "dependsOn"];
const STAMP_ROUNDS = 10;

async function stampRace(mode) {
  const { dir, archDir } = stampFixture();
  const logFile = path.join(dir, "stamp.log");
  fs.writeFileSync(logFile, "");

  await runTogether(dir, STAMP_FIELDS.map((field) => (readyDir, goFile) =>
    runChild(CHILD_STAMP, [mode, archDir, "hot", field, STAMP_ROUNDS, logFile, readyDir, goFile], dir)));

  const records = readLog(logFile);
  const goal = loadGoal(archDir, "hot");
  const observed = {};
  for (const field of STAMP_FIELDS) {
    const key = field === "dependsOn" ? "depends_on" : field;
    const v = goal?.meta?.[key];
    observed[field] = Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  }
  const expected = Object.fromEntries(STAMP_FIELDS.map((f) => [f, `${f}#${STAMP_ROUNDS - 1}`]));
  const lost = STAMP_FIELDS.filter((f) => observed[f] !== expected[f]);
  return { records, observed, expected, lost, goal };
}

await atest("locked: five processes stamping five different fields all survive", async () => {
  const r = await stampRace("lock");
  assert.equal(r.records.length, STAMP_FIELDS.length, "every contender reported");
  for (const rec of r.records) assert.equal(rec.error, null, `contender ${rec.field} threw: ${rec.error}`);
  assert.ok(r.goal, "the goal survived the race as a parseable file");
  assert.deepEqual(
    r.observed,
    r.expected,
    `lost update under the lock: ${r.lost.join(", ") || "(none)"} — got ${JSON.stringify(r.observed)}`,
  );
});

await atest("NEGATIVE CONTROL: the same workload unlocked loses at least one field", async () => {
  // Sampled rather than single-shot: the control is inherently probabilistic (it
  // is a race), and a suite that demands a loss on one specific attempt would be
  // the flaky one. Losing on NONE of the attempts means the workload can no
  // longer lose an update at all — at which point the locked run above proves
  // nothing and this must fail, loudly.
  const attempts = 3;
  const results = [];
  for (let i = 0; i < attempts; i++) results.push(await stampRace("nolock"));
  const anyLost = results.some((r) => r.lost.length > 0);
  assert.ok(
    anyLost,
    `the unlocked control never lost a field across ${attempts} attempts — the workload is too weak to prove anything. ` +
    `Observed: ${results.map((r) => JSON.stringify(r.observed)).join(" | ")}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nrace 2 — a lease RENEWED during a reclaim pass");
// ═══════════════════════════════════════════════════════════════════════════

// The renewer holds the lock across its stamp and the reclaim child announces
// its fold, so the dangerous order — fold, THEN renew, THEN mutate — is
// choreographed rather than aimed at with a sleep. `holdMs` is only the beat
// between "the fold has started" and the renewal, sized to clear the orphan
// (goals/ root is parsed first, so it is the first file the fold reads) with
// room for a scheduling hiccup. Its upper bound is the mutator's own 2s
// fail-open budget, which is a far more forgiving target than a 10ms fold.
const RENEW_HOLD_MS = 60;
const RENEW_TTL_MS = 3_600_000;

async function reclaimRace(mode) {
  const { dir, archDir } = reclaimFixture();
  const logFile = path.join(dir, "reclaim.log");
  fs.writeFileSync(logFile, "");
  const lockHeldFile = path.join(dir, "lock-held");
  const foldingFile = path.join(dir, "folding");

  await runTogether(dir, [
    (readyDir, goFile) => runChild(
      CHILD_RECLAIM,
      [mode, archDir, logFile, readyDir, goFile, lockHeldFile, foldingFile],
      dir,
    ),
    (readyDir, goFile) => runChild(
      CHILD_RENEW,
      [archDir, "orphan", "w-alpha", RENEW_TTL_MS, RENEW_HOLD_MS, logFile, readyDir, goFile, lockHeldFile, foldingFile],
      dir,
    ),
  ]);

  const records = readLog(logFile);
  const reclaim = records.find((r) => r.role === "reclaim");
  const renew = records.find((r) => r.role === "renew");
  const lease = leaseOf(loadGoal(archDir, "orphan"));
  const events = fs.readFileSync(path.join(archDir, "board", "events.ndjson"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return {
    reclaim,
    renew,
    lease,
    // The renewal is only interesting where it lands between the reclaim's fold
    // and its mutation — before or after that window, nothing was ever at risk.
    inWindow: Boolean(reclaim && renew && renew.startedAt > reclaim.startedAt && renew.endedAt < reclaim.endedAt),
    // The decisive evidence: an appended lease-expired means the pass decided to
    // orphan the CGR, which is what re-dispatches the lane under a live worker.
    expiredEvents: events.filter((e) => e.type === "lease-expired" && e.slug === "orphan").length,
    // "Dropped" is the defect itself: the worker renewed and its lease is gone.
    dropped: !lease || lease.expires !== renew?.expires,
  };
}

const LEASE_ATTEMPTS = 3;

// The control runs FIRST and is what licenses every assertion below it: proving
// the PRE-fix code drops the renewal under this choreography is what proves the
// renewal really lands in the fold->mutate window, rather than the fixed run
// looking safe because nothing was ever at risk.
const legacyRuns = [];
for (let i = 0; i < LEASE_ATTEMPTS; i++) legacyRuns.push(await reclaimRace("legacy"));

await atest("NEGATIVE CONTROL: the pre-fix reclaim drops a lease renewed mid-pass", async () => {
  const droppedIn = legacyRuns.filter((r) => r.dropped).length;
  assert.ok(
    droppedIn > 0,
    `the pre-fix reclaim never dropped the renewal across ${LEASE_ATTEMPTS} attempts, so the renewal is not landing ` +
    `in the fold->mutate window and the fixed runs below prove nothing. ` +
    `Timings: ${legacyRuns.map((r) => `renew@+${r.renew?.startedAt - r.reclaim?.startedAt}ms of ${r.reclaim?.endedAt - r.reclaim?.startedAt}ms`).join(" | ")}`,
  );
  const orphaned = legacyRuns.filter((r) => r.expiredEvents > 0).length;
  assert.ok(orphaned > 0, "and it appended lease-expired for a CGR whose worker was demonstrably alive");
});

const fixedRuns = [];
for (let i = 0; i < LEASE_ATTEMPTS; i++) fixedRuns.push(await reclaimRace("fixed"));

await atest("a lease renewed during a reclaim pass is never dropped", async () => {
  for (const r of fixedRuns) {
    assert.equal(r.reclaim?.error ?? null, null, `reclaim child threw: ${r.reclaim?.error}`);
    assert.equal(r.renew?.error ?? null, null, `renew child threw: ${r.renew?.error}`);
    assert.ok(r.renew?.held, "the renewer really held the lock — otherwise the interleaving was not choreographed");
    assert.ok(r.inWindow, "the renewal landed inside the reclaim pass's own start/end window");
    assert.ok(r.lease, "the renewed lease is still on the CGR");
    assert.equal(r.lease.expires, r.renew.expires, "and it is the RENEWED expiry, not a resurrected stale one");
  }
});

await atest("the in-lock re-check skips the reclaim entirely — no lease-expired event", async () => {
  // Keeping the lease is necessary but not sufficient: a reclaim that cleared it
  // and lost the race to the renewer's re-stamp would look identical. The event
  // is the decisive evidence, because appending one is not a harmless extra — it
  // folds the CGR out of in_flight, which is exactly what re-dispatches the lane
  // under the worker still holding it.
  for (const r of fixedRuns) {
    assert.equal(
      r.expiredEvents,
      0,
      "a lease-expired event was appended for a CGR whose worker had just renewed — the re-check did not fire",
    );
    assert.deepEqual(r.reclaim.reclaimed, [], "and nothing was reported as reclaimed");
  }
});

await atest("an orphan with NO renewal is still reclaimed (the fix is not a blanket skip)", async () => {
  const { archDir } = reclaimFixture();
  const r = reclaimExpiredLeases(archDir);
  assert.deepEqual(r.reclaimed.map((x) => x.slug), ["orphan"], "a genuinely dead lease is still cleared");
  assert.equal(leaseOf(loadGoal(archDir, "orphan")), null, "and the stale lease is dropped");
  assert.deepEqual(reclaimExpiredLeases(archDir).reclaimed, [], "idempotent, as before");
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nnesting — the converted call paths re-enter, they do not fail open");
// ═══════════════════════════════════════════════════════════════════════════

// Nesting is the NORMAL case here, not an edge: completeGoal -> stampGoalFields,
// ensureGoalsLayout -> migratePendingGoalsToQueue, claimFrontier -> stamp. The
// lock is reentrant per process, but "reentrant" is a claim about the primitive,
// not about these call paths — so they are traced rather than assumed. A path
// that did NOT re-enter would not deadlock (acquisition is bounded), it would
// silently burn the full fail-open budget and then mutate UNLOCKED, which is the
// regression that would be easiest to ship without noticing. Wall-clock is
// therefore the detector: an inner mutation that takes ~0ms re-entered; one that
// takes LOCK_WAIT_MS did not.
const NEST_BUDGET_MS = Math.max(200, Math.floor(LOCK_WAIT_MS / 4));

test("a nested mutator re-enters the outer lock and unwinds to zero", () => {
  const { archDir } = stampFixture();
  const lockPath = archLockPath(archDir);
  assert.equal(lockDepth(lockPath).depth, 0, "nothing held before the trace");

  const depths = [];
  withGoalsLock(archDir, "test:outer", () => {
    depths.push(lockDepth(lockPath).depth);
    stampGoalFields(archDir, "hot", { lane: "nested" });
    depths.push(lockDepth(lockPath).depth);
  });

  assert.deepEqual(depths, [1, 1], "the nested stamp re-entered rather than taking a second lock");
  assert.equal(lockDepth(lockPath).depth, 0, "and the outermost release unwound it fully");
  assert.ok(!fs.existsSync(lockPath), "the lockfile is gone, not stranded");
  assert.equal(laneOf(loadGoal(archDir, "hot")), "nested", "the nested mutation still landed");
});

// Each converted entry point, invoked while this process already holds the lock —
// exactly what a caller like runGoalComplete does one frame down.
const NESTED_PATHS = [
  ["stampGoalFields", (archDir) => stampGoalFields(archDir, "hot", { lane: "L" }),
    (archDir) => assert.equal(laneOf(loadGoal(archDir, "hot")), "L")],
  ["startGoal", (archDir) => startGoal(archDir, "hot"),
    (archDir) => assert.equal(statusOf(loadGoal(archDir, "hot")), "in-progress")],
  ["dispatchGoal", (archDir) => dispatchGoal(archDir, "hot", { worker: "w" }),
    (archDir) => assert.equal(statusOf(loadGoal(archDir, "hot")), "dispatched")],
  ["claimFrontier", (archDir) => claimFrontier(archDir, { slug: "hot", worker: "w" }),
    (archDir) => assert.ok(leaseOf(loadGoal(archDir, "hot")))],
  ["markTesting", (archDir) => markTesting(archDir, "hot"),
    (archDir) => assert.equal(statusOf(loadGoal(archDir, "hot")), "testing")],
  ["markOnHold", (archDir) => markOnHold(archDir, "hot"),
    (archDir) => assert.equal(statusOf(loadGoal(archDir, "hot")), "on-hold")],
  ["reconcileGoalsLayout", (archDir) => reconcileGoalsLayout(archDir, { apply: true }),
    (archDir) => assert.ok(loadGoal(archDir, "hot"))],
  ["reclaimExpiredLeases", (archDir) => reclaimExpiredLeases(archDir),
    (archDir) => assert.ok(loadGoal(archDir, "hot"))],
  ["completeGoal", (archDir) => completeGoal(archDir, "hot"),
    (archDir) => assert.equal(loadGoal(archDir, "hot"), null)],
  ["abandonGoal", (archDir) => abandonGoal(archDir, "hot", { reason: "r" }),
    (archDir) => assert.equal(loadGoal(archDir, "hot"), null)],
];

for (const [name, call, verify] of NESTED_PATHS) {
  test(`${name} re-enters when called under an outer lock`, () => {
    const { archDir } = stampFixture();
    let elapsed = 0;
    withGoalsLock(archDir, "test:outer", () => {
      const t0 = Date.now();
      call(archDir);
      elapsed = Date.now() - t0;
    });
    assert.ok(
      elapsed < NEST_BUDGET_MS,
      `${name} took ${elapsed}ms under an outer lock — that is the fail-open budget, not re-entry`,
    );
    verify(archDir);
    assert.equal(lockDepth(archLockPath(archDir)).depth, 0, "and the lock unwound fully");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nsource audit — the contract is an invariant nothing else enforces");
// ═══════════════════════════════════════════════════════════════════════════

// ADR 0030's own "harder" note: a new fs.writeFileSync against .arch/ silently
// opts out of the contract and no behavioural test fails. So the mutators are
// pinned by a scan, in the spirit of the existing spawn-cwd and windows-path
// audits — the next mutation added to this file inherits the rule or fails here.

const GOALS_SRC = fs.readFileSync(path.join(REPO_ROOT, "src/lib/goals.mjs"), "utf8");
const BOARD_SRC = fs.readFileSync(path.join(REPO_ROOT, "src/lib/board.mjs"), "utf8");

// A function's text: from its declaration to the next top-level declaration.
// Line-anchored rather than brace-counted, so a brace inside a template literal
// or a comment cannot silently truncate the slice and hand the scan an alibi.
function functionBody(src, name) {
  const re = new RegExp(`^(?:export )?function ${name}\\(`, "m");
  const m = re.exec(src);
  assert.ok(m, `${name} not found — the audit is scanning for a function that no longer exists`);
  const rest = src.slice(m.index + m[0].length);
  const end = /^(?:export )?(?:function|const|class) /m.exec(rest);
  return rest.slice(0, end ? end.index : rest.length);
}

// Every entry point that mutates a goal FILE. Each must take the lock; the ones
// that also re-read must do it inside.
const LOCKED_ENTRY_POINTS = [
  "stampGoalFields",
  "completeGoal",
  "startGoal",
  "dispatchGoal",
  "markTesting",
  "markOnHold",
  "abandonGoal",
  "reconcileGoalsLayout",
  "migratePendingGoalsToQueue",
];

for (const name of LOCKED_ENTRY_POINTS) {
  test(`AUDIT: goals.mjs ${name} routes through withGoalsLock`, () => {
    assert.match(functionBody(GOALS_SRC, name), /withGoalsLock\(/, `${name} mutates goal files outside the lock`);
  });
}

// The bodies that do the actual writing — the wrappers above delegate to these.
const ATOMIC_BODIES = [
  "stampGoalFields",
  "completeGoalLocked",
  "startGoalLocked",
  "dispatchGoalLocked",
  "markTestingLocked",
  "markOnHoldLocked",
  "abandonGoalLocked",
  "reconcilePass",
  "quarantineFile",
];

for (const name of ATOMIC_BODIES) {
  test(`AUDIT: goals.mjs ${name} writes atomically, never in place`, () => {
    const body = functionBody(GOALS_SRC, name);
    assert.doesNotMatch(body, /fs\.writeFileSync\(/, `${name} still writes a goal file in place`);
    assert.match(body, /atomicWriteFileSync\(/, `${name} does not write through the atomic primitive`);
  });
}

test("AUDIT: stampGoalFields loads INSIDE the lock, not before it", () => {
  const body = functionBody(GOALS_SRC, "stampGoalFields");
  const lockAt = body.indexOf("withGoalsLock(");
  const loadAt = body.indexOf("loadGoal(");
  assert.ok(lockAt >= 0 && loadAt >= 0, "expected both a lock and a load");
  assert.ok(loadAt > lockAt, "read-then-lock is the bug; the load must sit inside the lock callback");
});

test("AUDIT: reclaimExpiredLeases re-reads the lease inside the lock before stamping", () => {
  const body = functionBody(BOARD_SRC, "reclaimExpiredLeases");
  const lockAt = body.indexOf("withGoalsLock(");
  const leaseAt = body.indexOf("leaseOf(goal)");
  const stampAt = body.indexOf("stampGoalFields(");
  assert.ok(lockAt >= 0, "reclaimExpiredLeases does not take the lock");
  assert.ok(leaseAt > lockAt, "the lease re-read must happen inside the lock");
  assert.ok(stampAt > leaseAt, "and the re-read must precede the stamp");
});

// ── done ─────────────────────────────────────────────────────────────────────

cleanupTemps();
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
