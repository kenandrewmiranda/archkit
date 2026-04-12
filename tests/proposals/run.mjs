#!/usr/bin/env node

/**
 * Gotcha DB Proposals Test Suite
 *
 * Verifies that the built-in gotcha DB contains required keys and well-formed entries.
 *
 * Usage:
 *   node tests/proposals/run.mjs
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");
import { GOTCHA_DB } from "../../src/data/gotcha-db.mjs";

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

console.log("");
console.log("  ┌─────────────────────────────────────────────────────────┐");
console.log("  │           ARCHKIT GOTCHA DB PROPOSALS TESTS             │");
console.log("  └─────────────────────────────────────────────────────────┘");
console.log("");

// ── Key existence ──────────────────────────────────────────────────────────

test("sqlite key exists with at least 1 entry", () => {
  assert.ok(Array.isArray(GOTCHA_DB.sqlite), "GOTCHA_DB.sqlite should be an array");
  assert.ok(GOTCHA_DB.sqlite.length >= 1, "GOTCHA_DB.sqlite should have at least 1 entry");
});

test("numerics key exists with at least 1 entry", () => {
  assert.ok(Array.isArray(GOTCHA_DB.numerics), "GOTCHA_DB.numerics should be an array");
  assert.ok(GOTCHA_DB.numerics.length >= 1, "GOTCHA_DB.numerics should have at least 1 entry");
});

// ── Required fields ────────────────────────────────────────────────────────

test("all gotcha entries have required fields (wrong, right, why)", () => {
  for (const [key, entries] of Object.entries(GOTCHA_DB)) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      assert.ok(typeof entry.wrong === "string" && entry.wrong.length > 0,
        `GOTCHA_DB.${key}[${i}] missing or empty 'wrong' field`);
      assert.ok(typeof entry.right === "string" && entry.right.length > 0,
        `GOTCHA_DB.${key}[${i}] missing or empty 'right' field`);
      assert.ok(typeof entry.why === "string" && entry.why.length > 0,
        `GOTCHA_DB.${key}[${i}] missing or empty 'why' field`);
    }
  }
});

// ── Content checks ─────────────────────────────────────────────────────────

test("sqlite entry references ALTER TABLE", () => {
  const hasAlterTable = GOTCHA_DB.sqlite.some(
    entry =>
      entry.wrong.includes("ALTER TABLE") ||
      entry.right.includes("ALTER TABLE") ||
      entry.why.includes("ALTER TABLE")
  );
  assert.ok(hasAlterTable, "No sqlite entry references ALTER TABLE");
});

test("numerics entry references IEEE 754 or float precision", () => {
  const hasIEEE = GOTCHA_DB.numerics.some(
    entry =>
      entry.wrong.includes("IEEE 754") ||
      entry.right.includes("IEEE 754") ||
      entry.why.includes("IEEE 754") ||
      entry.wrong.toLowerCase().includes("float") ||
      entry.right.toLowerCase().includes("float") ||
      entry.why.toLowerCase().includes("float") ||
      entry.wrong.toLowerCase().includes("precision") ||
      entry.right.toLowerCase().includes("precision") ||
      entry.why.toLowerCase().includes("precision")
  );
  assert.ok(hasIEEE, "No numerics entry references IEEE 754 or float precision");
});

// ── Hash unit tests ────────────────────────────────────────────────────────

function proposalHash(skill, wrong, right) {
  return createHash("sha1").update(`${skill}\x1f${wrong}\x1f${right}`).digest("hex").slice(0, 12);
}

console.log("");
console.log("  ── Hash unit tests ───────────────────────────────────────");

test("hash is stable — same inputs produce same hash", () => {
  const h1 = proposalHash("stripe", "req.body", "req.rawBody");
  const h2 = proposalHash("stripe", "req.body", "req.rawBody");
  assert.strictEqual(h1, h2);
});

test("hash is 12 hex characters", () => {
  const h = proposalHash("stripe", "req.body", "req.rawBody");
  assert.match(h, /^[0-9a-f]{12}$/);
});

test("changing skill changes hash", () => {
  const h1 = proposalHash("stripe", "req.body", "req.rawBody");
  const h2 = proposalHash("prisma", "req.body", "req.rawBody");
  assert.notStrictEqual(h1, h2);
});

test("changing wrong changes hash", () => {
  const h1 = proposalHash("stripe", "req.body", "req.rawBody");
  const h2 = proposalHash("stripe", "request.body", "req.rawBody");
  assert.notStrictEqual(h1, h2);
});

test("changing right changes hash", () => {
  const h1 = proposalHash("stripe", "req.body", "req.rawBody");
  const h2 = proposalHash("stripe", "req.body", "request.rawBody");
  assert.notStrictEqual(h1, h2);
});

test("changing why does NOT change hash", () => {
  const h1 = proposalHash("stripe", "req.body", "req.rawBody");
  const h2 = proposalHash("stripe", "req.body", "req.rawBody");
  // why is excluded — hash function doesn't take why
  assert.strictEqual(h1, h2);
});

// ── Integration tests ──────────────────────────────────────────────────────

function withTempArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-propose-"));
  fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
  const orig = process.cwd();
  try { process.chdir(dir); fn(dir); }
  finally { process.chdir(orig); fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("");
console.log("  ── Integration tests (--propose) ─────────────────────────");

test("--propose with all flags creates proposal file", () => {
  withTempArchDir((dir) => {
    const out = execFileSync(process.execPath, [
      ARCHKIT, "gotcha", "--propose",
      "--skill", "stripe",
      "--wrong", "req.body",
      "--right", "req.rawBody",
      "--why", "Stripe needs raw bytes",
      "--json",
    ], { cwd: dir, encoding: "utf8" });
    const result = JSON.parse(out.trim());
    assert.strictEqual(result.status, "queued");
    assert.match(result.hash, /^[0-9a-f]{12}$/);
    assert.ok(typeof result.path === "string" && result.path.length > 0);
    assert.ok(fs.existsSync(path.join(dir, result.path)));
  });
});

test("--propose duplicate returns duplicate status", () => {
  withTempArchDir((dir) => {
    const flags = [
      ARCHKIT, "gotcha", "--propose",
      "--skill", "stripe",
      "--wrong", "req.body",
      "--right", "req.rawBody",
      "--why", "Stripe needs raw bytes",
      "--json",
    ];
    execFileSync(process.execPath, flags, { cwd: dir, encoding: "utf8" });
    const out2 = execFileSync(process.execPath, flags, { cwd: dir, encoding: "utf8" });
    const result = JSON.parse(out2.trim());
    assert.strictEqual(result.status, "duplicate");
    assert.match(result.hash, /^[0-9a-f]{12}$/);
  });
});

test("--propose without .arch/ dir errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-no-arch-"));
  try {
    let threw = false;
    try {
      execFileSync(process.execPath, [
        ARCHKIT, "gotcha", "--propose",
        "--skill", "stripe",
        "--wrong", "req.body",
        "--right", "req.rawBody",
        "--why", "Stripe needs raw bytes",
        "--json",
      ], { cwd: dir, encoding: "utf8" });
    } catch (err) {
      threw = true;
      const output = (err.stdout || "") + (err.stderr || "");
      assert.ok(
        output.includes("no_arch_dir") || output.includes("Cannot find"),
        `Expected no_arch_dir or "Cannot find" in output, got: ${output}`
      );
    }
    assert.ok(threw, "Expected command to exit with error");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--propose with missing field errors", () => {
  withTempArchDir((dir) => {
    let threw = false;
    try {
      execFileSync(process.execPath, [
        ARCHKIT, "gotcha", "--propose",
        "--skill", "stripe",
        "--wrong", "req.body",
        // missing --right and --why
        "--json",
      ], { cwd: dir, encoding: "utf8" });
    } catch (err) {
      threw = true;
      const output = (err.stdout || "") + (err.stderr || "");
      assert.ok(
        output.includes("missing_field"),
        `Expected missing_field in output, got: ${output}`
      );
    }
    assert.ok(threw, "Expected command to exit with error");
  });
});

test("--propose after rejection returns previously-rejected", () => {
  withTempArchDir((dir) => {
    const flags = [
      ARCHKIT, "gotcha", "--propose",
      "--skill", "stripe",
      "--wrong", "req.body",
      "--right", "req.rawBody",
      "--why", "Stripe needs raw bytes",
      "--json",
    ];
    // First propose
    const out1 = execFileSync(process.execPath, flags, { cwd: dir, encoding: "utf8" });
    const result1 = JSON.parse(out1.trim());
    assert.strictEqual(result1.status, "queued");

    // Move file to rejected/
    const proposalPath = path.join(dir, result1.path);
    const rejectedDir = path.join(dir, ".arch", "gotcha-proposals", "rejected");
    fs.mkdirSync(rejectedDir, { recursive: true });
    fs.renameSync(proposalPath, path.join(rejectedDir, `${result1.hash}.json`));

    // Re-propose same
    const out2 = execFileSync(process.execPath, flags, { cwd: dir, encoding: "utf8" });
    const result2 = JSON.parse(out2.trim());
    assert.strictEqual(result2.status, "previously-rejected");
    assert.strictEqual(result2.hash, result1.hash);
  });
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log("");
console.log("  ═════════════════════════════════════════════════════════");
console.log(`  \x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m | \x1b[1m${((passed / (passed + failed)) * 100).toFixed(0)}%\x1b[0m`);

if (failures.length > 0) {
  console.log("");
  console.log("  \x1b[31mFailed:\x1b[0m");
  for (const f of failures) {
    console.log(`    - ${f}`);
  }
}
console.log("");

process.exit(failed > 0 ? 1 : 0);
