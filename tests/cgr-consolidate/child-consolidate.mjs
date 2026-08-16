#!/usr/bin/env node
// One contender in the concurrent-consolidation race: a REAL process draining
// .arch/goals/done/ into the dated digest, behind a barrier.
//
// Two modes, and the comparison between them is the whole point:
//
//   real  — the shipped consolidateGoals().
//   naive — `naiveConsolidate` below: the PRE-FIX body of consolidateGoals
//           verbatim in control flow (read the whole digest -> archive+unlink
//           every terminal goal -> write the WHOLE digest back). It is the
//           NEGATIVE CONTROL. If it ever stops losing digest entries the
//           workload has gone soft and the suite says so instead of quietly
//           proving nothing.
//
// Kept as a copy rather than a flag on the real function: a test hook inside the
// mutator would be a production code path that exists only to be broken.
//
// TWO DELIBERATE DEVIATIONS in `naive`, both documented because they make the
// control STRICTER, not weaker:
//
//   1. ENOENT-tolerant read. The real pre-fix code throws ENOENT when a peer
//      unlinks a goal between this process's scan and its read — a separate,
//      real defect of the same code. Left unguarded it would crash the control
//      before it could demonstrate the lost update, so the control skips
//      instead. This makes the control MORE robust than the code it models.
//
//   2. `order=reverse` walks the terminal list back-to-front. readdir order is
//      not contractual, and two Stop hooks landing microseconds apart partition
//      the queue however the kernel feels like it. Reversing one contender makes
//      the partition DETERMINISTIC, so the control is a reliable detector rather
//      than a coin flip. It does not create the bug; it makes the existing
//      window observable on every run.
//
// argv: <mode real|naive> <order forward|reverse> <trigger barrier|claimed:N>
//       <archDir> <day> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { consolidateGoals, listTerminalGoals } from "../../src/lib/goals.mjs";

const [mode, order, trigger, archDir, day, logFile, readyDir, goFile] = process.argv.slice(2);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

const doneRoot = path.join(archDir, "goals", "done");
const archiveRoot = path.join(doneRoot, "archive");
const digestRoot = path.join(doneRoot, "digest");

function doneRootCount() {
  try { return fs.readdirSync(doneRoot).filter((n) => n.endsWith(".md")).length; } catch { return 0; }
}

// ── the negative control: pre-fix consolidateGoals, verbatim in control flow ──

function oneLine(text, max = 200) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function naiveEntry(goal) {
  const m = goal.meta || {};
  const status = m.status || "completed";
  const completedOn = String(m.completed || m.abandoned || m.created || "").slice(0, 10);
  const note = m["completion-notes"] || m["abandon-reason"] || "";
  const lines = [];
  lines.push(`<!-- cgr-digest-slug: ${goal.slug} -->`);
  lines.push(`## ${goal.slug} — ${m.title || goal.slug}`);
  lines.push(`- Outcome: ${status}`);
  if (completedOn) lines.push(`- Date: ${completedOn}`);
  if (note) lines.push(`- Notes: ${oneLine(note, 300)}`);
  lines.push(`- Raw: goals/done/archive/${goal.slug}.md`);
  return lines.join("\n");
}

function naiveConsolidate(reverse) {
  const terminal = listTerminalGoals(archDir);
  if (terminal.length === 0) return { consolidated: 0, slugs: [] };
  if (reverse) terminal.reverse();

  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.mkdirSync(digestRoot, { recursive: true });
  const digestPath = path.join(digestRoot, `${day}.md`);

  // THE BUG, step 1: the digest is read into memory here and written back at the
  // end. Everything a peer appends in between is on the losing side of the
  // last-writer-wins.
  let existing = "";
  try { existing = fs.readFileSync(digestPath, "utf8"); } catch { /* new digest */ }
  const already = new Set();
  for (const mm of existing.matchAll(/<!-- cgr-digest-slug: (.+?) -->/g)) already.add(mm[1]);

  const newEntries = [];
  const slugs = [];
  for (const goal of terminal) {
    let raw;
    try { raw = fs.readFileSync(goal.filepath, "utf8"); } catch { continue; } // deviation (1)
    fs.writeFileSync(path.join(archiveRoot, `${goal.slug}.md`), raw);
    fs.rmSync(goal.filepath, { force: true });
    slugs.push(goal.slug);
    if (!already.has(goal.slug)) newEntries.push(naiveEntry(goal));
  }

  // THE BUG, step 2: a full-file rewrite of a log.
  if (newEntries.length > 0) {
    let content;
    if (existing.trim()) {
      content = existing.trimEnd() + "\n\n" + newEntries.join("\n\n") + "\n";
    } else {
      content =
        `# CGR digest — ${day}\n\n` +
        `Consolidated summary of CGR goals finished on ${day}. The raw goal files\n` +
        `are preserved verbatim under goals/done/archive/ for full-context recovery.\n\n` +
        newEntries.join("\n\n") + "\n";
    }
    fs.writeFileSync(digestPath, content);
  }
  return { consolidated: slugs.length, slugs };
}

// ── barrier ──────────────────────────────────────────────────────────────────

fs.writeFileSync(path.join(readyDir, `${process.pid}`), "ready");

const barrierDeadline = Date.now() + 60_000;
while (!fs.existsSync(goFile)) {
  if (Date.now() > barrierDeadline) {
    fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, error: "barrier timeout" })}\n`);
    process.exit(1);
  }
  sleep(2);
}

// `claimed:N` is the OVERLAP barrier: hold until a peer has provably started
// draining (done/ has dropped to N or fewer files), so this process enters its
// scan while the peer is demonstrably mid-pass. That is a readiness signal about
// the peer's actual progress, not a sleep hoping for a race.
if (trigger.startsWith("claimed:")) {
  const target = Number(trigger.slice("claimed:".length));
  const overlapDeadline = Date.now() + 60_000;
  while (doneRootCount() > target) {
    if (Date.now() > overlapDeadline) {
      fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, error: "overlap trigger timeout" })}\n`);
      process.exit(1);
    }
    sleep(1);
  }
}

const startedAt = Date.now();
let error = null;
let result = null;
try {
  result = mode === "real"
    ? consolidateGoals(archDir, { date: day })
    : naiveConsolidate(order === "reverse");
} catch (err) {
  error = err.message;
}

// Append-only, one line per process: N writers, no coordination, no lost record.
fs.appendFileSync(logFile, `${JSON.stringify({
  pid: process.pid,
  mode,
  order,
  trigger,
  consolidated: result ? result.consolidated : 0,
  slugs: result ? result.slugs : [],
  startedAt,
  endedAt: Date.now(),
  error,
})}\n`);
