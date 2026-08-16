#!/usr/bin/env node
// The RECORDER in the graph-gap race: the write side of the flywheel (ADR 0004).
// A completing goal records the files it touched that the node graph does not yet
// represent — a whole-file record of the current gap set for its slug.
//
// It is a contender because acceptGraphProposal REWRITES that same file from a
// snapshot of its gap list. A record that lands between the accept's read and its
// write is erased, and the erased gap is unrecoverable: the goal that detected it
// is already completed, so nothing ever re-detects it.
//
// Each round stamps a WITNESS gap (`src/lib/witness-<round>.mjs`) that no accepter
// ever consumes. The witness of the last completed round must be on disk when the
// dust settles — under the lock, an accept that writes after this recorder must
// have read what it wrote. That single assertion is the lost-record test.
//
//   lock   — the shipped writeGraphProposal.
//   nolock — the PRE-fix body verbatim (mkdir -> fs.writeFileSync, no lock).
//
// argv: <mode lock|nolock> <archDir> <slug> <rounds> <gapsFile> <pauseMs> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { writeGraphProposal } from "../../src/lib/goals.mjs";
import { witnessFile } from "./fixture.mjs";
import { collectLockWarnings, reachBarrier, report, sleep } from "./child-runtime.mjs";

const [mode, archDir, slug, roundsRaw, gapsFile, pauseRaw, logFile, readyDir, goFile] = process.argv.slice(2);
const rounds = Number(roundsRaw);
const pauseMs = Number(pauseRaw);
const baseGaps = JSON.parse(fs.readFileSync(gapsFile, "utf8"));

const NOTE = "Files this goal touched that the node graph does not yet represent. For each undocumented-file: fill the suggestedLine's <role>/<flow> and append it to .arch/clusters/<cluster>.graph. For each unmapped-area: scaffold a new cluster + INDEX node. archkit does not auto-merge graph changes.";

// A deliberate copy of the pre-fix mutation (see child-proposal.mjs for why it is
// a copy and not a flag on the shipped function).
function naiveWriteGraphProposal(gaps) {
  const dir = path.join(archDir, "graph-proposals");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.json`);
  const proposal = { slug, created: new Date().toISOString().slice(0, 10), gaps, note: NOTE };
  fs.writeFileSync(file, JSON.stringify(proposal, null, 2));
  return { proposalPath: file, count: gaps.length };
}

const witnessGap = (round) => ({
  kind: "undocumented-file",
  file: witnessFile(round),
  cluster: "lib",
  node: "@lib",
  suggestedLine: `Witness${round} [U] : ${witnessFile(round)} — <role — fill in> | <flow — fill in>`,
});

const warnings = collectLockWarnings();
reachBarrier(readyDir, goFile, logFile, "recorder");

let error = null;
let lastRound = null;
const startedAt = Date.now();
try {
  for (let r = 0; r < rounds; r++) {
    const gaps = [...baseGaps, witnessGap(r)];
    if (mode === "lock") writeGraphProposal(archDir, slug, gaps);
    else naiveWriteGraphProposal(gaps);
    lastRound = r;
    sleep(pauseMs);
  }
} catch (err) {
  error = err.message;
}

report(logFile, { role: "recorder", mode, rounds, lastRound, startedAt, endedAt: Date.now(), failedOpen: warnings.length, error });
