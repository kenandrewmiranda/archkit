#!/usr/bin/env node
// One contender in the turn-cap race: a REAL process incrementing the shared
// .loop-state.json counter, over and over, behind a barrier. This is the Stop
// hook's exact workload — bin/archkit-stop-hook.mjs calls bumpLoopBlock, and it
// is a fresh process at every turn-end in every open session.
//
// Two modes, and the comparison between them is the whole point:
//
//   lock   — the shipped bumpLoopBlock (reads INSIDE the archDir lock).
//   nolock — `naiveBump` below: the PRE-fix bodies of bumpLoopBlock and
//            writeLoopState verbatim (readLoopState -> +1 -> ensureGoalsLayout ->
//            fs.writeFileSync, no lock anywhere). It is the negative control, and
//            it exists so a passing locked run cannot be explained by "nothing
//            interleaved". If nolock ever stops losing increments, the workload
//            has gone soft and the suite says so instead of quietly proving
//            nothing.
//
// argv: <mode lock|nolock> <archDir> <slug> <rounds> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { readLoopState, bumpLoopBlock, ensureGoalsLayout } from "../../src/lib/goals.mjs";

const [mode, archDir, slug, roundsRaw, logFile, readyDir, goFile] = process.argv.slice(2);
const rounds = Number(roundsRaw);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

// A deliberate copy of the pre-fix mutation, kept as a copy rather than a flag on
// the real function: a test hook inside the mutator would be a production code
// path that exists only to be broken. ensureGoalsLayout is kept because the old
// writeLoopState called it — it takes the lock internally (migratePendingGoals-
// ToQueue does), which makes this control STRICTER, not weaker: it proves the
// loss comes from the unprotected READ, not from an unprotected write.
function naiveBump() {
  const state = readLoopState(archDir);
  state[slug] = (state[slug] || 0) + 1;
  ensureGoalsLayout(archDir);
  fs.writeFileSync(path.join(archDir, "goals", ".loop-state.json"), JSON.stringify(state, null, 2));
  return state[slug];
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
let last = null;
try {
  for (let r = 0; r < rounds; r++) last = mode === "lock" ? bumpLoopBlock(archDir, slug) : naiveBump();
} catch (err) {
  error = err.message;
}

// Append-only, one line per process: N writers, no coordination, no lost record.
fs.appendFileSync(logFile, `${JSON.stringify({
  pid: process.pid,
  mode,
  rounds,
  last,
  startedAt,
  endedAt: Date.now(),
  error,
})}\n`);
