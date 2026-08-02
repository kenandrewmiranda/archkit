#!/usr/bin/env node
//
// Repo-wide source scan: no test may spawn a child process without telling it
// where it is.
//
// THE BUG THIS PINS. archkit dogfoods its own .arch/ board, and its suites
// spawn archkit's real bins and hooks. Every one of those children resolves the
// board by walking UP from its cwd — and a child spawned without an explicit
// `cwd` inherits its parent's. A suite that forgot one therefore handed the
// child archkit's LIVE board. The Stop hook's queue-drain consolidation then
// archived real completed CGRs into .arch/goals/done/archive/ and wrote a
// digest, on every `npm test`. scripts/test.mjs now runs each suite from a
// sandbox with no reachable .arch/, which neutralises this under `npm test` —
// but a suite run DIRECTLY (`node tests/<suite>/run.mjs`, which is exactly how
// they get debugged) has no such protection. The fix is per-call, so the guard
// has to be per-call too.
//
// A near-identical scan lives inside tests/stop-hook/run.mjs, scoped to that
// one file. This is the repo-wide one: every *.mjs under tests/ is checked, so
// a new cwd-less spawn fails the run wherever it lands.
//
// WHAT COUNTS AS OK. A call is clean if its own text mentions a `cwd` option.
// Two things are exempt, by rule rather than by name — see CWD_INDEPENDENT and
// the delegation check below. Neither exemption is a free pass: the delegation
// rule re-checks the helper's call sites, and both are exercised by fixtures at
// the bottom of this file so the scan can never quietly degrade into one that
// approves everything.
//
// Usage:
//   node tests/spawn-cwd-audit/run.mjs

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.resolve(__dirname, "..");
const SELF = path.resolve(__dirname, "run.mjs");

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[90m${err.message}\x1b[0m`); failed++; failures.push(name); }
}

// ── the scan ─────────────────────────────────────────────────────────────────

// Bare-identifier calls only: `regex.exec(src)` and `re.exec(s)` are not child
// processes, and a leading `.` is what tells them apart. That is only sound
// while every suite destructures its imports (`import { spawnSync } from
// "node:child_process"`) rather than aliasing the module — which the companion
// test "no test file imports child_process as a namespace" enforces.
const SPAWN_RE = /(^|[^.\w$])(spawnSync|spawn|execFileSync|execSync|execFile|exec)\s*\(/g;

// External programs whose behaviour does not depend on the cwd they are run
// from, so an inherited cwd cannot leak anything. `which`/`where` are pure PATH
// lookups. Nothing that could resolve an .arch/ belongs in here — in particular
// NOT `node` (that is how every archkit bin is launched) and NOT `git`.
const CWD_INDEPENDENT = new Set(["which", "where"]);

// Slice a call expression starting at `start` (the index of the callee name) by
// balancing parens from its opening one.
function sliceCall(src, start, openParen) {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

function mentionsCwd(call) {
  return /\bcwd\s*[,:}]/.test(call);
}

// The literal command a call spawns, if it is a plain string: execFileSync("which", …)
// → "which". Returns null for process.execPath, a variable, or a template.
function literalCommand(call) {
  const m = /^\w+\s*\(\s*(['"])(.*?)\1/.exec(call);
  return m ? m[2] : null;
}

// Does the options object hand off to a caller-supplied bag (`...opts`)? If so
// the cwd may legitimately arrive from every call site, which we then verify.
function spreadsOptions(call) {
  return /\.\.\.\s*\w+\s*,?\s*\}\s*[,)]/.test(call);
}

// Name of the function enclosing `index` — the helper a spawn is wrapped in.
// Handles `function name(` and `const name = (`/`const name = async (`.
function enclosingFunction(src, index) {
  const head = src.slice(0, index);
  let name = null, at = -1;
  for (const re of [/\bfunction\s+(\w+)\s*\(/g, /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\s*)?\(/g]) {
    let m;
    while ((m = re.exec(head))) if (m.index > at) { at = m.index; name = m[1]; }
  }
  return name;
}

// Every call site of `name` in `src` that does not pass a cwd. The declaration
// itself is skipped.
function callSitesWithoutCwd(src, name) {
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  const bad = [];
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(0, m.index);
    if (/\b(?:function|const|let|var)\s+$/.test(before)) continue;
    const call = sliceCall(src, m.index, re.lastIndex - 1);
    if (!mentionsCwd(call)) bad.push(lineOf(src, m.index));
  }
  return bad;
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

// Audit one source file. Returns { offenders, exemptions, calls }.
export function auditSource(src, label = "<source>") {
  const offenders = [], exemptions = [];
  let calls = 0;
  let m;
  SPAWN_RE.lastIndex = 0;
  while ((m = SPAWN_RE.exec(src))) {
    calls++;
    const start = m.index + m[1].length; // skip the delimiter captured before the callee
    const call = sliceCall(src, start, SPAWN_RE.lastIndex - 1);
    const where = `${label}:${lineOf(src, start)}`;
    const snippet = call.replace(/\s+/g, " ").slice(0, 90);

    if (mentionsCwd(call)) continue;

    const cmd = literalCommand(call);
    if (cmd && CWD_INDEPENDENT.has(cmd)) {
      exemptions.push(`${where}: ${cmd} — cwd-independent PATH lookup`);
      continue;
    }

    if (spreadsOptions(call)) {
      // Delegating helper: cwd may come from the caller. Only an exemption if
      // EVERY call site actually supplies one.
      const fn = enclosingFunction(src, start);
      const bad = fn ? callSitesWithoutCwd(src, fn) : [];
      if (fn && bad.length === 0) {
        exemptions.push(`${where}: options spread into ${fn}() — all call sites pass cwd`);
        continue;
      }
      offenders.push(
        fn
          ? `${where}: ${fn}() spreads caller options but is called without a cwd at line(s) ${bad.join(", ")}`
          : `${where}: spreads options from an unidentifiable enclosing function — ${snippet}`
      );
      continue;
    }

    offenders.push(`${where}: ${snippet}`);
  }
  return { offenders, exemptions, calls };
}

function testSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(abs);
    }
  };
  walk(TESTS_DIR);
  return files.sort();
}

console.log("\n  spawn cwd audit — every test child is told where it is\n");

// ── the invariant ────────────────────────────────────────────────────────────

test("no test spawns a child without an explicit cwd", () => {
  const offenders = [], exemptions = [];
  let scanned = 0, calls = 0;
  for (const file of testSources()) {
    // Self-exclusion: the fixtures below are spawn calls as TEXT, and scanning
    // them would flag this file for bugs it does not have. The companion test
    // "the audit suite spawns nothing itself" is what closes that gap.
    if (file === SELF) continue;
    scanned++;
    const rel = path.relative(path.dirname(TESTS_DIR), file).split(path.sep).join("/");
    const r = auditSource(fs.readFileSync(file, "utf8"), rel);
    offenders.push(...r.offenders);
    exemptions.push(...r.exemptions);
    calls += r.calls;
  }

  // A scan that reads nothing passes trivially. Pin the floor: these numbers are
  // well under the real counts (76 suites, ~100 spawn calls) and only need
  // raising if a lot of suites are deleted.
  assert.ok(scanned >= 60, `scanned only ${scanned} test sources — the walk is broken`);
  assert.ok(calls >= 60, `found only ${calls} spawn calls — the matcher is broken`);

  for (const e of exemptions) console.log(`      \x1b[90mexempt  ${e}\x1b[0m`);
  assert.deepEqual(offenders, [], `\n    spawn without an explicit cwd:\n      ${offenders.join("\n      ")}\n`);
});

test("no test file imports child_process as a namespace", () => {
  // SPAWN_RE only matches bare-identifier calls, so `cp.spawnSync(…)` would slip
  // past it. Keep the destructured-import convention that makes the scan sound.
  const offenders = [];
  for (const file of testSources()) {
    const src = fs.readFileSync(file, "utf8");
    const m = /import\s+(?:\*\s+as\s+)?(\w+)\s+from\s+["']node:child_process["']/.exec(src);
    if (m) offenders.push(`${path.relative(TESTS_DIR, file)} imports it as \`${m[1]}\``);
  }
  assert.deepEqual(offenders, [],
    `use \`import { spawnSync } from "node:child_process"\` — the cwd scan cannot see member calls:\n      ${offenders.join("\n      ")}`);
});

test("the audit suite spawns nothing itself", () => {
  // Self-exclusion above is only safe while this file has no live spawns.
  // Anchored at line start so this does not match the child_process regexes
  // written elsewhere in this file.
  const src = fs.readFileSync(SELF, "utf8");
  assert.ok(!/^import[^\n]*node:child_process/m.test(src),
    "tests/spawn-cwd-audit/run.mjs must not import node:child_process — it excludes itself from the scan");
});

// ── the scan is not vacuous ──────────────────────────────────────────────────
//
// Fixtures proving each rule fires. Without these, a regex that stopped matching
// would look exactly like a clean repo.

test("fixture: a bare cwd-less spawn is an offender", () => {
  const { offenders } = auditSource(`spawnSync(process.execPath, [HOOK], { input: "x" });`, "fx");
  assert.equal(offenders.length, 1, JSON.stringify(offenders));
  assert.match(offenders[0], /fx:1/);
});

test("fixture: an explicit cwd is clean", () => {
  const { offenders } = auditSource(`spawnSync(process.execPath, [HOOK], { cwd: dir, input: "x" });`, "fx");
  assert.deepEqual(offenders, []);
});

test("fixture: a nested call does not confuse the paren balancer", () => {
  const src = `spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: dir }) });`;
  // The cwd here is inside the PAYLOAD, not the options — but the borrowed
  // matcher is textual, so it reads clean. Documented as a known limit: the
  // payload cwd and the process cwd are set together everywhere in this repo.
  assert.deepEqual(auditSource(src, "fx").offenders, []);
});

test("fixture: `which` is exempt, other externals are not", () => {
  const ok = auditSource(`execFileSync("which", ["node"], { encoding: "utf8" });`, "fx");
  assert.deepEqual(ok.offenders, []);
  assert.equal(ok.exemptions.length, 1);

  const bad = auditSource(`execFileSync("git", ["status"], { encoding: "utf8" });`, "fx");
  assert.equal(bad.offenders.length, 1, "a cwd-less git call must NOT be exempt");
});

test("fixture: a delegating helper is exempt only when every call site passes cwd", () => {
  const clean = `
    function tryRun(args, opts = {}) {
      return execFileSync("node", [ARCHKIT, ...args], { encoding: "utf8", ...opts });
    }
    tryRun(["drift"], { cwd: dir });
    tryRun(["stats"], { cwd: other });
  `;
  const r1 = auditSource(clean, "fx");
  assert.deepEqual(r1.offenders, []);
  assert.equal(r1.exemptions.length, 1, "the delegation exemption should have fired");

  const leaky = `
    function tryRun(args, opts = {}) {
      return execFileSync("node", [ARCHKIT, ...args], { encoding: "utf8", ...opts });
    }
    tryRun(["drift"], { cwd: dir });
    tryRun(["stats"]);
  `;
  const r2 = auditSource(leaky, "fx");
  assert.equal(r2.offenders.length, 1, JSON.stringify(r2));
  assert.match(r2.offenders[0], /tryRun\(\) spreads caller options but is called without a cwd/);
});

test("fixture: every spawn form is matched", () => {
  for (const fn of ["spawnSync", "spawn", "execFileSync", "execSync", "execFile", "exec"]) {
    const { offenders } = auditSource(`${fn}(process.execPath, [BIN], {});`, "fx");
    assert.equal(offenders.length, 1, `${fn} was not matched`);
  }
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) for (const f of failures) console.log(`    - ${f}`);
console.log("");
process.exit(failed > 0 ? 1 : 0);
