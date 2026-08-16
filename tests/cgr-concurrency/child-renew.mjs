#!/usr/bin/env node
// The worker half of the lease-renewal race: a REAL process renewing its claim
// on a CGR mid-flight, which is one stamp of a fresh `lease` with a future
// expiry — exactly what a live worker does to say "still here".
//
// WHY IT HOLDS THE LOCK AROUND THE STAMP. The defect under test is a window, and
// a window aimed at with a sleep is a coin flip: too early and the reclaim's
// fold simply reads the renewed lease and correctly skips (proving nothing);
// too late and the renewal lands after the mutation and survives for the wrong
// reason. So the interleaving is made DETERMINISTIC instead of hoped for. This
// child takes the same advisory lock the mutators take, announces that it holds
// it, waits for the reclaim child to say it has begun folding, renews, and only
// then releases. The reclaim's fold is unaffected (reads never lock) so it still
// observes the STALE lease, and its mutation cannot land until the renewal has
// committed — which is precisely the fold-then-renew-then-mutate order the
// TOCTOU needs. The stamp itself re-enters the lock this process already holds.
//
// argv: <archDir> <slug> <worker> <ttlMs> <holdMs> <logFile> <readyDir> <goFile> <lockHeldFile> <foldingFile>

import fs from "node:fs";
import path from "node:path";

import { stampGoalFields } from "../../src/lib/goals.mjs";
import { acquireLock, archLockPath } from "../../src/lib/fslock.mjs";

const [archDir, slug, worker, ttlRaw, holdRaw, logFile, readyDir, goFile, lockHeldFile, foldingFile] =
  process.argv.slice(2);
const ttlMs = Number(ttlRaw);
const holdMs = Number(holdRaw);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

function waitFor(file, what) {
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) {
      fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, role: "renew", error: `timed out waiting for ${what}` })}\n`);
      process.exit(1);
    }
    sleep(2);
  }
}

fs.writeFileSync(path.join(readyDir, `${process.pid}`), "ready");
waitFor(goFile, "the barrier");

// Wait long enough for the lock — the fixture builder in the parent may still be
// releasing its own setup stamps when we start.
const handle = acquireLock(archLockPath(archDir), { waitMs: 30_000, meta: { test: "renew" } });
fs.writeFileSync(lockHeldFile, "held");

// The reclaim child folds only after it sees the marker above, so the fold reads
// the STALE lease. Give it a beat to get past the orphan (goals/ root is parsed
// before the testing/ filler tail) and then renew, still under the lock.
waitFor(foldingFile, "the reclaim child to begin folding");
sleep(holdMs);

const startedAt = Date.now();
const expires = new Date(Date.now() + ttlMs).toISOString();
let error = null;
try {
  stampGoalFields(archDir, slug, { lease: { worker, expires } });
} catch (err) {
  error = err.message;
}
const endedAt = Date.now();
const released = handle.release();

fs.appendFileSync(logFile, `${JSON.stringify({
  pid: process.pid,
  role: "renew",
  held: handle.held,
  failedOpen: handle.failedOpen,
  released: released.released,
  expires,
  startedAt,
  endedAt,
  error,
})}\n`);
