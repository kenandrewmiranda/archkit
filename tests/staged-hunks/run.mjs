#!/usr/bin/env node
// Tests for src/commands/review/staged-hunks.mjs and the integration into
// `review --staged` (arch-poly dogfood: pre-existing TODOs on untouched lines
// were being reported on every review, training users to ignore the count).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  getDiffHunkLines,
  filterFindingsByHunks,
} from "../../src/commands/review/staged-hunks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

function withTempGitRepo(setup, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-hunks-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
    setup(dir);
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n  staged-hunks — filterFindingsByHunks");

test("no hunkLines → passes findings through unchanged", () => {
  const findings = [{ line: 5, type: "x" }, { line: 100, type: "y" }];
  assert.deepEqual(filterFindingsByHunks(findings, undefined), findings);
  assert.deepEqual(filterFindingsByHunks(findings, new Set()), findings);
});

test("findings without a line field always pass", () => {
  const findings = [{ type: "file-level" }, { line: 99, type: "scoped" }];
  const out = filterFindingsByHunks(findings, new Set([10]));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "file-level");
});

test("only findings inside hunk lines survive", () => {
  const findings = [
    { line: 5, type: "out" },
    { line: 12, type: "in" },
    { line: 13, type: "in" },
    { line: 99, type: "out" },
  ];
  const out = filterFindingsByHunks(findings, new Set([12, 13]));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(f => f.type), ["in", "in"]);
});

console.log("\n  staged-hunks — getDiffHunkLines (real git)");

test("single-file staged edit: hunk lines parsed correctly", () => {
  withTempGitRepo(
    (dir) => {
      const file = path.join(dir, "a.txt");
      fs.writeFileSync(file, Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
      execFileSync("git", ["add", "a.txt"], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
      // Edit lines 5 and 10
      const content = fs.readFileSync(file, "utf8").split("\n");
      content[4] = "line 5 EDITED";
      content[9] = "line 10 EDITED";
      fs.writeFileSync(file, content.join("\n"));
      execFileSync("git", ["add", "a.txt"], { cwd: dir });
    },
    (dir) => {
      const map = getDiffHunkLines(dir, { staged: true });
      const abs = path.resolve(dir, "a.txt");
      const lines = map.get(abs);
      assert.ok(lines, `expected entry for ${abs}, got keys: ${[...map.keys()].join(", ")}`);
      assert.ok(lines.has(5), "should include line 5");
      assert.ok(lines.has(10), "should include line 10");
      assert.ok(!lines.has(1), "should NOT include untouched line 1");
      assert.ok(!lines.has(20), "should NOT include untouched line 20");
    }
  );
});

test("no staged changes → empty map", () => {
  withTempGitRepo(
    (dir) => {
      fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
    },
    (dir) => {
      const map = getDiffHunkLines(dir, { staged: true });
      assert.equal(map.size, 0);
    }
  );
});

test("not in a git repo → empty map (no throw)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-nogit-"));
  try {
    const map = getDiffHunkLines(dir, { staged: true });
    assert.equal(map.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log("\n  staged-hunks — end-to-end via `archkit review --staged --agent`");

function makeArchProject(dir) {
  fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".arch", "SYSTEM.md"),
    "# SYSTEM.md\n## Type: SaaS\n## Stack: Frontend: React | API Framework: Hono\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab-case\n"
  );
  fs.writeFileSync(path.join(dir, ".arch", "INDEX.md"), "# INDEX.md\n## Conv: src/{f}/{f}.{layer}.ts\n");
}

function runReview(dir) {
  // Banner ANSI prints to stdout before JSON — extract the JSON object.
  const out = execFileSync(
    "node",
    [ARCHKIT, "review", "--staged", "--agent"],
    { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const match = out.match(/\{[\s\S]*\}\s*$/);
  if (!match) throw new Error(`no JSON in archkit output: ${out}`);
  return JSON.parse(match[0]);
}

test("pre-existing TODOs on untouched lines are filtered out", () => {
  withTempGitRepo(
    (dir) => {
      makeArchProject(dir);
      const src = path.join(dir, "src");
      fs.mkdirSync(src, { recursive: true });
      const initial = [
        "// TODO: pre-existing 1",
        "// TODO: pre-existing 2",
        "// TODO: pre-existing 3",
        "// TODO: pre-existing 4",
        "// TODO: pre-existing 5",
        "export const x = 1;",
      ].join("\n") + "\n";
      fs.writeFileSync(path.join(src, "a.js"), initial);
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
      // Clean staged change at line 7 (no new TODO)
      fs.writeFileSync(path.join(src, "a.js"), initial + "export const y = 2;\n");
      execFileSync("git", ["add", "."], { cwd: dir });
    },
    (dir) => {
      const result = runReview(dir);
      const findings = Object.values(result.findings || {}).flat();
      const todos = findings.filter(f => f.type === "untracked-todo");
      assert.equal(
        todos.length, 0,
        `expected zero untracked-todo findings (all pre-existing), got ${todos.length}: ${JSON.stringify(todos)}`
      );
    }
  );
});

test("NEW TODO on a staged line is still reported", () => {
  withTempGitRepo(
    (dir) => {
      makeArchProject(dir);
      const src = path.join(dir, "src");
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, "a.js"), "export const x = 1;\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
      // Stage a brand-new TODO
      fs.writeFileSync(
        path.join(src, "a.js"),
        "export const x = 1;\n// TODO: actually new\nexport const y = 2;\n"
      );
      execFileSync("git", ["add", "."], { cwd: dir });
    },
    (dir) => {
      const result = runReview(dir);
      const findings = Object.values(result.findings || {}).flat();
      const todos = findings.filter(f => f.type === "untracked-todo");
      assert.ok(
        todos.length >= 1,
        `expected the new TODO to be flagged, got ${todos.length}: ${JSON.stringify(findings)}`
      );
    }
  );
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
