#!/usr/bin/env node
// One contender in the deferred-proposal race: a REAL process recording a
// follow-up proposal, behind a barrier. This is bin/archkit-stop-hook.mjs's exact
// workload — its detector calls writeGoalProposal at every turn-end, in every
// open session, as a fresh process, and two sessions that surface the SAME
// follow-up produce the same hash.
//
// Two modes, and the comparison between them is the whole point:
//
//   lock   — the shipped writeGoalProposal (existsSync INSIDE the archDir lock,
//            atomicWriteFileSync for the record).
//   nolock — `naiveWriteGoalProposal` below: the PRE-fix body verbatim
//            (ensureProposedDir -> existsSync -> pid-tagged tmp -> rename, no
//            lock anywhere). It is the negative control, and it exists so a
//            passing locked run cannot be explained by "nothing interleaved".
//
// Each child records TWO proposals: the CONTENDED hash every child shares (the
// race), then its OWN hash (the collateral — distinct proposals must all survive
// the locked run, or the fix bought safety by dropping work).
//
// argv: <mode lock|nolock> <archDir> <sharedHash> <source> <excerptBytes> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { writeGoalProposal, ensureProposedDir } from "../../src/lib/goals.mjs";
import { collectLockWarnings, reachBarrier, report } from "./child-runtime.mjs";

const [mode, archDir, sharedHash, source, excerptBytesRaw, logFile, readyDir, goFile] = process.argv.slice(2);
const excerpt = "x".repeat(Number(excerptBytesRaw));

// A deliberate copy of the pre-fix mutation, kept as a copy rather than a flag on
// the real function: a test hook inside the mutator would be a production code
// path that exists only to be broken.
function naiveWriteGoalProposal(proposal) {
  const dir = ensureProposedDir(archDir);
  const file = path.join(dir, `${proposal.hash}.json`);
  if (fs.existsSync(file)) return false;
  const record = {
    hash: proposal.hash,
    title: proposal.title,
    why: "",
    exitCriteria: [],
    contextExcerpt: proposal.contextExcerpt,
    patternName: null,
    source: proposal.source,
    createdAt: new Date().toISOString(),
  };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, file);
  return true;
}

const write = (proposal) => (mode === "lock" ? writeGoalProposal(archDir, proposal) : naiveWriteGoalProposal(proposal));

const warnings = collectLockWarnings();
reachBarrier(readyDir, goFile, logFile, source);

let error = null;
let sharedCreated = null;
let ownCreated = null;
try {
  sharedCreated = write({
    hash: sharedHash,
    title: `Follow-up surfaced by ${source}`,
    source,
    contextExcerpt: excerpt,
  });
  ownCreated = write({
    hash: `own-${source}`,
    title: `Follow-up unique to ${source}`,
    source,
    contextExcerpt: excerpt,
  });
} catch (err) {
  error = err.message;
}

report(logFile, { mode, source, sharedCreated, ownCreated, failedOpen: warnings.length, error });
