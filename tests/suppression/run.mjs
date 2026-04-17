import { strict as assert } from "node:assert";
import { parseSuppressions, validateReason, isWeakReason } from "../../src/lib/suppression.mjs";

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

// ── Parser ───────────────────────────────────────────────────────────────────

console.log("\nParser");

test("parses single-line suppression", () => {
  const code = "// archkit: ignore floating-promise — fire-and-forget telemetry batched in worker\nfetchMetric();";
  const result = parseSuppressions(code);
  assert.equal(result.length, 1, "expected 1 suppression");
  assert.equal(result[0].ruleId, "floating-promise");
  assert.ok(result[0].reason.includes("telemetry"), "reason should include 'telemetry'");
  assert.equal(result[0].line, 2, "should apply to next line (line 2)");
});

test("parses same-line suppression", () => {
  const code = "fetchMetric(); // archkit: ignore floating-promise — known fire-and-forget pattern\n";
  const result = parseSuppressions(code);
  assert.equal(result.length, 1, "expected 1 suppression");
  assert.equal(result[0].ruleId, "floating-promise");
  assert.equal(result[0].line, 1, "should apply to current line (line 1)");
});

test("parses # comment style", () => {
  const code = "# archkit: ignore untracked-todo — internal scratch file, not for production\nx = 1";
  const result = parseSuppressions(code);
  assert.equal(result.length, 1, "expected 1 suppression");
  assert.equal(result[0].ruleId, "untracked-todo");
});

test("ignores malformed suppression (no reason)", () => {
  const code = "// archkit: ignore floating-promise\nfetchMetric();";
  const result = parseSuppressions(code);
  assert.equal(result.length, 0, "expected no valid suppressions");
});

// ── Reason Validation ────────────────────────────────────────────────────────

console.log("\nReason Validation");

test("isWeakReason flags 'fixed'", () => {
  assert.equal(isWeakReason("fixed"), true);
});

test("isWeakReason flags 'n/a'", () => {
  assert.equal(isWeakReason("n/a"), true);
});

test("isWeakReason flags 'see comment' (case insensitive)", () => {
  assert.equal(isWeakReason("See Comment"), true);
});

test("isWeakReason allows substantive reason", () => {
  assert.equal(isWeakReason("small lookup table, columns vary per consumer"), false);
});

test("validateReason returns ok for substantive reason", () => {
  const result = validateReason("fire-and-forget telemetry batched in worker");
  assert.deepEqual(result, { ok: true });
});

test("validateReason returns weak for blocklist reason", () => {
  const result = validateReason("fixed");
  assert.deepEqual(result, { ok: false, weak: true });
});

test("validateReason returns missing for empty", () => {
  const result = validateReason("");
  assert.deepEqual(result, { ok: false, missing: true });
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
