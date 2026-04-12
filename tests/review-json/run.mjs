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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-review-json-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });

  fs.writeFileSync(
    path.join(arch, "SYSTEM.md"),
    [
      "## App: test",
      "## Type: Internal Tool",
      "## Stack: Node.js",
      "## Pattern: Simple Layered",
      "",
      "## Rules",
      "- Layered",
      "",
      "## Reserved Words",
      "",
      "## Naming",
      "Files: kebab",
    ].join("\n")
  );

  fs.writeFileSync(path.join(arch, "INDEX.md"), "");

  fs.writeFileSync(
    path.join(tmp, "test-file.js"),
    "const x = 1;\nexport default x;\n"
  );

  return tmp;
}

function parseJson(output) {
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { continue; }
  }
  throw new Error(`No valid JSON found in output: ${JSON.stringify(output.substring(0, 200))}`);
}

function runReview(cwd, flag) {
  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      [ARCHKIT, "review", flag, "test-file.js"],
      { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }
    ).toString();
  } catch (err) {
    stdout = err.stdout ? err.stdout.toString() : "";
    if (!stdout) throw err;
  }
  return stdout;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("--json produces valid JSON output", () => {
  const tmp = makeFixture();
  try {
    const out = runReview(tmp, "--json");
    const data = parseJson(out);
    assert.ok(typeof data.files === "number", "files key should be a number");
    assert.ok(typeof data.pass === "boolean", "pass key should be a boolean");
    assert.ok(typeof data.findings === "object", "findings key should be an object");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--json and --agent produce same output shape", () => {
  const tmp = makeFixture();
  try {
    const jsonOut = runReview(tmp, "--json");
    const agentOut = runReview(tmp, "--agent");
    const jsonData = parseJson(jsonOut);
    const agentData = parseJson(agentOut);
    const jsonKeys = Object.keys(jsonData).sort();
    const agentKeys = Object.keys(agentData).sort();
    assert.deepEqual(jsonKeys, agentKeys, `key shapes differ: --json has [${jsonKeys}], --agent has [${agentKeys}]`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
