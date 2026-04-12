#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-stats-json-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(arch, "apis"), { recursive: true });

  fs.writeFileSync(
    path.join(arch, "SYSTEM.md"),
    "## App: test\n## Rules\n- Rule 1\n## Naming\nFiles: kebab\n"
  );

  fs.writeFileSync(
    path.join(arch, "INDEX.md"),
    "test → @test\n"
  );

  fs.writeFileSync(
    path.join(arch, "skills", "postgres.skill"),
    [
      "## Meta",
      "package: postgres",
      "version: 15",
      "",
      "## Use",
      "How YOUR project uses postgres for persistent storage.",
      "",
      "## Patterns",
      "Import paths and usage patterns for postgres.",
      "",
      "## Gotchas",
      "WRONG: SELECT * FROM users",
      "RIGHT: SELECT id, name FROM users",
      "WHY: Avoid fetching columns you don't need.",
      "",
      "## Boundaries",
      "What this layer owns and what it delegates.",
      "",
      "## Snippets",
      "```js",
      "const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [id]);",
      "```",
    ].join("\n")
  );

  fs.writeFileSync(
    path.join(arch, "clusters", "auth.graph"),
    "[auth] : handles authentication\n  [login] : user → session\n"
  );

  return tmp;
}

function runStats(cwd, extraArgs = []) {
  return execFileSync(
    process.execPath,
    [ARCHKIT, "stats", "--json", ...extraArgs],
    { cwd, stdio: ["pipe", "pipe", "pipe"] }
  ).toString();
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("--json outputs valid JSON with expected keys", () => {
  const tmp = makeFixture();
  try {
    const out = runStats(tmp);
    const data = JSON.parse(out);
    assert.ok(typeof data.health === "object", "health key missing");
    assert.ok(typeof data.health.pct === "number", "health.pct should be a number");
    assert.ok(Array.isArray(data.health.checks), "health.checks should be an array");
    assert.ok(data.system && data.system.exists === true, "system.exists should be true");
    assert.ok(Array.isArray(data.skills), "skills should be an array");
    assert.ok(Array.isArray(data.graphs), "graphs should be an array");
    assert.ok(Array.isArray(data.recommendations), "recommendations should be an array");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--json includes skill details", () => {
  const tmp = makeFixture();
  try {
    const out = runStats(tmp);
    const data = JSON.parse(out);
    assert.equal(data.skills.length, 1, "should have 1 skill");
    assert.equal(data.skills[0].id, "postgres", "skill id should be postgres");
    assert.ok(data.skills[0].gotchas >= 1, `gotchas should be >= 1, got ${data.skills[0].gotchas}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--json without .arch/ returns error JSON", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-no-arch-"));
  try {
    let stdout = "";
    let exitCode = 0;
    try {
      stdout = execFileSync(
        process.execPath,
        [ARCHKIT, "stats", "--json"],
        { cwd: tmp, stdio: ["pipe", "pipe", "pipe"] }
      ).toString();
    } catch (err) {
      exitCode = err.status;
      stdout = err.stdout ? err.stdout.toString() : "";
    }
    assert.ok(exitCode !== 0, `expected non-zero exit, got ${exitCode}`);
    const data = JSON.parse(stdout);
    const hasError = data.error === "no_arch_dir" || typeof data.error === "string";
    assert.ok(hasError, `expected error JSON, got: ${JSON.stringify(data)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--json takes precedence over --compact", () => {
  const tmp = makeFixture();
  try {
    const stdout = execFileSync(
      process.execPath,
      [ARCHKIT, "stats", "--json", "--compact"],
      { cwd: tmp, stdio: ["pipe", "pipe", "pipe"] }
    ).toString();
    // Should be valid JSON (not the compact human line)
    const data = JSON.parse(stdout);
    assert.ok(typeof data.health === "object", "should output full JSON, not compact line");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
