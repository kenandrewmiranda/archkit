#!/usr/bin/env node
// fslock — the shared-state write primitive (ADR 0030).
//
// The ADR names four properties that have to be TESTABLE rather than argued at
// each call site, and this suite is where they get proved:
//
//   1. mutual exclusion across REAL concurrent processes,
//   2. stale-lock breaking (on a TTL, and REPORTED),
//   3. release-on-throw,
//   4. a torn write is never observable by a concurrent reader.
//
// (1) and (4) spawn actual child processes with an explicit cwd — a same-
// process simulation would prove nothing about an O_EXCL create or a rename,
// which is precisely where the guarantees live.
//
// Determinism over sleeps: every cross-process rendezvous here is a file
// barrier plus a bounded poll, never "sleep 50ms and hope". A loaded machine
// makes the timings slower, not the assertions wronger.
//
// Every artifact lives in an mkdtemp'd directory that is removed afterwards;
// nothing here touches a live .arch/.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  atomicWriteFileSync,
  atomicWriteJsonSync,
  acquireLock,
  withLock,
  withArchLock,
  archLockPath,
  readLockHolder,
  lockDepth,
  LOCK_TTL_MS,
  LOCK_FILENAME,
} from "../../src/lib/fslock.mjs";
import { PAYLOAD_SIZE, variantBuffer, classify } from "./payload.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHILD_MUTEX = path.join(__dirname, "child-mutex.mjs");
const CHILD_STRAND = path.join(__dirname, "child-strand.mjs");
const CHILD_WRITER = path.join(__dirname, "child-writer.mjs");
const CHILD_READER = path.join(__dirname, "child-reader.mjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

async function atest(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

// ── sandbox + child plumbing ─────────────────────────────────────────────────

const temps = [];
function tempDir(tag) {
  // realpathSync: macOS's tmpdir is a symlink, and the lock path a child
  // resolves must be the same string this process resolves.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `archkit-fslock-${tag}-`));
  temps.push(dir);
  return dir;
}
function cleanupTemps() {
  for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// Never spawn without an explicit cwd: a child that inherits the runner's would
// be pointed at the repo mirror, and archkit's own suites have been bitten by
// exactly that (see tests/stop-hook/run.mjs).
function runChild(script, args, cwd) {
  if (!cwd) throw new Error("runChild requires an explicit cwd");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Bounded poll instead of a fixed sleep — slower machine, same verdict.
async function until(predicate, { timeoutMs = 30_000, pollMs = 5, what = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await delay(pollMs);
  }
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

console.log("\nfslock — atomic write + advisory lock (ADR 0030)\n");

// ═══════════════════════════════════════════════════════════════════════════
console.log("atomic write");
// ═══════════════════════════════════════════════════════════════════════════

test("writes a file and leaves no temp behind", () => {
  const dir = tempDir("atomic");
  const file = path.join(dir, "note.txt");
  assert.equal(atomicWriteFileSync(file, "hello"), file);
  assert.equal(fs.readFileSync(file, "utf8"), "hello");
  assert.deepEqual(fs.readdirSync(dir), ["note.txt"], "no .tmp sibling may survive a successful write");
});

test("creates the containing directory", () => {
  const dir = tempDir("atomic-mkdir");
  const file = path.join(dir, "a", "b", "deep.json");
  atomicWriteJsonSync(file, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ok: true });
});

test("replaces existing content wholesale (no residue from the longer old file)", () => {
  const dir = tempDir("atomic-replace");
  const file = path.join(dir, "x.txt");
  atomicWriteFileSync(file, "a".repeat(5000));
  atomicWriteFileSync(file, "short");
  assert.equal(fs.readFileSync(file, "utf8"), "short");
});

test("accepts Buffer data unchanged", () => {
  const dir = tempDir("atomic-buf");
  const file = path.join(dir, "x.bin");
  const buf = Buffer.from([0, 1, 2, 253, 254, 255]);
  atomicWriteFileSync(file, buf);
  assert.deepEqual(fs.readFileSync(file), buf);
});

test("a failed write throws atomic_write_failed and never falls back in place", () => {
  const dir = tempDir("atomic-fail");
  const file = path.join(dir, "missing-dir", "x.txt");
  assert.throws(
    () => atomicWriteFileSync(file, "data", { mkdir: false }),
    (err) => err.code === "atomic_write_failed"
  );
  assert.equal(fs.existsSync(path.dirname(file)), false, "must not have created anything");
  assert.deepEqual(fs.readdirSync(dir), [], "the staged temp must be cleaned up on failure");
});

test("the torn-read classifier actually fires on a truncated file (test power)", () => {
  // The concurrency test below asserts `torn === 0`. That assertion is only
  // worth anything if the classifier can recognise a torn file at all, so prove
  // it here deterministically rather than trusting the OS to lose a race.
  const dir = tempDir("classify");
  const whole = variantBuffer("A");
  assert.deepEqual(classify(whole), { ok: true, variant: "A" });
  assert.equal(classify(whole.subarray(0, PAYLOAD_SIZE - 1)).ok, false, "short file must read as torn");
  const seam = Buffer.concat([variantBuffer("A").subarray(0, 1024), variantBuffer("B").subarray(1024)]);
  assert.equal(classify(seam).ok, false, "half-A/half-B file must read as torn");
  assert.equal(fs.existsSync(dir), true);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nlock — acquisition, identity, scope");
// ═══════════════════════════════════════════════════════════════════════════

test("archLockPath scopes the lock to the resolved archDir's gitignored board dir", () => {
  const archDir = path.join("/some", "project", ".arch");
  assert.equal(archLockPath(archDir), path.join(archDir, "board", LOCK_FILENAME));
});

test("acquire creates a lockfile carrying pid + timestamp; release removes it", () => {
  const dir = tempDir("acquire");
  const lockPath = path.join(dir, "board", "goals.lock");
  const handle = acquireLock(lockPath, { meta: { op: "unit" } });
  assert.equal(handle.held, true);
  assert.equal(handle.failedOpen, false);
  assert.equal(handle.brokeStale, null);

  const holder = readLockHolder(lockPath);
  assert.equal(holder.pid, process.pid, "lockfile must identify its holder by pid");
  assert.ok(Number.isFinite(holder.acquiredAtMs), "lockfile must carry an acquisition timestamp");
  assert.ok(holder.ageMs < LOCK_TTL_MS);
  assert.deepEqual(holder.meta, { op: "unit" });

  assert.deepEqual(handle.release(), { released: true, reason: null });
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(readLockHolder(lockPath), null);
});

test("release is idempotent", () => {
  const dir = tempDir("release-twice");
  const lockPath = path.join(dir, "goals.lock");
  const handle = acquireLock(lockPath);
  handle.release();
  assert.deepEqual(handle.release(), { released: false, reason: "already-released" });
});

test("withLock returns the callback's value and reports it held the lock", () => {
  const dir = tempDir("withlock");
  const lockPath = path.join(dir, "goals.lock");
  const res = withLock(lockPath, () => 42);
  assert.equal(res.value, 42);
  assert.equal(res.held, true);
  assert.equal(res.failedOpen, false);
  assert.equal(res.released.released, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test("withArchLock locks the archDir's canonical lock path", () => {
  const dir = tempDir("archlock");
  const archDir = path.join(dir, ".arch");
  let sawLock = null;
  withArchLock(archDir, (handle) => { sawLock = handle.lockPath; assert.equal(handle.held, true); });
  assert.equal(sawLock, path.resolve(archLockPath(archDir)));
});

test("withLock refuses an async callback rather than releasing early", () => {
  const dir = tempDir("async-refused");
  const lockPath = path.join(dir, "goals.lock");
  assert.throws(
    () => withLock(lockPath, async () => "nope"),
    (err) => err.code === "invalid_input" && /synchronous/.test(err.message)
  );
  assert.equal(fs.existsSync(lockPath), false, "the refusal must still release");
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nlock — reentrancy (same process) and release-on-throw");
// ═══════════════════════════════════════════════════════════════════════════

test("nested acquire in the same process re-enters instead of deadlocking", () => {
  const dir = tempDir("reentrant");
  const lockPath = path.join(dir, "goals.lock");
  const outer = withLock(lockPath, () => {
    assert.deepEqual(lockDepth(lockPath), { held: true, depth: 1 });
    const inner = withLock(lockPath, () => {
      assert.deepEqual(lockDepth(lockPath), { held: true, depth: 2 }, "nested acquire must count depth");
      return "inner";
    }, { waitMs: 0 });
    assert.equal(inner.held, true);
    assert.equal(inner.reentrant, true, "the nested acquire must report itself as re-entry");
    assert.equal(inner.failedOpen, false);
    assert.equal(fs.existsSync(lockPath), true, "the inner release must NOT drop the lockfile");
    assert.deepEqual(lockDepth(lockPath), { held: true, depth: 1 });
    return inner.value;
  });
  assert.equal(outer.value, "inner");
  assert.equal(fs.existsSync(lockPath), false, "the outermost release drops the lockfile");
  assert.deepEqual(lockDepth(lockPath), { held: false, depth: 0 });
});

test("a throw inside the mutation releases the lock and propagates unchanged", () => {
  const dir = tempDir("throw");
  const lockPath = path.join(dir, "goals.lock");
  assert.throws(
    () => withLock(lockPath, () => { throw new Error("mutation blew up"); }),
    /mutation blew up/
  );
  assert.equal(fs.existsSync(lockPath), false, "a failed mutation must not strand the lock");
  assert.deepEqual(lockDepth(lockPath), { held: false, depth: 0 });

  // And the lock is immediately usable again — WITHOUT anyone having to break a
  // stale lock, which is the whole difference between release-on-throw and
  // relying on the TTL.
  const next = withLock(lockPath, () => "ok", { waitMs: 0 });
  assert.equal(next.held, true);
  assert.equal(next.brokeStale, null);
});

test("a throw inside a NESTED mutation still unwinds to a fully released lock", () => {
  const dir = tempDir("throw-nested");
  const lockPath = path.join(dir, "goals.lock");
  const res = withLock(lockPath, () => {
    try {
      withLock(lockPath, () => { throw new Error("inner blew up"); }, { waitMs: 0 });
      return "no throw";
    } catch (err) {
      assert.match(err.message, /inner blew up/);
      // The outer level still holds it: an inner failure must not evict its caller.
      assert.deepEqual(lockDepth(lockPath), { held: true, depth: 1 });
      assert.equal(fs.existsSync(lockPath), true);
      return "caught";
    }
  });
  assert.equal(res.value, "caught");
  assert.equal(fs.existsSync(lockPath), false);
  assert.deepEqual(lockDepth(lockPath), { held: false, depth: 0 });
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nlock — stale breaking and fail-open");
// ═══════════════════════════════════════════════════════════════════════════

test("a lock older than the TTL is broken, and the break is REPORTED", () => {
  const dir = tempDir("stale");
  const lockPath = path.join(dir, "goals.lock");
  const acquiredAtMs = Date.now() - 90_000;
  fs.writeFileSync(lockPath, `${JSON.stringify({
    pid: 999_999, host: "ghost", token: "deadbeef", acquiredAtMs,
    acquiredAt: new Date(acquiredAtMs).toISOString(), meta: null,
  })}\n`);

  const events = [];
  const handle = acquireLock(lockPath, { ttlMs: 1_000, waitMs: 250, onEvent: (e) => events.push(e) });
  assert.equal(handle.held, true, "a corpse must not deadlock a new holder");
  assert.ok(handle.brokeStale, "breaking a stale lock must be reported, never silent");
  assert.equal(handle.brokeStale.pid, 999_999);
  assert.equal(handle.brokeStale.host, "ghost");
  assert.ok(handle.brokeStale.ageMs >= 90_000);
  assert.equal(handle.brokeStale.ttlMs, 1_000);
  assert.equal(events.filter((e) => e.type === "stale-broken").length, 1, "onEvent must see the break too");

  assert.equal(readLockHolder(lockPath).pid, process.pid, "the breaker takes the lock");
  handle.release();
});

test("an UNPARSEABLE lockfile is dated by mtime, so it can still go stale", () => {
  const dir = tempDir("stale-corrupt");
  const lockPath = path.join(dir, "goals.lock");
  fs.writeFileSync(lockPath, ""); // e.g. created with 'wx' by a process that then died
  const old = new Date(Date.now() - 90_000);
  fs.utimesSync(lockPath, old, old);

  const holder = readLockHolder(lockPath);
  assert.equal(holder.parsed, false);
  assert.ok(holder.ageMs >= 80_000, "mtime must stand in for a missing timestamp");

  const handle = acquireLock(lockPath, { ttlMs: 1_000, waitMs: 250 });
  assert.equal(handle.held, true, "a corrupt lockfile must not become immortal");
  assert.equal(handle.brokeStale.parsed, false);
  handle.release();
});

// A FOREIGN holder: a lockfile written by hand with someone else's pid. It has
// to be foreign — a second acquire from THIS process would legitimately
// re-enter (see the reentrancy section), which is the opposite of contention.
function plantForeignLock(lockPath, { pid = 999_999, ageMs = 0 } = {}) {
  const acquiredAtMs = Date.now() - ageMs;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({
    pid, host: "elsewhere", token: "foreign", acquiredAtMs,
    acquiredAt: new Date(acquiredAtMs).toISOString(), meta: { op: "someone else's mutation" },
  })}\n`);
  return pid;
}

test("a FRESH lock is never broken — the waiter fails open and names the holder", () => {
  const dir = tempDir("failopen");
  const lockPath = path.join(dir, "goals.lock");
  const foreignPid = plantForeignLock(lockPath);
  const startedAt = Date.now();
  const events = [];
  const second = acquireLock(lockPath, { waitMs: 120, pollMs: 5, onEvent: (e) => events.push(e) });
  const elapsed = Date.now() - startedAt;

  assert.equal(second.held, false, "a live holder must not be evicted");
  assert.equal(second.failedOpen, true, "contention degrades to running unlocked (ADR 0030 §7)");
  assert.equal(second.brokeStale, null);
  assert.equal(second.holder.pid, foreignPid, "fail-open must name who is holding it");
  assert.ok(elapsed >= 120, `must have actually waited its budget, took ${elapsed}ms`);
  assert.ok(elapsed < 10_000, `must return within its budget, took ${elapsed}ms`);
  assert.equal(events.filter((e) => e.type === "fail-open").length, 1);

  // Failing open must not damage the real holder's lock.
  assert.deepEqual(second.release(), { released: false, reason: "not-held" });
  assert.equal(readLockHolder(lockPath).pid, foreignPid);
  assert.equal(fs.existsSync(lockPath), true);
});

test("withLock RUNS the mutation even when it fails open, and says it did", () => {
  const dir = tempDir("failopen-runs");
  const lockPath = path.join(dir, "goals.lock");
  const foreignPid = plantForeignLock(lockPath);
  let ran = false;
  const res = withLock(lockPath, (handle) => {
    ran = true;
    assert.equal(handle.held, false);
    assert.equal(handle.failedOpen, true);
    return "did the work anyway";
  }, { waitMs: 60, pollMs: 5 });
  assert.equal(ran, true, "fail-open must not skip the caller's work");
  assert.equal(res.value, "did the work anyway");
  assert.equal(res.held, false);
  assert.equal(res.failedOpen, true);
  assert.equal(fs.existsSync(lockPath), true, "the real holder keeps its lock");
  assert.equal(readLockHolder(lockPath).pid, foreignPid, "fail-open must not evict the holder on release");
});

await atest("a lock stranded by a DEAD process is broken on the TTL", async () => {
  const dir = tempDir("stale-proc");
  const lockPath = path.join(dir, "goals.lock");
  const child = await runChild(CHILD_STRAND, [lockPath], dir);
  assert.equal(child.code, 0, `strand child failed: ${child.stderr}`);
  const strandedPid = JSON.parse(child.stdout).pid;
  assert.equal(fs.existsSync(lockPath), true, "the dead process really did leave a lockfile");
  assert.equal(readLockHolder(lockPath).pid, strandedPid);

  // Before the TTL: still respected, so we fail open rather than steal it.
  const early = acquireLock(lockPath, { ttlMs: 60_000, waitMs: 50, pollMs: 5 });
  assert.equal(early.held, false);
  assert.equal(early.failedOpen, true);
  assert.equal(early.holder.pid, strandedPid);

  // Age it past a short TTL rather than sleeping for one.
  const old = new Date(Date.now() - 120_000);
  const payload = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  payload.acquiredAtMs = old.getTime();
  payload.acquiredAt = old.toISOString();
  fs.writeFileSync(lockPath, `${JSON.stringify(payload)}\n`);

  const late = acquireLock(lockPath, { ttlMs: 1_000, waitMs: 500, pollMs: 5 });
  assert.equal(late.held, true, "a dead holder's lock must be reclaimable");
  assert.equal(late.brokeStale.pid, strandedPid, "the break must name the corpse");
  late.release();
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nmutual exclusion — REAL concurrent processes");
// ═══════════════════════════════════════════════════════════════════════════

const CONTENDERS = 8;
const HOLD_MS = 25;

async function runContenders(mode) {
  const dir = tempDir(`mutex-${mode}`);
  const lockPath = path.join(dir, "board", "goals.lock");
  const counterFile = path.join(dir, "counter.txt");
  const logFile = path.join(dir, "log.ndjson");
  const readyDir = path.join(dir, "ready");
  const goFile = path.join(dir, "go");
  fs.mkdirSync(readyDir, { recursive: true });
  fs.writeFileSync(counterFile, "0");
  fs.writeFileSync(logFile, "");

  const args = [mode, lockPath, counterFile, logFile, readyDir, goFile, String(HOLD_MS), "30000", "120000"];
  const children = Array.from({ length: CONTENDERS }, () => runChild(CHILD_MUTEX, args, dir));

  // Release the barrier only once every process is up, so "concurrent" is a
  // fact rather than a hope.
  await until(() => fs.readdirSync(readyDir).length === CONTENDERS, {
    timeoutMs: 60_000, what: `${CONTENDERS} contenders to announce`,
  });
  fs.writeFileSync(goFile, "go");

  const results = await Promise.all(children);
  for (const r of results) assert.equal(r.code, 0, `contender failed (${r.stderr})`);
  return { dir, lockPath, counter: Number(fs.readFileSync(counterFile, "utf8")), records: readLines(logFile) };
}

await atest(`${CONTENDERS} concurrent processes under the lock lose no updates`, async () => {
  const { counter, records, lockPath } = await runContenders("lock");
  assert.equal(records.length, CONTENDERS, "every contender must have recorded a result");
  for (const r of records) {
    assert.equal(r.held, true, `pid ${r.pid} failed open — the wait budget was not the constraint`);
    assert.equal(r.failedOpen, false);
    assert.equal(r.brokeStale, null, "no lock should have looked stale in a ~200ms run");
    assert.equal(r.released, true, "every contender must have released");
  }
  assert.equal(counter, CONTENDERS, `read-modify-write lost updates: counter ${counter} != ${CONTENDERS}`);

  // Each contender must have observed a DIFFERENT value: with N serialized
  // increments the reads are exactly 0..N-1.
  assert.deepEqual(
    records.map((r) => r.read).sort((a, b) => a - b),
    Array.from({ length: CONTENDERS }, (_, i) => i),
    "two contenders read the same value — they overlapped"
  );

  // Direct proof of exclusion: no two critical sections overlapped in time.
  const windows = records.map((r) => ({ pid: r.pid, start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
  for (let i = 1; i < windows.length; i++) {
    assert.ok(
      windows[i].start >= windows[i - 1].end,
      `hold windows overlapped: pid ${windows[i - 1].pid} [${windows[i - 1].start},${windows[i - 1].end}] ` +
      `vs pid ${windows[i].pid} [${windows[i].start},${windows[i].end}]`
    );
  }
  assert.equal(fs.existsSync(lockPath), false, "the lockfile must not survive the run");
});

await atest("the same contenders WITHOUT the lock do lose updates (control)", async () => {
  // The counter test above only means something if this workload can actually
  // lose updates. The barrier makes that deterministic: all N processes read
  // before any of them writes.
  const { counter } = await runContenders("nolock");
  assert.ok(
    counter < CONTENDERS,
    `unlocked run reached ${counter}/${CONTENDERS} — the contenders never overlapped, so the locked ` +
    "assertion proves nothing"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\ntorn writes — a concurrent reader never sees a partial file");
// ═══════════════════════════════════════════════════════════════════════════

await atest("a reader process never observes a partial atomic write", async () => {
  const dir = tempDir("torn");
  const target = path.join(dir, "target.bin");
  const readyFile = path.join(dir, "reader-ready");
  const doneFile = path.join(dir, "writer-done");
  const resultFile = path.join(dir, "reader-result.json");

  // Pre-seed with a whole payload: an atomic replace has no window in which the
  // destination is absent, so the reader may treat ENOENT as an anomaly.
  atomicWriteFileSync(target, variantBuffer("A"));

  const reader = runChild(CHILD_READER, [target, readyFile, doneFile, resultFile], dir);
  const writer = runChild(CHILD_WRITER, [target, "300", readyFile, doneFile], dir);
  const [rr, wr] = await Promise.all([reader, writer]);
  assert.equal(wr.code, 0, `writer failed: ${wr.stderr}`);
  assert.equal(rr.code, 0, `reader failed: ${rr.stderr}`);

  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.ok(!result.timedOut, "reader timed out waiting for the writer");
  assert.ok(result.reads > 0, "the reader never read anything");
  assert.equal(result.missing, 0, "an atomic replace must never make the file disappear");
  assert.equal(result.torn, 0, `reader saw ${result.torn} torn payload(s): ${result.firstTornReason}`);
  assert.deepEqual(
    result.variants, ["A", "B"],
    `reader only ever saw ${JSON.stringify(result.variants)} — its reads did not overlap the writes, ` +
    "so torn === 0 proves nothing"
  );
  assert.equal(fs.readFileSync(target).length, PAYLOAD_SIZE);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nno new runtime dependency");
// ═══════════════════════════════════════════════════════════════════════════

test("fslock.mjs imports nothing but node: builtins and a local module", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "fslock.mjs"), "utf8");
  const specifiers = [...src.matchAll(/^\s*import\s+[^"']*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, "expected to find imports");
  for (const spec of specifiers) {
    assert.ok(
      spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"),
      `fslock.mjs must add no dependency, but imports "${spec}"`
    );
  }
});

test("package.json declares no new dependency for the lock", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.deepEqual(
    Object.keys(pkg.dependencies || {}).sort(),
    ["@modelcontextprotocol/sdk", "inquirer", "zod"],
    "fslock must not have introduced a runtime dependency"
  );
});

// ── summary ──────────────────────────────────────────────────────────────────

cleanupTemps();
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
