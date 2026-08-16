// Shared fixtures + child plumbing for the proposal-json-lock suite.
//
// Same two non-negotiables as tests/board-json-lock and tests/cgr-concurrency
// (kept as a copy rather than an import so the suites can be edited
// independently):
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
// And the same sizing argument. A follow-up proposal, a graph-proposal and a
// config.json are all small in a toy fixture, and a read-modify-write window over
// a 200-byte file is nanoseconds wide — a negative control over one can pass
// simply because nothing had time to interleave, which would make the locked runs
// prove nothing. So each fixture is padded to a few hundred KB: parse + mutate +
// serialise + write then lands in the milliseconds, which is where real
// contention lives. Only the width of the window changes; the code under test
// does not.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Filler sizes, tuned against the negative controls: small enough that the suite
// stays a few seconds, large enough that the pre-fix code reliably loses.
export const PROPOSAL_EXCERPT_KB = 320;
export const GAP_FILLER_COUNT = 700;
export const CONFIG_FILLER_KB = 300;

const temps = [];

// realpathSync: macOS's tmpdir is a symlink, and the archDir a child resolves
// must be the same string the parent resolved — the lock path derives from it.
export function tempProject(tag) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `archkit-propjson-${tag}-`));
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
export const proposedPath = (archDir, hash) => path.join(archDir, "goals", "proposed", `${hash}.json`);
export const graphProposalPath = (archDir, slug) => path.join(archDir, "graph-proposals", `${slug}.json`);
export const clusterPath = (archDir, cluster) => path.join(archDir, "clusters", `${cluster}.graph`);
export const configPath = (archDir) => path.join(archDir, "config.json");

// ── fixtures ─────────────────────────────────────────────────────────────────

// A deferred-proposal record big enough that writing one is real work: the Stop
// hook's detector carries a context excerpt, and it is the excerpt that makes the
// check-then-act window wide enough to lose in practice as well as in principle.
export function bigExcerpt(kb = PROPOSAL_EXCERPT_KB) {
  const line = "Session transcript excerpt kept with the deferred follow-up so a later review has context. ";
  return line.repeat(Math.ceil((kb * 1024) / line.length));
}

export function proposalFixture() {
  const { dir, archDir } = tempProject("proposal");
  fs.mkdirSync(path.join(archDir, "goals", "proposed"), { recursive: true });
  return { dir, archDir };
}

// A minimal but real .arch graph — the same shape tests/cgr-goals uses — so
// acceptGraphProposal's validation runs through the actual parser rather than a
// stub, and the .graph it appends to is one warmup could read.
export function graphFixture() {
  const { dir, archDir } = tempProject("graph");
  fs.mkdirSync(path.join(archDir, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(archDir, "INDEX.md"), [
    "# INDEX.md",
    "## Nodes → Clusters → Files",
    "@lib → [lib] → src/lib/",
    "## Cross-references",
    "",
  ].join("\n"));
  fs.writeFileSync(clusterPath(archDir, "lib"),
    "--- lib [feature] ---\nGoals [U] : src/lib/goals.mjs — list/read/move CGR goal files, pure | GoalCmd,StopHook → THIS\n---\n");
  return { dir, archDir };
}

// The gaps a completing goal records. `filler` gaps are never accepted, so they
// are the population that must survive every rewrite; `acc-<i>-<j>` gaps are the
// ones the accepters consume, one authored node line each.
export function fillerGaps(count = GAP_FILLER_COUNT) {
  return Array.from({ length: count }, (_, i) => ({
    kind: "undocumented-file",
    file: `src/lib/filler-module-with-a-realistic-name-${i}.mjs`,
    cluster: "lib",
    node: "@lib",
    suggestedLine: `Filler${i} [U] : src/lib/filler-module-with-a-realistic-name-${i}.mjs — <role — fill in> | <flow — fill in>`,
  }));
}

export function acceptableGaps(writers, attempts) {
  const out = [];
  for (let i = 0; i < writers; i++) {
    for (let j = 0; j < attempts; j++) {
      out.push({
        kind: "undocumented-file",
        file: acceptFile(i, j),
        cluster: "lib",
        node: "@lib",
        suggestedLine: `${acceptNode(i, j)} [U] : ${acceptFile(i, j)} — <role — fill in> | <flow — fill in>`,
      });
    }
  }
  return out;
}

export const acceptFile = (i, j) => `src/lib/acc-${i}-${j}.mjs`;
export const acceptNode = (i, j) => `Acc${i}x${j}`;
export const witnessFile = (round) => `src/lib/witness-${round}.mjs`;

// A config.json that already carries the OTHER project knobs — review disables,
// the api gate, the escalation threshold — plus enough bulk that the merge-write
// is milliseconds rather than nanoseconds. The unrelated keys are the collateral:
// a lost update over this file is not only a dropped finalize step, it is a
// silently reverted project policy.
export function configFixture({ kb = CONFIG_FILLER_KB } = {}) {
  const { dir, archDir } = tempProject("config");
  const filler = {};
  const entry = "a-suppressed-rule-family-with-a-realistic-name";
  const rows = Math.ceil((kb * 1024) / (entry.length + 24));
  for (let i = 0; i < rows; i++) filler[`${entry}-${i}`] = { enabled: i % 3 === 0, note: entry };
  fs.writeFileSync(configPath(archDir), `${JSON.stringify({
    review: { disable: ["magic-number"] },
    apiGate: { enabled: true },
    cgr: { escalateAfter: 3, leaseTtlHours: 6 },
    filler,
  }, null, 2)}\n`);
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

// Node ids currently in a cluster, read through the same file every reader reads.
// Duplicates are kept (not de-duplicated) — a doubled node line is one of the
// failures this suite is looking for.
export function clusterNodeIds(archDir, cluster) {
  const raw = fs.readFileSync(clusterPath(archDir, cluster), "utf8");
  return raw.split("\n")
    .map((l) => /^([A-Za-z][\w-]*)\s*\[/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => m[1]);
}
