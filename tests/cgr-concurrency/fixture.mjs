// Shared fixture + child plumbing for the CGR concurrency suite.
//
// Two rules this module exists to keep in ONE place, because both are easy to
// get subtly wrong per-test and neither fails loudly when it is:
//
//   TEMP .arch/ ONLY. Every fixture is an mkdtemp'd project with its own .arch/.
//   scripts/arch-write-guard.cjs EACCESes anything that reaches the repo's live
//   board, so a slip here fails the run rather than corrupting real CGRs — but
//   the fixture is what keeps us from ever testing that.
//
//   EXPLICIT cwd ON EVERY SPAWN. A child that inherits the runner's cwd resolves
//   whatever .arch/ sits above it (tests/spawn-cwd-audit enforces this repo-wide).
//   runChild refuses to spawn without one.
//
// The bodies are deliberately LARGE. A lost update needs a window between the
// read and the write, and on a 200-byte goal file that window is nanoseconds
// wide — a negative control on a small file can pass simply because nothing had
// time to interleave, which would make the locked case prove nothing. A few
// hundred KB of body puts the read+parse+emit+write of one stamp into the
// milliseconds, which is where real contention lives (the funnel is called from
// a Stop hook that runs per turn-end, per session).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { writeGoal, dispatchGoal, stampGoalFields } from "../../src/lib/goals.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Body sizes, in KB. Sized by experiment against the negative controls: small
// enough that the suite stays a couple of seconds, large enough that the
// unlocked control reliably loses an update.
export const HOT_BODY_KB = 320;
export const FILLER_BODY_KB = 120;

const temps = [];

// realpathSync: macOS's tmpdir is a symlink, and the archDir a child resolves
// must be the same string the parent resolved — the lock path is derived from it.
export function tempProject(tag) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `archkit-cgrconc-${tag}-`));
  temps.push(dir);
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "board"), { recursive: true });
  return { dir, archDir };
}

export function cleanupTemps() {
  for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  temps.length = 0;
}

export function bigBody(kb, tag) {
  const line = `${tag} filler line, deliberately long so the goal file is heavy enough to widen the read-modify-write window.\n`;
  return line.repeat(Math.ceil((kb * 1024) / line.length));
}

// ── the two fixtures ─────────────────────────────────────────────────────────

// One heavy goal, sitting in goals/queue/, for the concurrent-stamp race.
export function stampFixture() {
  const { dir, archDir } = tempProject("stamp");
  writeGoal(archDir, {
    slug: "hot",
    title: "Hot goal",
    exitCriteria: ["contended"],
    body: bigBody(HOT_BODY_KB, "hot"),
  });
  return { dir, archDir };
}

// A dispatched goal holding an EXPIRED lease plus its `claimed` event (so it
// folds into in_flight and then into leases_expired), and a tail of filler goals
// in testing/. The orphan sits in goals/ ROOT, which listGoals parses before
// testing/, so the fold reads the stale lease in its first milliseconds and the
// filler tail keeps the pass running well past that — the fold->mutate stretch
// the renewal has to land in is real work, not a contrived pause.
export function reclaimFixture({ fillers = 8 } = {}) {
  const { dir, archDir } = tempProject("reclaim");
  const expired = { worker: "w-alpha", expires: "2020-01-01T00:00:00.000Z" };
  writeGoal(archDir, { slug: "orphan", title: "Orphan", exitCriteria: ["x"] });
  dispatchGoal(archDir, "orphan", { worker: "w-alpha" });
  stampGoalFields(archDir, "orphan", { lease: expired });
  fs.appendFileSync(
    path.join(archDir, "board", "events.ndjson"),
    `${JSON.stringify({ type: "claimed", slug: "orphan", worker: "w-alpha", lease: expired, at: expired.expires })}\n`,
  );

  const testingDir = path.join(archDir, "goals", "testing");
  fs.mkdirSync(testingDir, { recursive: true });
  const body = bigBody(FILLER_BODY_KB, "filler");
  for (let i = 0; i < fillers; i++) {
    fs.writeFileSync(
      path.join(testingDir, `filler-${i}.md`),
      `---\nslug: filler-${i}\ntitle: Filler ${i}\nstatus: testing\ncreated: 2026-08-10\n---\n\n${body}`,
    );
  }
  return { dir, archDir };
}

// ── barrier + child plumbing ─────────────────────────────────────────────────

// Process spawn on a loaded machine can cost more than the whole critical
// section, so children launched in a burst can end up accidentally serialised —
// which makes an unlocked control pass for the wrong reason. Every child
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
export function runChild(script, args, cwd) {
  if (!cwd) throw new Error("runChild requires an explicit cwd");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args.map(String)], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
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

// Release N children that are provably all in flight, then wait for them.
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
