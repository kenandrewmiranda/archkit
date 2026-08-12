#!/usr/bin/env node
// board-json-lock — the LAST lock-free read-modify-writes over CGR sidecar state.
//
// tests/fslock proves the PRIMITIVE. tests/cgr-concurrency proves the GOAL FILE
// mutators adopted it. This suite closes the three holes that lane disclosed and
// did not own — the JSON sidecars beside the goals and the shared chat board:
//
//   1. bumpLoopBlock lost increment. The turn-cap counter is read-modify-written
//      by bin/archkit-stop-hook.mjs, which is a FRESH PROCESS at every turn-end
//      in every open session — the single most concurrent writer in the system.
//      A lost increment is not cosmetic: it is a turn the escape hatch never
//      counted, so the loop that was supposed to release keeps trapping.
//
//   2. ensureQueueBranch lost record. "Record ONCE, then reuse" is a check-then-
//      act. Two sessions starting a queue goal together both read "nothing
//      minted", both mint, the second write clobbers the first — after the first
//      already RETURNED its name. That is two agents told to work one batch on
//      two branches.
//
//   3. appendChatEntry lost announcement. The board's whole purpose is that
//      several agents write it at once, and it was a whole-file rewrite. The
//      entry that gets erased is exactly the one that would have prevented the
//      collision. Fixed by making the write genuinely append-only rather than by
//      locking it — see the "not the lock" test below for why that is stronger.
//
// REAL PROCESSES, BEHIND A BARRIER. An in-process fake proves nothing about an
// O_APPEND write or a rename, which is where the guarantee lives, and children
// launched in a burst can be accidentally serialised by spawn latency — so every
// child announces itself and blocks until all of them are provably in flight.
//
// EVERY RACE HAS A NEGATIVE CONTROL that reproduces the PRE-fix code and MUST
// fail. A protected run that passes because nothing interleaved is worthless, so
// if a control ever stops losing data this suite fails loudly and says the
// workload has gone too soft to prove anything.
//
// Every fixture is an mkdtemp'd project with its own .arch/; nothing here can
// reach the live board (scripts/arch-write-guard.cjs would EACCES it anyway).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readLoopState,
  bumpLoopBlock,
  resetLoopState,
  ensureQueueBranch,
  readQueueBranch,
  clearQueueBranchIfDrained,
  appendChatEntry,
  readChatBoard,
} from "../../src/lib/goals.mjs";
import { archLockPath, LOCK_WAIT_MS } from "../../src/lib/fslock.mjs";
import {
  loopFixture,
  queueFixture,
  chatFixture,
  tempProject,
  cleanupTemps,
  childPath,
  runChild,
  runTogether,
  readLog,
  loopStatePath,
  queueStatePath,
  chatBoardPath,
} from "./fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHILD_BUMP = childPath("child-bump.mjs");
const CHILD_QUEUE = childPath("child-queue.mjs");
const CHILD_CHAT = childPath("child-chat.mjs");

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

console.log("\nboard-json-lock — sidecar JSON + chat board under the write contract (ADR 0030)\n");

// ═══════════════════════════════════════════════════════════════════════════
console.log("race 1 — concurrent turn-end bumps of the SAME turn-cap counter");
// ═══════════════════════════════════════════════════════════════════════════

// Five Stop-hook-shaped processes, all bumping one slug. The counter is a pure
// accumulator, so the arithmetic is exact and so is the verdict: anything less
// than WRITERS*ROUNDS is a lost increment, full stop.
const BUMP_WRITERS = 5;
const BUMP_ROUNDS = 12;
const BUMP_TOTAL = BUMP_WRITERS * BUMP_ROUNDS;

async function bumpRace(mode) {
  const { dir, archDir } = loopFixture();
  const logFile = path.join(dir, "bump.log");
  fs.writeFileSync(logFile, "");

  await runTogether(dir, Array.from({ length: BUMP_WRITERS }, () => (readyDir, goFile) =>
    runChild(CHILD_BUMP, [mode, archDir, "hot", BUMP_ROUNDS, logFile, readyDir, goFile], dir)));

  const records = readLog(logFile);
  const state = readLoopState(archDir);
  const counted = Number(state.hot || 0);
  return { records, counted, lost: BUMP_TOTAL - counted, archDir };
}

await atest(`locked: ${BUMP_WRITERS} processes x ${BUMP_ROUNDS} bumps land all ${BUMP_TOTAL} increments`, async () => {
  const r = await bumpRace("lock");
  assert.equal(r.records.length, BUMP_WRITERS, "every contender reported");
  for (const rec of r.records) assert.equal(rec.error, null, `contender ${rec.pid} threw: ${rec.error}`);
  assert.equal(
    r.counted,
    BUMP_TOTAL,
    `lost ${r.lost}/${BUMP_TOTAL} increments under the lock — the counter read is not inside it`,
  );
  // The filler keys are the collateral: a lost update here would also be a
  // whole-file clobber, so their survival is a second, independent witness.
  const state = readLoopState(r.archDir);
  assert.ok(Object.keys(state).length > 1000, "the rest of the counter file survived intact");
});

await atest("NEGATIVE CONTROL: the same workload with the pre-fix body loses increments", async () => {
  // Sampled rather than single-shot: the control is inherently probabilistic (it
  // is a race), and a suite that demands a loss on one specific attempt would be
  // the flaky one. Losing on NONE of the attempts means the workload can no
  // longer lose an increment at all — at which point the locked run above proves
  // nothing and this must fail, loudly.
  const attempts = 2;
  const runs = [];
  for (let i = 0; i < attempts; i++) runs.push(await bumpRace("nolock"));
  const worst = Math.max(...runs.map((r) => r.lost));
  assert.ok(
    worst > 0,
    `the pre-fix bump never lost an increment across ${attempts} attempts (counted ${runs.map((r) => r.counted).join(", ")} of ${BUMP_TOTAL}) — ` +
    "the workload is too weak to prove anything",
  );
  console.log(`      negative control lost ${runs.map((r) => `${r.lost}/${BUMP_TOTAL}`).join(", ")} increments`);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nrace 2 — concurrent first-use of the shared queue branch");
// ═══════════════════════════════════════════════════════════════════════════

// Six sessions, six DIFFERENT dates. Distinct dates are the point: they make the
// branch each child would mint on its own distinguishable, so "everyone agrees"
// cannot be true by accident.
const QUEUE_DATES = ["2026-01-01", "2026-02-02", "2026-03-03", "2026-04-04", "2026-05-05", "2026-06-06"];

async function queueRace(mode) {
  const { dir, archDir } = queueFixture();
  const logFile = path.join(dir, "queue.log");
  fs.writeFileSync(logFile, "");

  await runTogether(dir, QUEUE_DATES.map((date) => (readyDir, goFile) =>
    runChild(CHILD_QUEUE, [mode, archDir, date, logFile, readyDir, goFile], dir)));

  const records = readLog(logFile);
  const returned = [...new Set(records.map((r) => r.branch))];
  return { records, returned, recorded: readQueueBranch(archDir), archDir };
}

await atest("locked: every contender returns the ONE recorded branch", async () => {
  const r = await queueRace("lock");
  assert.equal(r.records.length, QUEUE_DATES.length, "every contender reported");
  for (const rec of r.records) assert.equal(rec.error, null, `contender ${rec.date} threw: ${rec.error}`);
  assert.equal(
    r.returned.length,
    1,
    `the batch was handed ${r.returned.length} different branches: ${r.returned.join(", ")}`,
  );
  assert.equal(r.returned[0], r.recorded, "and the name every caller got is the one on disk");
  assert.match(r.recorded, /^cgr-queue-2026-/, "a real minted name, not an empty record");
});

await atest("NEGATIVE CONTROL: the pre-fix ensureQueueBranch hands out several branches", async () => {
  const attempts = 2;
  const runs = [];
  for (let i = 0; i < attempts; i++) runs.push(await queueRace("nolock"));
  const worst = Math.max(...runs.map((r) => r.returned.length));
  assert.ok(
    worst > 1,
    `the pre-fix mint agreed on one branch across ${attempts} attempts — the workload is too weak to prove anything`,
  );
  console.log(`      negative control returned ${runs.map((r) => `${r.returned.length}/${QUEUE_DATES.length}`).join(", ")} distinct branches`);
  // The clobber is the other half of the same defect: the record on disk is not
  // even the branch the first caller was told to use.
  const disagreed = runs.some((r) => r.records.some((rec) => rec.branch !== r.recorded));
  assert.ok(disagreed, "and at least one caller walked away with a branch the record does not name");
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nrace 3 — concurrent announcements on the coordination board");
// ═══════════════════════════════════════════════════════════════════════════

const CHAT_WRITERS = 4;
const CHAT_ROUNDS = 10;
const CHAT_TOTAL = CHAT_WRITERS * CHAT_ROUNDS;

async function chatRace(mode) {
  const { dir, archDir } = chatFixture();
  const logFile = path.join(dir, "chat.log");
  fs.writeFileSync(logFile, "");

  await runTogether(dir, Array.from({ length: CHAT_WRITERS }, () => (readyDir, goFile) =>
    runChild(CHILD_CHAT, [mode, archDir, CHAT_ROUNDS, logFile, readyDir, goFile], dir)));

  const records = readLog(logFile);
  const announced = records.flatMap((r) => r.announced || []);
  const onBoard = new Set(readChatBoard(archDir, { limit: 0 }).map((e) => e.slug));
  const missing = announced.filter((s) => !onBoard.has(s));
  return { records, announced, missing, archDir };
}

await atest(`append-only: all ${CHAT_TOTAL} concurrent announcements survive`, async () => {
  const r = await chatRace("append");
  assert.equal(r.records.length, CHAT_WRITERS, "every announcer reported");
  for (const rec of r.records) assert.equal(rec.error, null, `announcer ${rec.pid} threw: ${rec.error}`);
  assert.equal(r.announced.length, CHAT_TOTAL, "every announcer made its full round of entries");
  assert.deepEqual(
    r.missing,
    [],
    `${r.missing.length}/${CHAT_TOTAL} announcements were erased by a concurrent writer`,
  );
  // Torn blocks are the other way an append can fail: a half-written entry would
  // be skipped by the regex parse and silently under-count. Nothing may be
  // unparseable.
  const raw = fs.readFileSync(chatBoardPath(r.archDir), "utf8");
  const blocks = raw.match(/<!-- cgr-chat /g) || [];
  assert.equal(blocks.length, CHAT_TOTAL, "every entry marker parsed — no torn block");
});

await atest("NEGATIVE CONTROL: the pre-fix read-modify-write erases announcements", async () => {
  const attempts = 2;
  const runs = [];
  for (let i = 0; i < attempts; i++) runs.push(await chatRace("rmw"));
  const worst = Math.max(...runs.map((r) => r.missing.length));
  assert.ok(
    worst > 0,
    `the pre-fix board rewrite never erased an entry across ${attempts} attempts — the workload is too weak to prove anything`,
  );
  console.log(`      negative control erased ${runs.map((r) => `${r.missing.length}/${CHAT_TOTAL}`).join(", ")} announcements`);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nfail-open — acquisition failure is LOUD, and never fails closed (ADR 0030 §7)");
// ═══════════════════════════════════════════════════════════════════════════

// A FOREIGN, FRESH lockfile: a pid that is not ours, stamped now, so it is not a
// corpse the TTL may break. The mutation must still happen (fail OPEN — these sit
// on the Stop hook, and failing closed would hang every turn-end), and it must
// SAY that it ran unprotected. Silence here is the bug: "best-effort" is only
// acceptable while it is auditable.
function holdForeignLock(archDir) {
  const lockPath = archLockPath(archDir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({
    pid: 999_999,
    host: "somewhere-else",
    token: "foreign",
    acquiredAt: new Date().toISOString(),
    acquiredAtMs: Date.now(),
    meta: { op: "a mutation this process cannot see" },
  })}\n`);
  return lockPath;
}

await atest("bumpLoopBlock under a foreign lock still counts the turn, and warns that it did", async () => {
  const { archDir } = loopFixture({ keys: 10 });
  holdForeignLock(archDir);

  const warnings = [];
  const onWarn = (w) => warnings.push(w);
  process.on("warning", onWarn);
  const t0 = Date.now();
  const n = bumpLoopBlock(archDir, "hot");
  const elapsed = Date.now() - t0;
  await new Promise((r) => setImmediate(r)); // emitWarning lands on the next tick
  process.off("warning", onWarn);

  assert.equal(n, 1, "the increment happened anyway — fail OPEN, not fail closed");
  assert.equal(readLoopState(archDir).hot, 1, "and it is on disk");
  const loud = warnings.filter((w) => w.name === "ArchkitLockWarning");
  assert.ok(loud.length > 0, "the fail-open was silent — nothing warned that the counter was written unprotected");
  assert.ok(
    loud.some((w) => /bumpLoopBlock/.test(w.message)),
    `the warning does not name the operation: ${loud.map((w) => w.message).join(" | ")}`,
  );
  console.log(`      fail-open cost ${elapsed}ms (budget ${LOCK_WAIT_MS}ms per acquisition)`);
});

test("appendChatEntry does NOT depend on acquiring the lock — a foreign holder cannot cost it an entry", () => {
  // This is why the board was made append-only instead of locked: the lock fails
  // open, so a locked appendChatEntry would still lose an entry under exactly the
  // condition below. An O_APPEND write cannot.
  const { archDir } = tempProject("chat-foreign");
  holdForeignLock(archDir);
  appendChatEntry(archDir, { slug: "under-foreign-lock", files: ["a.mjs"] });
  const entries = readChatBoard(archDir);
  assert.deepEqual(entries.map((e) => e.slug), ["under-foreign-lock"], "the entry landed regardless of the lock");
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nsingle-process behaviour — unchanged by the conversion");
// ═══════════════════════════════════════════════════════════════════════════

test("bumpLoopBlock counts per slug and resetLoopState clears the file", () => {
  const { archDir } = tempProject("single-loop");
  assert.equal(bumpLoopBlock(archDir, "a"), 1);
  assert.equal(bumpLoopBlock(archDir, "a"), 2);
  assert.equal(bumpLoopBlock(archDir, "b"), 1, "counters are per slug");
  assert.deepEqual(readLoopState(archDir), { a: 2, b: 1 });
  resetLoopState(archDir);
  assert.deepEqual(readLoopState(archDir), {}, "reset clears");
  assert.ok(!fs.existsSync(loopStatePath(archDir)), "and removes the file, as before");
});

test("ensureQueueBranch records once, reuses, and clears when the queue drains", () => {
  const { archDir } = tempProject("single-queue");
  const first = ensureQueueBranch(archDir, { date: "2026-06-20" });
  assert.equal(first, "cgr-queue-2026-06-20");
  assert.equal(ensureQueueBranch(archDir, { date: "2026-07-01" }), first, "later goals REUSE the recorded name");
  assert.equal(readQueueBranch(archDir), first);
  assert.deepEqual(JSON.parse(fs.readFileSync(queueStatePath(archDir), "utf8")), {
    branch: first, minted: "2026-06-20",
  }, "the record's shape is unchanged");
  clearQueueBranchIfDrained(archDir);
  assert.equal(readQueueBranch(archDir), null, "drained → cleared");
});

test("the chat board still gets a header on creation and blank-line-separated entries", () => {
  const { archDir } = tempProject("single-chat");
  const r = appendChatEntry(archDir, { slug: "one", project: "alpha", files: ["./a.mjs", "a.mjs"], note: "hi" });
  assert.equal(r.written, true);
  assert.equal(r.branch, "feat/alpha");
  assert.deepEqual(r.files, ["a.mjs"], "normalised + deduped, as before");
  appendChatEntry(archDir, { slug: "two", files: ["b.mjs"] });
  const raw = fs.readFileSync(chatBoardPath(archDir), "utf8");
  assert.ok(raw.startsWith("# CGR agent coordination board"), "header written on creation");
  assert.equal((raw.match(/# CGR agent coordination board/g) || []).length, 1, "exactly one header");
  assert.match(raw, /\n\n<!-- cgr-chat .*"slug":"two"/, "entries separated by a blank line");
  assert.deepEqual(readChatBoard(archDir).map((e) => e.slug), ["two", "one"], "newest first, as before");
});

test("an EMPTY pre-existing board still gets its header (the old truthiness check)", () => {
  const { archDir } = tempProject("empty-chat");
  fs.writeFileSync(chatBoardPath(archDir), "");
  appendChatEntry(archDir, { slug: "first", files: [] });
  const raw = fs.readFileSync(chatBoardPath(archDir), "utf8");
  assert.ok(raw.startsWith("# CGR agent coordination board"), "header restored on an empty board");
  assert.ok(raw.includes("(none declared)"), "empty files render as before");
  assert.deepEqual(readChatBoard(archDir).map((e) => e.slug), ["first"]);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nsource audit — the contract is an invariant nothing else enforces");
// ═══════════════════════════════════════════════════════════════════════════

// ADR 0030's own "harder" note: a new fs.writeFileSync against .arch/ silently
// opts out of the contract and no behavioural test fails. So these mutators are
// pinned by a scan, exactly as tests/cgr-concurrency pins the goal-file ones.

const GOALS_SRC = fs.readFileSync(path.join(REPO_ROOT, "src/lib/goals.mjs"), "utf8");

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

// Every writer of the sidecar JSON. Reads (readLoopState/readQueueBranch) stay
// lock-free and tolerant by design — the contract covers writers.
const LOCKED_SIDECAR_WRITERS = [
  "writeLoopState",
  "bumpLoopBlock",
  "resetLoopState",
  "ensureQueueBranch",
  "clearQueueBranchIfDrained",
];

for (const name of LOCKED_SIDECAR_WRITERS) {
  test(`AUDIT: goals.mjs ${name} routes through withGoalsLock`, () => {
    assert.match(functionBody(GOALS_SRC, name), /withGoalsLock\(/, `${name} mutates sidecar state outside the lock`);
  });
}

for (const name of ["putLoopState", "ensureQueueBranch"]) {
  test(`AUDIT: goals.mjs ${name} writes atomically, never in place`, () => {
    const body = functionBody(GOALS_SRC, name);
    assert.doesNotMatch(body, /fs\.writeFileSync\(/, `${name} still writes the sidecar in place`);
    assert.match(body, /atomicWriteFileSync\(/, `${name} does not write through the atomic primitive`);
  });
}

test("AUDIT: the raw writer putLoopState is reachable ONLY from a locked body", () => {
  // putLoopState deliberately does NOT acquire (its callers already hold the
  // lock, and a second acquire would re-pay the fail-open budget on the Stop
  // hook's hot path). That makes it the one unguarded write in this file, so its
  // reachability is pinned: definition + exactly two call sites, both of which
  // are audited above as taking the lock.
  const calls = (GOALS_SRC.match(/putLoopState\(/g) || []).length;
  assert.equal(calls, 3, `putLoopState has ${calls - 1} call sites — expected exactly writeLoopState and bumpLoopBlock`);
  for (const name of ["writeLoopState", "bumpLoopBlock"]) {
    const body = functionBody(GOALS_SRC, name);
    assert.match(body, /putLoopState\(/, `${name} no longer writes through putLoopState`);
    assert.match(body, /withGoalsLock\(/, `${name} calls the raw writer without the lock`);
  }
});

test("AUDIT: bumpLoopBlock reads the counter INSIDE the lock, not before it", () => {
  const body = functionBody(GOALS_SRC, "bumpLoopBlock");
  const lockAt = body.indexOf("withGoalsLock(");
  const readAt = body.indexOf("readLoopState(");
  assert.ok(lockAt >= 0 && readAt >= 0, "expected both a lock and a read");
  assert.ok(readAt > lockAt, "read-then-lock is the bug; the read must sit inside the lock callback");
});

test("AUDIT: ensureQueueBranch reads the existing record INSIDE the lock", () => {
  const body = functionBody(GOALS_SRC, "ensureQueueBranch");
  const lockAt = body.indexOf("withGoalsLock(");
  const readAt = body.indexOf("readQueueBranch(");
  const writeAt = body.indexOf("atomicWriteFileSync(");
  assert.ok(lockAt >= 0, "ensureQueueBranch does not take the lock");
  assert.ok(readAt > lockAt, "the check must happen inside the lock, or the act is against a stale check");
  assert.ok(writeAt > readAt, "and the check must precede the mint");
});

test("AUDIT: the chat board is written by APPEND only — it never reads itself back", () => {
  // The defect was structural: any read of the whole board followed by a whole-
  // board write is a lost-update window, whatever guards it. So the audit is that
  // the write path does not read the board at all.
  for (const name of ["appendChatEntry", "appendChatBlock"]) {
    const body = functionBody(GOALS_SRC, name);
    assert.doesNotMatch(body, /readFileSync\(/, `${name} reads the board back — that is the read-modify-write again`);
  }
  assert.match(functionBody(GOALS_SRC, "appendChatBlock"), /fs\.appendFileSync\(/, "appendChatBlock does not append");
});

// ── done ─────────────────────────────────────────────────────────────────────

cleanupTemps();
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
