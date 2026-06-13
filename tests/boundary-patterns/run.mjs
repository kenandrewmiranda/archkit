#!/usr/bin/env node
import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOD = pathToFileURL(path.resolve(__dirname, "../../src/lib/boundary-patterns.mjs")).href;
const { detectViolations, formatViolation, _internals } = await import(MOD);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

console.log("\nboundary-patterns — universal NEVER detectors\n");

// ─── sql_string_concat ─────────────────────────────────────────────────────

test("sql_string_concat — flags classic concat", () => {
  const code = '`const q = "SELECT * FROM users WHERE id = " + userId;`';
  const v = detectViolations(code);
  assert.equal(v.length, 1);
  assert.equal(v[0].patternName, "sql_string_concat");
  assert.equal(v[0].ruleId, "U-001");
});

test("sql_string_concat — flags UPDATE concat too", () => {
  const code = 'const u = "UPDATE accounts SET balance = " + amt + " WHERE id = " + uid;';
  assert.ok(detectViolations(code).length >= 1);
});

test("sql_string_concat — does NOT flag parameterized query", () => {
  const code = `db.query("SELECT * FROM users WHERE id = $1", [userId]);`;
  assert.equal(detectViolations(code).length, 0);
});

test("sql_string_concat — does NOT flag prose with SQL keywords", () => {
  const code = "We use SELECT statements for the main query layer.";
  assert.equal(detectViolations(code).length, 0);
});

test("sql_string_concat — does NOT flag template literal with placeholder lib", () => {
  // sql template tag (postgres.js / slonik / drizzle-style) — not concat
  const code = 'const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;';
  assert.equal(detectViolations(code).length, 0);
});

// ─── hardcoded_credential ──────────────────────────────────────────────────

test("hardcoded_credential — flags real-shaped sk- key", () => {
  const code = 'const KEY = "sk-abc123def456ghi789jkl012mno345pq";';
  const v = detectViolations(code);
  assert.equal(v.length, 1);
  assert.equal(v[0].patternName, "hardcoded_credential");
  assert.equal(v[0].label, "OpenAI/Anthropic-style key");
});

test("hardcoded_credential — flags AKIA AWS key", () => {
  const code = 'AWS_KEY = "AKIAIOSFODNN7EXAMPLE"';
  // EXAMPLE marker should suppress this one
  assert.equal(detectViolations(code).length, 0, "EXAMPLE placeholder should suppress");
});

test("hardcoded_credential — flags real AKIA without placeholder marker", () => {
  const code = 'AWS_KEY = "AKIA1234567890ABCDEF"';
  assert.equal(detectViolations(code).length, 1);
});

test("hardcoded_credential — flags GitHub PAT shape", () => {
  const code = 'const t = "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789";';
  // Won't match because the prefix is split across strings.
  assert.equal(detectViolations(code).length, 0);

  const code2 = 'const t = "ghp_abcdefghijklmnopqrstuvwxyz123456";';
  assert.equal(detectViolations(code2).length, 1);
});

test("hardcoded_credential — does NOT flag env var pattern", () => {
  const code = 'const KEY = process.env.OPENAI_API_KEY;';
  assert.equal(detectViolations(code).length, 0);
});

test("hardcoded_credential — does NOT flag obvious placeholder", () => {
  const code = 'const KEY = "sk-your-api-key-here-replace-me";';
  assert.equal(detectViolations(code).length, 0);
});

test("hardcoded_credential — does NOT flag short prefix-shaped non-key", () => {
  const code = 'const x = "sk-foo";'; // too short to match
  assert.equal(detectViolations(code).length, 0);
});

// ─── unvalidated_input ─────────────────────────────────────────────────────

test("unvalidated_input — flags req.body without validator nearby", () => {
  const code = `
    app.post("/users", async (req, res) => {
      const user = await db.users.create(req.body);
      res.json(user);
    });
  `;
  const v = detectViolations(code);
  assert.equal(v.length, 1);
  assert.equal(v[0].patternName, "unvalidated_input");
});

test("unvalidated_input — does NOT flag req.body with z.parse nearby", () => {
  const code = `
    app.post("/users", async (req, res) => {
      const data = UserSchema.parse(req.body);
      const user = await db.users.create(data);
      res.json(user);
    });
  `;
  assert.equal(detectViolations(code).length, 0);
});

test("unvalidated_input — does NOT flag with safeParse nearby", () => {
  const code = `
    const result = schema.safeParse(req.query);
    if (!result.success) return res.status(400).json(result.error);
  `;
  assert.equal(detectViolations(code).length, 0);
});

test("unvalidated_input — flags req.query without validator", () => {
  const code = `const id = req.query.id; const result = await db.findById(id);`;
  assert.equal(detectViolations(code).length, 1);
});

test("unvalidated_input — flags req.params without validator", () => {
  const code = `const slug = req.params.slug; render(slug);`;
  assert.equal(detectViolations(code).length, 1);
});

// ─── shape + ordering ──────────────────────────────────────────────────────

test("detectViolations — empty / non-string returns []", () => {
  assert.deepEqual(detectViolations(""), []);
  assert.deepEqual(detectViolations(null), []);
  assert.deepEqual(detectViolations(123), []);
});

test("detectViolations — multiple violations sorted by position", () => {
  const code = `
    const slug = req.params.slug;
    const KEY = "sk-abc123def456ghi789jkl012mno345pq";
    const q = "SELECT * FROM users WHERE id = " + req.body.id;
  `;
  const v = detectViolations(code);
  assert.ok(v.length >= 3, `expected ≥3 violations, got ${v.length}`);
  for (let i = 1; i < v.length; i++) {
    assert.ok(v[i].idx >= v[i - 1].idx, "violations must be sorted by idx");
  }
});

test("each violation has required fields", () => {
  const code = 'const KEY = "sk-abc123def456ghi789jkl012mno345pq";';
  const v = detectViolations(code)[0];
  assert.ok(v.patternName);
  assert.ok(v.ruleId);
  assert.ok(v.ruleText);
  assert.ok(v.line >= 1);
  assert.ok(v.matchedText);
  assert.ok(v.snippet);
});

test("formatViolation produces compact one-liner", () => {
  const v = detectViolations('const q = "SELECT * FROM x WHERE id = " + id;')[0];
  const line = formatViolation(v);
  assert.match(line, /BOUNDARY VIOLATION/);
  assert.match(line, /U-001/);
  assert.match(line, /line \d+/);
});

test("PATTERNS exposes 3 universal detectors", () => {
  assert.equal(_internals.PATTERNS.length, 3);
  const names = _internals.PATTERNS.map((p) => p.name).sort();
  assert.deepEqual(names, ["hardcoded_credential", "sql_string_concat", "unvalidated_input"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
