// Barrier + reporting plumbing shared by this suite's contenders.
//
// Every child announces itself, blocks until the parent releases all of them,
// runs its workload and appends exactly one JSON line to the shared log
// (append-only, N writers, no coordination — the one write shape that cannot
// lose a record, ADR 0030 §8).
//
// It also captures ArchkitLockWarning. A locked run that quietly failed OPEN
// would look exactly like a broken lock, so the children report how often
// acquisition degraded and the suite asserts zero: a soft failure is then
// diagnosable instead of mysterious.

import fs from "node:fs";
import path from "node:path";

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
export const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

export function collectLockWarnings() {
  const warnings = [];
  process.on("warning", (w) => { if (w.name === "ArchkitLockWarning") warnings.push(w.message); });
  return warnings;
}

export function reachBarrier(readyDir, goFile, logFile, tag = String(process.pid)) {
  fs.writeFileSync(path.join(readyDir, tag), "ready");
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(goFile)) {
    if (Date.now() > deadline) {
      fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, error: "barrier timeout" })}\n`);
      process.exit(1);
    }
    sleep(2);
  }
}

export function report(logFile, record) {
  fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, ...record })}\n`);
}
