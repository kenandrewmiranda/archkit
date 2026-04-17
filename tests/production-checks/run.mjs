import { strict as assert } from "node:assert";
import { checkFloatingPromise, checkMockDataLeftover, checkDeadErrorHandler, checkUntrackedTodo } from "../../src/commands/review/production-checks.mjs";
import { checkIncompleteSkeleton } from "../../src/commands/review/completeness-checks.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Floating Promise ─────────────────────────────────────────────────────────

console.log("\nFloating Promise");

test("flags bare async call without await", () => {
  const findings = checkFloatingPromise(
    "async function fetchData() {}\nfetchData();",
    "src/main.ts"
  );
  assert.ok(findings.length > 0, "expected at least one finding");
  assert.equal(findings[0].type, "floating-promise");
});

test("does NOT flag void-prefixed async call", () => {
  const findings = checkFloatingPromise(
    "async function fetchData() {}\nvoid fetchData();",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

test("does NOT flag awaited call", () => {
  const findings = checkFloatingPromise(
    "async function fetchData() {}\nawait fetchData();",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

test("does NOT flag in test file", () => {
  const findings = checkFloatingPromise(
    "async function fetchData() {}\nfetchData();",
    "src/main.test.ts"
  );
  assert.equal(findings.length, 0, "expected no findings for test file");
});

// ── Mock Data Leftover ───────────────────────────────────────────────────────

console.log("\nMock Data Leftover");

test("flags // mock data comment in non-test file", () => {
  const findings = checkMockDataLeftover(
    "// mock data\nconst users = [];",
    "src/api.ts"
  );
  assert.ok(findings.length > 0, "expected at least one finding");
  assert.equal(findings[0].type, "mock-data-leftover");
});

test("flags Math.random() in non-game context", () => {
  const findings = checkMockDataLeftover(
    "const id = Math.random().toString();",
    "src/api.ts"
  );
  assert.ok(findings.length > 0, "expected at least one finding");
});

test("flags John Doe / Jane Doe / Test User", () => {
  const findings = checkMockDataLeftover(
    'const u = { name: "John Doe", email: "foo@bar.com" };',
    "src/api.ts"
  );
  assert.ok(findings.length >= 1, "expected at least one finding");
});

test("does NOT flag in test files", () => {
  const findings = checkMockDataLeftover(
    "// mock data\nconst users = [];",
    "src/api.test.ts"
  );
  assert.equal(findings.length, 0, "expected no findings for test file");
});

// ── Dead Error Handler ───────────────────────────────────────────────────────

console.log("\nDead Error Handler");

test("flags empty catch block", () => {
  const findings = checkDeadErrorHandler(
    "try { x(); } catch (e) {}",
    "src/main.ts"
  );
  assert.ok(findings.length > 0, "expected at least one finding");
  assert.equal(findings[0].type, "dead-error-handler");
  assert.equal(findings[0].severity, "error");
});

test("flags catch with only console.log", () => {
  const findings = checkDeadErrorHandler(
    "try { x(); } catch (e) { console.log(e); }",
    "src/main.ts"
  );
  assert.ok(findings.length > 0, "expected at least one finding");
  assert.equal(findings[0].severity, "error");
});

test("does NOT flag catch that re-throws", () => {
  const findings = checkDeadErrorHandler(
    "try { x(); } catch (e) { throw e; }",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

test("does NOT flag catch that calls log.error", () => {
  const findings = checkDeadErrorHandler(
    "try { x(); } catch (e) { log.error(e); }",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

// ── Untracked TODO ───────────────────────────────────────────────────────────

console.log("\nUntracked TODO");

test("flags bare TODO without ticket", () => {
  const findings = checkUntrackedTodo(
    "// TODO: handle errors",
    "src/main.ts"
  );
  assert.ok(findings.length > 0, "expected at least one finding");
  assert.equal(findings[0].type, "untracked-todo");
});

test("does NOT flag TODO with ticket reference", () => {
  const findings = checkUntrackedTodo(
    "// TODO(KAL-42): handle errors",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

test("does NOT flag TODO with #issue reference", () => {
  const findings = checkUntrackedTodo(
    "// TODO(#42): handle errors",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

test("does NOT flag TODO with @owner reference", () => {
  const findings = checkUntrackedTodo(
    "// TODO(@kenmiranda): handle errors",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

test("does NOT flag TODO with date", () => {
  const findings = checkUntrackedTodo(
    "// TODO(2026-05-01): handle errors",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

// ── Incomplete Skeleton ──────────────────────────────────────────────────────

console.log("\nIncomplete Skeleton");

test("flags skeleton with unchecked AGENT-VALIDATION", () => {
  const findings = checkIncompleteSkeleton(
    "// AGENT-VALIDATION (required before completion)\n// [ ] Verify imports\n// [ ] Project conventions\nexport const x = 1;",
    "src/main.ts"
  );
  assert.ok(findings.length > 0, "expected at least one finding");
  assert.equal(findings[0].type, "incomplete-skeleton");
});

test("does NOT flag fully-ticked skeleton", () => {
  const findings = checkIncompleteSkeleton(
    "// AGENT-VALIDATION (required before completion)\n// [x] Verify imports\n// [x] Project conventions\nexport const x = 1;",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

test("does NOT flag file with no AGENT-VALIDATION block", () => {
  const findings = checkIncompleteSkeleton(
    "export const x = 1;",
    "src/main.ts"
  );
  assert.equal(findings.length, 0, "expected no findings");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
