// Shared fixture + child plumbing for the consolidation-race suite.
//
// Same two rules as tests/cgr-concurrency/fixture.mjs, for the same reasons:
//
//   TEMP .arch/ ONLY. scripts/arch-write-guard.cjs EACCESes anything reaching
//   the repo's live board; the fixture is what keeps us from testing that.
//
//   EXPLICIT cwd ON EVERY SPAWN (tests/spawn-cwd-audit enforces it repo-wide).
//   runChild refuses to spawn without one.
//
// The goal bodies are deliberately LARGE. consolidateGoals' lost-update window
// is the stretch between "scan done/ for terminal goals" and "write the digest
// back", and on 200-byte goal files that stretch is microseconds — a negative
// control on small files can pass simply because nothing had time to interleave,
// which would make the fixed case prove nothing. A few hundred KB per goal puts
// one consolidation pass into the tens of milliseconds, which is where real
// contention lives (this runs from bin/archkit-stop-hook.mjs, once per turn-end,
// in every concurrently-open session).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sized by experiment against the negative control: big enough that the naive
// control reliably loses entries, small enough that the suite stays a few
// seconds.
export const GOAL_COUNT = 24;
export const GOAL_BODY_KB = 200;

const temps = [];

// realpathSync: macOS's tmpdir is a symlink, and the archDir a child resolves
// must be the same string the parent resolved — the lock path derives from it.
export function tempProject(tag) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `archkit-consol-${tag}-`));
  temps.push(dir);
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "goals", "done"), { recursive: true });
  return { dir, archDir };
}

export function cleanupTemps() {
  for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  temps.length = 0;
}

export function bigBody(kb, tag) {
  const line = `${tag} filler line, deliberately long so the goal file is heavy enough to widen the scan-to-digest-write window.\n`;
  return line.repeat(Math.ceil((kb * 1024) / line.length));
}

export function doneRoot(archDir) {
  return path.join(archDir, "goals", "done");
}
export function archiveRoot(archDir) {
  return path.join(archDir, "goals", "done", "archive");
}
export function digestRoot(archDir) {
  return path.join(archDir, "goals", "done", "digest");
}

export function slugFor(i) {
  return `race-goal-${String(i).padStart(2, "0")}`;
}

// N heavy COMPLETED goals sitting at the top level of done/ — exactly the state
// consolidateGoals drains. Written directly rather than through
// completeGoal(): the shape is what matters here, and 24 lifecycle transitions
// would dominate the runtime.
export function raceFixture(tag, { count = GOAL_COUNT, bodyKb = GOAL_BODY_KB, day = "2026-06-07" } = {}) {
  const { dir, archDir } = tempProject(tag);
  fs.writeFileSync(
    path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n",
  );
  const done = doneRoot(archDir);
  const originals = new Map();
  for (let i = 0; i < count; i++) {
    const slug = slugFor(i);
    const content =
      `---\nslug: ${slug}\ntitle: Race goal ${i}\nstatus: completed\ncreated: ${day}\n` +
      `completed: ${day}T00:00:0${i % 10}.000Z\ncompletion-notes: shipped race goal ${i}\n---\n\n` +
      bigBody(bodyKb, slug);
    fs.writeFileSync(path.join(done, `${slug}.md`), content);
    originals.set(slug, content);
  }
  return { dir, archDir, day, originals, slugs: [...originals.keys()] };
}

// ── barrier + child plumbing (mirrors tests/cgr-concurrency/fixture.mjs) ─────

// Process spawn on a loaded machine can cost more than the whole critical
// section, so children launched in a burst can end up accidentally serialised —
// which makes a negative control pass for the wrong reason. Every child
// announces itself and blocks until the parent, having seen all N, writes `go`.
export function barrier(dir) {
  const readyDir = path.join(dir, "ready");
  fs.mkdirSync(readyDir, { recursive: true });
  return { readyDir, goFile: path.join(dir, "go") };
}

export function readyCount(readyDir) {
  try { return fs.readdirSync(readyDir).length; } catch { return 0; }
}

export function childPath(name) {
  return path.join(__dirname, name);
}

// Never spawn without an explicit cwd (tests/spawn-cwd-audit).
export function spawnChild(script, args, cwd) {
  if (!cwd) throw new Error("spawnChild requires an explicit cwd");
  const child = spawn(process.execPath, [script, ...args.map(String)], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  child.done = new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return child;
}

export function runChild(script, args, cwd) {
  return spawnChild(script, args, cwd).done;
}

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Bounded poll instead of a fixed sleep — a slower machine gets the same verdict.
export async function until(predicate, { timeoutMs = 60_000, pollMs = 5, what = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await delay(pollMs);
  }
}

// Release N children that are provably all at the barrier, then wait for them.
export async function runTogether(dir, spawns) {
  const { readyDir, goFile } = barrier(dir);
  const running = spawns.map((s) => s(readyDir, goFile));
  await until(() => readyCount(readyDir) === spawns.length, {
    what: `${spawns.length} children to reach the barrier`,
  });
  fs.writeFileSync(goFile, "go");
  return Promise.all(running);
}

export function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── observation helpers ──────────────────────────────────────────────────────

export function digestText(archDir, day) {
  const p = path.join(digestRoot(archDir), `${day}.md`);
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

// Every `<!-- cgr-digest-slug: X -->` marker in file order, WITH duplicates —
// duplicate detection is half of what this suite asserts, so this must not dedupe.
export function digestSlugs(archDir, day) {
  return [...digestText(archDir, day).matchAll(/<!-- cgr-digest-slug: (.+?) -->/g)].map((m) => m[1]);
}

export function listMd(dir) {
  try { return fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort(); } catch { return []; }
}

// The crash-safety invariant, evaluated as a snapshot: for every slug the
// fixture created, its raw bytes must exist INTACT at exactly one of
// done/<slug>.md (not yet consolidated) or done/archive/<slug>.md (consolidated).
// Returns the slugs that violate it, with the reason.
export function recoverabilityViolations({ archDir, originals }) {
  const bad = [];
  for (const [slug, want] of originals) {
    const atRoot = path.join(doneRoot(archDir), `${slug}.md`);
    const atArchive = path.join(archiveRoot(archDir), `${slug}.md`);
    const rootOk = fs.existsSync(atRoot) && fs.readFileSync(atRoot, "utf8") === want;
    const archiveOk = fs.existsSync(atArchive) && fs.readFileSync(atArchive, "utf8") === want;
    if (rootOk || archiveOk) continue;
    const sizes = [
      fs.existsSync(atRoot) ? `done/${slug}.md=${fs.statSync(atRoot).size}B` : "done/-",
      fs.existsSync(atArchive) ? `archive/${slug}.md=${fs.statSync(atArchive).size}B` : "archive/-",
    ].join(" ");
    bad.push({ slug, reason: `no intact copy (want ${want.length}B): ${sizes}` });
  }
  return bad;
}
