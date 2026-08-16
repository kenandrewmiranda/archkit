#!/usr/bin/env node
// One contender in the config.json race: a REAL process merge-writing its own
// finalize step into .arch/config.json.
//
// This is the third lock-free read-modify-write the prior lane disclosed and did
// not own. It is not a private sidecar: config.json also carries the review
// disables, the api gate, the escalation threshold and the integration branch, so
// a lost update here does not merely drop a finalize step — it silently reverts a
// project policy, in a git-tracked file nobody is watching.
//
// Every child owns exactly ONE step key and always writes the SAME value for it,
// so the serialised outcome is fully determined no matter what order they run in.
// That is what makes the assertion exact rather than statistical.
//
//   lock   — the shipped writeFinalizeConfig (read INSIDE the archDir lock,
//            atomicWriteFileSync for the merged file).
//   nolock — the PRE-fix body verbatim (readFileSync -> merge -> fs.writeFileSync,
//            no lock anywhere).
//
// argv: <mode lock|nolock> <archDir> <stepKey> <stepValue true|false> <rounds> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { writeFinalizeConfig, readFinalizeConfig, FINALIZE_STEPS } from "../../src/lib/goals.mjs";
import { collectLockWarnings, reachBarrier, report, sleep } from "./child-runtime.mjs";

const [mode, archDir, stepKey, stepValueRaw, roundsRaw, logFile, readyDir, goFile] = process.argv.slice(2);
const stepValue = stepValueRaw === "true";
const rounds = Number(roundsRaw);

// A deliberate copy of the pre-fix mutation (see child-proposal.mjs for why).
function naiveWriteFinalizeConfig(patch) {
  const fp = path.join(archDir, "config.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { cfg = {}; }
  if (!cfg || typeof cfg !== "object") cfg = {};
  if (!cfg.cgr || typeof cfg.cgr !== "object") cfg.cgr = {};
  const cur = readFinalizeConfig(archDir);
  const steps = { ...cur.steps };
  if (patch.steps && typeof patch.steps === "object") {
    for (const s of FINALIZE_STEPS) {
      if (patch.steps[s.key] !== undefined) steps[s.key] = patch.steps[s.key] === true;
    }
  }
  cfg.cgr.finalize = {
    enabled: cur.enabled,
    configured: true,
    steps,
    ciCd: cur.ciCd,
    deployCommand: cur.deployCommand,
  };
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(cfg, null, 2) + "\n");
  return cfg.cgr.finalize;
}

const write = (patch) => (mode === "lock" ? writeFinalizeConfig(archDir, patch) : naiveWriteFinalizeConfig(patch));

const warnings = collectLockWarnings();
reachBarrier(readyDir, goFile, logFile, stepKey);

let error = null;
let last = null;
try {
  for (let r = 0; r < rounds; r++) {
    last = write({ steps: { [stepKey]: stepValue } });
    sleep(1);
  }
} catch (err) {
  error = err.message;
}

report(logFile, {
  role: "config",
  mode,
  stepKey,
  stepValue,
  observed: last ? last.steps[stepKey] : null,
  failedOpen: warnings.length,
  error,
});
