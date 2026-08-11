#!/usr/bin/env node
// One contender in the concurrent-stamp race: a REAL process stamping ONE
// extended frontmatter field on a shared goal, over and over, behind a barrier.
//
// Two modes, and the comparison between them is the whole point:
//
//   lock   — the shipped stampGoalFields (loads INSIDE the archDir lock).
//   nolock — `naiveStamp` below, which is the PRE-ADR-0030 body of
//            stampGoalFields verbatim: loadGoal -> mutate meta -> writeFileSync,
//            no lock, no re-read. It is the negative control, and it exists so a
//            passing locked run cannot be explained by "nothing interleaved".
//            If nolock ever stops losing updates, the workload has gone soft and
//            the suite says so instead of quietly proving nothing.
//
// argv: <mode lock|nolock> <archDir> <slug> <field> <rounds> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { loadGoal, stampGoalFields } from "../../src/lib/goals.mjs";

const [mode, archDir, slug, field, roundsRaw, logFile, readyDir, goFile] = process.argv.slice(2);
const rounds = Number(roundsRaw);

// Friendly input name -> frontmatter key, mirroring goals.mjs's EXTENDED_FIELD_MAP
// for the fields this test contends on. Array-valued fields are stamped as
// single-element arrays so the block-array emit path is exercised too.
const META_KEY = { lane: "lane", handoff: "handoff", completion: "completion", owns: "owns", dependsOn: "depends_on" };
const IS_ARRAY = new Set(["owns", "dependsOn"]);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

// A deliberate copy of the pre-ADR-0030 mutation. Kept as a copy rather than a
// flag on the real function: a test hook inside the mutator would be a
// production code path that exists only to be broken.
function naiveEmit(meta) {
  const lines = [];
  for (const [k, v] of Object.entries(meta)) {
    if (!/^[\w][\w.-]*$/.test(String(k))) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else if (v != null) {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join("\n");
}

function naiveStamp(key, value) {
  const goal = loadGoal(archDir, slug);
  if (!goal) throw new Error(`unknown goal: ${slug}`);
  goal.meta[key] = value;
  const out = `---\n${naiveEmit(goal.meta)}\n---\n\n${goal.body || ""}`;
  fs.writeFileSync(goal.filepath, out);
}

fs.writeFileSync(path.join(readyDir, `${process.pid}`), "ready");

const barrierDeadline = Date.now() + 60_000;
while (!fs.existsSync(goFile)) {
  if (Date.now() > barrierDeadline) {
    fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, field, error: "barrier timeout" })}\n`);
    process.exit(1);
  }
  sleep(2);
}

const startedAt = Date.now();
let error = null;
try {
  for (let r = 0; r < rounds; r++) {
    const raw = `${field}#${r}`;
    const value = IS_ARRAY.has(field) ? [raw] : raw;
    if (mode === "lock") stampGoalFields(archDir, slug, { [field]: value });
    else naiveStamp(META_KEY[field], value);
  }
} catch (err) {
  error = err.message;
}

// Append-only, one line per process: N writers, no coordination, no lost record.
fs.appendFileSync(logFile, `${JSON.stringify({
  pid: process.pid,
  mode,
  field,
  metaKey: META_KEY[field],
  final: `${field}#${rounds - 1}`,
  startedAt,
  endedAt: Date.now(),
  error,
})}\n`);
