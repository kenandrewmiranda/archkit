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
// Set ARCHKIT_TEST_ALLOW_ARCH_MUTATION=1 to downgrade (2) to a warning — only
// useful when another agent is concurrently writing the board in this checkout.

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
const mutators = [];
let snapshot = snapshotArch();

try {
  for (const suite of suites) {
    const res = spawnSync(process.execPath, [path.join(testsDir, suite, "run.mjs")], {
      cwd: sandbox,
      stdio: "inherit",
    });
    if (res.status !== 0) failed.push(suite);

    const after = snapshotArch();
    const changes = diffArch(snapshot, after);
    if (changes.length) mutators.push({ suite, changes });
    snapshot = after;
  }
} finally {
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

const allowMutation = process.env.ARCHKIT_TEST_ALLOW_ARCH_MUTATION === "1";
if (mutators.length) {
  const label = allowMutation ? "WARNING" : "FAILED";
  console.error(`\n${label}: the test run mutated this repository's own .arch/ board.`);
  console.error("Tests must never write to the live board — spawn archkit bins with an explicit cwd\n" +
    "pointing at the suite's temp project (see tests/stop-hook/run.mjs spawnHook).");
  for (const { suite, changes } of mutators) {
    console.error(`  ${suite}:`);
    for (const c of changes) console.error(`    ${c}`);
  }
}

if (failed.length) {
  console.error(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
if (mutators.length && !allowMutation) process.exit(1);
