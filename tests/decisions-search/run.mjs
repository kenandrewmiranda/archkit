#!/usr/bin/env node
// Tests for ADR read-back (archkit_decisions_search) + preflight recall.
//
// What this verifies:
//   - parseAdr extracts number/title/date/status/tags/sections
//   - listDecisions returns most-recent-first
//   - searchDecisions ranks by keyword and filters by status/tags
//   - runDecisionsSearchJson carries decisionsNote (empty) + nextStep
//   - resolve_preflight surfaces relatedDecisions for the feature

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { parseAdr, listDecisions, searchDecisions } from "../../src/lib/decisions.mjs";
import { runDecisionsSearchJson } from "../../src/commands/decisions.mjs";
import { cmdPreflight } from "../../src/commands/resolve/preflight.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

const ADR_1 = `# 1. Use Postgres for auth storage

- **Date**: 2026-05-01
- **Status**: Accepted
- **Tags**: database, auth

## Context

We need a relational store for the auth service.

## Decision

Use Postgres on Neon for auth persistence.

## Consequences

Single source of truth; managed backups.
`;

const ADR_2 = `# 2. Short-lived JWT sessions

- **Date**: 2026-05-02
- **Status**: Superseded
- **Tags**: auth, sessions

## Context

Sessions need to scale horizontally.

## Decision

Use short-lived JWTs for auth sessions instead of server-side state.

## Consequences

Stateless; rotation complexity.
`;

function withDecisions(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-adr-"));
  const arch = path.join(root, ".arch");
  const dDir = path.join(arch, "decisions", "proposed");
  fs.mkdirSync(dDir, { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "# SYSTEM.md\n## Type: Internal\n");
  fs.writeFileSync(path.join(arch, "decisions", "0001-use-postgres.md"), ADR_1);
  fs.writeFileSync(path.join(arch, "decisions", "0002-jwt-sessions.md"), ADR_2);
  // a non-.md and a proposed/ entry that must be ignored by listDecisions
  fs.writeFileSync(path.join(arch, "decisions", "README.txt"), "not an adr");
  fs.writeFileSync(path.join(dDir, "abc.json"), "{}");
  try { return fn({ root, arch }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

console.log("\n  decisions — parseAdr");

test("parseAdr extracts number, title, status, tags, and sections", () => {
  const adr = parseAdr(ADR_1, { filename: "0001-use-postgres.md" });
  assert.equal(adr.number, "1");
  assert.equal(adr.title, "Use Postgres for auth storage");
  assert.equal(adr.status, "accepted");
  assert.deepEqual(adr.tags, ["database", "auth"]);
  assert.match(adr.decision, /Postgres on Neon/);
  assert.match(adr.context, /relational store/);
  assert.match(adr.consequences, /Single source of truth/);
});

console.log("\n  decisions — listDecisions");

test("listDecisions returns ADRs most-recent-first and ignores non-ADRs", () => {
  withDecisions(({ arch }) => {
    const all = listDecisions(arch);
    assert.equal(all.length, 2, "only the two .md ADRs (README.txt + proposed/ ignored)");
    assert.equal(all[0].number, "2", "highest number first");
    assert.equal(all[1].number, "1");
  });
});

console.log("\n  decisions — searchDecisions");

test("searchDecisions ranks title/tag hits above body-only hits", () => {
  withDecisions(({ arch }) => {
    const hits = searchDecisions(arch, { query: "postgres" });
    assert.equal(hits[0].number, "1", "postgres ADR ranks first");
    assert.ok(hits[0].score > 0);
  });
});

test("searchDecisions with no query lists recent (score null)", () => {
  withDecisions(({ arch }) => {
    const hits = searchDecisions(arch, {});
    assert.equal(hits.length, 2);
    assert.equal(hits[0].score, null);
  });
});

test("searchDecisions filters by status and by tags", () => {
  withDecisions(({ arch }) => {
    const sup = searchDecisions(arch, { status: "superseded" });
    assert.deepEqual(sup.map((d) => d.number), ["2"]);
    const db = searchDecisions(arch, { tags: ["database"] });
    assert.deepEqual(db.map((d) => d.number), ["1"]);
  });
});

console.log("\n  decisions — runDecisionsSearchJson");

test("runDecisionsSearchJson notes an empty corpus and still gives nextStep", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-adr-empty-"));
  const arch = path.join(root, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  try {
    const res = runDecisionsSearchJson({ archDir: arch });
    assert.equal(res.returned, 0);
    assert.match(res.decisionsNote, /No ADRs/);
    assert.ok(res.nextStep.length > 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("runDecisionsSearchJson returns ranked hits with a recall-oriented nextStep", () => {
  withDecisions(({ arch }) => {
    const res = runDecisionsSearchJson({ archDir: arch, query: "auth" });
    assert.ok(res.returned >= 1);
    assert.equal(res.decisionsNote, undefined, "non-empty result has no note");
    assert.match(res.nextStep, /related ADR/i);
  });
});

console.log("\n  decisions — preflight recall");

test("cmdPreflight surfaces relatedDecisions for the feature", () => {
  withDecisions(({ arch }) => {
    // INDEX.md node so preflight resolves the feature.
    fs.writeFileSync(path.join(arch, "INDEX.md"),
      "## Nodes\n@auth = [auth] → src/features/auth/\n\n## Keywords\n");
    const r = cmdPreflight(arch, "auth", "service", { cwd: path.dirname(arch) });
    assert.ok(Array.isArray(r.relatedDecisions), "relatedDecisions present");
    assert.ok(r.relatedDecisions.length >= 1, "auth ADR(s) recalled");
    assert.match(r.nextStep, /ADR/);
  });
});

test("cmdPreflight explains an empty recall (silent-success)", () => {
  withDecisions(({ arch }) => {
    fs.writeFileSync(path.join(arch, "INDEX.md"),
      "## Nodes\n@billing = [billing] → src/features/billing/\n\n## Keywords\n");
    const r = cmdPreflight(arch, "billing", "service", { cwd: path.dirname(arch) });
    assert.deepEqual(r.relatedDecisions, []);
    assert.match(r.relatedDecisionsNote, /No prior ADR/);
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
