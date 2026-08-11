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
import { projectClaudeDir, gatherHooksStatus } from "../../src/lib/hooks-status.mjs";
import { renderGuardrailHooks, ARCHKIT_GUARDRAIL_HOOKS } from "../../src/lib/claude-settings.mjs";
import { conductorGraph } from "../../src/lib/format.mjs";
import { writeGoal } from "../../src/lib/goals.mjs";
import { listDecisions } from "../../src/lib/decisions.mjs";

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

// src/commands/decisions.mjs + src/commands/prd.mjs carried a THIRD copy — the
// residual the first pass missed, because the archdir lane did not own
// src/commands/. Identical bodies, deleted by the follow-up; reproduced here so
// their back-compat is diffed too rather than assumed from a family resemblance.
function legacyCommandFindArchDir(start) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, ".arch");
    if (fs.existsSync(path.join(candidate, "SYSTEM.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
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

// ── 7. the command residual: `decisions list/search` and `prd check` ─────────
//
// The first pass collapsed the MCP server, the six hook bins and the CLI
// mainline onto the resolver, but src/commands/decisions.mjs and
// src/commands/prd.mjs each kept a private walker in their CLI branch. So
// `archkit decisions list --json` and `archkit prd check --json` resolved from
// cwd and ignored the variable outright — a worktree worker asking either of
// them a question got an answer about the wrong project, with no error to hint
// at it. Same fixture shape as section 4: a REAL worktree, a REAL divergence,
// the REAL CLI.

const PRD_SAAS = `# Product

A multi-tenant SaaS with subscriptions and billing via Stripe. Each organization
gets a workspace; users sign up, log in, and land on a dashboard.
`;

function writeAdr(archDir, number, title) {
  const dir = path.join(archDir, "decisions");
  fs.mkdirSync(dir, { recursive: true });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = path.join(dir, `${String(number).padStart(4, "0")}-${slug}.md`);
  fs.writeFileSync(
    file,
    `# ${number}. ${title}\n\n- **Date**: 2026-08-10\n- **Status**: accepted\n- **Tags**: archdir\n\n` +
    `## Context\n\ncontext\n\n## Decision\n\ndecision body\n\n## Consequences\n\nconsequences\n`,
  );
  return file;
}

// The declared archetype is the discriminator for `prd check`: the PRD is
// identical in both trees (committed before the cut) so the ONLY thing that can
// change the answer is WHICH SYSTEM.md it is diffed against.
function declaredTypeOf(archDir) {
  const m = fs.readFileSync(path.join(archDir, "SYSTEM.md"), "utf8").match(/^##\s*Type:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

function buildCommandTrees() {
  const base = tempDir("commands");
  const conductor = path.join(base, "conductor");
  fs.mkdirSync(conductor, { recursive: true });

  git(["init", "-q", "-b", "main", "."], conductor);
  git(["config", "user.email", "test@archkit.invalid"], conductor);
  git(["config", "user.name", "archkit test"], conductor);

  const conductorArch = project(conductor);
  fs.writeFileSync(path.join(conductorArch, "SYSTEM.md"), "# System\n\n## Type: content\n");
  writeAdr(conductorArch, 1, "in both trees");
  fs.writeFileSync(path.join(conductor, "PRD.md"), PRD_SAAS);
  git(["add", "-A"], conductor);
  git(["commit", "-qm", "init"], conductor);

  const worker = path.join(base, "worker");
  git(["worktree", "add", "-q", worker, "-b", "cgr/lane-commands"], conductor);

  // THE DIVERGENCE, minted after the cut and uncommitted so the worktree
  // provably cannot see it: one extra ADR, and a re-declared archetype.
  writeAdr(conductorArch, 2, "conductor only");
  fs.writeFileSync(path.join(conductorArch, "SYSTEM.md"), "# System\n\n## Type: saas\n");

  return { conductor, conductorArch, worker, workerArch: path.join(worker, ".arch") };
}

function cliJson(args, cwd, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
  assert.equal(r.status, 0, `archkit ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout);
}

test("COMMANDS: the fixture diverges — the worktree's .arch/ lacks the conductor's ADR and archetype", () => {
  const { conductorArch, workerArch } = buildCommandTrees();
  assert.equal(declaredTypeOf(conductorArch), "saas");
  assert.equal(declaredTypeOf(workerArch), "content", "the worktree kept the committed declaration");
  assert.ok(fs.existsSync(path.join(conductorArch, "decisions", "0002-conductor-only.md")));
  assert.equal(
    fs.existsSync(path.join(workerArch, "decisions", "0002-conductor-only.md")), false,
    "…and cannot see the ADR minted after the cut — that is the whole problem",
  );
});

test("COMMANDS: `decisions list --json` from a worktree honours ARCHKIT_ARCH_DIR", () => {
  const { conductor, conductorArch, worker } = buildCommandTrees();
  const fromConductor = cliJson(["decisions", "list", "--json"], conductor, envWithout());
  const fromWorker = cliJson(["decisions", "list", "--json"], worker, envWithout({ [ARCH_DIR_ENV]: conductorArch }));

  assert.equal(fromConductor.total, 2, "control: the conductor's tree really has two ADRs");
  assert.equal(fromWorker.total, 2, "the worktree answered against the NAMED .arch/, not its own");
  assert.deepEqual(
    fromWorker.decisions.map((d) => d.title).sort(),
    ["conductor only", "in both trees"],
    "including the ADR its own checkout does not contain",
  );
});

test("COMMANDS: `decisions list --json` with the variable unset still answers from cwd", () => {
  const { conductor, worker } = buildCommandTrees();
  const fromWorker = cliJson(["decisions", "list", "--json"], worker, envWithout());
  assert.equal(fromWorker.total, 1, "only what its checkout carries — the documented fallback, unchanged");
  assert.deepEqual(fromWorker.decisions.map((d) => d.title), ["in both trees"]);
  // …and the difference is real, not an artefact of an empty fixture.
  assert.notEqual(fromWorker.total, cliJson(["decisions", "list", "--json"], conductor, envWithout()).total);
});

test("COMMANDS: `prd check --json` from a worktree diffs against the NAMED .arch/", () => {
  const { conductorArch, worker } = buildCommandTrees();
  const r = cliJson(["prd", "check", "--json"], worker, envWithout({ [ARCH_DIR_ENV]: conductorArch }));

  assert.equal(r.prdFound, true, "the PRD is still located from cwd — it belongs to the tree you stand in");
  assert.equal(r.prdRelativePath, "PRD.md");
  assert.equal(r.recommendedArchetype, "saas", "control: the PRD's own signal is unambiguous");
  assert.equal(r.declaredArchetype, "saas", "checked against the conductor's SYSTEM.md, not the worktree's");
  assert.equal(
    r.findings.some((f) => f.type === "archetype_mismatch"), false,
    "…so PRD and system agree, which is only true of the conductor's declaration",
  );
});

test("COMMANDS: `prd check --json` with the variable unset still diffs against the cwd project", () => {
  const { worker } = buildCommandTrees();
  const r = cliJson(["prd", "check", "--json"], worker, envWithout());
  assert.equal(r.declaredArchetype, "content", "the worktree's own SYSTEM.md — the documented fallback");
  assert.ok(
    r.findings.some((f) => f.type === "archetype_mismatch"),
    "and the mismatch it always reported is still reported",
  );
});

test("BACK-COMPAT: unset → identical to the DELETED private command walker, every layout", () => {
  const root = tempDir("compat-cmd");
  const arch = project(root);
  const bareRoot = tempDir("compat-cmd-bare");
  project(bareRoot, { system: false });          // bare .arch/ → the command copy said null
  const noProject = tempDir("compat-cmd-none");

  const cases = [
    root,
    nested(root, "src"),
    nested(root, "src", "features", "auth", "deep", "deeper", "deepest", "further", "onward", "still", "more", "yet"),
    bareRoot,
    nested(bareRoot, "src"),
    noProject,
    nested(noProject, "a", "b", "c"),
  ];
  for (const cwd of cases) {
    assert.equal(
      resolveArchDir({ cwd, requireFile: "SYSTEM.md", env: {} }),
      legacyCommandFindArchDir(cwd),
      `divergence at ${cwd}`,
    );
  }
  assert.equal(legacyCommandFindArchDir(nested(root, "src")), arch, "…and the matrix is not all-null");
});

test("BACK-COMPAT: unset, both CLIs answer against exactly the deleted walker's pick", () => {
  // The end-to-end half: not "the resolver agrees with the old function" but
  // "the shipped command produces the answer the old function's archDir gives".
  const { conductor, conductorArch, worker, workerArch } = buildCommandTrees();
  const sub = nested(conductor, "src", "features");

  for (const [cwd, expectedArch] of [[conductor, conductorArch], [worker, workerArch], [sub, conductorArch]]) {
    assert.equal(legacyCommandFindArchDir(cwd), expectedArch, `fixture check for ${cwd}`);
    const listed = cliJson(["decisions", "list", "--json"], cwd, envWithout());
    assert.equal(
      listed.total, listDecisions(legacyCommandFindArchDir(cwd)).length,
      `decisions list from ${cwd} moved off the old walker's project`,
    );
  }
  // prd check needs a cwd the PRD is findable from, so it runs at the two roots.
  for (const cwd of [conductor, worker]) {
    const r = cliJson(["prd", "check", "--json"], cwd, envWithout());
    assert.equal(
      r.declaredArchetype, declaredTypeOf(legacyCommandFindArchDir(cwd)),
      `prd check from ${cwd} moved off the old walker's project`,
    );
  }
});

test("COMMANDS: neither module declares a walker any more; both import the one resolver", () => {
  for (const rel of ["src/commands/decisions.mjs", "src/commands/prd.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(src, /import \{ resolveArchDir \} from "\.\.\/lib\/archdir\.mjs";/, `${rel} imports the resolver`);
    assert.match(src, /resolveArchDir\(\{[^}]*requireFile: "SYSTEM\.md"[^}]*\}\)/, `${rel} keeps the SYSTEM.md check`);
  }
});

// ── 8. the guard: a private walker may not come back a third time ────────────
//
// This exists because the class of bug regressed twice: 18 copies collapsed,
// then two survivors, and nothing in the suite would have noticed a nineteenth.
//
// THE RULE is deliberately NAME-BLIND — it never looks at `findArchDir`, so
// renaming the function defeats nothing. A private walker is a SHAPE: code that
// joins ".arch" onto a directory and then steps to that directory's PARENT,
// either round a loop or through a self-recursive call. Every one of the 20
// copies had that shape, and (per the exception list below) nothing else in the
// shipped tree does.

const JOINS_ARCH = /path\.join\(\s*[^)]*["'`]\.arch["'`]/;
const STEPS_UP = /path\.dirname\s*\(/;
const RECURSIVE_STEP = /return\s+[A-Za-z_$][\w$]*\s*\(\s*path\.dirname\s*\(/;

// Files that legitimately match the shape. Each carries its reason, and the
// guard asserts every entry STILL matches — a stale exception fails the suite,
// so the list cannot be padded in advance to pre-authorise a future walker.
const WALKER_EXCEPTIONS = new Map([
  ["src/lib/archdir.mjs", "the ONE resolver — this is the walk every other surface routes through"],
  // NOT a grandfathered survivor — a DECIDED exception, ADR 0032. The reason it
  // may legitimately diverge from the ARCHKIT_ARCH_DIR-named .arch/, in full:
  //
  //   ADR 0031's contract governs which `.arch/` a call READS AND WRITES.
  //   projectClaudeDir neither reads nor writes one. It returns a `.claude/`
  //   path belonging to a Claude Code CHECKOUT, and touches `.arch/` only as one
  //   of two marker files ('.arch' or '.claude') for "is this a project root?".
  //
  //   ARCHKIT_ARCH_DIR promises nothing about its PARENT directory — it names
  //   the .arch dir itself, which need not sit inside a checkout or beside a
  //   .claude/ at all. So following it here would not move the answer to a
  //   different PROJECT, it would move it to a NON-project: a settings.json no
  //   Claude Code session will ever load, which doctor would report on and which
  //   archkit_install_hooks(apply:true) would create and write into — that
  //   function takes its write target straight from status.projectSettingsPath.
  //
  //   And the question D-HOOKS asks is "will the guardrails fire FOR ME?", whose
  //   answer is fixed by the checkout the session is in, not by the spec dir the
  //   caller named. A worktree worker pointed at the conductor's .arch/ shares
  //   the conductor's STATE (board, goals, locks); it does not inherit the
  //   conductor's hook CONFIG.
  //
  // §9 below pins that divergence as intended: those tests fail if anyone routes
  // projectClaudeDir through the resolver, so this entry cannot rot into cover.
  ["src/lib/hooks-status.mjs", "projectClaudeDir: resolves a .claude/ dir for the CHECKOUT (cwd), using .arch/ only as a project-root marker; never returns an archDir and deliberately ignores ARCHKIT_ARCH_DIR per ADR 0032 — see §9"],
  ["scripts/test.mjs", "sandbox safety assertion: refuses to run if the temp sandbox sits UNDER a real project — a filesystem check, not a resolution"],
]);

// Every loop block in `source`, as text, by brace balance from the loop header.
function loopBodies(source) {
  const lines = source.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\b(?:while|for)\s*\(/.test(lines[i])) continue;
    let depth = 0, opened = false;
    const body = [];
    for (let j = i; j < lines.length && j - i <= 80; j++) {
      body.push(lines[j]);
      for (const ch of lines[j]) {
        if (ch === "{") { depth++; opened = true; }
        else if (ch === "}") depth--;
      }
      if (opened && depth <= 0) break;
    }
    out.push({ line: i + 1, text: body.join("\n") });
  }
  return out;
}

function privateArchWalkers(source) {
  const hits = [];
  for (const loop of loopBodies(source)) {
    if (JOINS_ARCH.test(loop.text) && STEPS_UP.test(loop.text)) hits.push({ line: loop.line, kind: "loop" });
  }
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!RECURSIVE_STEP.test(lines[i])) continue;
    const window = lines.slice(Math.max(0, i - 12), i + 13).join("\n");
    if (JOINS_ARCH.test(window)) hits.push({ line: i + 1, kind: "recursion" });
  }
  return hits.sort((a, b) => a.line - b.line);
}

function scanSources(entries) {
  const violations = [];
  for (const { rel, source } of entries) {
    if (WALKER_EXCEPTIONS.has(rel)) continue;
    for (const hit of privateArchWalkers(source)) violations.push(`${rel}:${hit.line} (${hit.kind})`);
  }
  return violations;
}

// The shipped tree: src/, bin/, scripts/. tests/ is excluded on purpose — this
// very file reproduces the deleted walkers verbatim so back-compat can be
// diffed, and the fixtures below are walkers by construction.
function shippedSources() {
  const out = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(mjs|cjs|js)$/.test(entry.name)) out.push({ rel: path.relative(ROOT, p), source: fs.readFileSync(p, "utf8") });
    }
  };
  for (const dir of ["src", "bin", "scripts"]) walk(path.join(ROOT, dir));
  return out;
}

// The walker this change deleted, as source, for the reintroduction controls.
const DELETED_WALKER = `
function findArchDir(start) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, ".arch");
    if (fs.existsSync(path.join(candidate, "SYSTEM.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
`;

test("GUARD: the shipped tree declares no private archDir walker outside the one resolver", () => {
  const entries = shippedSources();
  // The scan is not vacuous: it really did read the two files this change fixed.
  assert.ok(entries.length > 50, `only ${entries.length} shipped files scanned`);
  for (const rel of ["src/commands/decisions.mjs", "src/commands/prd.mjs", "src/lib/archdir.mjs"]) {
    assert.ok(entries.some((e) => e.rel === rel), `${rel} was not scanned`);
  }
  assert.deepEqual(scanSources(entries), []);
});

test("GUARD: it catches the walker being reintroduced into a command module", () => {
  // The positive control for the test above: put the deleted function back into
  // the real file's real source and the guard must name it.
  const source = fs.readFileSync(path.join(ROOT, "src/commands/decisions.mjs"), "utf8") + DELETED_WALKER;
  const violations = scanSources([{ rel: "src/commands/decisions.mjs", source }]);
  assert.equal(violations.length, 1, `expected exactly one violation, got ${JSON.stringify(violations)}`);
  assert.match(violations[0], /^src\/commands\/decisions\.mjs:\d+ \(loop\)$/);
});

test("GUARD: renaming the function, or changing the loop, defeats nothing", () => {
  const variants = {
    "renamed": DELETED_WALKER.replace("findArchDir", "locateProjectContext"),
    "for(;;) instead of while(true)": DELETED_WALKER.replace("while (true)", "for (;;)"),
    "arrow assigned to a const": `
const resolveIt = (start) => {
  let dir = start;
  for (;;) {
    const c = path.join(dir, ".arch");
    if (fs.existsSync(c)) return c;
    if (path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
};`,
    "recursive, no loop at all": `
function up(dir) {
  const candidate = path.join(dir, ".arch");
  if (fs.existsSync(candidate)) return candidate;
  const parent = path.dirname(dir);
  if (parent === dir) return null;
  return up(path.dirname(dir));
}`,
    "an object method": `
const helpers = {
  find(start) {
    let dir = start;
    while (dir) {
      const candidate = path.join(dir, ".arch", "SYSTEM.md");
      if (fs.existsSync(candidate)) return path.dirname(candidate);
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  },
};`,
  };
  for (const [label, source] of Object.entries(variants)) {
    assert.ok(privateArchWalkers(source).length > 0, `the guard missed: ${label}`);
  }
});

test("GUARD: legitimate walk-ups and .arch reads are NOT flagged", () => {
  const benign = {
    "a walk-up for something else entirely": `
function repoRoot(start) {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}`,
    "iterating .arch subpaths without walking up": `
for (const name of ["goals", "board", "decisions"]) {
  const p = path.join(archDir, ".arch", name);
  if (fs.existsSync(p)) out.push(p);
}`,
    "a caller that uses the one resolver": `
import { resolveArchDir } from "../lib/archdir.mjs";
const archDir = resolveArchDir({ requireFile: "SYSTEM.md" });
const decisions = path.join(archDir, "decisions");`,
    "path.dirname used far away from an .arch join": `
const archDir = path.join(root, ".arch");
${"// filler\n".repeat(20)}
const parent = path.dirname(somewhereElse);`,
  };
  for (const [label, source] of Object.entries(benign)) {
    assert.deepEqual(privateArchWalkers(source), [], `false positive on: ${label}`);
  }
});

test("GUARD: every exception still matches the rule — the list cannot be padded in advance", () => {
  for (const [rel, reason] of WALKER_EXCEPTIONS) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(
      privateArchWalkers(source).length > 0,
      `${rel} no longer matches the walker shape — drop it from WALKER_EXCEPTIONS (${reason})`,
    );
  }
});

// ── 9. the DECIDED exception: hooks-status stays cwd-scoped (ADR 0032) ───────
//
// src/lib/hooks-status.mjs `projectClaudeDir` matches the walker shape above and
// is allowlisted in WALKER_EXCEPTIONS. ADR 0032 settles that this is CORRECT
// rather than a survivor: ADR 0031's contract governs which `.arch/` a call
// reads and writes, and this function returns a `.claude/` belonging to a
// CHECKOUT, using `.arch/` only as a project-root marker.
//
// These tests exist so the exception cannot rot into cover. They FAIL if anyone
// routes projectClaudeDir through the resolver or teaches it to read
// ARCHKIT_ARCH_DIR — the divergence is pinned as INTENDED, not accidental.

// The projectClaudeDir body EXACTLY as it stood before ADR 0032 (which changed
// comments only). Reproduced verbatim, like the legacy walkers in §2, so the
// back-compat claim is DIFFED rather than asserted by eye — and so any future
// edit to the shipped one shows up here as a divergence instead of silently.
function preAdr0032ProjectClaudeDir(cwd) {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".arch")) || fs.existsSync(path.join(dir, ".claude"))) {
      return path.join(dir, ".claude");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(cwd, ".claude");
}

function claudeDir(dir) {
  const p = path.join(dir, ".claude");
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function writeWiredSettings(dir) {
  fs.writeFileSync(path.join(claudeDir(dir), "settings.json"), JSON.stringify(renderGuardrailHooks(), null, 2) + "\n");
}

// Same shape as §4/§7: a REAL worktree with a REAL post-cut divergence. Here the
// divergence is deliberately TWO-SIDED — the conductor gains a goal (archDir
// state, which ARCHKIT_ARCH_DIR SHOULD move) and gains the guardrail hooks
// (checkout config, which it should NOT). One fixture, both halves.
function buildHooksWorktreePair() {
  const base = tempDir("hooks-wt");
  const conductor = path.join(base, "conductor");
  fs.mkdirSync(conductor, { recursive: true });

  git(["init", "-q", "-b", "main", "."], conductor);
  git(["config", "user.email", "test@archkit.invalid"], conductor);
  git(["config", "user.name", "archkit test"], conductor);

  const conductorArch = project(conductor);
  writeGoal(conductorArch, { slug: "shared-goal", title: "in both trees", exitCriteria: ["x"] });
  git(["add", "-A"], conductor);
  git(["commit", "-qm", "init"], conductor); // NOTE: no .claude/ committed…

  const worker = path.join(base, "worker");
  git(["worktree", "add", "-q", worker, "-b", "cgr/lane-hooks"], conductor);

  // …so the worktree has NO .claude/ at all, while the conductor is fully wired.
  writeWiredSettings(conductor);
  writeGoal(conductorArch, { slug: "conductor-only", title: "minted after the cut", exitCriteria: ["x"] });

  // An isolated HOME so neither the real ~/.claude/settings.json nor a real
  // enabledPlugins entry can decide the answer for us.
  const home = path.join(base, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });

  return { base, conductor, conductorArch, worker, home };
}

// Run a callback with ARCHKIT_ARCH_DIR forced to `value` (null = definitively
// unset), restoring whatever the runner had afterwards.
function withArchDirEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, ARCH_DIR_ENV);
  const prev = process.env[ARCH_DIR_ENV];
  if (value === null) delete process.env[ARCH_DIR_ENV];
  else process.env[ARCH_DIR_ENV] = value;
  try { return fn(); }
  finally {
    if (had) process.env[ARCH_DIR_ENV] = prev;
    else delete process.env[ARCH_DIR_ENV];
  }
}

test("HOOKS-STATUS: the fixture diverges on BOTH axes — goals and hook wiring", () => {
  const { conductor, conductorArch, worker } = buildHooksWorktreePair();
  assert.ok(fs.existsSync(path.join(worker, ".arch", "SYSTEM.md")), "the worktree has its OWN tracked .arch/");
  assert.ok(fs.existsSync(path.join(conductorArch, "goals", "queue", "conductor-only.md")));
  assert.equal(fs.existsSync(path.join(worker, ".arch", "goals", "queue", "conductor-only.md")), false);
  assert.ok(fs.existsSync(path.join(conductor, ".claude", "settings.json")), "the conductor is fully wired");
  assert.equal(fs.existsSync(path.join(worker, ".claude")), false, "…and the worktree has no .claude/ at all");
});

test("HOOKS-STATUS: ARCHKIT_ARCH_DIR does not move projectClaudeDir (ADR 0032)", () => {
  const { conductorArch, worker } = buildHooksWorktreePair();
  const deep = nested(worker, "src", "features", "auth");
  const expected = path.join(worker, ".claude");

  const unset = withArchDirEnv(null, () => [projectClaudeDir(worker), projectClaudeDir(deep)]);
  const set = withArchDirEnv(conductorArch, () => [projectClaudeDir(worker), projectClaudeDir(deep)]);

  assert.deepEqual(unset, [expected, expected], "control: the cwd answer");
  assert.deepEqual(
    set, [expected, expected],
    "the explicit signal is INERT here — it names a spec dir, and this resolves a checkout's .claude/",
  );
  // The variable is not being ignored globally: it really would move an archDir
  // resolution from the same cwd. That is the divergence, side by side.
  assert.equal(resolveArchDir({ cwd: deep, requireFile: "SYSTEM.md", env: { [ARCH_DIR_ENV]: conductorArch } }), conductorArch);
  assert.notEqual(path.dirname(conductorArch), worker, "…and it points at a genuinely different tree");
});

test("HOOKS-STATUS: gatherHooksStatus answers about the CHECKOUT even with the variable set", () => {
  const { conductor, conductorArch, worker, home } = buildHooksWorktreePair();

  const fromWorker = withArchDirEnv(conductorArch, () => gatherHooksStatus(worker, { home }));
  assert.equal(
    fromWorker.projectSettingsPath, path.join(worker, ".claude", "settings.json"),
    "the worktree's own settings.json — NOT the one beside the named .arch/",
  );
  assert.equal(fromWorker.installed, false, "the worktree is genuinely unwired, and that is what it reports");
  assert.deepEqual(fromWorker.missing.sort(), [...ARCHKIT_GUARDRAIL_HOOKS.map((h) => h.event)].sort());

  // Control: the conductor really IS wired, so the assertion above is a genuine
  // difference and not both trees happening to be empty.
  const fromConductor = withArchDirEnv(null, () => gatherHooksStatus(conductor, { home }));
  assert.equal(fromConductor.installed, true);
  assert.equal(fromConductor.via, "settings");
  assert.notEqual(fromWorker.projectSettingsPath, fromConductor.projectSettingsPath);
});

test("HOOKS-STATUS: a named .arch/ need not have a checkout around it at all", () => {
  // The decisive case (ADR 0032 reason 1): ARCHKIT_ARCH_DIR promises nothing
  // about its PARENT. Following it would not relocate the answer to a different
  // PROJECT — it would relocate it to a NON-project.
  const specRoot = tempDir("spec-only");
  const specArch = project(specRoot); // a bare spec dir; no .claude/, no checkout

  const checkout = tempDir("real-checkout");
  project(checkout);
  writeWiredSettings(checkout);
  const home = nested(tempDir("spec-home"), "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });

  const status = withArchDirEnv(specArch, () => gatherHooksStatus(checkout, { home }));
  assert.equal(status.projectSettingsPath, path.join(checkout, ".claude", "settings.json"));
  assert.equal(status.installed, true, "it read the settings.json that will actually fire");

  // What a contract-following projectClaudeDir would have produced instead:
  const phantom = path.join(path.dirname(specArch), ".claude", "settings.json");
  assert.equal(fs.existsSync(phantom), false, "a settings.json no Claude Code session would ever load…");
  assert.notEqual(status.projectSettingsPath, phantom, "…and archkit_install_hooks(apply) would have CREATED it");
});

test("HOOKS-STATUS: install's write target IS status.projectSettingsPath, so the pin covers the write", () => {
  // Not only a reporting path: runHooksInstallJson takes its write target
  // straight off the payload asserted above, so pinning the path pins the write.
  const src = fs.readFileSync(path.join(ROOT, "src/commands/hooks.mjs"), "utf8");
  assert.match(src, /const settingsPath = status\.projectSettingsPath;/);
  assert.match(src, /writeClaudeSettings\(settingsPath, settings\)/);
  assert.match(src, /const projectDir = path\.dirname\(path\.dirname\(settingsPath\)\);/);
});

test("HOOKS-STATUS: the module never imports the resolver and never reads the env (ADR 0032)", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/hooks-status.mjs"), "utf8");
  assert.equal(
    /from\s+["'][^"']*archdir\.mjs["']/.test(src), false,
    "routing projectClaudeDir through the resolver is a behaviour change that SUPERSEDES ADR 0032 — write that ADR first",
  );
  assert.equal(
    /process\.env/.test(src), false,
    "the only env this module could plausibly grow is ARCHKIT_ARCH_DIR, which ADR 0032 says it must not read",
  );
  // …and the decision is discoverable AT the definition site, not only in the ADR.
  const defSite = src.slice(0, src.indexOf("export function projectClaudeDir"));
  assert.match(defSite, /ADR 0032/, "the definition site cites the decision");
  assert.match(defSite, /ARCHKIT_ARCH_DIR/, "…and names the variable it deliberately ignores");
});

test("HOOKS-STATUS: the decision is written down durably in .arch/decisions/", () => {
  // Number-blind on purpose: an ADR renumbered during integration still passes.
  const dir = path.join(ROOT, ".arch", "decisions");
  const hit = fs.readdirSync(dir).find((f) => /^\d{4}-hooks-status-is-cwd-scoped/.test(f));
  assert.ok(hit, "no ADR settling the hooks-status / ARCHKIT_ARCH_DIR scope question");
  const body = fs.readFileSync(path.join(dir, hit), "utf8");
  for (const needle of ["projectClaudeDir", "ARCHKIT_ARCH_DIR", "## Decision", "## Consequences"]) {
    assert.ok(body.includes(needle), `${hit} does not mention ${needle}`);
  }
});

test("BACK-COMPAT: projectClaudeDir is byte-identical to the pre-decision walker, set OR unset", () => {
  const { conductorArch, worker } = buildHooksWorktreePair();

  const both = tempDir("pcd-both");                 // .arch/ AND .claude/
  project(both); claudeDir(both);
  const archOnly = tempDir("pcd-arch"); project(archOnly);
  const claudeOnly = tempDir("pcd-claude"); claudeDir(claudeOnly);
  const neither = tempDir("pcd-none");

  const cases = [
    both,
    nested(both, "src"),
    nested(both, "src", "features", "auth"),
    nested(both, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"), // past the 10-parent bound
    archOnly,
    nested(archOnly, "src"),
    claudeOnly,
    nested(claudeOnly, "src", "x"),
    neither,
    nested(neither, "a", "b"),
    worker,                                          // the worktree root…
    nested(worker, "src", "features"),               // …and inside it
  ];

  for (const cwd of cases) {
    const legacy = preAdr0032ProjectClaudeDir(cwd);
    assert.equal(withArchDirEnv(null, () => projectClaudeDir(cwd)), legacy, `unset diverged at ${cwd}`);
    assert.equal(withArchDirEnv(conductorArch, () => projectClaudeDir(cwd)), legacy, `set diverged at ${cwd}`);
  }

  // The matrix is not vacuous: it contains a real walk-UP, a real cwd FALLBACK,
  // and both marker files exercised on their own.
  assert.equal(preAdr0032ProjectClaudeDir(nested(both, "src", "features", "auth")), path.join(both, ".claude"),
    "walk-up case really walks up");
  assert.equal(preAdr0032ProjectClaudeDir(nested(both, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l")),
    path.join(both, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", ".claude"),
    "past 10 parents it still gives up and returns cwd/.claude — unchanged, 10-parent bound and all");
  assert.equal(preAdr0032ProjectClaudeDir(nested(archOnly, "src")), path.join(archOnly, ".claude"),
    ".arch alone is a root marker");
  assert.equal(preAdr0032ProjectClaudeDir(nested(claudeOnly, "src", "x")), path.join(claudeOnly, ".claude"),
    ".claude alone is a root marker");
  assert.equal(preAdr0032ProjectClaudeDir(neither), path.join(neither, ".claude"), "no marker → cwd/.claude");
  assert.equal(new Set(cases.map(preAdr0032ProjectClaudeDir)).size > 1, true, "…and the answers are not all the same path");
});

test("HOOKS-STATUS: the real CLI — one `archkit doctor` run, goals MOVE and hooks DO NOT", () => {
  // The end-to-end half. Same command, same cwd, one variable flipped: the
  // archDir-backed check follows it, D-HOOKS does not. If someone "fixes"
  // projectClaudeDir, D-HOOKS flips to pass here and this goes red.
  const { conductor, conductorArch, worker, home } = buildHooksWorktreePair();

  const doctorJson = (cwd, env) => {
    const r = spawnSync(process.execPath, [CLI, "doctor", "--json"], { cwd, env, encoding: "utf8" });
    assert.ok(r.stdout.trim(), `archkit doctor produced no stdout in ${cwd}: ${r.stderr}`);
    return JSON.parse(r.stdout); // exit code is the doctor VERDICT, not a spawn failure
  };
  const hooksCheck = (j) => j.checks.find((c) => c.id === "D-HOOKS");

  const unset = doctorJson(worker, envWithout({ HOME: home }));
  const set = doctorJson(worker, envWithout({ HOME: home, [ARCH_DIR_ENV]: conductorArch }));
  const control = doctorJson(conductor, envWithout({ HOME: home }));

  // The archDir-backed half MOVES with the variable — proving it reached the CLI.
  assert.equal(unset.summary.goalsTotal, 1, "the worktree's own stale goal tree");
  assert.equal(set.summary.goalsTotal, 2, "…and with the variable set, the conductor's");

  // The hooks half does NOT move — same warn, same count, both runs.
  assert.equal(hooksCheck(unset).status, "warn");
  assert.equal(hooksCheck(set).status, "warn", "D-HOOKS still describes the checkout the command ran in");
  assert.equal(hooksCheck(set).detail, hooksCheck(unset).detail, "byte-identical: the variable is inert for hooks");
  assert.match(hooksCheck(set).detail, /6\/6 guardrail hook\(s\) not wired/);

  // Control: the conductor's tree really does report PASS, so "warn" above is a
  // genuine difference rather than doctor being unable to see hooks at all.
  assert.equal(hooksCheck(control).status, "pass");
  assert.equal(control.summary.goalsTotal, 2);
});

// ── done ─────────────────────────────────────────────────────────────────────

cleanup();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
