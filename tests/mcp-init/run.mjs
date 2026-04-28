#!/usr/bin/env node
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

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-init-"));
  fs.mkdirSync(path.join(tmp, ".arch"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".arch", "SYSTEM.md"), "## Rules\n- R\n");
  const home = path.join(tmp, "fake-home");
  fs.mkdirSync(home, { recursive: true });
  return { tmp, home };
}

test("--install-hooks --mcp writes archkit entry to ~/.claude/mcp.json", () => {
  const { tmp, home } = makeFixture();
  try {
    execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"], {
      cwd: tmp,
      env: { ...process.env, HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const cfgPath = path.join(home, ".claude", "mcp.json");
    assert.ok(fs.existsSync(cfgPath), `expected ${cfgPath} to exist`);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    assert.ok(cfg.mcpServers, "mcpServers key missing");
    assert.equal(cfg.mcpServers.archkit.command, "archkit-mcp");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--install-hooks --mcp is idempotent (no duplicate on re-run)", () => {
  const { tmp, home } = makeFixture();
  try {
    const env = { ...process.env, HOME: home };
    execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"],
      { cwd: tmp, env, stdio: ["pipe", "pipe", "pipe"] });
    execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"],
      { cwd: tmp, env, stdio: ["pipe", "pipe", "pipe"] });
    const cfg = JSON.parse(fs.readFileSync(path.join(home, ".claude", "mcp.json"), "utf8"));
    assert.equal(cfg.mcpServers.archkit.command, "archkit-mcp");
    assert.equal(Object.keys(cfg.mcpServers).filter(k => k === "archkit").length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--install-hooks --mcp does not overwrite a different existing archkit entry", () => {
  const { tmp, home } = makeFixture();
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "mcp.json"),
      JSON.stringify({ mcpServers: { archkit: { command: "custom-archkit", args: ["--special"] } } }, null, 2));
    execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"],
      { cwd: tmp, env: { ...process.env, HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
    const cfg = JSON.parse(fs.readFileSync(path.join(home, ".claude", "mcp.json"), "utf8"));
    assert.equal(cfg.mcpServers.archkit.command, "custom-archkit");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
