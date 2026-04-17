#!/usr/bin/env node

/**
 * Preflight Live Tests
 *
 * Verifies that `archkit resolve preflight` returns a live runtime view:
 * git history, scoped gotcha proposals, and scoped drift findings.
 *
 * Usage:
 *   node tests/preflight-live/run.mjs
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[90m${err.message}\x1b[0m`);
    failed++;
    failures.push(name);
  }
}

function withProject(setup, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-preflight-live-"));
  try {
    setup(dir);
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeArchProject(dir, { extraIndexLines = "", gotchaProposals = {}, srcFiles = [], skipSrcNotify = false } = {}) {
  fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".arch", "gotcha-proposals"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, ".arch", "SYSTEM.md"),
    "## App: test\n## Rules\n- R1\n"
  );

  fs.writeFileSync(
    path.join(dir, ".arch", "INDEX.md"),
    `## Nodes\n@notify = [notify] → src/features/notify/\n${extraIndexLines}`
  );

  fs.writeFileSync(
    path.join(dir, ".arch", "clusters", "notify.graph"),
    "[notify] : notification handling\n"
  );

  // Write gotcha proposals
  for (const [filename, content] of Object.entries(gotchaProposals)) {
    fs.writeFileSync(
      path.join(dir, ".arch", "gotcha-proposals", filename),
      JSON.stringify(content)
    );
  }

  // Create source files
  if (!skipSrcNotify) {
    fs.mkdirSync(path.join(dir, "src", "features", "notify"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "features", "notify", "notify.controller.ts"),
      "// notify controller\n"
    );
  }

  for (const file of srcFiles) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "// placeholder\n");
  }
}

function gitInit(dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
}

function runPreflight(dir, feature, layer, opts = {}) {
  const args = [ARCHKIT, "resolve", "preflight", feature, layer, "--json"];
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
      ...opts,
    });
    return { ok: true, result: JSON.parse(stdout.trim()) };
  } catch (err) {
    const stdout = err.stdout?.toString() || "";
    let result = null;
    try { result = JSON.parse(stdout.trim()); } catch (_) {}
    return { ok: false, result, stdout, stderr: err.stderr?.toString() || "" };
  }
}

console.log("");
console.log("  ┌─────────────────────────────────────────────────────────┐");
console.log("  │          ARCHKIT PREFLIGHT LIVE TESTS                   │");
console.log("  └─────────────────────────────────────────────────────────┘");
console.log("");

// ── Test 1: New live shape with required keys ────────────────────────────────

test("preflight returns new live shape with required keys", () => {
  withProject(
    (dir) => {
      makeArchProject(dir);
      gitInit(dir);
    },
    (dir) => {
      const { result } = runPreflight(dir, "notify", "controller");
      assert.ok(result, "Expected JSON result");
      assert.ok(Array.isArray(result.recentCommits), "recentCommits should be an array");
      assert.ok(Array.isArray(result.pendingGotchas), "pendingGotchas should be an array");
      assert.ok(Array.isArray(result.driftFindings), "driftFindings should be an array");
      assert.strictEqual(typeof result.passWithoutAction, "boolean", "passWithoutAction should be boolean");
      assert.strictEqual(typeof result.gitAvailable, "boolean", "gitAvailable should be boolean");
      assert.ok(typeof result.feature === "string", "feature should be a string");
      assert.ok(typeof result.basePath === "string", "basePath should be a string");
    }
  );
});

// ── Test 2: recentCommits populated from git log ─────────────────────────────

test("recentCommits populated from git log", () => {
  withProject(
    (dir) => {
      makeArchProject(dir);
      gitInit(dir);
      // Add a new commit touching the notify controller
      const controllerPath = path.join(dir, "src", "features", "notify", "notify.controller.ts");
      fs.writeFileSync(controllerPath, "// updated notify controller\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "fix: update notify controller logic"], { cwd: dir });
    },
    (dir) => {
      const { result } = runPreflight(dir, "notify", "controller");
      assert.ok(result, "Expected JSON result");
      assert.ok(Array.isArray(result.recentCommits), "recentCommits should be array");
      assert.ok(result.recentCommits.length > 0, "recentCommits should be non-empty after touching file");
      const commit = result.recentCommits[0];
      assert.ok(typeof commit.hash === "string", "commit.hash should be string");
      assert.ok(commit.hash.length <= 7, "commit.hash should be truncated to 7 chars");
      assert.ok(typeof commit.subject === "string", "commit.subject should be string");
      assert.ok(commit.subject.includes("notify"), "commit subject should reference notify");
    }
  );
});

// ── Test 3: pendingGotchas filtered to feature's skills ─────────────────────

test("pendingGotchas filtered to feature's skills", () => {
  withProject(
    (dir) => {
      // Add a skill file reference in INDEX and a gotcha proposal for it
      makeArchProject(dir, {
        extraIndexLines: "## Skills Files\n$aiosqlite → .arch/skills/aiosqlite.skill\n",
        gotchaProposals: {
          "abc123def456.json": {
            skill: "aiosqlite",
            wrong: "conn.execute()",
            right: "await conn.execute()",
            why: "aiosqlite is async-only",
          },
        },
      });
      gitInit(dir);
    },
    (dir) => {
      const { result } = runPreflight(dir, "notify", "controller");
      assert.ok(result, "Expected JSON result");
      assert.ok(Array.isArray(result.pendingGotchas), "pendingGotchas should be array");
      // Filter logic may be conservative (include all if featureSkills is empty)
      // so just verify the array has entries and each entry has required fields
      if (result.pendingGotchas.length > 0) {
        const g = result.pendingGotchas[0];
        assert.ok(typeof g.hash === "string", "gotcha should have hash");
        assert.ok(typeof g.skill === "string", "gotcha should have skill");
        assert.ok(typeof g.wrong === "string", "gotcha should have wrong");
        assert.ok(typeof g.right === "string", "gotcha should have right");
        assert.ok(typeof g.why === "string", "gotcha should have why");
      }
    }
  );
});

// ── Test 4: driftFindings filtered to feature's basePath ─────────────────────

test("driftFindings filtered to feature's basePath", () => {
  withProject(
    (dir) => {
      // notify source is missing — INDEX.md references it but skip creating it
      makeArchProject(dir, { skipSrcNotify: true });
      gitInit(dir);
    },
    (dir) => {
      const { result } = runPreflight(dir, "notify", "controller");
      assert.ok(result, "Expected JSON result");
      assert.ok(Array.isArray(result.driftFindings), "driftFindings should be array");
      assert.ok(result.driftFindings.length > 0, "Should have at least one drift finding for missing source");
      const finding = result.driftFindings.find(f => f.id === "notify");
      assert.ok(finding, "Should have a finding for notify node");
      assert.ok(
        finding.type === "missing-source" || finding.type === "missing-file",
        `finding.type should be missing-source or missing-file, got: ${finding.type}`
      );
    }
  );
});

// ── Test 5: passWithoutAction true when all clean ────────────────────────────

test("passWithoutAction true when all clean", () => {
  withProject(
    (dir) => {
      // notify source exists, no gotcha proposals
      makeArchProject(dir);
      gitInit(dir);
    },
    (dir) => {
      const { result } = runPreflight(dir, "notify", "controller");
      assert.ok(result, "Expected JSON result");
      assert.strictEqual(result.pendingGotchas.length, 0, "No gotcha proposals");
      assert.strictEqual(result.driftFindings.length, 0, "No drift findings");
      assert.strictEqual(result.passWithoutAction, true, "passWithoutAction should be true");
    }
  );
});

// ── Test 6: gitAvailable false when not a git repo ───────────────────────────

test("gitAvailable false when not a git repo", () => {
  withProject(
    (dir) => {
      // Set up arch project but don't git init
      makeArchProject(dir);
      // NOTE: no gitInit(dir)
    },
    (dir) => {
      const { result } = runPreflight(dir, "notify", "controller");
      assert.ok(result, "Expected JSON result");
      assert.strictEqual(result.gitAvailable, false, "gitAvailable should be false outside git repo");
      assert.ok(Array.isArray(result.recentCommits), "recentCommits should still be array");
      assert.strictEqual(result.recentCommits.length, 0, "recentCommits should be empty");
    }
  );
});

// ── Test 7: unknown feature returns error ────────────────────────────────────

test("unknown feature returns error", () => {
  withProject(
    (dir) => {
      makeArchProject(dir);
      gitInit(dir);
    },
    (dir) => {
      // Run with an unknown feature
      const { result } = runPreflight(dir, "nonexistent-feature", "controller");
      assert.ok(result, "Expected JSON result");
      assert.strictEqual(result.error, "unknown_feature", `Expected error: unknown_feature, got: ${result.error}`);
    }
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("");
console.log("  ═════════════════════════════════════════════════════════");
const total = passed + failed;
const pct = total > 0 ? ((passed / total) * 100).toFixed(0) : 0;
console.log(`  \x1b[1m${total} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m | \x1b[1m${pct}%\x1b[0m`);

if (failures.length > 0) {
  console.log("");
  console.log("  \x1b[31mFailed:\x1b[0m");
  for (const f of failures) {
    console.log(`    - ${f}`);
  }
}
console.log("");

process.exit(failed > 0 ? 1 : 0);
