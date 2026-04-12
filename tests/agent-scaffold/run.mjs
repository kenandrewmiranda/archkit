#!/usr/bin/env node

/**
 * Agent Scaffold Templates Test Suite
 *
 * Verifies that TEMPLATES object is exported with all required keys and content.
 *
 * Usage:
 *   node tests/agent-scaffold/run.mjs
 */

import { strict as assert } from "node:assert";
import { TEMPLATES } from "../../src/data/agent-scaffold-templates.mjs";

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
console.log("  │         ARCHKIT AGENT SCAFFOLD TEMPLATES TESTS          │");
console.log("  └─────────────────────────────────────────────────────────┘");
console.log("");

// ── Object shape ───────────────────────────────────────────────────────────

test("exports TEMPLATES object", () => {
  assert.ok(TEMPLATES !== null && typeof TEMPLATES === "object", "TEMPLATES should be an object");
});

test("has all 4 required templates: BOUNDARIES, SYSTEM, SKILLS_README, CLAUDE_MD", () => {
  assert.ok(typeof TEMPLATES.BOUNDARIES === "string", "TEMPLATES.BOUNDARIES should be a string");
  assert.ok(typeof TEMPLATES.SYSTEM === "string", "TEMPLATES.SYSTEM should be a string");
  assert.ok(typeof TEMPLATES.SKILLS_README === "string", "TEMPLATES.SKILLS_README should be a string");
  assert.ok(typeof TEMPLATES.CLAUDE_MD === "string", "TEMPLATES.CLAUDE_MD should be a string");
});

// ── BOUNDARIES template ────────────────────────────────────────────────────

test("BOUNDARIES template has AGENT-INSTRUCTIONS: START and END markers", () => {
  assert.ok(
    TEMPLATES.BOUNDARIES.includes("AGENT-INSTRUCTIONS: START"),
    "BOUNDARIES missing AGENT-INSTRUCTIONS: START"
  );
  assert.ok(
    TEMPLATES.BOUNDARIES.includes("AGENT-INSTRUCTIONS: END"),
    "BOUNDARIES missing AGENT-INSTRUCTIONS: END"
  );
});

// ── SYSTEM template ────────────────────────────────────────────────────────

test("SYSTEM template has AGENT-INSTRUCTIONS: START and END markers", () => {
  assert.ok(
    TEMPLATES.SYSTEM.includes("AGENT-INSTRUCTIONS: START"),
    "SYSTEM missing AGENT-INSTRUCTIONS: START"
  );
  assert.ok(
    TEMPLATES.SYSTEM.includes("AGENT-INSTRUCTIONS: END"),
    "SYSTEM missing AGENT-INSTRUCTIONS: END"
  );
});

// ── CLAUDE_MD template ─────────────────────────────────────────────────────

test("CLAUDE_MD template references .arch/ and gotcha", () => {
  assert.ok(
    TEMPLATES.CLAUDE_MD.includes(".arch/"),
    "CLAUDE_MD missing .arch/ reference"
  );
  assert.ok(
    TEMPLATES.CLAUDE_MD.toLowerCase().includes("gotcha"),
    "CLAUDE_MD missing gotcha reference"
  );
});

// ── SKILLS_README template ─────────────────────────────────────────────────

test("SKILLS_README template references WRONG, RIGHT, WHY", () => {
  assert.ok(
    TEMPLATES.SKILLS_README.includes("WRONG"),
    "SKILLS_README missing WRONG"
  );
  assert.ok(
    TEMPLATES.SKILLS_README.includes("RIGHT"),
    "SKILLS_README missing RIGHT"
  );
  assert.ok(
    TEMPLATES.SKILLS_README.includes("WHY"),
    "SKILLS_README missing WHY"
  );
});

// ── No forbidden strings ───────────────────────────────────────────────────

test("no templates contain literal TODO or TBD", () => {
  for (const [key, value] of Object.entries(TEMPLATES)) {
    assert.ok(
      !value.includes("TODO"),
      `TEMPLATES.${key} contains literal TODO`
    );
    assert.ok(
      !value.includes("TBD"),
      `TEMPLATES.${key} contains literal TBD`
    );
  }
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
