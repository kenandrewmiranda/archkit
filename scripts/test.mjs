#!/usr/bin/env node
// Run every tests/<suite>/run.mjs as a child process and aggregate results.
// archkit's suites are standalone scripts (no test framework); this is the
// `npm test` entry point and what CI runs. Exits non-zero if any suite fails.
//
// Two safety properties this runner owns, both because archkit dogfoods its own
// .arch/ board and the suites spawn archkit's real bins:
//
//   1. CWD SANDBOX — every suite runs with its cwd set to a temp mirror of the
//      repo root that deliberately has no .arch/, never the repo root itself.
//      A hook or CLI child spawned without an explicit `cwd` inherits its
//      parent's, so a suite that forgets one used to hand archkit's LIVE board
//      to the child. The Stop hook's queue-drain consolidation then archived
//      real completed CGRs into .arch/goals/done/archive/ and wrote a digest —
//      on every `npm test`. From the sandbox that walk-up finds nothing and the
//      hook exits silently, which is the correct behaviour for a child whose
//      caller forgot to say where it was.
//
//   2. BOARD IMMUTABILITY GUARD — the repo's .arch/ is hashed before and after
//      each suite. Any suite that mutates it fails the run and is named. This
//      is the regression guard for the class of leak above: it catches the next
//      one even if it arrives through a path the sandbox doesn't cover.
//
// (2) needs more than a hash to be trustworthy, because the board is SHARED
// mutable state. archkit's MCP tools always write the MAIN project's .arch/ no
// matter which worktree the calling agent sits in, so during a multi-agent pass
// another worker's archkit_goal_handoff can land mid-run and the suite that
// happened to be executing gets blamed for a file it never opened. A hash diff
// simply cannot tell the two apart.
//
// ATTRIBUTION MECHANISM: scripts/arch-write-guard.cjs is preloaded into every
// suite process and, via a child_process wrapper, into everything they spawn.
// It refuses any fs write whose target is inside the live .arch/ and records it
// (suite, pid, api, path) to a run-scoped audit log. Writes are therefore
// observed AT THEIR SOURCE, inside this process tree, which is the one place
// the two causes are distinguishable:
//
//     board delta  +  audit records  ->  the suite did it. Fatal, named.
//     board delta  +  no records     ->  nothing in this process tree wrote the
//                                        board, so the writer was external.
//                                        Reported as a concurrent write; not a
//                                        failure and no suite is named.
//
// Why this and not the cheaper options: a path allow-list (ignore .arch/goals/,
// .arch/board/handoff/) would disarm the guard for exactly the directories a
// leaked hook run corrupts, and a timing heuristic (re-read after the suite
// window) cannot see a one-shot external write that lands mid-suite — the very
// case observed. Refusing the write rather than merely logging it also means a
// surviving delta is external by construction, not merely unattributed.
//
// A suite whose audit log has no `boot` line ran UNinstrumented; its delta is
// treated as its own fault. Silence is never read as innocence.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const testsDir = path.join(root, "tests");
const archDir = path.join(root, ".arch");

// The multi-agent coordination scratchpad: gitignored, appended to by whichever
// agents are live in this checkout, never by a test. Excluding it keeps the
// guard from going red on a concurrent worker's announce-entry.
const UNTRACKED_BY_DESIGN = new Set(["goals/chat.md"]);

// ── board immutability guard ─────────────────────────────────────────────────

function snapshotArch() {
  const snap = new Map();
  if (!fs.existsSync(archDir)) return snap;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(archDir, abs).split(path.sep).join("/");
      if (UNTRACKED_BY_DESIGN.has(rel)) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        snap.set(rel, crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"));
      }
    }
  };
  walk(archDir);
  return snap;
}

// ── write-attribution audit log ──────────────────────────────────────────────

const shimPath = path.join(__dirname, "arch-write-guard.cjs");
const auditPath = path.join(
  fs.realpathSync(os.tmpdir()),
  `archkit-test-write-audit-${process.pid}-${Date.now()}.jsonl`
);
let auditOffset = 0;

// The shim resolves candidate paths, so it must compare against the resolved
// board: on macOS a checkout under /tmp or /var reaches .arch/ by a different
// literal string than the one this file computes.
const archDirReal = fs.existsSync(archDir) ? fs.realpathSync(archDir) : archDir;

function suiteEnv(suite) {
  const preload = `--require ${JSON.stringify(shimPath)}`;
  return {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ${preload}` : preload,
    ARCHKIT_TEST_ARCH_DIR: archDirReal,
    ARCHKIT_TEST_WRITE_AUDIT: auditPath,
    ARCHKIT_TEST_SUITE: suite,
    ARCHKIT_TEST_SUITE_BOOT: suite,
  };
}

// Read only what was appended since the last call, so records are attributed to
// the suite that was running when they landed.
function readNewAuditRecords() {
  let text = "";
  try {
    const fd = fs.openSync(auditPath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size > auditOffset) {
        const buf = Buffer.alloc(size - auditOffset);
        fs.readSync(fd, buf, 0, buf.length, auditOffset);
        text = buf.toString("utf8");
        auditOffset = size;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function diffArch(before, after) {
  const changes = [];
  for (const [rel, hash] of after) {
    if (!before.has(rel)) changes.push(`+ ${rel}`);
    else if (before.get(rel) !== hash) changes.push(`~ ${rel}`);
  }
  for (const rel of before.keys()) if (!after.has(rel)) changes.push(`- ${rel}`);
  return changes.sort();
}

// ── cwd sandbox ──────────────────────────────────────────────────────────────

// Top-level entries the sandbox deliberately does NOT mirror. `.arch` is the
// whole point — a child that inherits the sandbox must not be able to find the
// live board. `.git` follows for the same reason: a stray `git` call with no
// cwd should fail loudly rather than operate on this checkout.
const UNMIRRORED = new Set([".arch", ".git"]);

function makeSandbox() {
  // realpathSync: macOS's tmpdir is a symlink, and a child comparing cwd
  // against its own resolved path would otherwise see a mismatch.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "archkit-test-cwd-"));

  // Mirror the repo root by symlink so cwd-relative references a suite may
  // still carry (e.g. `path.resolve("bin/archkit.mjs")`) keep resolving, while
  // .arch/ stays unreachable. Symlinks, not copies: the suites read through
  // them, and a copy would drift from the tree under test.
  for (const entry of fs.readdirSync(root)) {
    if (UNMIRRORED.has(entry)) continue;
    const target = path.join(root, entry);
    const type = fs.statSync(target).isDirectory() ? "junction" : "file";
    fs.symlinkSync(target, path.join(dir, entry), type);
  }

  // Nothing above the sandbox may look like an archkit project either —
  // findArchDir() walks up until it hits the filesystem root.
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".arch", "SYSTEM.md"))) {
      console.error(`test sandbox ${dir} sits under an archkit project at ${d} — refusing to run`);
      process.exit(1);
    }
    if (path.dirname(d) === d) break;
  }
  return dir;
}

// ── run ──────────────────────────────────────────────────────────────────────

const suites = fs
  .readdirSync(testsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(testsDir, d.name, "run.mjs")))
  .map((d) => d.name)
  .sort();

const sandbox = makeSandbox();
const failed = [];
const mutators = [];          // suites proven to have written the live board
const externalChanges = [];   // deltas no test process is responsible for
let snapshot = snapshotArch();

fs.writeFileSync(auditPath, "");

try {
  for (const suite of suites) {
    const res = spawnSync(process.execPath, [path.join(testsDir, suite, "run.mjs")], {
      cwd: sandbox,
      stdio: "inherit",
      env: suiteEnv(suite),
    });
    if (res.status !== 0) failed.push(suite);

    const records = readNewAuditRecords();
    const writes = records.filter((r) => r.kind === "write");
    const instrumented = records.some((r) => r.kind === "boot");

    const after = snapshotArch();
    const changes = diffArch(snapshot, after);
    snapshot = after;

    if (writes.length) {
      // Refused at the source, so `changes` is usually empty — the attempt is
      // the offence, and the audit record is the proof.
      mutators.push({ suite, writes, changes, reason: "attributed" });
    } else if (changes.length && !instrumented) {
      // The write shim never loaded for this suite, so "no records" proves
      // nothing. Fail closed rather than hand it an alibi.
      mutators.push({ suite, writes: [], changes, reason: "uninstrumented" });
    } else if (changes.length) {
      externalChanges.push(...changes);
    }
  }
} finally {
  fs.rmSync(auditPath, { force: true });
  // Unlink the mirror entries explicitly before removing the dir. `rm -rf`
  // would not follow the symlinks either, but the repo tree is on the other
  // end of them — this leaves no room for that to be wrong.
  for (const entry of fs.readdirSync(sandbox)) {
    const abs = path.join(sandbox, entry);
    if (fs.lstatSync(abs).isSymbolicLink()) fs.unlinkSync(abs);
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed.`);

// A concurrent writer is a fact about the environment, not a defect in the
// suite that was unlucky enough to be running. Report it as its own condition,
// with its own vocabulary, and never attach a suite name to it.
if (externalChanges.length) {
  console.error("\nCONCURRENT EXTERNAL WRITE: this repository's .arch/ board changed while the");
  console.error("tests ran, but no test process wrote to it — every fs write to the live board");
  console.error("from inside the test process tree is intercepted, and none was recorded. The");
  console.error("writer was outside this run (typically another agent's archkit MCP session, which");
  console.error("writes the main project's board from any worktree). Not a test failure.");
  for (const c of [...new Set(externalChanges)].sort()) console.error(`    ${c}`);
}

if (mutators.length) {
  console.error("\nFAILED: a test suite wrote to this repository's own .arch/ board.");
  console.error("Tests must never write to the live board — spawn archkit bins with an explicit cwd\n" +
    "pointing at the suite's temp project (see tests/stop-hook/run.mjs spawnHook).");
  for (const { suite, writes, changes, reason } of mutators) {
    console.error(`  ${suite} mutated the board${reason === "uninstrumented" ? " (write-attribution shim never loaded — failing closed)" : ""}:`);
    for (const w of writes) console.error(`    refused ${w.api}(${w.path})  [pid ${w.pid}]`);
    for (const c of changes) console.error(`    ${c}`);
  }
}

if (failed.length) {
  console.error(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
if (mutators.length) process.exit(1);
