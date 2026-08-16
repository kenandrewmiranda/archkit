// Shared fixtures + child plumbing for the board-json-lock suite.
//
// Same two non-negotiables as tests/cgr-concurrency (kept here rather than
// imported so the two suites can be edited independently):
//
//   TEMP .arch/ ONLY. Every fixture is an mkdtemp'd project with its own .arch/.
//   scripts/arch-write-guard.cjs EACCESes anything that reaches the repo's live
//   board, so a slip fails the run — but the fixture is what keeps us from ever
//   testing that.
//
//   EXPLICIT cwd ON EVERY SPAWN. A child that inherits the runner's cwd resolves
//   whatever .arch/ sits above it (tests/spawn-cwd-audit enforces this
//   repo-wide). runChild refuses to spawn without one.
//
// The state files here are naturally TINY — a turn-cap counter is a handful of
// keys, a queue record is two — and a read-modify-write window on a 60-byte file
// is nanoseconds wide. A negative control over a file that small can pass simply
// because nothing had time to interleave, which would make the locked runs prove
// nothing. So the counter file and the chat board are PRE-SEEDED to a few
// hundred KB: the read+parse+serialise+write of one mutation then lands in the
// milliseconds, which is where real contention lives. Nothing about the code
// under test changes with the file size; only the width of the window does.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Filler sizes, tuned against the negative controls: small enough that the suite
// stays a few seconds, large enough that the pre-fix code reliably loses.
export const LOOP_FILLER_KEYS = 12_000;
export const CHAT_FILLER_KB = 400;

const temps = [];

// realpathSync: macOS's tmpdir is a symlink, and the archDir a child resolves
// must be the same string the parent resolved — the lock path derives from it.
export function tempProject(tag) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `archkit-boardjson-${tag}-`));
  temps.push(dir);
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "board"), { recursive: true });
  fs.mkdirSync(path.join(archDir, "goals", "queue"), { recursive: true });
  fs.mkdirSync(path.join(archDir, "goals", "testing"), { recursive: true });
  fs.mkdirSync(path.join(archDir, "goals", "done"), { recursive: true });
  return { dir, archDir };
}

export function cleanupTemps() {
  for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  temps.length = 0;
}

// The paths under test, recomputed here rather than imported: a test that asks
// the module under test where its state lives cannot catch the module moving it.
export const loopStatePath = (archDir) => path.join(archDir, "goals", ".loop-state.json");
export const queueStatePath = (archDir) => path.join(archDir, "goals", ".queue-state.json");
export const chatBoardPath = (archDir) => path.join(archDir, "goals", "chat.md");

// ── fixtures ─────────────────────────────────────────────────────────────────

// A turn-cap file already carrying many slugs, so parse+serialise is real work.
export function loopFixture({ keys = LOOP_FILLER_KEYS } = {}) {
  const { dir, archDir } = tempProject("loop");
  const state = {};
  for (let i = 0; i < keys; i++) state[`filler-goal-with-a-realistic-slug-${i}`] = (i % 7) + 1;
  fs.writeFileSync(loopStatePath(archDir), JSON.stringify(state, null, 2));
  return { dir, archDir };
}

// No queue record yet — the whole race is over who gets to mint the first one.
//
// The check-then-act window here is `read the record` -> `ensureGoalsLayout` ->
// `write the record`, and ensureGoalsLayout's cost is proportional to what sits
// in goals/ root (it stats+parses every .md there looking for legacy pending
// files to migrate). A goals/ root with a real working set therefore widens the
// window the way a real project does, rather than the way a sleep would. The
// seeded goals are IN-PROGRESS, so the migration finds nothing to move and the
// tree is identical for every contender — only the parse cost is added.
export function queueFixture({ liveGoals = 40, kb = 24 } = {}) {
  const { dir, archDir } = tempProject("queue");
  const body = "Working notes for a goal already in flight in this tree.\n".repeat(Math.ceil((kb * 1024) / 56));
  for (let i = 0; i < liveGoals; i++) {
    fs.writeFileSync(
      path.join(archDir, "goals", `live-${i}.md`),
      `---\nslug: live-${i}\ntitle: Live ${i}\nstatus: in-progress\ncreated: 2026-08-11\n---\n\n${body}`,
    );
  }
  return { dir, archDir };
}

// A board with a long history, so a whole-file rewrite of it is slow enough for
// two announcers to overlap.
export function chatFixture({ kb = CHAT_FILLER_KB } = {}) {
  const { dir, archDir } = tempProject("chat");
  const line = "Prior announcement filler line, long enough to give the board a realistic history.\n";
  fs.writeFileSync(
    chatBoardPath(archDir),
    `# CGR agent coordination board\n\n${line.repeat(Math.ceil((kb * 1024) / line.length))}\n`,
  );
  return { dir, archDir };
}

// ── barrier + child plumbing ─────────────────────────────────────────────────

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
