#!/usr/bin/env node

/**
 * Goal-frontmatter fidelity suite (frontmatter-colon-escaping).
 *
 * The regression: goal frontmatter is hand-rolled key:value (no YAML dep), and
 * exit criteria are author prose — "X is preserved: a lane containing…". Emitted
 * bare, the colon-space made the scalar pass harvest the list ITEM as a bogus
 * top-level key; the next write re-emitted it as a stray unindented line right
 * after the block, and the read after that swallowed it back as a PHANTOM
 * DUPLICATE criterion. A worker then chases criteria the author never wrote.
 *
 * Covers:
 *  - colon / dash / backtick / bracket / hash-bearing criteria round-trip exactly
 *  - the SAME quoting on every frontmatter list (files-to-touch, owns,
 *    required-reading, depends-on), not just exit-criteria
 *  - a read→write cycle (stampGoalFields) emits no stray unindented lines and no
 *    bogus top-level keys
 *  - already-corrupted files on disk are tolerated on read (no throw, no phantom)
 *
 * Usage:
 *   node tests/cgr-frontmatter/run.mjs
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeGoal,
  loadGoal,
  listGoals,
  parseGoal,
  stampGoalFields,
  renderPayload,
} from "../../src/lib/goals.mjs";

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[90m${err.message}\x1b[0m`); failed++; failures.push(name); }
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-fm-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "goals"), { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# SYSTEM.md\n## App: x\n## Type: saas\n");
  return { dir, archDir };
}

// The real criteria from the batch that exposed the bug, plus the other YAML
// indicators a criterion can legally start with.
const NASTY_CRITERIA = [
  "Cross-lane dependency order from orderMergeQueue is preserved: a lane containing a CGR that depends_on a CGR in another lane still lands after it",
  "bucketMergeGuidance is CI-aware: when cgr.finalize.ciCd indicates a CI provider, it emits push + open-a-PR guidance (e.g. `git push -u origin <branch>`) instead of a direct merge",
  "- a criterion that itself starts with a dash",
  "# not a comment: a criterion starting with a hash",
  "& anchor-looking, * alias-looking and [bracket] leading indicators survive",
  "A trailing colon:",
  "no punctuation at all here",
];

console.log("\n  ┌─────────────────────────────────────────────┐");
console.log("  │        ARCHKIT CGR FRONTMATTER              │");
console.log("  └─────────────────────────────────────────────┘\n");

// ── Round-trip ───────────────────────────────────────────────────────────────

test("colon/dash/backtick criteria round-trip EXACTLY (write → read)", () => {
  const { archDir } = fixture();
  writeGoal(archDir, { slug: "nasty", title: "Nasty", exitCriteria: NASTY_CRITERIA });
  const g = loadGoal(archDir, "nasty");
  assert.deepEqual(g.meta["exit-criteria"], NASTY_CRITERIA,
    "criteria must survive verbatim — no extra, dropped, or reordered entries");
});

test("every frontmatter LIST is quoted, not just exit-criteria", () => {
  const { archDir } = fixture();
  const filesToTouch = ["src/lib/goals.mjs", "notes: about the file", "*.mjs"];
  const requiredReading = ["docs/ADR-0013.md", "ADR 0010: instruct-not-act"];
  const dependsOn = ["lane-reconcile-stage", "pr-based-landing: the CI-aware one"];
  const owns = ["src/lib/*", "- weird glob", "docs/**"];
  writeGoal(archDir, {
    slug: "lists", title: "Lists", exitCriteria: ["ok"],
    filesToTouch, requiredReading, dependsOn, owns,
  });
  const g = loadGoal(archDir, "lists");
  assert.deepEqual(g.meta["files-to-touch"], filesToTouch, "files-to-touch");
  assert.deepEqual(g.meta["required-reading"], requiredReading, "required-reading");
  assert.deepEqual(g.meta["depends-on"], dependsOn, "depends-on");
  assert.deepEqual(g.meta.owns, owns, "owns");
});

test("a colon-bearing TITLE / verify-command round-trips as a scalar", () => {
  const { archDir } = fixture();
  writeGoal(archDir, {
    slug: "scalars",
    title: "Finalize: changelog, docs, commits",
    exitCriteria: ["ok"],
    verifyCommand: "npm test -- --grep 'a: b'",
  });
  const g = loadGoal(archDir, "scalars");
  assert.equal(g.meta.title, "Finalize: changelog, docs, commits");
  assert.equal(g.meta["verify-command"], "npm test -- --grep 'a: b'");
});

// ── No corruption on the read → write cycle ──────────────────────────────────

test("read→write cycle emits NO stray top-level lines and no bogus keys", () => {
  const { archDir } = fixture();
  writeGoal(archDir, { slug: "cycle", title: "Cycle", exitCriteria: NASTY_CRITERIA });
  // stampGoalFields is the real read→mutate→write path the conductor drives.
  stampGoalFields(archDir, "cycle", { lane: "lane-cycle" });
  const g = loadGoal(archDir, "cycle");
  const raw = fs.readFileSync(g.filepath, "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)[1];
  const stray = fm.split("\n").filter((l) => /^-\s/.test(l));
  assert.deepEqual(stray, [], `stray unindented list lines in frontmatter: ${stray.join(" | ")}`);
  const bogus = Object.keys(g.meta).filter((k) => !/^[\w][\w.-]*$/.test(k));
  assert.deepEqual(bogus, [], `bogus frontmatter keys: ${bogus.join(" | ")}`);
  assert.deepEqual(g.meta["exit-criteria"], NASTY_CRITERIA, "criteria unchanged by the cycle");
  assert.equal(g.meta.lane, "lane-cycle", "the stamped field landed");
});

test("payload renders exactly the authored criteria — no phantom duplicates", () => {
  const { archDir } = fixture();
  writeGoal(archDir, { slug: "phantom", title: "Phantom", exitCriteria: NASTY_CRITERIA });
  stampGoalFields(archDir, "phantom", { lane: "l" });
  const { payload } = renderPayload(archDir, "phantom");
  const numbered = payload.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.equal(numbered.length, NASTY_CRITERIA.length,
    `payload listed ${numbered.length} criteria for ${NASTY_CRITERIA.length} authored`);
});

// ── Tolerating already-corrupted files ───────────────────────────────────────

// Exactly what the pre-fix writer produced: the colon-bearing criterion appears
// once inside the block AND once as a stray unindented line after it.
const CORRUPTED = `---
slug: legacy
title: Legacy corrupted goal
status: pending
created: 2026-08-02
exit-criteria:
  - board.mjs exposes a reconcile plan
  - Cross-lane dependency order is preserved: a lane still lands after it
- Cross-lane dependency order is preserved: a lane still lands after it
files-to-touch:
  - src/lib/board.mjs
verify-command: npm test
---

# Legacy corrupted goal
`;

test("an already-corrupted goal file reads without throwing", () => {
  const { archDir } = fixture();
  fs.mkdirSync(path.join(archDir, "goals", "queue"), { recursive: true });
  fs.writeFileSync(path.join(archDir, "goals", "queue", "legacy.md"), CORRUPTED);
  const g = loadGoal(archDir, "legacy");
  assert.ok(g, "corrupted goal still resolves");
  assert.equal(g.meta.slug, "legacy");
  assert.equal(g.meta["verify-command"], "npm test", "later keys are not swallowed");
  assert.deepEqual(g.meta["exit-criteria"], [
    "board.mjs exposes a reconcile plan",
    "Cross-lane dependency order is preserved: a lane still lands after it",
  ], "the stray duplicate is healed, not surfaced as a 3rd criterion");
  assert.deepEqual(listGoals(archDir).map((x) => x.slug), ["legacy"], "listGoals tolerates it too");
});

test("re-writing a corrupted goal drops the stray line permanently", () => {
  const { archDir } = fixture();
  fs.mkdirSync(path.join(archDir, "goals", "queue"), { recursive: true });
  const fp = path.join(archDir, "goals", "queue", "legacy.md");
  fs.writeFileSync(fp, CORRUPTED);
  stampGoalFields(archDir, "legacy", { lane: "healed" });
  const raw = fs.readFileSync(fp, "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.deepEqual(fm.split("\n").filter((l) => /^-\s/.test(l)), [], "stray line gone after rewrite");
  assert.equal(parseGoal(raw).meta["exit-criteria"].length, 2, "still exactly 2 criteria");
});

console.log(`\n  ${passed + failed} tests | \x1b[32m${passed} passed\x1b[0m | ${failed ? `\x1b[31m${failed} failed\x1b[0m` : "0 failed"}`);
if (failures.length) console.log(`  FAILED: ${failures.join(", ")}`);
process.exit(failed > 0 ? 1 : 0);
