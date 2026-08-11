#!/usr/bin/env node
// tests/archdir-resolution — the archDir resolution contract (ADR 0031).
//
// THE BUG THIS PINS. Every surface used to re-derive archDir from wherever the
// process happened to be started: 18 copies of `findArchDir`, three signatures,
// two existence checks, two walk bounds. For a single tree that is right by
// accident. For a conductor's worktree worker it is silently WRONG: `.arch/board/`
// is gitignored so the worktree has no board at all, and `.arch/goals/` is tracked
// so the worktree carries a copy forked at its base commit. A worker therefore
// read a stale goal tree and wrote a board nobody would ever fold — and the only
// reason it usually worked was that the worker's cwd happened to be the main tree.
//
// So the headline test here is not a unit test. It builds a REAL throwaway git
// repo plus a REAL `git worktree`, diverges the two trees on purpose, and runs
// the actual CLI from inside the worktree — once with ARCHKIT_ARCH_DIR and once
// without. With it, the worktree reports the conductor's board verbatim; without
// it, it reports its own. That is the contract, as a test rather than a hope.
//
// The other half of the suite is the back-compat proof. Backward compatibility
// is a hard requirement, so "unset behaves as before" is not asserted by
// inspection: the PRE-ADR implementations are reproduced verbatim below and the
// new resolver is diffed against them over a matrix of layouts.
//
// Never touches the live .arch/ — every fixture is an OS temp dir, removed on
// the way out. Every spawn carries an explicit cwd (tests/spawn-cwd-audit).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ARCH_DIR_ENV,
  archDirFromEnv,
  resolveArchDir,
  requireArchDir,
  resolveArchDirForHook,
} from "../../src/lib/archdir.mjs";
import { findArchDir } from "../../src/lib/shared.mjs";
import { conductorGraph } from "../../src/lib/format.mjs";
import { writeGoal } from "../../src/lib/goals.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLI = path.join(ROOT, "bin", "archkit.mjs");
const SESSION_START = path.join(ROOT, "bin", "archkit-session-start.mjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n    ${err.stack || err.message}`); failed++; }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const temps = [];
function tempDir(tag) {
  // realpathSync: macOS's tmpdir is a symlink, and the resolver returns real
  // paths, so a raw mkdtemp path would mismatch on every assertion.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `archkit-archdir-${tag}-`));
  temps.push(dir);
  return dir;
}
function cleanup() {
  for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// A project root with a .arch/ in it. `system:false` makes a BARE .arch/ — the
// case where the two pre-ADR existence checks disagreed (shared.mjs accepted it,
// the MCP and hook copies did not).
function project(dir, { system = true } = {}) {
  const arch = path.join(dir, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  if (system) fs.writeFileSync(path.join(arch, "SYSTEM.md"), "# system\n");
  return arch;
}

function nested(dir, ...segments) {
  const p = path.join(dir, ...segments);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// An env with ARCHKIT_ARCH_DIR definitively ABSENT — inheriting the runner's
// would make the "unset falls back to cwd" half of the suite vacuous.
function envWithout(extra = {}) {
  const env = { ...process.env };
  delete env[ARCH_DIR_ENV];
  return { ...env, ...extra }; // the delete happens FIRST — `extra` may set it back on purpose
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

// ── the two PRE-ADR implementations, verbatim ────────────────────────────────
// Reproduced so back-compat is DIFFED, not asserted by eye. `start` is a
// parameter here only because the originals differed in how they got it: the
// MCP/hook copies took it as an argument, shared.mjs read process.cwd() and
// ignored anything passed. Both bodies are otherwise unchanged.

// src/mcp/tools.mjs + every hook bin: walk to the filesystem ROOT, require
// SYSTEM.md inside the candidate.
function legacyMcpFindArchDir(start) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, ".arch");
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "SYSTEM.md"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// src/lib/shared.mjs: at most 10 parents, `requireFile` optional (a bare .arch/
// counts when omitted).
function legacySharedFindArchDir(start, opts = {}) {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const archPath = path.join(dir, ".arch");
    if (opts.requireFile) {
      if (fs.existsSync(path.join(archPath, opts.requireFile))) return archPath;
    } else {
      if (fs.existsSync(archPath)) return archPath;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

console.log("\narchdir resolution — ARCHKIT_ARCH_DIR is the explicit signal (ADR 0031)\n");

// ── 1. precedence ────────────────────────────────────────────────────────────

test("tier 3: unset → walks up from cwd to the nearest .arch/", () => {
  const root = tempDir("walk");
  const arch = project(root);
  const deep = nested(root, "src", "features", "auth");
  assert.equal(resolveArchDir({ cwd: deep, requireFile: "SYSTEM.md", env: {} }), arch);
  assert.equal(resolveArchDir({ cwd: root, requireFile: "SYSTEM.md", env: {} }), arch);
});

test("tier 3: no .arch/ anywhere up the tree → null, never a throw", () => {
  // A temp dir with no project above it — the runner's sandbox already
  // guarantees nothing above tmp looks like an archkit project.
  const bare = tempDir("bare");
  assert.equal(resolveArchDir({ cwd: bare, requireFile: "SYSTEM.md", env: {} }), null);
});

test("tier 2: ARCHKIT_ARCH_DIR wins over cwd entirely — no walk happens", () => {
  const conductor = tempDir("conductor");
  const conductorArch = project(conductor);
  const other = tempDir("other");
  project(other); // a perfectly good .arch/ sitting right at the cwd…

  const resolved = resolveArchDir({
    cwd: other,
    requireFile: "SYSTEM.md",
    env: { [ARCH_DIR_ENV]: conductorArch },
  });
  assert.equal(resolved, conductorArch, "…and it is IGNORED: the explicit signal wins");
});

test("tier 2: a relative ARCHKIT_ARCH_DIR resolves against cwd", () => {
  const root = tempDir("relative");
  const arch = project(root);
  assert.equal(
    resolveArchDir({ cwd: root, requireFile: "SYSTEM.md", env: { [ARCH_DIR_ENV]: ".arch" } }),
    arch,
  );
});

test("tier 1: an explicit archDir argument outranks ARCHKIT_ARCH_DIR", () => {
  const a = tempDir("arg"); const argArch = project(a);
  const e = tempDir("env"); const envArch = project(e);
  assert.equal(
    resolveArchDir({ archDir: argArch, cwd: tempDir("elsewhere"), env: { [ARCH_DIR_ENV]: envArch } }),
    argArch,
  );
});

test("a set-but-nonexistent ARCHKIT_ARCH_DIR is an ERROR, never a fallback to cwd", () => {
  const root = tempDir("stale");
  project(root); // cwd COULD resolve — the point is that it must not be consulted
  const missing = path.join(root, "does-not-exist", ".arch");
  assert.throws(
    () => resolveArchDir({ cwd: root, requireFile: "SYSTEM.md", env: { [ARCH_DIR_ENV]: missing } }),
    (err) => {
      assert.equal(err.code, "invalid_arch_dir");
      assert.match(err.message, /ARCHKIT_ARCH_DIR/, "the message names the variable that is wrong");
      assert.match(err.message, /does not exist/);
      return true;
    },
  );
});

test("a blank / whitespace-only ARCHKIT_ARCH_DIR reads as unset, not as an error", () => {
  const root = tempDir("blank");
  const arch = project(root);
  for (const raw of ["", "   ", "\t\n"]) {
    assert.equal(archDirFromEnv({ [ARCH_DIR_ENV]: raw }), null, `"${raw}" is not an intent`);
    assert.equal(resolveArchDir({ cwd: root, requireFile: "SYSTEM.md", env: { [ARCH_DIR_ENV]: raw } }), arch);
  }
});

test("requireArchDir turns a miss into the structured no_arch_dir error", () => {
  const bare = tempDir("require");
  assert.throws(
    () => requireArchDir({ cwd: bare, env: {} }),
    (err) => {
      assert.equal(err.code, "no_arch_dir");
      assert.match(err.message, /No \.arch\/ directory found/);
      assert.ok(err.suggestion, "carries the `archkit init` suggestion the MCP envelope surfaces");
      return true;
    },
  );
});

test("requireArchDir defaults to the SYSTEM.md existence check the MCP surface always used", () => {
  const root = tempDir("bare-arch");
  project(root, { system: false }); // a bare .arch/, no SYSTEM.md
  assert.throws(() => requireArchDir({ cwd: root, env: {} }), (err) => err.code === "no_arch_dir");
  // …while the bare directory is still findable when a caller asks for no file.
  assert.equal(resolveArchDir({ cwd: root, env: {} }), path.join(root, ".arch"));
});

test("the hook variant never throws — a bad explicit value degrades to null", () => {
  const root = tempDir("hookvariant");
  project(root);
  const missing = path.join(root, "nope", ".arch");
  assert.equal(
    resolveArchDirForHook("test-hook", { cwd: root, requireFile: "SYSTEM.md", env: { [ARCH_DIR_ENV]: missing } }),
    null,
    "null (declines to act), NOT a silent fall back to the cwd project",
  );
  // and it still resolves normally when the value is good
  assert.equal(
    resolveArchDirForHook("test-hook", { cwd: root, requireFile: "SYSTEM.md", env: {} }),
    path.join(root, ".arch"),
  );
});

// ── 2. back-compat: unset must be byte-identical to the pre-ADR behaviour ────

test("BACK-COMPAT: unset → identical to the pre-ADR MCP/hook resolver, every layout", () => {
  const root = tempDir("compat-mcp");
  const arch = project(root);
  const bareRoot = tempDir("compat-bare");
  project(bareRoot, { system: false });
  const noProject = tempDir("compat-none");

  const cases = [
    root,
    nested(root, "src"),
    nested(root, "src", "features", "auth", "deep", "deeper"),
    bareRoot,                                   // bare .arch/ → the MCP copy said null
    nested(bareRoot, "src"),
    noProject,
    nested(noProject, "a", "b", "c"),
  ];
  for (const cwd of cases) {
    assert.equal(
      resolveArchDir({ cwd, requireFile: "SYSTEM.md", env: {} }),
      legacyMcpFindArchDir(cwd),
      `divergence at ${cwd}`,
    );
  }
  // …and the positive case really is finding something, so the loop is not
  // trivially comparing null to null.
  assert.equal(legacyMcpFindArchDir(nested(root, "src")), arch);
});

test("BACK-COMPAT: unset → identical to the pre-ADR shared.mjs resolver within its 10-parent bound", () => {
  const root = tempDir("compat-shared");
  const arch = project(root, { system: false }); // bare .arch/ — shared.mjs accepted these
  const withSystem = tempDir("compat-shared2");
  const arch2 = project(withSystem);
  const noProject = tempDir("compat-shared3");

  const cases = [
    [root, {}],
    [nested(root, "a"), {}],
    [nested(root, "a", "b", "c"), {}],
    [root, { requireFile: "SYSTEM.md" }],        // bare .arch/ → null on both
    [withSystem, { requireFile: "SYSTEM.md" }],
    [nested(withSystem, "a", "b"), { requireFile: "SYSTEM.md" }],
    [withSystem, { requireFile: "BOUNDARIES.md" }],
    [noProject, {}],
    [nested(noProject, "x", "y"), { requireFile: "SYSTEM.md" }],
  ];
  for (const [cwd, opts] of cases) {
    assert.equal(
      resolveArchDir({ cwd, requireFile: opts.requireFile || null, env: {} }),
      legacySharedFindArchDir(cwd, opts),
      `divergence at ${cwd} ${JSON.stringify(opts)}`,
    );
  }
  assert.equal(legacySharedFindArchDir(nested(root, "a"), {}), arch);
  assert.equal(legacySharedFindArchDir(withSystem, { requireFile: "SYSTEM.md" }), arch2);
});

test("DELIBERATE divergence: past 10 parents the walk no longer gives up (ADR 0031, one walk bound)", () => {
  // The one behaviour change back-compat does NOT cover, called out by the ADR:
  // shared.mjs stopped after 10 parents while the MCP/hook copies walked to the
  // root. They collapse onto walk-to-root, which only ever finds MORE.
  const root = tempDir("deep");
  const arch = project(root);
  const deep = nested(root, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l");
  assert.equal(legacySharedFindArchDir(deep, { requireFile: "SYSTEM.md" }), null, "the old bound gave up");
  assert.equal(resolveArchDir({ cwd: deep, requireFile: "SYSTEM.md", env: {} }), arch, "the one bound does not");
});

test("shared.mjs findArchDir (the CLI's entry) now routes through the resolver", () => {
  const root = tempDir("cli-lib");
  const arch = project(root);
  const elsewhere = tempDir("cli-lib-elsewhere");
  const cwd = process.cwd();
  try {
    // unset: the documented cwd fallback, exactly as before
    process.chdir(root);
    delete process.env[ARCH_DIR_ENV];
    assert.equal(findArchDir({ requireFile: "SYSTEM.md" }), arch);
    // set: honoured even from a directory with no project at all
    process.chdir(elsewhere);
    assert.equal(findArchDir({ requireFile: "SYSTEM.md" }), null, "control: nothing to find here");
    process.env[ARCH_DIR_ENV] = arch;
    assert.equal(findArchDir({ requireFile: "SYSTEM.md" }), arch, "…until the explicit signal names one");
  } finally {
    delete process.env[ARCH_DIR_ENV];
    process.chdir(cwd);
  }
});

// ── 3. the collapse: one resolver, no surface re-derives it ──────────────────

test("no MCP handler or hook bin carries its own findArchDir copy any more", () => {
  const files = [
    "src/mcp/tools.mjs", "src/mcp/prompts.mjs", "src/mcp/resources.mjs", "src/mcp/server.mjs",
    "bin/archkit-stop-hook.mjs", "bin/archkit-session-start.mjs", "bin/archkit-pretooluse-hook.mjs",
    "bin/archkit-posttooluse-hook.mjs", "bin/archkit-precompact-hook.mjs",
    "bin/archkit-userpromptsubmit-hook.mjs",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(
      /function\s+findArchDir\s*\(/.test(src), false,
      `${rel} still declares its own findArchDir — the point of ADR 0031 is that it does not`,
    );
  }
  // shared.mjs KEEPS the `findArchDir` name — src/commands/* all import it — but
  // it is now a one-line adapter onto the resolver, not a fourteenth walk loop.
  const shared = fs.readFileSync(path.join(ROOT, "src/lib/shared.mjs"), "utf8");
  const body = /export function findArchDir\([^)]*\) \{([\s\S]*?)\n\}/.exec(shared);
  assert.ok(body, "shared.mjs still exports findArchDir for the CLI commands");
  assert.match(body[1], /resolveArchDir\(/, "…delegating to the one resolver");
  assert.equal(/for\s*\(|while\s*\(/.test(body[1]), false, "…with no walk loop of its own left in it");

  // The resolver is imported rather than reimplemented.
  for (const rel of ["src/mcp/tools.mjs", "bin/archkit-stop-hook.mjs", "src/lib/shared.mjs"]) {
    assert.match(fs.readFileSync(path.join(ROOT, rel), "utf8"), /from ["'].*archdir\.mjs["']/, `${rel} imports the resolver`);
  }
});

test("tools.mjs no longer re-derives archDir per handler — every tool routes through requireArchDir", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/mcp/tools.mjs"), "utf8");
  // 49 call sites, one per tool that needs a project — the same 49 that each
  // used to compute their own `const cwd = process.cwd()` and hand it to a
  // file-local findArchDir copy.
  const calls = (src.match(/requireArchDir\(/g) || []).length;
  assert.equal(calls, 49, `expected 49 handlers on the one resolver, saw ${calls}`);

  // The surviving process.cwd() reads belong to handlers that need the process
  // cwd for their OWN work (git, relative path args). Each either threads it
  // into the resolver as the walk root, or belongs to a handler that resolves
  // no archDir at all (archkit_install_hooks) — none re-derives one.
  const cwdReads = (src.match(/const cwd = process\.cwd\(\);/g) || []).length;
  const threaded = (src.match(/requireArchDir\(\{ cwd \}\)/g) || []).length;
  assert.equal(cwdReads, 17, "the cwd reads that remain are the ones with a second job");
  assert.equal(threaded, 16, "16 of them are threaded into the resolver explicitly");
  assert.equal(
    (src.match(/handler: async[\s\S]*?const cwd = process\.cwd\(\);(?![\s\S]*?requireArchDir)/g) || []).length <= 1,
    true,
    "at most one handler (install_hooks) reads cwd without resolving an archDir",
  );
});

// ── 4. the headline: a real worktree, a real divergence, the real CLI ────────

// Build a conductor tree + a git worktree off it, then diverge them: a goal that
// exists ONLY in the conductor's tree (written after the worktree was cut, and
// uncommitted, so the worktree provably cannot see it through git).
function buildWorktreePair() {
  const base = tempDir("worktree");
  const conductor = path.join(base, "conductor");
  fs.mkdirSync(conductor, { recursive: true });

  git(["init", "-q", "-b", "main", "."], conductor);
  git(["config", "user.email", "test@archkit.invalid"], conductor);
  git(["config", "user.name", "archkit test"], conductor);

  const conductorArch = project(conductor);
  writeGoal(conductorArch, { slug: "shared-goal", title: "in both trees", exitCriteria: ["x"] });
  git(["add", "-A"], conductor);
  git(["commit", "-qm", "init"], conductor);

  const worker = path.join(base, "worker");
  git(["worktree", "add", "-q", worker, "-b", "cgr/lane-a"], conductor);

  // THE DIVERGENCE: only the conductor's tree has this one.
  writeGoal(conductorArch, { slug: "conductor-only", title: "minted after the cut", exitCriteria: ["x"] });

  return { conductor, conductorArch, worker };
}

function goalSlugs(cwd, env) {
  const r = spawnSync(process.execPath, [CLI, "goal", "list", "--json"], { cwd, env, encoding: "utf8" });
  assert.equal(r.status, 0, `archkit goal list failed in ${cwd}: ${r.stderr}`);
  return JSON.parse(r.stdout).active.map((g) => g.slug).sort();
}

test("WORKTREE: the two trees genuinely diverge — the fixture is not a no-op", () => {
  const { conductor, worker, conductorArch } = buildWorktreePair();
  assert.ok(fs.existsSync(path.join(worker, ".arch", "SYSTEM.md")), "the worktree has its OWN tracked .arch/");
  assert.ok(fs.existsSync(path.join(conductorArch, "goals", "queue", "conductor-only.md")));
  assert.equal(
    fs.existsSync(path.join(worker, ".arch", "goals", "queue", "conductor-only.md")), false,
    "…and it does NOT contain the goal minted after the cut — that is the whole problem",
  );
  assert.notEqual(path.join(worker, ".arch"), conductorArch);
  assert.equal(goalSlugs(conductor, envWithout()).join(","), "conductor-only,shared-goal");
});

test("WORKTREE: with ARCHKIT_ARCH_DIR the worktree CLI reports the CONDUCTOR's board", () => {
  const { conductor, conductorArch, worker } = buildWorktreePair();
  const fromConductor = goalSlugs(conductor, envWithout());
  const fromWorker = goalSlugs(worker, envWithout({ [ARCH_DIR_ENV]: conductorArch }));
  assert.deepEqual(fromWorker, fromConductor, "same board, byte for byte, despite a different cwd");
  assert.ok(fromWorker.includes("conductor-only"), "including the goal the worktree's own checkout lacks");
});

test("WORKTREE: without it the worktree falls back to cwd and reports its OWN, stale board", () => {
  const { conductor, worker } = buildWorktreePair();
  const fromConductor = goalSlugs(conductor, envWithout());
  const fromWorker = goalSlugs(worker, envWithout());
  assert.deepEqual(fromWorker, ["shared-goal"], "only what its checkout carries — the documented cwd fallback");
  assert.notDeepEqual(fromWorker, fromConductor, "which is exactly the divergence ADR 0031 makes deliberate");
});

test("WORKTREE: a stale ARCHKIT_ARCH_DIR fails the CLI loudly instead of degrading to cwd", () => {
  const { worker } = buildWorktreePair();
  const r = spawnSync(
    process.execPath, [CLI, "goal", "list", "--json"],
    { cwd: worker, env: envWithout({ [ARCH_DIR_ENV]: path.join(worker, "gone", ".arch") }), encoding: "utf8" },
  );
  assert.equal(r.status, 1, "a caller that set the variable meant it");
  assert.match(r.stderr, /ARCHKIT_ARCH_DIR/);
  assert.match(r.stderr, /does not exist/);
  assert.equal(r.stdout.trim(), "", "and it does NOT quietly answer against the worktree's own .arch/");
});

test("WORKTREE: unset behaviour is unchanged in a plain single tree (no variable, no regression)", () => {
  const { conductor } = buildWorktreePair();
  // The single-tree case the ADR promises stays byte-identical: the CLI run from
  // a subdirectory still walks up and finds the one project.
  const sub = nested(conductor, "src", "features");
  assert.deepEqual(goalSlugs(sub, envWithout()), ["conductor-only", "shared-goal"]);
});

// ── 5. every hook bin honours the signal ─────────────────────────────────────

test("HOOKS: a hook spawned OUTSIDE any project still resolves via ARCHKIT_ARCH_DIR", () => {
  const root = tempDir("hook-project");
  const arch = project(root);
  const bare = tempDir("hook-bare"); // no .arch/ anywhere above it

  const event = JSON.stringify({ cwd: bare, hook_event_name: "SessionStart" });
  const run = (env) => spawnSync(process.execPath, [SESSION_START], { cwd: bare, env, input: event, encoding: "utf8" });

  const without = run(envWithout());
  assert.equal(without.status, 0);
  assert.match(
    JSON.parse(without.stdout).hookSpecificOutput.additionalContext,
    /does not have an \.arch\/ directory yet/,
    "control: cwd resolution finds nothing here",
  );

  const withEnv = run(envWithout({ [ARCH_DIR_ENV]: arch }));
  assert.equal(withEnv.status, 0);
  assert.match(
    JSON.parse(withEnv.stdout).hookSpecificOutput.additionalContext,
    /managed by archkit/,
    "the explicit signal reaches the hook bin, not just the CLI",
  );
});

test("HOOKS: a stale ARCHKIT_ARCH_DIR degrades the hook to 'no project' and still exits 0", () => {
  const bare = tempDir("hook-stale");
  const event = JSON.stringify({ cwd: bare, hook_event_name: "SessionStart" });
  const r = spawnSync(
    process.execPath, [SESSION_START],
    { cwd: bare, env: envWithout({ [ARCH_DIR_ENV]: path.join(bare, "gone", ".arch") }), input: event, encoding: "utf8" },
  );
  assert.equal(r.status, 0, "a hook must never take down a Claude Code session");
  assert.match(r.stderr, /ARCHKIT_ARCH_DIR/, "…but it says so on stderr rather than failing silently");
});

test("HOOKS: every hook bin resolves through the one resolver with the harness cwd", () => {
  const bins = [
    "archkit-stop-hook", "archkit-session-start", "archkit-pretooluse-hook",
    "archkit-posttooluse-hook", "archkit-precompact-hook", "archkit-userpromptsubmit-hook",
  ];
  for (const bin of bins) {
    const src = fs.readFileSync(path.join(ROOT, "bin", `${bin}.mjs`), "utf8");
    assert.match(src, /import \{ resolveArchDirForHook \} from "\.\.\/src\/lib\/archdir\.mjs";/, `${bin} imports the resolver`);
    assert.match(
      src, new RegExp(`resolveArchDirForHook\\("${bin}", \\{ cwd, requireFile: "SYSTEM\\.md" \\}\\)`),
      `${bin} still prefers the harness-supplied event.cwd — that preference now takes effect AT the resolver`,
    );
    assert.match(src, /const cwd = event\.cwd \|\| process\.cwd\(\);/, `${bin} keeps event.cwd over its own process cwd`);
  }
});

// ── 6. the dispatch step carries the environment requirement ────────────────

test("DISPATCH: the rendered pass tells the conductor to set ARCHKIT_ARCH_DIR per worker", () => {
  const archDir = "/tmp/conductor/.arch";
  const plan = {
    archDir,
    counts: { frontier: 2, claimableLanes: 2, barriers: 0, in_flight: 0, merge_queue: 0, blocked: 0, exceptions: 0, leases_expired: 0 },
    claimableLanes: { backend: ["f1"], frontend: ["f2"] },
    barriers: [], leasesExpired: [], exceptions: [], unverifiedMerges: [],
    convergence: { branch: "main", groups: [] },
  };
  const lines = conductorGraph(plan);
  const spawnLine = lines.find((l) => l.includes("ARCHKIT_ARCH_DIR"));
  assert.ok(spawnLine, "the dispatch step names the variable at all");
  assert.ok(spawnLine.includes(`ARCHKIT_ARCH_DIR=${archDir}`), "…with the conductor's ACTUAL archDir, ready to paste");
  assert.match(spawnLine, /SPAWN/, "…attached to the spawn, which is where the conductor acts on it");
  assert.match(spawnLine, /worktree/i, "…and says why: a worktree's own state is not the conductor's");
  // O(1) in lanes, like the claim template beside it — one line for N workers.
  assert.equal(lines.filter((l) => l.includes("ARCHKIT_ARCH_DIR")).length, 1);
});

test("DISPATCH: with no lanes to claim there is no spawn step, so no env line either", () => {
  const idle = {
    counts: { frontier: 0, claimableLanes: 0, barriers: 0, in_flight: 0, merge_queue: 0, blocked: 0, exceptions: 0, leases_expired: 0 },
    claimableLanes: {}, barriers: [], leasesExpired: [], exceptions: [], unverifiedMerges: [],
    convergence: { branch: "main", groups: [] },
  };
  assert.equal(conductorGraph(idle).some((l) => l.includes("ARCHKIT_ARCH_DIR")), false);
});

test("DISPATCH: a plan with no archDir still renders a usable placeholder, never `undefined`", () => {
  const plan = {
    counts: { frontier: 1, claimableLanes: 1, barriers: 0, in_flight: 0, merge_queue: 0, blocked: 0, exceptions: 0, leases_expired: 0 },
    claimableLanes: { backend: ["f1"] },
    barriers: [], leasesExpired: [], exceptions: [], unverifiedMerges: [],
    convergence: { branch: "main", groups: [] },
  };
  const line = conductorGraph(plan).find((l) => l.includes("ARCHKIT_ARCH_DIR"));
  assert.ok(line && !line.includes("undefined"), `got: ${line}`);
});

// ── done ─────────────────────────────────────────────────────────────────────

cleanup();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
