#!/usr/bin/env node
// The reader half of the torn-write test. Reads the target file as fast as it
// can for the whole life of the writer and classifies every single read.
//
// The parent pre-creates the target with a whole payload before either child
// starts, so ENOENT is never legitimate here — an atomic replace has no window
// in which the destination does not exist. A missing file is counted as an
// anomaly, not tolerated.
//
// argv: <targetFile> <readyFile> <doneFile> <resultFile>

import fs from "node:fs";
import { classify } from "./payload.mjs";

const [targetFile, readyFile, doneFile, resultFile] = process.argv.slice(2);

const result = { reads: 0, torn: 0, missing: 0, firstTornReason: null, variants: [] };
const seen = new Set();

fs.writeFileSync(readyFile, "ready");

const deadline = Date.now() + 60_000;
for (;;) {
  const writerDone = fs.existsSync(doneFile);
  let buf = null;
  try {
    buf = fs.readFileSync(targetFile);
  } catch {
    result.missing++;
  }
  if (buf) {
    result.reads++;
    const verdict = classify(buf);
    if (verdict.ok) seen.add(verdict.variant);
    else {
      result.torn++;
      if (!result.firstTornReason) result.firstTornReason = verdict.reason;
    }
  }
  // One final read AFTER the writer is done, then stop — so the loop always
  // terminates on the writer's own signal rather than on a timer.
  if (writerDone) break;
  if (Date.now() > deadline) { result.timedOut = true; break; }
}

result.variants = [...seen].sort();
fs.writeFileSync(resultFile, JSON.stringify(result));
