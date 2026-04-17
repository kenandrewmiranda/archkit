#!/usr/bin/env node

/**
 * Skeleton Renderer Test Suite
 *
 * Verifies token substitution, comment prefix resolution, and combined
 * rendering behaviour.
 *
 * Usage:
 *   node tests/skeleton-renderer/run.mjs
 */

import { strict as assert } from "node:assert";
import { commentPrefix, renderSkeleton } from "../../src/lib/skeleton-renderer.mjs";

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
console.log("  │           ARCHKIT SKELETON RENDERER TESTS               │");
console.log("  └─────────────────────────────────────────────────────────┘");
console.log("");

// ── Token substitution ─────────────────────────────────────────────────────

test("substitutes {feature} token (lowercase)", () => {
  const result = renderSkeleton("export const {feature}Service = {};", { feature: "notify" });
  assert.strictEqual(result, "export const notifyService = {};");
});

test("substitutes {Feature} token (capitalized)", () => {
  const result = renderSkeleton("export class {Feature}Service {}", { feature: "notify" });
  assert.strictEqual(result, "export class NotifyService {}");
});

test("substitutes multiple tokens in one string", () => {
  const result = renderSkeleton(
    "import { {Feature} } from './{feature}.types';",
    { feature: "payment" }
  );
  assert.strictEqual(result, "import { Payment } from './payment.types';");
});

// ── commentPrefix ──────────────────────────────────────────────────────────

test("commentPrefix returns '//' for .ts", () => {
  assert.strictEqual(commentPrefix(".ts"), "//");
});

test("commentPrefix returns '//' for .tsx, .js, .mjs", () => {
  assert.strictEqual(commentPrefix(".tsx"), "//");
  assert.strictEqual(commentPrefix(".js"), "//");
  assert.strictEqual(commentPrefix(".mjs"), "//");
});

test("commentPrefix returns '#' for .py", () => {
  assert.strictEqual(commentPrefix(".py"), "#");
});

test("commentPrefix returns '--' for .sql", () => {
  assert.strictEqual(commentPrefix(".sql"), "--");
});

// ── {commentPrefix} token in template ─────────────────────────────────────

test("renderSkeleton substitutes {commentPrefix} token using fileExt", () => {
  const template = "{commentPrefix} a comment\nexport const x = 1;";
  const result = renderSkeleton(template, { feature: "x" }, ".ts");
  assert.strictEqual(result, "// a comment\nexport const x = 1;");
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log("");
if (failed === 0) {
  console.log(`  \x1b[32m✓ All ${passed} tests passed\x1b[0m`);
} else {
  console.log(`  \x1b[31m✗ ${failed} of ${passed + failed} tests failed\x1b[0m`);
  console.log("");
  for (const name of failures) {
    console.log(`    • ${name}`);
  }
}
console.log("");

if (failed > 0) process.exit(1);
