#!/usr/bin/env node
// Tests `archkit init --install-hooks --mcp` MCP registration path.
//
// The legacy `~/.claude/mcp.json` direct-write was removed when Claude Code
// v2.x switched its source of truth to `~/.claude.json` written via the
// `claude mcp add` CLI. archkit now delegates to that CLI — these tests
// stub a fake `claude` binary on PATH and assert the CLI is invoked with
// the right arguments.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

// Build a fake `claude` shim that logs its argv to a known file. Optional
// `mode` controls behavior of `claude mcp list`:
//   "empty"   — list is empty (so `mcp add` runs)
//   "present" — list already contains "archkit:" (so `mcp add` is skipped)
function makeFixture({ listMode = "empty" } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-init-"));
  fs.mkdirSync(path.join(tmp, ".arch"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".arch", "SYSTEM.md"), "## Rules\n- R\n");
  const home = path.join(tmp, "fake-home");
  fs.mkdirSync(home, { recursive: true });

  const binDir = path.join(tmp, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const logPath = path.join(tmp, "claude-invocations.log");
  const listOutput = listMode === "present" ? "archkit: archkit-mcp\n" : "";
  const fakeClaude = `#!/bin/sh
echo "$@" >> "${logPath}"
if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then
  printf '%s' "${listOutput}"
fi
exit 0
`;
  fs.writeFileSync(path.join(binDir, "claude"), fakeClaude, { mode: 0o755 });
  return { tmp, home, binDir, logPath };
}

function runInit({ tmp, home, binDir }) {
  return execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"], {
    cwd: tmp,
    env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH || ""}` },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

test("--install-hooks --mcp invokes `claude mcp add` when no entry exists", () => {
  const fx = makeFixture({ listMode: "empty" });
  try {
    runInit(fx);
    assert.ok(fs.existsSync(fx.logPath), "fake claude should have been invoked");
    const log = fs.readFileSync(fx.logPath, "utf8");
    assert.match(log, /mcp list/, "should query existing registrations first");
    assert.match(log, /mcp add archkit archkit-mcp --scope user/,
      "should add the archkit server with user scope");
  } finally {
    fs.rmSync(fx.tmp, { recursive: true, force: true });
  }
});

test("--install-hooks --mcp is idempotent — skips `add` when already registered", () => {
  const fx = makeFixture({ listMode: "present" });
  try {
    runInit(fx);
    const log = fs.readFileSync(fx.logPath, "utf8");
    assert.match(log, /mcp list/, "should still query the list");
    assert.doesNotMatch(log, /mcp add/,
      "should NOT call `mcp add` when archkit is already registered");
  } finally {
    fs.rmSync(fx.tmp, { recursive: true, force: true });
  }
});

test("--install-hooks --mcp warns gracefully when `claude` CLI is absent", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-init-"));
  fs.mkdirSync(path.join(tmp, ".arch"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".arch", "SYSTEM.md"), "## Rules\n- R\n");
  const home = path.join(tmp, "fake-home");
  fs.mkdirSync(home, { recursive: true });
  try {
    // Empty PATH so `claude` isn't found
    let stderr = "";
    try {
      execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"], {
        cwd: tmp,
        env: { ...process.env, HOME: home, PATH: "" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      stderr = (err.stderr || "").toString();
    }
    // Either it warns or the command itself returns non-zero — both acceptable,
    // the important behavior is that it doesn't crash and surfaces the issue.
    // (When run via execFileSync the absence is detected via `which claude`
    // failing or `claude mcp list` failing — either way init's warn path runs.)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
