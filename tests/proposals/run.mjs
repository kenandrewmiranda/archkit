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
