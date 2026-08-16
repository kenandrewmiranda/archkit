#!/usr/bin/env node
// The reclaim half of the lease-renewal race: a REAL process running an
// orphan-lease reclaim pass behind a barrier, while another process renews the
// lease it is about to drop.
//
// Two modes:
//
//   fixed  — the shipped reclaimExpiredLeases, which re-checks expiry against
//            the live CGR INSIDE the lock before touching anything.
//   legacy — `legacyReclaim` below: the pre-ADR-0030 algorithm verbatim (fold,
//            then append + stamp against the fold's snapshot). The negative
//            control. It runs on today's stampGoalFields on purpose — the defect
//            under test is the missing RE-CHECK, not the stamp, and isolating it
//            is what makes the control meaningful.
//
// The rendezvous (see child-renew.mjs) is what makes the interleaving
// deterministic rather than timing-dependent: this child waits until the renewer
// holds the lock, announces that it is about to fold, and folds — so the fold
// provably reads the STALE lease, and the mutation that follows it provably
// cannot land until the renewal has committed. The timings it reports let the
// parent verify that ordering instead of assuming it.
//
// argv: <mode fixed|legacy> <archDir> <logFile> <readyDir> <goFile> <lockHeldFile> <foldingFile>

import fs from "node:fs";
import path from "node:path";

import { loadGoal, stampGoalFields } from "../../src/lib/goals.mjs";
import {
  reclaimExpiredLeases,
  sessionState,
  foldEvents,
  readEvents,
  appendEvent,
} from "../../src/lib/board.mjs";

const [mode, archDir, logFile, readyDir, goFile, lockHeldFile, foldingFile] = process.argv.slice(2);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

function legacyReclaim(now) {
  const board = sessionState(archDir, { now });
  const { bySlug } = foldEvents(readEvents(archDir));
  const reclaimed = [];
  for (const exp of board.leases_expired) {
    if (bySlug.get(exp.slug)?.lifecycle === "lease-expired") continue;
    appendEvent(archDir, { type: "lease-expired", slug: exp.slug, worker: exp.worker || null, at: now });
    if (loadGoal(archDir, exp.slug)) {
      try { stampGoalFields(archDir, exp.slug, { lease: null }); } catch { /* tolerant */ }
    }
    reclaimed.push({ slug: exp.slug, worker: exp.worker || null, expires: exp.expires || null });
  }
  return { reclaimed, now };
}

function waitFor(file, what) {
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) {
      fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, role: "reclaim", error: `timed out waiting for ${what}` })}\n`);
      process.exit(1);
    }
    sleep(2);
  }
}

fs.writeFileSync(path.join(readyDir, `${process.pid}`), "ready");
waitFor(goFile, "the barrier");
waitFor(lockHeldFile, "the renewer to take the lock");
fs.writeFileSync(foldingFile, "folding");

const now = new Date().toISOString();
const startedAt = Date.now();
let reclaimed = [];
let error = null;
try {
  const r = mode === "fixed" ? reclaimExpiredLeases(archDir, { now }) : legacyReclaim(now);
  reclaimed = r.reclaimed.map((x) => x.slug);
} catch (err) {
  error = err.message;
}

fs.appendFileSync(logFile, `${JSON.stringify({
  pid: process.pid,
  role: "reclaim",
  mode,
  reclaimed,
  startedAt,
  endedAt: Date.now(),
  error,
})}\n`);
