#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runLogDecisionJson } from "../../../src/commands/decisions.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-decisions-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- R\n");
  return arch;
}

const sampleArgs = {
  title: "Use Postgres as primary database",
  context: "We need a relational store with transactions and RLS for multi-tenant SaaS.",
  decision: "Use PostgreSQL on Neon (managed) or self-hosted on K3s (selfHosted mode).",
  consequences: "Single source of truth for app state. Tenant isolation enforced via $tenant column + RLS.",
};

await test("creates first decision file at 0001 with correct shape", async () => {
  const arch = makeFixture();
  try {
    const result = await runLogDecisionJson({ archDir: arch, ...sampleArgs });
    assert.equal(result.number, "0001");
    assert.equal(result.filename, "0001-use-postgres-as-primary-database.md");
    assert.equal(result.status, "accepted");
    assert.ok(fs.existsSync(result.path), "decision file should exist on disk");

    const body = fs.readFileSync(result.path, "utf8");
    assert.match(body, /^# 0001\. Use Postgres as primary database$/m);
    assert.match(body, /^- \*\*Date\*\*: \d{4}-\d{2}-\d{2}$/m);
    assert.match(body, /^- \*\*Status\*\*: Accepted$/m);
    assert.match(body, /^## Context$/m);
    assert.match(body, /^## Decision$/m);
    assert.match(body, /^## Consequences$/m);
    assert.match(body, /relational store/);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("auto-increments number when prior decisions exist", async () => {
  const arch = makeFixture();
  try {
    await runLogDecisionJson({ archDir: arch, ...sampleArgs });
    const second = await runLogDecisionJson({
      archDir: arch,
      title: "Use Drizzle ORM",
      context: "Need typed query builder.",
      decision: "Adopt Drizzle.",
      consequences: "Migrations become code-driven.",
    });
    assert.equal(second.number, "0002");
    assert.equal(second.filename, "0002-use-drizzle-orm.md");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("respects existing high-numbered decisions when incrementing", async () => {
  const arch = makeFixture();
  try {
    fs.mkdirSync(path.join(arch, "decisions"), { recursive: true });
    fs.writeFileSync(path.join(arch, "decisions", "0042-pre-existing.md"), "# 0042. Pre-existing\n");
    const result = await runLogDecisionJson({ archDir: arch, ...sampleArgs });
    assert.equal(result.number, "0043");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("renders tags line when tags are provided", async () => {
  const arch = makeFixture();
  try {
    const result = await runLogDecisionJson({
      archDir: arch,
      ...sampleArgs,
      tags: ["database", "stack"],
    });
    const body = fs.readFileSync(result.path, "utf8");
    assert.match(body, /^- \*\*Tags\*\*: database, stack$/m);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("omits tags line when tags are absent", async () => {
  const arch = makeFixture();
  try {
    const result = await runLogDecisionJson({ archDir: arch, ...sampleArgs });
    const body = fs.readFileSync(result.path, "utf8");
    assert.doesNotMatch(body, /\*\*Tags\*\*/);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("respects non-default status", async () => {
  const arch = makeFixture();
  try {
    const result = await runLogDecisionJson({ archDir: arch, ...sampleArgs, status: "proposed" });
    const body = fs.readFileSync(result.path, "utf8");
    assert.match(body, /^- \*\*Status\*\*: Proposed$/m);
    assert.equal(result.status, "proposed");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("slugifies titles with special characters and accents", async () => {
  const arch = makeFixture();
  try {
    const result = await runLogDecisionJson({
      archDir: arch,
      ...sampleArgs,
      title: "Use Café & Naïve patterns! (v2)",
    });
    assert.match(result.filename, /^0001-use-cafe-naive-patterns-v2\.md$/);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("throws on missing required field", async () => {
  const arch = makeFixture();
  try {
    await runLogDecisionJson({ archDir: arch, title: "x", context: "x", decision: "x" /* consequences missing */ });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "decision_invalid");
    assert.match(err.message, /consequences/);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("throws on whitespace-only required field", async () => {
  const arch = makeFixture();
  try {
    await runLogDecisionJson({ archDir: arch, ...sampleArgs, context: "   " });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "decision_invalid");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("throws on invalid status", async () => {
  const arch = makeFixture();
  try {
    await runLogDecisionJson({ archDir: arch, ...sampleArgs, status: "bogus" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "decision_invalid");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("throws on invalid tags shape", async () => {
  const arch = makeFixture();
  try {
    await runLogDecisionJson({ archDir: arch, ...sampleArgs, tags: ["ok", ""] });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "decision_invalid");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("throws when no archDir provided", async () => {
  try {
    await runLogDecisionJson({ ...sampleArgs });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "no_arch_dir");
  }
});

await test("creates decisions/ subdirectory if absent", async () => {
  const arch = makeFixture();
  try {
    const decisionsDir = path.join(arch, "decisions");
    assert.equal(fs.existsSync(decisionsDir), false, "fixture should not pre-create decisions/");
    await runLogDecisionJson({ archDir: arch, ...sampleArgs });
    assert.equal(fs.existsSync(decisionsDir), true);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
