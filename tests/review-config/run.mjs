#!/usr/bin/env node
// Regression tests for v1.6.5:
//   1. --staged / --diff / --dir accept non-JS code extensions (Swift, Kotlin,
//      Go, Rust, Python, Ruby, etc.) — not just .js/.ts/.tsx/.mjs/.py.
//   2. .arch/config.json → review.disable[] suppresses findings whose `type`
//      matches, while leaving architecture-correctness families (which sit in
//      NON_DISABLABLE) untouched.

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

function makeRepo({ stack = "Node.js", config = null, files = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-review-config-"));
  execFileSync("git", ["init", "-q"], { cwd: tmp });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: tmp });
  execFileSync("git", ["config", "user.name", "test"], { cwd: tmp });

  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  fs.writeFileSync(
    path.join(arch, "SYSTEM.md"),
    `## App: test\n## Type: Internal Tool\n## Stack: ${stack}\n## Pattern: Simple Layered\n\n## Rules\n- Layered\n\n## Reserved Words\n\n## Naming\nFiles: kebab\n`
  );
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");

  if (config !== null) {
    fs.writeFileSync(path.join(arch, "config.json"), JSON.stringify(config, null, 2));
  }

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  execFileSync("git", ["add", "-A"], { cwd: tmp });
  return tmp;
}

function runStaged(cwd) {
  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      [ARCHKIT, "review", "--staged", "--json"],
      { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }
    ).toString();
  } catch (err) {
    stdout = err.stdout ? err.stdout.toString() : "";
    if (!stdout) throw err;
  }
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { continue; }
  }
  throw new Error(`No JSON in output: ${stdout.slice(0, 300)}`);
}

function cleanup(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Tests: staged extension allowlist ──────────────────────────────────────

test("--staged picks up .swift files (was 0 before v1.6.5)", () => {
  const tmp = makeRepo({
    stack: "Swift / SwiftUI",
    files: {
      "Foo.swift": "import SwiftUI\nstruct FooView: View { var body: some View { Text(\"hi\") } }\n",
    },
  });
  try {
    const result = runStaged(tmp);
    assert.equal(result.files, 1, `expected 1 file, got ${result.files}`);
  } finally { cleanup(tmp); }
});

test("--staged picks up .kt, .go, .rs, .rb files", () => {
  const tmp = makeRepo({
    stack: "Polyglot",
    files: {
      "a.kt": "fun main() {}\n",
      "b.go": "package main\nfunc main() {}\n",
      "c.rs": "fn main() {}\n",
      "d.rb": "puts 'hi'\n",
    },
  });
  try {
    const result = runStaged(tmp);
    assert.equal(result.files, 4, `expected 4 files, got ${result.files}`);
  } finally { cleanup(tmp); }
});

test("--staged still skips markdown / lockfiles / images", () => {
  const tmp = makeRepo({
    files: {
      "README.md": "# hi\n",
      "package-lock.json": "{}\n",
      "logo.png": "binary",
      "real.js": "export const x = 1;\n",
    },
  });
  try {
    const result = runStaged(tmp);
    assert.equal(result.files, 1, `expected 1 file (only real.js), got ${result.files}`);
    assert.ok(result.findings["real.js"], "real.js should be reviewed");
  } finally { cleanup(tmp); }
});

// ── Tests: .arch/config.json → review.disable ──────────────────────────────

test("review.disable silences listed rule families", () => {
  const code = `import { db } from "./db";\nimport { users } from "./schema";\nexport async function listUsers() { return db.select().from(users); }\nexport async function fetchExternal() { return fetch("https://api.example.com/x"); }\n`;
  const baseFiles = { "src/users.ts": code };

  const baseline = makeRepo({ stack: "TypeScript / Drizzle", files: baseFiles });
  let baselineWarnings;
  try {
    const r = runStaged(baseline);
    baselineWarnings = r.warnings;
    assert.ok(baselineWarnings >= 2, `expected ≥2 warnings (http-client + db-efficiency), got ${baselineWarnings}`);
  } finally { cleanup(baseline); }

  const suppressed = makeRepo({
    stack: "TypeScript / Drizzle",
    files: baseFiles,
    config: { review: { disable: ["http-client", "db-efficiency"] } },
  });
  try {
    const r = runStaged(suppressed);
    const httpFindings = Object.values(r.findings).flat().filter(f => f.type === "http-client");
    const dbFindings = Object.values(r.findings).flat().filter(f => f.type === "db-efficiency");
    assert.equal(httpFindings.length, 0, `http-client should be silenced, got ${httpFindings.length}`);
    assert.equal(dbFindings.length, 0, `db-efficiency should be silenced, got ${dbFindings.length}`);
  } finally { cleanup(suppressed); }
});

test("review.disable does NOT silence architecture families (import-boundary)", () => {
  const tmp = makeRepo({
    stack: "TypeScript",
    config: { review: { disable: ["import-boundary", "import-hierarchy", "boundary-violation"] } },
    files: {
      "src/features/auth/auth.controller.ts": "import { x } from \"../billing/billing.repository\";\nexport const handler = () => x;\n",
    },
  });
  try {
    const r = runStaged(tmp);
    const archFindings = Object.values(r.findings).flat()
      .filter(f => f.type === "import-boundary" || f.type === "boundary-violation");
    assert.ok(archFindings.length > 0, `architecture family should fire despite disable list, got ${archFindings.length}`);
  } finally { cleanup(tmp); }
});

test("malformed .arch/config.json degrades silently to no-disables", () => {
  const tmp = makeRepo({
    stack: "Node.js",
    files: { "a.js": "export const x = 1;\n" },
  });
  fs.writeFileSync(path.join(tmp, ".arch", "config.json"), "{ this is not json");
  try {
    const r = runStaged(tmp);
    assert.equal(r.files, 1, "should still review files");
    assert.equal(typeof r.pass, "boolean");
  } finally { cleanup(tmp); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
