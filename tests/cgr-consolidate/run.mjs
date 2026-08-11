#!/usr/bin/env node
// Consolidation under concurrency (goal: digest-append-only, ADR 0030).
//
// consolidateGoals runs from bin/archkit-stop-hook.mjs — a SEPARATE PROCESS
// spawned at every turn-end, in EVERY open session. Before this suite it read
// the whole digest, deleted the source goal files, and wrote the digest back:
// a read-modify-write of a LOG, with the sources destroyed in the middle of it.
// Two sessions ending a turn together both drained done/ and the second write
// clobbered the first's entries — entries that could not be rebuilt, because the
// goal files they described were already gone.
//
// What this suite pins, in the order the goal states it:
//
//   1. APPEND-ONLY, not merely locked. The lock (ADR 0030) FAILS OPEN after
//      LOCK_WAIT_MS, so a lock alone cannot be the answer — test 3 holds the
//      lock from a third process to force every consolidation down the
//      fail-open path, and requires the invariant to hold anyway.
//   2. ARCHIVE-THEN-DELETE, made crash-safe. Test 5 traces the syscalls: the
//      raw content is fsynced and then RENAMED, so there is no instant at which
//      it exists nowhere, and no unsynced copy that a power loss can drop.
//   3. IDEMPOTENT. Tests 3 and 8: no duplicate markers, ever.
//   4. REAL CONCURRENCY. Tests 1-3 spawn real processes with a readiness
//      barrier, and test 1 is the NEGATIVE CONTROL — the pre-fix algorithm,
//      which MUST lose entries or this suite is not measuring anything.
//   5. FORMAT UNCHANGED. Tests 6-7: byte-identical output for a fresh digest,
//      and both read directions (old file / new file) still parse.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  consolidateGoals,
  listDigests,
  listTerminalGoals,
  goalsCompletedOn,
} from "../../src/lib/goals.mjs";

import {
  GOAL_COUNT,
  raceFixture,
  tempProject,
  cleanupTemps,
  childPath,
  spawnChild,
  runChild,
  runTogether,
  until,
  delay,
  readLog,
  digestText,
  digestSlugs,
  listMd,
  doneRoot,
  archiveRoot,
  digestRoot,
  recoverabilityViolations,
  slugFor,
} from "./fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

const CONSOLIDATE = childPath("child-consolidate.mjs");
const HOLD_LOCK = childPath("child-hold-lock.mjs");
const FSYNC_ORDER = childPath("child-fsync-order.mjs");

// The exact bytes the PRE-FIX consolidateGoals produced for a fresh digest.
// Kept here so criterion 5 ("existing digest format stays readable") can be a
// byte-for-byte assertion rather than a claim: the new append-only writer must
// emit this, character for character.
function oldFormatEntry(slug, i, day) {
  return [
    `<!-- cgr-digest-slug: ${slug} -->`,
    `## ${slug} — Race goal ${i}`,
    `- Outcome: completed`,
    `- Date: ${day}`,
    `- Notes: shipped race goal ${i}`,
    `- Raw: goals/done/archive/${slug}.md`,
  ].join("\n");
}

function oldFormatDigest(day, entries) {
  return (
    `# CGR digest — ${day}\n\n` +
    `Consolidated summary of CGR goals finished on ${day}. The raw goal files\n` +
    `are preserved verbatim under goals/done/archive/ for full-context recovery.\n\n` +
    entries.join("\n\n") + "\n"
  );
}

// Two intervals from real processes must actually intersect, or "concurrent"
// was wishful thinking and every downstream assertion is vacuous.
function assertOverlap(records, what) {
  assert.ok(records.length >= 2, `${what}: expected >= 2 child records, got ${records.length}`);
  for (const r of records) assert.equal(r.error, null, `${what}: child ${r.pid} errored: ${r.error}`);
  const start = Math.max(...records.map((r) => r.startedAt));
  const end = Math.min(...records.map((r) => r.endedAt));
  assert.ok(
    end >= start,
    `${what}: children did NOT overlap — windows ${records.map((r) => `${r.pid}:[${r.startedAt},${r.endedAt}]`).join(" ")}`,
  );
}

console.log("\n  consolidation race — negative control (the pre-fix algorithm)");

// ── 1. NEGATIVE CONTROL ──────────────────────────────────────────────────────
// If this ever stops losing entries the workload has gone soft, and tests 2/3
// prove nothing. It must fail loudly in that case, so it asserts the LOSS.
await test("CONTROL: pre-fix read-modify-write loses digest entries whose goal files are already gone", async () => {
  const fx = raceFixture("control");
  const logFile = path.join(fx.dir, "control.jsonl");

  await runTogether(fx.dir, [
    (readyDir, goFile) => runChild(CONSOLIDATE,
      ["naive", "forward", "barrier", fx.archDir, fx.day, logFile, readyDir, goFile], fx.dir),
    (readyDir, goFile) => runChild(CONSOLIDATE,
      ["naive", "reverse", `claimed:${GOAL_COUNT - 1}`, fx.archDir, fx.day, logFile, readyDir, goFile], fx.dir),
  ]);

  const records = readLog(logFile);
  assertOverlap(records, "control");

  const inDigest = new Set(digestSlugs(fx.archDir, fx.day));
  const archived = new Set(listMd(archiveRoot(fx.archDir)).map((n) => n.replace(/\.md$/, "")));
  const atRoot = new Set(listMd(doneRoot(fx.archDir)).map((n) => n.replace(/\.md$/, "")));

  // The signature of the bug: the goal is gone from done/ (consolidated), yet
  // the digest — the only rendered record of it — never mentions it.
  const lost = fx.slugs.filter((s) => !inDigest.has(s) && !atRoot.has(s));
  assert.ok(
    lost.length > 0,
    `CONTROL DID NOT REPRODUCE THE BUG — every one of ${fx.slugs.length} slugs survived the clobber. ` +
    `This suite cannot detect the defect it exists to detect. digest=${inDigest.size} archived=${archived.size} ` +
    `records=${JSON.stringify(records.map((r) => ({ pid: r.pid, n: r.consolidated })))}`,
  );
  for (const s of lost) {
    assert.ok(archived.has(s), `control: ${s} vanished from BOTH done/ and archive/ — unexpected control state`);
  }
  console.log(`      control lost ${lost.length}/${fx.slugs.length} digest entries (e.g. ${lost.slice(0, 3).join(", ")})`);
});

console.log("\n  consolidation race — the shipped implementation");

// ── 2. real code, same staggered-overlap harness ─────────────────────────────
await test("concurrent consolidations lose no entry, duplicate no entry, and lose no goal file", async () => {
  const fx = raceFixture("real");
  const logFile = path.join(fx.dir, "real.jsonl");

  await runTogether(fx.dir, [
    (readyDir, goFile) => runChild(CONSOLIDATE,
      ["real", "forward", "barrier", fx.archDir, fx.day, logFile, readyDir, goFile], fx.dir),
    (readyDir, goFile) => runChild(CONSOLIDATE,
      ["real", "reverse", `claimed:${GOAL_COUNT - 1}`, fx.archDir, fx.day, logFile, readyDir, goFile], fx.dir),
  ]);

  const records = readLog(logFile);
  assertOverlap(records, "real");

  const seen = digestSlugs(fx.archDir, fx.day);
  assert.deepEqual([...seen].sort(), [...fx.slugs].sort(), "every completed goal must have a digest entry");
  assert.equal(seen.length, new Set(seen).size, `duplicate digest entries: ${seen.join(", ")}`);
  assert.deepEqual(listMd(doneRoot(fx.archDir)), [], "done/ root must be fully drained");
  assert.deepEqual(recoverabilityViolations(fx), [], "every raw goal file must survive verbatim");

  // Exactly-once at the CLAIM level too: no goal was consolidated by both.
  const claimed = records.flatMap((r) => r.slugs);
  assert.equal(claimed.length, new Set(claimed).size, `a goal was claimed twice: ${claimed.join(", ")}`);
  assert.deepEqual([...claimed].sort(), [...fx.slugs].sort(), "claims must partition the queue exactly");
});

// ── 3. THE criterion-1 test: append-only WITHOUT the lock ────────────────────
// withGoalsLock fails open after LOCK_WAIT_MS, so a lock alone cannot satisfy
// "a concurrent consolidation cannot clobber another's entries". A third process
// pins the lock for the whole run; every consolidation here is UNLOCKED and says
// so on stderr. The invariant must hold on structure alone.
await test("append-only survives with the lock FAILING OPEN (3 unlocked concurrent consolidations)", async () => {
  const fx = raceFixture("failopen");
  const logFile = path.join(fx.dir, "failopen.jsonl");
  const lockReady = path.join(fx.dir, "lock-ready.json");
  const lockRelease = path.join(fx.dir, "lock-release");

  const holder = spawnChild(HOLD_LOCK, [fx.archDir, lockReady, lockRelease], fx.dir);
  await until(() => fs.existsSync(lockReady), { what: "the lock holder to take the lock" });
  const held = JSON.parse(fs.readFileSync(lockReady, "utf8"));
  assert.equal(held.held, true, "the holder must actually hold the lock for this test to mean anything");

  let results;
  try {
    // Simultaneous release: all three block in acquireLock for the same
    // LOCK_WAIT_MS window and come out of it within milliseconds of each other,
    // which is a tighter overlap than any stagger could arrange.
    results = await runTogether(fx.dir, [0, 1, 2].map(() =>
      (readyDir, goFile) => runChild(CONSOLIDATE,
        ["real", "forward", "barrier", fx.archDir, fx.day, logFile, readyDir, goFile], fx.dir)));
  } finally {
    fs.writeFileSync(lockRelease, "release");
    await holder.done;
  }

  const failedOpen = results.filter((r) => /proceeded WITHOUT the \.arch lock/.test(r.stderr));
  assert.equal(failedOpen.length, results.length,
    `all ${results.length} children must have run UNLOCKED; only ${failedOpen.length} reported fail-open. ` +
    `stderr: ${results.map((r) => JSON.stringify(r.stderr.slice(0, 160))).join(" | ")}`);

  const records = readLog(logFile);
  assertOverlap(records, "fail-open");

  const seen = digestSlugs(fx.archDir, fx.day);
  assert.deepEqual([...seen].sort(), [...fx.slugs].sort(), "unlocked: every goal must still have a digest entry");
  assert.equal(seen.length, new Set(seen).size, `unlocked: duplicate digest entries: ${seen.join(", ")}`);
  assert.deepEqual(listMd(doneRoot(fx.archDir)), [], "unlocked: done/ root must be fully drained");
  assert.deepEqual(recoverabilityViolations(fx), [], "unlocked: every raw goal file must survive verbatim");

  // Exactly one header, despite three racing writers creating the file.
  const headers = digestText(fx.archDir, fx.day).match(/^# CGR digest — /gm) || [];
  assert.equal(headers.length, 1, `digest header written ${headers.length} times`);

  const claimed = records.flatMap((r) => r.slugs);
  assert.equal(claimed.length, new Set(claimed).size, `unlocked: a goal was claimed twice: ${claimed.join(", ")}`);
});

console.log("\n  crash safety — archive before delete, durably");

// ── 4. SIGKILL storm ─────────────────────────────────────────────────────────
await test("a crash mid-consolidation always leaves every goal recoverable, verbatim", async () => {
  const ROUNDS = 10;
  const COUNT = 24;
  let caughtMidPass = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const fx = raceFixture(`crash-${round}`, { count: COUNT, bodyKb: 128 });
    const logFile = path.join(fx.dir, "crash.jsonl");
    const readyDir = path.join(fx.dir, "ready");
    fs.mkdirSync(readyDir, { recursive: true });
    const goFile = path.join(fx.dir, "go");

    const child = spawnChild(CONSOLIDATE,
      ["real", "forward", "barrier", fx.archDir, fx.day, logFile, readyDir, goFile], fx.dir);
    await until(() => fs.readdirSync(readyDir).length === 1, { what: "the crash child to reach the barrier" });

    // Kill on OBSERVED progress, not on a sleep: a timed kill spent most of its
    // rounds landing after the pass had already finished, which made the storm
    // vacuous. Watch the archive fill and pull the trigger the instant it
    // crosses this round's target, sweeping the target across the pass.
    const target = 1 + (round % (COUNT - 1));
    let alive = true;
    child.done.then(() => { alive = false; });
    fs.writeFileSync(goFile, "go");
    await until(() => !alive || listMd(archiveRoot(fx.archDir)).length >= target, {
      pollMs: 0, what: `${target} archived files before the kill`,
    });
    child.kill("SIGKILL");
    await child.done;

    const atRoot = listMd(doneRoot(fx.archDir)).length;
    const inArchive = listMd(archiveRoot(fx.archDir)).length;
    if (atRoot > 0 && inArchive > 0) caughtMidPass++;

    assert.deepEqual(
      recoverabilityViolations(fx), [],
      `round ${round}: SIGKILL after ${target} archived left a goal unrecoverable (done/=${atRoot} archive/=${inArchive})`,
    );
    // No half-written archive copies, in either direction.
    for (const name of listMd(archiveRoot(fx.archDir))) {
      const slug = name.replace(/\.md$/, "");
      assert.equal(
        fs.readFileSync(path.join(archiveRoot(fx.archDir), name), "utf8"),
        fx.originals.get(slug),
        `round ${round}: archive/${name} is not byte-identical to the original — a torn copy`,
      );
    }
  }
  assert.ok(caughtMidPass > 0,
    `the SIGKILL storm never landed mid-pass in ${ROUNDS} rounds — it proves nothing about the window`);
  console.log(`      ${caughtMidPass}/${ROUNDS} kills landed mid-pass`);
});

// ── 5. the durability ORDER, traced at the syscall level ─────────────────────
await test("the raw copy is made durable BEFORE the source is removed (syscall trace)", async () => {
  const fx = raceFixture("trace", { count: 1, bodyKb: 8 });
  const slug = slugFor(0);
  const tracePath = path.join(fx.dir, "trace.json");
  const r = await runChild(FSYNC_ORDER, [fx.archDir, fx.day, tracePath], fx.dir);
  assert.equal(r.code, 0, `trace child failed: ${r.stderr}`);

  const { trace, error } = JSON.parse(fs.readFileSync(tracePath, "utf8"));
  assert.equal(error, null, `consolidation threw under instrumentation: ${error}`);
  const at = (re) => trace.findIndex((l) => re.test(l));
  const show = `\n      trace:\n        ${trace.join("\n        ")}`;

  const iRename = at(new RegExp(`^rename goals/done/${slug}\\.md -> goals/done/archive/${slug}\\.md$`));
  assert.ok(iRename >= 0, `the source must be moved by an atomic rename${show}`);

  // The source is removed BY the rename. A separate unlink/rm of it would mean
  // there was an instant where the content lived at neither path.
  assert.equal(at(new RegExp(`^(unlink|rm) goals/done/${slug}\\.md$`)), -1,
    `the source goal file must never be removed as a separate step${show}`);
  assert.equal(at(new RegExp(`^writeFile goals/done/archive/${slug}\\.md$`)), -1,
    `the archive copy must not be a plain (non-atomic, unsynced) writeFileSync${show}`);

  const iContentFsync = at(new RegExp(`^fsync goals/done/${slug}\\.md$`));
  assert.ok(iContentFsync >= 0 && iContentFsync < iRename,
    `the raw content must be fsynced BEFORE the rename (fsync@${iContentFsync}, rename@${iRename})${show}`);

  const iDoneDirFsync = trace.findIndex((l, i) => i > iRename && l === "fsync goals/done");
  const iArchiveDirFsync = trace.findIndex((l, i) => i > iRename && l === "fsync goals/done/archive");
  assert.ok(iDoneDirFsync > iRename, `the source directory entry must be fsynced after the rename${show}`);
  assert.ok(iArchiveDirFsync > iRename, `the archive directory entry must be fsynced after the rename${show}`);

  const iDigestAppend = at(/^open goals\/done\/digest\/.*\.md flags=a$/);
  assert.ok(iDigestAppend > iRename, `the digest entry must be appended (O_APPEND) after the archive is durable${show}`);
});

console.log("\n  digest format — unchanged, and readable in both directions");

// ── 6. byte-for-byte format identity with the pre-fix writer ─────────────────
await test("a digest written by the new append-only writer is byte-identical to the old format", () => {
  const fx = raceFixture("format", { count: 3, bodyKb: 4 });
  consolidateGoals(fx.archDir, { date: fx.day });
  const got = digestText(fx.archDir, fx.day);
  const want = oldFormatDigest(fx.day, [0, 1, 2].map((i) => oldFormatEntry(slugFor(i), i, fx.day)));
  assert.equal(got, want, "append-only output diverged from the pre-fix digest format");
});

// ── 7. both read directions ──────────────────────────────────────────────────
await test("listDigests + goalsCompletedOn + `archkit goal list --json` read the new digest", () => {
  const fx = raceFixture("read-new", { count: 3, bodyKb: 4 });
  consolidateGoals(fx.archDir, { date: fx.day });

  const digests = listDigests(fx.archDir);
  assert.equal(digests.length, 1);
  assert.equal(digests[0].date, fx.day);
  assert.equal(digests[0].count, 3);
  assert.deepEqual([...digests[0].slugs].sort(), [...fx.slugs].sort());
  assert.ok(digests[0].summary.includes("Race goal 0"), `summary lost the titles: ${digests[0].summary}`);

  const completed = goalsCompletedOn(fx.archDir, fx.day).map((g) => g.slug).sort();
  assert.deepEqual(completed, [...fx.slugs].sort(), "goalsCompletedOn must read the appended entries");

  const list = JSON.parse(execFileSync("node", [ARCHKIT, "goal", "list", "--json"],
    { cwd: fx.dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  assert.ok(Array.isArray(list.digests) && list.digests.length === 1, "archkit goal list must surface the digest");
  assert.equal(list.digests[0].count, 3);
  assert.equal(list.archived, 3);
});

await test("a digest written in the OLD format still parses, and appending to it keeps both halves", () => {
  const fx = raceFixture("read-old", { count: 4, bodyKb: 4 });
  // Stage the world as a pre-fix archkit left it: slugs 0-1 already consolidated
  // into an old-format digest with their raws in archive/, slugs 2-3 still at
  // done/ root awaiting consolidation.
  fs.mkdirSync(archiveRoot(fx.archDir), { recursive: true });
  fs.mkdirSync(digestRoot(fx.archDir), { recursive: true });
  for (const i of [0, 1]) {
    const slug = slugFor(i);
    fs.renameSync(path.join(doneRoot(fx.archDir), `${slug}.md`), path.join(archiveRoot(fx.archDir), `${slug}.md`));
  }
  const legacy = oldFormatDigest(fx.day, [0, 1].map((i) => oldFormatEntry(slugFor(i), i, fx.day)));
  fs.writeFileSync(path.join(digestRoot(fx.archDir), `${fx.day}.md`), legacy);

  // Direction 1: the old file is readable as-is.
  assert.deepEqual([...listDigests(fx.archDir)[0].slugs].sort(), [slugFor(0), slugFor(1)]);

  // Direction 2: appending to it neither rewrites nor breaks it.
  consolidateGoals(fx.archDir, { date: fx.day });
  const after = digestText(fx.archDir, fx.day);
  assert.ok(after.startsWith(legacy.trimEnd()), "the pre-existing digest bytes must be left untouched");
  assert.equal(
    after,
    oldFormatDigest(fx.day, [0, 1, 2, 3].map((i) => oldFormatEntry(slugFor(i), i, fx.day))),
    "an old digest extended by the new writer must equal what the old writer would have produced",
  );
  const d = listDigests(fx.archDir)[0];
  assert.equal(d.count, 4);
  assert.deepEqual([...d.slugs].sort(), [...fx.slugs].sort());
});

console.log("\n  idempotency");

await test("re-running consolidation is a byte-for-byte no-op, and a re-filed slug is not duplicated", () => {
  const fx = raceFixture("idem", { count: 2, bodyKb: 4 });
  consolidateGoals(fx.archDir, { date: fx.day });
  const first = digestText(fx.archDir, fx.day);

  const again = consolidateGoals(fx.archDir, { date: fx.day });
  assert.equal(again.consolidated, 0, "nothing left to consolidate");
  assert.equal(digestText(fx.archDir, fx.day), first, "a no-op run must not touch a byte of the digest");

  // A slug that is already in the digest reappears at done/ root (a re-filed or
  // reconciled goal). It must be archived, but must NOT get a second entry —
  // this is the already-consolidated check the goal requires to still hold.
  const slug = slugFor(0);
  fs.writeFileSync(path.join(doneRoot(fx.archDir), `${slug}.md`), fx.originals.get(slug));
  assert.equal(listTerminalGoals(fx.archDir).length, 1);
  consolidateGoals(fx.archDir, { date: fx.day });

  const seen = digestSlugs(fx.archDir, fx.day);
  assert.equal(seen.filter((s) => s === slug).length, 1, `duplicate entry for the re-filed slug: ${seen.join(", ")}`);
  assert.deepEqual(listMd(doneRoot(fx.archDir)), [], "the re-filed goal must still be drained");
});

cleanupTemps();

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
