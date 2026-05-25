#!/usr/bin/env node
// Tests for src/lib/stack-detect.mjs — gates verify-wiring guidance on non-JS stacks.
// Source: arch-poly dogfood (Python-only project mandated to run verify-wiring → dead-weight output).

import { strict as assert } from "node:assert";
import { hasJsTsStack } from "../../src/lib/stack-detect.mjs";
import { genSystemMd } from "../../src/lib/generators.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

console.log("\n  stack-detect — hasJsTsStack");

test("SaaS default stack (Next.js + Hono) → true", () => {
  assert.equal(hasJsTsStack({
    stack: {
      "Frontend": "Next.js + Tailwind + shadcn/ui",
      "API Framework": "Hono",
      "Database": "PostgreSQL",
    },
  }), true);
});

test("Mobile (React Native) → true", () => {
  assert.equal(hasJsTsStack({
    stack: { "Framework": "React Native", "BFF API": "Hono" },
  }), true);
});

test("AI archetype (Next.js SSE + FastAPI mixed) → true (any JS counts)", () => {
  assert.equal(hasJsTsStack({
    stack: {
      "Frontend": "Next.js (streaming SSE UI)",
      "API": "FastAPI (Python)",
    },
  }), true);
});

test("Pure Python (FastAPI + Celery, no frontend) → false", () => {
  assert.equal(hasJsTsStack({
    stack: {
      "API": "FastAPI (Python)",
      "Database": "PostgreSQL",
      "Job Queue": "Celery",
      "Auth": "Keycloak",
    },
  }), false);
});

test("Pure Go → false", () => {
  assert.equal(hasJsTsStack({
    stack: { "Backend": "Go + chi router", "Database": "PostgreSQL" },
  }), false);
});

test("Pure Swift/SwiftUI → false", () => {
  assert.equal(hasJsTsStack({
    stack: { "App": "SwiftUI + SwiftData", "Backend": "Vapor (Swift)" },
  }), false);
});

test("No stack info → true (safe default — keep guidance)", () => {
  assert.equal(hasJsTsStack({}), true);
  assert.equal(hasJsTsStack({ stack: null }), true);
  assert.equal(hasJsTsStack(null), true);
});

test("Data archetype (React + FastAPI) → true (React present)", () => {
  assert.equal(hasJsTsStack({
    stack: {
      "Frontend": "React + ECharts + TanStack Query/Table",
      "API": "FastAPI (Python)",
    },
  }), true);
});

console.log("\n  generators.genSystemMd — verify-wiring gating");

const pythonCfg = {
  appName: "arch-poly",
  appType: "ai",
  stack: { "API": "FastAPI (Python)", "Database": "PostgreSQL" },
  features: [],
  skills: [],
};
const jsCfg = {
  appName: "test-saas",
  appType: "saas",
  stack: { "Frontend": "Next.js + Tailwind", "API Framework": "Hono" },
  features: [],
  skills: [],
};

test("Python-only SYSTEM.md omits verify-wiring", () => {
  const out = genSystemMd(pythonCfg);
  assert.equal(
    out.includes("verify-wiring"),
    false,
    "SYSTEM.md for Python project should not mention verify-wiring"
  );
});

test("JS SYSTEM.md keeps verify-wiring guidance", () => {
  const out = genSystemMd(jsCfg);
  assert.ok(
    out.includes("verify-wiring"),
    "SYSTEM.md for JS project should keep verify-wiring guidance"
  );
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
