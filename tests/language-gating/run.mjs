import { strict as assert } from "node:assert";
import { classifyStack, shouldRunJsEcosystemChecks } from "../../src/commands/review/language.mjs";
import { checkApiPatterns } from "../../src/commands/review/api-checks.mjs";
import { checkDatabasePatterns } from "../../src/commands/review/db-checks.mjs";
import { parseSystem } from "../../src/lib/parsers.mjs";

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

// classifyStack ─────────────────────────────────────────────────────────────

console.log("\nclassifyStack");

test("classifies Swift stack as non-js", () => {
  assert.equal(classifyStack("Swift 5.9 / SwiftUI / SwiftData"), "non-js");
});

test("classifies TypeScript/Next stack as js", () => {
  assert.equal(classifyStack("TypeScript / Next.js / Drizzle"), "js");
});

test("classifies Go stack as non-js", () => {
  assert.equal(classifyStack("Go 1.22 / Gin / Postgres"), "non-js");
});

test("classifies Python stack as non-js", () => {
  assert.equal(classifyStack("Python 3.12 / FastAPI"), "non-js");
});

test("does NOT misclassify TypeScript as Java", () => {
  // "typescript" contains "java" + "script"; ensure JS tokens win.
  assert.equal(classifyStack("TypeScript / Node"), "js");
});

test("returns unknown for empty stack", () => {
  assert.equal(classifyStack(""), "unknown");
  assert.equal(classifyStack(undefined), "unknown");
});

// shouldRunJsEcosystemChecks ────────────────────────────────────────────────

console.log("\nshouldRunJsEcosystemChecks");

test("runs for .ts file regardless of stack", () => {
  assert.equal(shouldRunJsEcosystemChecks("src/api.ts", "Swift"), true);
});

test("skips for .swift file regardless of stack", () => {
  assert.equal(shouldRunJsEcosystemChecks("App/Today.swift", "TypeScript"), false);
});

test("skips for .kt, .go, .py, .rs files", () => {
  assert.equal(shouldRunJsEcosystemChecks("app/Main.kt", ""), false);
  assert.equal(shouldRunJsEcosystemChecks("cmd/server/main.go", ""), false);
  assert.equal(shouldRunJsEcosystemChecks("app/views.py", ""), false);
  assert.equal(shouldRunJsEcosystemChecks("src/main.rs", ""), false);
});

test("falls back to stack for ambiguous extensions", () => {
  assert.equal(shouldRunJsEcosystemChecks("Makefile", "Swift"), false);
  assert.equal(shouldRunJsEcosystemChecks("Makefile", "TypeScript"), true);
  assert.equal(shouldRunJsEcosystemChecks("Makefile", ""), true); // preserve prior default
});

// Bug-report regression: Swift files do not trigger JS findings ─────────────

console.log("\nBug-report regression (Swift)");

test("SwiftData ModelContext.fetch does NOT trigger http-client", () => {
  const swift = `let entries = try modelContext.fetch(FetchDescriptor<Entry>())`;
  // Only meaningful if our gating prevents this from running; verify both
  // that the resolver returns false AND that if the rule did run, it would
  // misfire (so we're testing the right thing).
  assert.equal(shouldRunJsEcosystemChecks("App/TodayViewModel.swift", "Swift"), false);
  const raw = checkApiPatterns(swift, "App/TodayViewModel.swift");
  assert.ok(
    raw.some(f => f.type === "http-client"),
    "expected the underlying rule to misfire on Swift code (this is the bug we're gating)"
  );
});

test("Swift static factory .from(_:) does NOT trigger db-efficiency", () => {
  const swift = `let backup = KaceBackup(baby: .from(baby), entries: entries.map { .from($0) })`;
  assert.equal(shouldRunJsEcosystemChecks("App/Backup.swift", "Swift"), false);
  const raw = checkDatabasePatterns(swift, "App/Backup.swift");
  assert.ok(
    raw.some(f => f.type === "db-efficiency"),
    "expected the underlying rule to misfire on Swift code (this is the bug we're gating)"
  );
});

// JS still triggers (no regression) ─────────────────────────────────────────

console.log("\nJS still triggers (no regression)");

test("fetch() in .ts still flagged by api-checks", () => {
  const ts = `const res = await fetch('https://example.com/api');`;
  assert.equal(shouldRunJsEcosystemChecks("src/api.ts", "TypeScript"), true);
  const findings = checkApiPatterns(ts, "src/api.ts");
  assert.ok(findings.some(f => f.type === "http-client"), "expected http-client finding on real JS fetch");
});

test("Drizzle .from(table) in .ts still flagged by db-checks", () => {
  const ts = `const rows = db.select().from(users);`;
  assert.equal(shouldRunJsEcosystemChecks("src/queries.ts", "TypeScript"), true);
  const findings = checkDatabasePatterns(ts, "src/queries.ts");
  assert.ok(findings.some(f => f.type === "db-efficiency"), "expected db-efficiency finding on real Drizzle query");
});

// parseSystem now extracts ## Stack: ────────────────────────────────────────

console.log("\nparseSystem stack extraction");

test("extracts Stack field from SYSTEM.md", () => {
  const md = `# System\n## Type: Mobile (iOS + watchOS)\n## Stack: Swift 5.9 / SwiftUI / SwiftData\n`;
  const parsed = parseSystem(md);
  assert.equal(parsed.stack, "Swift 5.9 / SwiftUI / SwiftData");
});

test("returns empty stack when not declared", () => {
  const md = `# System\n## Type: SaaS\n`;
  const parsed = parseSystem(md);
  assert.equal(parsed.stack, "");
});

// Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
