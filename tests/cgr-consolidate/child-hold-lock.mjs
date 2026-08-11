#!/usr/bin/env node
// Holds the archDir advisory lock for the duration of a test, so that every
// consolidation running against that tree is FORCED down the fail-open path
// (ADR 0030: acquisition fails open after LOCK_WAIT_MS and the caller runs
// UNLOCKED). That is the only way to test the property the goal actually asks
// for — that consolidation is structurally append-only, so it survives
// concurrency even when the lock is not protecting it.
//
// A separate process, not an in-process acquire: the lock is REENTRANT within a
// process, so an in-process holder would let the consolidations straight through.
//
// argv: <archDir> <readyFile> <releaseFile>

import fs from "node:fs";

import { acquireLock, archLockPath, LOCK_TTL_MS } from "../../src/lib/fslock.mjs";

const [archDir, readyFile, releaseFile] = process.argv.slice(2);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

const handle = acquireLock(archLockPath(archDir), { waitMs: 5_000 });
if (!handle.held) {
  fs.writeFileSync(readyFile, JSON.stringify({ held: false, reason: "could not take the lock" }));
  process.exit(1);
}
fs.writeFileSync(readyFile, JSON.stringify({ held: true, pid: process.pid, ttlMs: LOCK_TTL_MS }));

// Held until released, but never past the TTL — a hung parent must not turn this
// into a lock the next test breaks as stale mid-assertion.
const deadline = Date.now() + LOCK_TTL_MS - 5_000;
while (!fs.existsSync(releaseFile) && Date.now() < deadline) sleep(5);

handle.release();
