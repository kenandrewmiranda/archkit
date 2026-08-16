#!/usr/bin/env node
// One contender in the queue-branch race: a REAL process starting an ungrouped
// goal's branch record, behind a barrier. Every child passes a DIFFERENT date, so
// the branch each would mint on its own is distinguishable — which is what makes
// "we all agree" a real assertion rather than a tautology.
//
//   lock   — the shipped ensureQueueBranch (reads INSIDE the archDir lock, so the
//            losers of the race observe the winner's record and return it).
//   nolock — `naiveEnsureQueueBranch` below: the pre-fix body verbatim
//            (readQueueBranch -> mint -> ensureGoalsLayout -> fs.writeFileSync).
//            Every child reads "nothing minted", every child mints its own, the
//            last write wins, and the callers walk away holding N different
//            branch names for one batch.
//
// argv: <mode lock|nolock> <archDir> <date> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { ensureQueueBranch, readQueueBranch, ensureGoalsLayout } from "../../src/lib/goals.mjs";

const [mode, archDir, date, logFile, readyDir, goFile] = process.argv.slice(2);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

function naiveEnsureQueueBranch() {
  const existing = readQueueBranch(archDir);
  if (existing) return existing;
  const branch = `cgr-queue-${date}`;
  try {
    ensureGoalsLayout(archDir);
    fs.writeFileSync(
      path.join(archDir, "goals", ".queue-state.json"),
      JSON.stringify({ branch, minted: date }, null, 2),
    );
  } catch { /* best-effort, as the pre-fix code was */ }
  return branch;
}

fs.writeFileSync(path.join(readyDir, `${process.pid}`), "ready");

const barrierDeadline = Date.now() + 60_000;
while (!fs.existsSync(goFile)) {
  if (Date.now() > barrierDeadline) {
    fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, error: "barrier timeout" })}\n`);
    process.exit(1);
  }
  sleep(2);
}

const startedAt = Date.now();
let error = null;
let branch = null;
try {
  branch = mode === "lock" ? ensureQueueBranch(archDir, { date }) : naiveEnsureQueueBranch();
} catch (err) {
  error = err.message;
}

fs.appendFileSync(logFile, `${JSON.stringify({
  pid: process.pid,
  mode,
  date,
  branch,
  startedAt,
  endedAt: Date.now(),
  error,
})}\n`);
