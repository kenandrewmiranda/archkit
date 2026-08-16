#!/usr/bin/env node
// One contender in the mutual-exclusion test: a REAL process doing a
// read-modify-write of a shared counter, either under the lock or without it.
//
// The barrier is what makes this deterministic. Process spawn on a loaded
// machine can take longer than the hold window, so children launched in a burst
// can end up accidentally serialised — which would make the unlocked control
// pass for the wrong reason and the locked case prove nothing. Every child
// announces itself and then blocks on a `go` file the parent writes only once
// every child is announced, so all N are provably in flight together.
//
// argv: <mode lock|nolock> <lockPath> <counterFile> <logFile> <readyDir> <goFile> <holdMs> <waitMs> <ttlMs>

import fs from "node:fs";
import path from "node:path";
import { withLock, atomicWriteFileSync } from "../../src/lib/fslock.mjs";

const [mode, lockPath, counterFile, logFile, readyDir, goFile, holdMsRaw, waitMsRaw, ttlMsRaw] =
  process.argv.slice(2);
const holdMs = Number(holdMsRaw);
const waitMs = Number(waitMsRaw);
const ttlMs = Number(ttlMsRaw);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

// The read-modify-write under test. The hold widens the window between the read
// and the write so an unlocked run reliably loses updates; under the lock it is
// simply time spent in the critical section.
function mutate() {
  const start = Date.now();
  const n = Number(fs.readFileSync(counterFile, "utf8").trim());
  sleep(holdMs);
  atomicWriteFileSync(counterFile, String(n + 1));
  return { start, end: Date.now(), read: n };
}

fs.writeFileSync(path.join(readyDir, `${process.pid}`), "ready");

const barrierDeadline = Date.now() + 30_000;
while (!fs.existsSync(goFile)) {
  if (Date.now() > barrierDeadline) {
    fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, error: "barrier timeout" })}\n`);
    process.exit(1);
  }
  sleep(2);
}

let record;
if (mode === "lock") {
  const res = withLock(lockPath, mutate, { waitMs, ttlMs, pollMs: 5, meta: { test: "mutex" } });
  record = {
    pid: process.pid,
    held: res.held,
    failedOpen: res.failedOpen,
    brokeStale: res.brokeStale,
    released: res.released?.released ?? null,
    ...res.value,
  };
} else {
  record = { pid: process.pid, held: null, failedOpen: null, brokeStale: null, released: null, ...mutate() };
}

// Append-only, one line per process: safe from N writers without coordination
// (the same property board.mjs's event log relies on), so the log itself can
// never be the thing that loses a record.
fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`);
