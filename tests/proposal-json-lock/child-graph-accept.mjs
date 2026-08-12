#!/usr/bin/env node
// An ACCEPTER in the graph-gap race: the read side of the flywheel closing
// (archkit_graph_accept). It loads the proposal's gap list, appends ONE authored
// node line to the cluster .graph, then writes the gap list back minus the gap it
// consumed — a read-modify-write across two files, which is exactly the shape ADR
// 0030 §2/§4 exists for.
//
// Two ways this loses data when the sequence is not serialised, and the suite
// measures both:
//
//   the gap list — a rewrite from a pre-acquisition snapshot erases whatever the
//     recorder (or another accepter) wrote in the window.
//   the .graph — two accepters that read the same cluster each write
//     `everything I saw + my line`, so the loser's node line is gone even though
//     its accept reported ok and its gap was consumed. The file it documented is
//     then undocumented forever, with nothing left to re-detect it.
//
//   lock   — the shipped acceptGraphProposal.
//   nolock — `naiveAccept` below: the PRE-fix bodies of acceptGraphProposal and
//            appendValidatedNodeLine verbatim, no lock anywhere. Validation still
//            runs through the real loadGraphCluster, so the control is the true
//            pre-fix code path and not a weakened stand-in.
//
// argv: <mode lock|nolock> <archDir> <slug> <index> <attempts> <deadlineMs> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { acceptGraphProposal } from "../../src/lib/goals.mjs";
import { loadGraphCluster } from "../../src/lib/parsers.mjs";
import { acceptFile, acceptNode } from "./fixture.mjs";
import { collectLockWarnings, reachBarrier, report, sleep } from "./child-runtime.mjs";

const [mode, archDir, slug, indexRaw, attemptsRaw, deadlineRaw, logFile, readyDir, goFile] = process.argv.slice(2);
const index = Number(indexRaw);
const attempts = Number(attemptsRaw);
const deadlineMs = Number(deadlineRaw);

function naiveAppendValidatedNodeLine(cluster, authoredLine) {
  const dir = path.join(archDir, "clusters");
  const target = path.join(dir, `${cluster}.graph`);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const before = loadGraphCluster(archDir, cluster);
  const beforeCount = before ? before.nodes.length : 0;
  const candidate = (existing.trimEnd() ? existing.trimEnd() + "\n" : "") + authoredLine.trim() + "\n";

  fs.mkdirSync(dir, { recursive: true });
  const probeId = `.accept-probe-${process.pid}`;
  const probePath = path.join(dir, `${probeId}.graph`);
  let probedCount = 0;
  try {
    fs.writeFileSync(probePath, candidate);
    const probed = loadGraphCluster(archDir, probeId);
    probedCount = probed ? probed.nodes.length : 0;
  } finally {
    fs.rmSync(probePath, { force: true });
  }
  if (probedCount !== beforeCount + 1) return { ok: false, beforeCount, probedCount };

  fs.writeFileSync(target, candidate);
  return { ok: true, beforeCount, afterCount: probedCount, clusterPath: target };
}

// A deliberate copy of the pre-fix mutation (see child-proposal.mjs for why).
function naiveAccept(file, line) {
  const proposalPath = path.join(archDir, "graph-proposals", `${slug}.json`);
  if (!fs.existsSync(proposalPath)) return { ok: false, reason: "unknown_proposal" };
  let proposal;
  try { proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8")); }
  catch { return { ok: false, reason: "unreadable_proposal" }; }
  const gaps = Array.isArray(proposal.gaps) ? proposal.gaps : [];
  const gap = gaps.find((g) => g.file === file);
  if (!gap) return { ok: false, reason: "gap_not_found" };

  const appended = naiveAppendValidatedNodeLine(gap.cluster, line);
  if (!appended.ok) return { ok: false, reason: "malformed_line" };

  const remaining = gaps.filter((g) => g.file !== gap.file);
  if (remaining.length === 0) fs.rmSync(proposalPath, { force: true });
  else fs.writeFileSync(proposalPath, JSON.stringify({ ...proposal, gaps: remaining }, null, 2));
  return { ok: true, remainingGaps: remaining.length };
}

const accept = (file, line) =>
  (mode === "lock" ? acceptGraphProposal(archDir, slug, { file, line }) : naiveAccept(file, line));

const warnings = collectLockWarnings();
reachBarrier(readyDir, goFile, logFile, `accepter-${index}`);

const accepted = [];
const anomalies = [];
const startedAt = Date.now();
let error = null;
const stopAt = Date.now() + deadlineMs;
try {
  for (let j = 0; j < attempts; j++) {
    const file = acceptFile(index, j);
    const line = `${acceptNode(index, j)} [S] : ${file} — concurrent-accept fixture node | Goals → THIS`;
    for (;;) {
      const r = accept(file, line);
      if (r.ok) { accepted.push(file); break; }
      // The gap can be legitimately absent for a moment: a recorder round rewrites
      // the whole set, so retry rather than call it a loss. Anything else is a
      // real refusal and is reported, never retried into a spin.
      if (r.reason === "gap_not_found" || r.reason === "unknown_proposal") {
        if (Date.now() > stopAt) { anomalies.push(`timeout:${r.reason}`); break; }
        sleep(2);
        continue;
      }
      anomalies.push(r.reason);
      break;
    }
  }
} catch (err) {
  error = err.message;
}

report(logFile, { role: "accepter", mode, index, accepted, anomalies, startedAt, endedAt: Date.now(), failedOpen: warnings.length, error });
