#!/usr/bin/env node
// tests/doctor-hooks-path — `archkit doctor` must name the settings.json that
// D-HOOKS actually read, and must SAY SO when that file belongs to a different
// project than the rest of the report.
//
// THE BUG THIS PINS. ADR 0032 settles that `projectClaudeDir` is deliberately
// cwd-scoped: ARCHKIT_ARCH_DIR names a SPEC directory and promises nothing
// about its parent, so hook wiring is resolved from the checkout the command
// ran in, not from the named `.arch/`. The accepted cost, written into that
// ADR's Consequences as an explicit follow-up, is that `archkit doctor` run in
// a worktree with the variable set becomes a CHIMERA: D-INTENT-* describes the
// goals in the named `.arch/` while D-HOOKS describes the settings.json of the
// checkout — in one report, with nothing saying so. A reader who saw
// "2/6 guardrail hook(s) not wired" beside the conductor's goal list would
// reasonably go and edit the CONDUCTOR's settings.json, which is the wrong
// file, in the wrong repository, and would not fix anything.
//
// Every path involved was already in the JSON payload, so the cure is
// disclosure in the human-readable output, not forced alignment. This suite is
// that disclosure's pin. It fails if the settings path is dropped from the
// D-HOOKS detail, and it fails if the divergence notice is dropped — both as
// exact-string comparisons, so a paraphrase that loses the load-bearing part
// cannot slip through.
//
// It also pins the OTHER half, which is easy to lose by accident: when the two
// roots AGREE the output must not get noisier. Two runs over ONE fixture, the
// variable the only difference, are compared check-by-check: every row other
// than D-HOOKS must be byte-identical, the warning count must be equal, and the
// agreeing D-HOOKS detail must carry none of the divergence prose.
//
// Everything here runs the REAL CLI end-to-end (`node bin/archkit.mjs doctor`)
// against mkdtemp'd fixtures with an explicit cwd and an isolated HOME — the
// failure mode being guarded is a silently wrong answer in real output, which a
// unit stub cannot see. The live .arch/ is never touched.
//
// Usage:
//   node tests/doctor-hooks-path/run.mjs

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { renderGuardrailHooks, ARCHKIT_GUARDRAIL_HOOKS } from "../../src/lib/claude-settings.mjs";
import { ARCH_DIR_ENV } from "../../src/lib/archdir.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLI = path.join(ROOT, "bin", "archkit.mjs");

const ALL_HOOKS = ARCHKIT_GUARDRAIL_HOOKS.map(h => h.event);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[90m${err.stack || err.message}\x1b[0m`); failed++; }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const temps = [];
function tempDir(tag) {
  // realpathSync: macOS's tmpdir is itself a symlink, and the CLI reports real
  // paths, so a raw mkdtemp path would mismatch every path assertion below.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `archkit-dhooks-${tag}-`));
  temps.push(dir);
  return dir;
}
function cleanup() {
  for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// A complete, doctor-clean `.arch/`. Content only — no absolute paths — so two
// of these in different directories produce identical output for every check
// that reads the archDir rather than the cwd.
function writeArch(root) {
  const arch = path.join(root, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(arch, "goals"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Type: SaaS\n## Stack: Node.js\n## Pattern: Layered\n\n" +
    "## Rules\n- Layered\n\n## Reserved Words\n$db = database\n\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"),
    "## Nodes\n@auth = [auth] → src/features/auth/\n\n## Keywords\n");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n  [login]\n");
  fs.writeFileSync(path.join(arch, "skills", "stripe.skill"),
    "# stripe\n\n## Use\nReal usage notes.\n\n## Patterns\nimport Stripe from 'stripe'.\n\n" +
    "## Gotchas\nWRONG: req.body\nRIGHT: req.rawBody\nWHY: parses JSON\n\n" +
    "## Boundaries\nN/A\n\n## Snippets\nconst s = new Stripe(key)\n\n## Meta\nupdated: 2026-05-25\n");
  fs.writeFileSync(path.join(arch, "BOUNDARIES.md"), "- BAN: src/copilot/* -> src/execution/*\n");
  return arch;
}

// The source tree the cwd-scoped checks (drift basePaths, BAN globs) scan.
function writeSources(root) {
  for (const rel of [
    ["src", "features", "auth", "index.js"],
    ["src", "copilot", "a.js"],
    ["src", "execution", "b.js"],
  ]) {
    const file = path.join(root, ...rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "export const x = 1;\n");
  }
}

function wireHooks(root) {
  const dir = path.join(root, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(renderGuardrailHooks(), null, 2) + "\n");
  return path.join(dir, "settings.json");
}

// An isolated HOME so neither the developer's real ~/.claude/settings.json nor
// a real enabledPlugins entry can decide the verdict for us.
function isolatedHome({ enabledPlugins = null } = {}) {
  const home = tempDir("home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  if (enabledPlugins) {
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins }, null, 2));
  }
  return home;
}

// THE fixture: two structurally identical projects side by side. `checkout` has
// the source tree and (optionally) the hook wiring; `specs` is the `.arch/` a
// caller can name with ARCHKIT_ARCH_DIR. Because the two `.arch/` directories
// hold identical CONTENT, every check except D-HOOKS must answer identically
// whichever one is resolved — which is what makes the "did the agreeing case
// get noisier?" comparison below a real measurement rather than a vibe.
function twinProjects({ wired = true } = {}) {
  const base = tempDir("twin");
  const checkout = path.join(base, "checkout");
  const specs = path.join(base, "specs");
  fs.mkdirSync(checkout, { recursive: true });
  fs.mkdirSync(specs, { recursive: true });
  const checkoutArch = writeArch(checkout);
  const specsArch = writeArch(specs);
  writeSources(checkout);
  const settingsPath = wired ? wireHooks(checkout) : path.join(checkout, ".claude", "settings.json");
  return { base, checkout, checkoutArch, specs, specsArch, settingsPath };
}

// ── running the real CLI ─────────────────────────────────────────────────────

function env({ home, archDir = null }) {
  const e = { ...process.env };
  delete e[ARCH_DIR_ENV];       // never inherit the runner's
  e.HOME = home;
  e.USERPROFILE = home;
  if (archDir) e[ARCH_DIR_ENV] = archDir;
  return e;
}

function doctorJson(cwd, opts) {
  const r = spawnSync(process.execPath, [CLI, "doctor", "--json"], {
    cwd, env: env(opts), encoding: "utf8", timeout: 30000,
  });
  assert.ok(r.stdout && r.stdout.trim(), `archkit doctor --json produced no stdout in ${cwd}: ${r.stderr}`);
  return JSON.parse(r.stdout); // exit code is the doctor VERDICT, not a spawn failure
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function doctorPretty(cwd, opts) {
  const r = spawnSync(process.execPath, [CLI, "doctor"], {
    cwd, env: env(opts), encoding: "utf8", timeout: 30000,
  });
  assert.ok(r.stdout && r.stdout.trim(), `archkit doctor produced no stdout in ${cwd}: ${r.stderr}`);
  return stripAnsi(r.stdout);
}

const hooksCheck = (j) => j.checks.find(c => c.id === "D-HOOKS");

// The exact detail string, assembled from the fixture's own paths. Building the
// expectation rather than hardcoding it keeps the assertions readable; the
// EQUALITY is what pins the behaviour.
const AGREE_LABEL = ".claude/settings.json";
function divergenceNote({ checkout, archDir, viaEnv }) {
  return ` NOTE: that is the checkout this command ran in (${checkout}) — every other check above describes ${archDir}` +
    `${viaEnv ? `, named by ${ARCH_DIR_ENV}` : ""}, a DIFFERENT project. Hook wiring belongs to a checkout and does not` +
    ` follow the .arch/ location (ADR 0032), so fix hooks in the settings.json named here, not in the other tree.`;
}

// Words that only ever belong to the divergent case. Criterion 3 is that none
// of them reaches the agreeing output.
const DIVERGENCE_VOCAB = ["NOTE:", "DIFFERENT project", "ADR 0032", "the other tree", "checkout this command ran in"];

console.log("\n  ┌─────────────────────────────────────────────┐");
console.log("  │        DOCTOR — D-HOOKS PATH DISCLOSURE     │");
console.log("  └─────────────────────────────────────────────┘\n");

// ── 1. the agreeing case names the file, and says nothing more ───────────────

test("AGREE/pass: D-HOOKS names the settings.json it read, relative, one line", () => {
  const fx = twinProjects({ wired: true });
  const j = doctorJson(fx.checkout, { home: isolatedHome() });
  const c = hooksCheck(j);

  assert.equal(c.status, "pass", JSON.stringify(c));
  assert.equal(c.detail, `All guardrail hooks wired. Project settings: ${AGREE_LABEL}.`);

  // The disclosure earns its space only when load-bearing: none of it here.
  for (const word of DIVERGENCE_VOCAB) {
    assert.equal(c.detail.includes(word), false, `agreeing detail leaked "${word}": ${c.detail}`);
  }
  assert.equal(c.detail.includes("\n"), false, "still ONE detail line");
  assert.equal(/(^|[\s(])\//.test(c.detail), false, `no absolute path in the agreeing case: ${c.detail}`);
  assert.equal(c.detail.includes(fx.checkout), false, "…and specifically not the project root");

  // The payload agrees with the prose.
  assert.equal(j.hooks.projectSettingsPath, fx.settingsPath);
  assert.equal(j.hooks.divergedFromArchDir, false);
  assert.equal(j.hooks.projectRoot, j.hooks.archProjectRoot);
});

test("AGREE/warn: the unwired case names the file too, and its warning is unchanged", () => {
  const fx = twinProjects({ wired: false });
  const j = doctorJson(fx.checkout, { home: isolatedHome() });
  const c = hooksCheck(j);

  assert.equal(c.status, "warn", JSON.stringify(c));
  assert.equal(
    c.detail,
    `${ALL_HOOKS.length}/${ALL_HOOKS.length} guardrail hook(s) not wired: ${ALL_HOOKS.join(", ")}. Project settings: ${AGREE_LABEL}.`,
  );
  for (const word of DIVERGENCE_VOCAB) assert.equal(c.detail.includes(word), false, `leaked "${word}"`);

  // The [hooks] warning is byte-identical to the pre-disclosure text: in the
  // agreeing case the label it now interpolates IS ".claude/settings.json".
  const w = j.warnings.find(s => s.startsWith("[hooks]"));
  assert.ok(w, JSON.stringify(j.warnings));
  assert.equal(
    w,
    `[hooks] ${ALL_HOOKS.length} guardrail hook(s) not installed (${ALL_HOOKS.join(", ")}) — the SessionStart digest, ` +
    `CGR Stop-guard, and review-on-edit won't fire. Call archkit_install_hooks to wire the full set into .claude/settings.json.`,
  );
});

test("AGREE/plugin: the plugin branch names the project settings it read", () => {
  const fx = twinProjects({ wired: false });
  const home = isolatedHome({ enabledPlugins: { "archkit@archkit-marketplace": true } });
  const j = doctorJson(fx.checkout, { home });
  const c = hooksCheck(j);

  assert.equal(c.status, "pass", JSON.stringify(c));
  assert.equal(c.detail, `Provided by the enabled archkit plugin. Project settings: ${AGREE_LABEL}.`);
  assert.equal(j.hooks.via, "plugin");
  assert.equal(j.hooks.divergedFromArchDir, false);
});

// ── 2. the divergent case — the one ADR 0032 accepts, so the one to disclose ─

test("DIVERGE/warn: the detail names the ABSOLUTE settings.json and says the report is chimeric", () => {
  const fx = twinProjects({ wired: false });
  const j = doctorJson(fx.checkout, { home: isolatedHome(), archDir: fx.specsArch });
  const c = hooksCheck(j);

  assert.equal(c.status, "warn", JSON.stringify(c));
  assert.equal(
    c.detail,
    `${ALL_HOOKS.length}/${ALL_HOOKS.length} guardrail hook(s) not wired: ${ALL_HOOKS.join(", ")}.` +
    ` Project settings: ${fx.settingsPath}.` +
    divergenceNote({ checkout: fx.checkout, archDir: fx.specsArch, viaEnv: true }),
  );

  // The two facts a reader must not have to infer, asserted individually so a
  // partial regression names itself.
  assert.ok(c.detail.includes(fx.settingsPath), "the settings.json D-HOOKS actually read");
  assert.ok(c.detail.includes(fx.specsArch), "the .arch/ every other check describes");
  assert.ok(c.detail.includes("DIFFERENT project"), "…and that they are not the same project");
  assert.ok(c.detail.includes(ARCH_DIR_ENV), "…and what moved them apart");

  // The fix instruction must point at the checkout, not at the named tree —
  // this is the sentence that used to send a reader to the wrong repository.
  const w = j.warnings.find(s => s.startsWith("[hooks]"));
  assert.ok(w.endsWith(`wire the full set into ${fx.settingsPath}.`), w);
  assert.equal(w.includes(fx.specs + path.sep), false, "the install target is never the named spec tree");

  assert.equal(j.hooks.divergedFromArchDir, true);
  assert.equal(j.hooks.projectRoot, fx.checkout);
  assert.equal(j.hooks.archProjectRoot, fx.specs);
});

test("DIVERGE/pass: a WIRED checkout beside a named .arch/ is disclosed just the same", () => {
  // The nastier half: everything is green, so nothing else in the report hints
  // that two projects are being described at once.
  const fx = twinProjects({ wired: true });
  const j = doctorJson(fx.checkout, { home: isolatedHome(), archDir: fx.specsArch });
  const c = hooksCheck(j);

  assert.equal(c.status, "pass", JSON.stringify(c));
  assert.equal(
    c.detail,
    `All guardrail hooks wired. Project settings: ${fx.settingsPath}.` +
    divergenceNote({ checkout: fx.checkout, archDir: fx.specsArch, viaEnv: true }),
  );
  assert.equal(j.pass, true, "the divergence is disclosed, NOT escalated to a failure");
  assert.equal(j.hooks.divergedFromArchDir, true);
});

test("DIVERGE without the variable: a nested cwd diverges too, and is not blamed on the env", () => {
  // ARCHKIT_ARCH_DIR is not the only way the two roots part company: a cwd with
  // its own .claude/ below the .arch/ does it as well. Naming the variable then
  // would send the reader hunting for an export that was never made.
  const fx = twinProjects({ wired: true });
  const sub = path.join(fx.checkout, "packages", "web");
  fs.mkdirSync(path.join(sub, ".claude"), { recursive: true });

  const j = doctorJson(sub, { home: isolatedHome() });
  const c = hooksCheck(j);

  assert.equal(j.hooks.divergedFromArchDir, true);
  assert.equal(j.hooks.projectRoot, sub);
  assert.equal(j.hooks.archProjectRoot, fx.checkout);
  assert.ok(c.detail.includes("DIFFERENT project"), c.detail);
  assert.ok(c.detail.includes(path.join(sub, ".claude", "settings.json")), c.detail);
  assert.equal(c.detail.includes(ARCH_DIR_ENV), false, `must not blame an unset variable: ${c.detail}`);
});

// ── 3. criterion 3, measured: the agreeing case is not made noisier ──────────

test("ONE fixture, variable flipped: every row but D-HOOKS is byte-identical", () => {
  const fx = twinProjects({ wired: true });
  const home = isolatedHome();
  const agree = doctorJson(fx.checkout, { home });
  const diverge = doctorJson(fx.checkout, { home, archDir: fx.specsArch });

  assert.equal(agree.checks.length, diverge.checks.length, "no extra row appears");
  assert.equal(agree.warnings.length, diverge.warnings.length, "no extra warning appears");
  assert.equal(agree.summary.passing, diverge.summary.passing);
  assert.equal(agree.nextStep, diverge.nextStep);

  for (const a of agree.checks) {
    if (a.id === "D-HOOKS") continue;
    const d = diverge.checks.find(c => c.id === a.id);
    assert.deepEqual(d, a, `${a.id} differs between the two runs — the fixture is no longer a controlled comparison`);
  }

  // The whole cost of the disclosure, isolated: one appended sentence and an
  // absolute path in place of a relative one.
  const agreeDetail = hooksCheck(agree).detail;
  const divergeDetail = hooksCheck(diverge).detail;
  assert.notEqual(agreeDetail, divergeDetail, "the divergence IS disclosed");
  assert.equal(
    divergeDetail,
    agreeDetail.replace(`: ${AGREE_LABEL}.`, `: ${fx.settingsPath}.`) +
      divergenceNote({ checkout: fx.checkout, archDir: fx.specsArch, viaEnv: true }),
    "the divergent detail is the agreeing one plus the note — nothing else changed",
  );
  assert.ok(agreeDetail.length < divergeDetail.length);
});

// ── 4. the human-readable surface, which is the whole point ─────────────────

test("terminal output (no --json) carries the path in both cases and the notice in one", () => {
  const fx = twinProjects({ wired: true });
  const home = isolatedHome();
  const agree = doctorPretty(fx.checkout, { home });
  const diverge = doctorPretty(fx.checkout, { home, archDir: fx.specsArch });

  // Criterion 1: readable without dropping to --json.
  assert.ok(agree.includes(`Project settings: ${AGREE_LABEL}.`), agree);
  assert.ok(diverge.includes(`Project settings: ${fx.settingsPath}.`), diverge);

  // Criterion 2: the divergence is stated, not left to be noticed.
  assert.ok(diverge.includes("DIFFERENT project"), diverge);
  assert.ok(diverge.includes(fx.specsArch), diverge);

  // Criterion 3: none of that reaches the agreeing render.
  for (const word of DIVERGENCE_VOCAB) {
    assert.equal(agree.includes(word), false, `agreeing terminal output leaked "${word}"`);
  }
  assert.equal(agree.includes(fx.specs), false, "the agreeing render names no second tree");
});

// ── 5. no FALSE divergence ──────────────────────────────────────────────────

test("a symlinked route to the SAME project is not reported as a divergence", () => {
  // A false "these are two different projects" notice would be worse than none:
  // it trains the reader to ignore the true one. /var -> /private/var on macOS
  // and symlinked checkouts make this a live case, not a hypothetical.
  const fx = twinProjects({ wired: true });
  const link = path.join(fx.base, "link-to-checkout");
  try { fs.symlinkSync(fx.checkout, link, "dir"); }
  catch { console.log("    (symlinks unavailable — skipped)"); return; }

  const home = isolatedHome();
  const direct = doctorJson(fx.checkout, { home });
  const viaLink = doctorJson(fx.checkout, { home, archDir: path.join(link, ".arch") });

  assert.equal(viaLink.hooks.divergedFromArchDir, false, "same project reached by a symlink");
  assert.equal(hooksCheck(viaLink).detail, hooksCheck(direct).detail, "and therefore the same, quiet detail");
});

// ── done ────────────────────────────────────────────────────────────────────

cleanup();
console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
