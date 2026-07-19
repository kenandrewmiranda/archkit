#!/usr/bin/env node
// Tests for detectStaleGoals (goal-staleness-triage).
//
// Placement reconcile can't catch a genuinely-pending goal from ANOTHER project
// sitting correctly in the queue — its status matches its folder, so by placement
// it belongs. detectStaleGoals cross-references the board event log, the chat
// coordination file, the `created:` age, and the current git branch to surface
// that cross-project cruft as an ADVISORY finding. These verify: an orphaned
// pending goal (untouched, undiscussed, old, other branch) is flagged as
// `dismiss`; a live, recent, discussed goal is NOT flagged; the age threshold and
// branch-match knobs are configurable; missing board/chat files are tolerated;
// and the scan NEVER mutates disk.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeGoal,
  startGoal,
  goalsDir,
  queueDir,
} from "../../src/lib/goals.mjs";
import { appendEvent, eventsPath } from "../../src/lib/board.mjs";
import { detectStaleGoals, DEFAULT_STALENESS } from "../../src/lib/goal-triage.mjs";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-staleness-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "goals"), { recursive: true });
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeChat(archDir, text) {
  fs.writeFileSync(path.join(goalsDir(archDir), "chat.md"), text);
}

const find = (findings, slug) => findings.find((f) => f.slug === slug);

const NOW = "2026-07-19T00:00:00Z";
const OLD = "2026-01-01";   // ~199 days before NOW → stale under default 14
const TODAY = "2026-07-19"; // same day as NOW → age 0, not stale

console.log("\n  cgr-staleness — orphaned cross-project cruft is flagged");

test("orphaned pending (no board, no chat, old, other branch) → flagged 'dismiss'", () => {
  withArchDir(({ archDir }) => {
    // Correctly placed: a pending goal writeGoal files into queue/<project>/.
    writeGoal(archDir, { slug: "orphan-beta", title: "Orphan Beta", project: "beta", created: OLD });
    // We're on feat/alpha — beta is a DIFFERENT project's work sitting in the queue.
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW });
    const f = find(findings, "orphan-beta");
    assert.ok(f, "the orphan is surfaced");
    assert.deepEqual(
      [...f.reasons].sort(),
      ["branch-mismatch", "no-board-event", "no-chat-mention", "stale-created"],
      "all four staleness signals trip",
    );
    assert.equal(f.suggestion, "dismiss", "cross-project + old + untouched → dismiss");
    assert.equal(f.project, "beta");
    assert.ok(f.ageDays > 14, "age is computed in days");
  });
});

test("a softer pile-up (old + undiscussed, but on-branch & board-touched) → 'hold'", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "aged-alpha", title: "Aged Alpha", project: "alpha", created: OLD });
    appendEvent(archDir, { type: "claimed", slug: "aged-alpha", worker: "w1", at: OLD });
    writeChat(archDir, "# board\n(nothing about this one)\n");
    // On feat/alpha, so NO branch-mismatch; it WAS claimed, so board event exists.
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW });
    const f = find(findings, "aged-alpha");
    assert.ok(f, "still surfaced");
    assert.deepEqual([...f.reasons].sort(), ["no-chat-mention", "stale-created"]);
    assert.equal(f.suggestion, "hold", "two soft signals → hold");
  });
});

test("a single lone signal → 'keep' (surfaced for awareness only)", () => {
  withArchDir(({ archDir }) => {
    // Recent, on-branch, board-touched — but nobody mentioned it in chat.
    writeGoal(archDir, { slug: "lonely", title: "Lonely", created: TODAY });
    appendEvent(archDir, { type: "claimed", slug: "lonely", worker: "w1", at: TODAY });
    // no chat.md at all
    const findings = detectStaleGoals(archDir, { branch: "main", now: NOW });
    const f = find(findings, "lonely");
    assert.ok(f, "surfaced");
    assert.deepEqual(f.reasons, ["no-chat-mention"]);
    assert.equal(f.suggestion, "keep", "one lone signal → keep");
  });
});

console.log("\n  cgr-staleness — live / recent work is NOT flagged");

test("an active, recent, discussed, board-touched goal is not flagged", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "active-live", title: "Active Live", created: TODAY });
    startGoal(archDir, "active-live");                                  // in-progress
    appendEvent(archDir, { type: "claimed", slug: "active-live", worker: "w1", at: TODAY });
    writeChat(archDir, "# board\nworking on active-live right now\n");
    const findings = detectStaleGoals(archDir, { branch: "main", now: NOW });
    assert.equal(find(findings, "active-live"), undefined, "clean goal absent from findings");
  });
});

test("only cruft is returned when clean and stale goals coexist", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "active-live", title: "Active Live", created: TODAY });
    appendEvent(archDir, { type: "claimed", slug: "active-live", worker: "w1", at: TODAY });
    writeGoal(archDir, { slug: "orphan-beta", title: "Orphan Beta", project: "beta", created: OLD });
    writeChat(archDir, "# board\nworking on active-live\n");
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW });
    assert.deepEqual(findings.map((f) => f.slug), ["orphan-beta"], "only the orphan surfaces");
  });
});

console.log("\n  cgr-staleness — age threshold & branch-match are configurable");

test("cgr.staleness.ageDays raises the bar so an old goal is no longer stale", () => {
  withArchDir(({ archDir }) => {
    fs.writeFileSync(path.join(archDir, "config.json"),
      JSON.stringify({ cgr: { staleness: { ageDays: 3650 } } }, null, 2));
    writeGoal(archDir, { slug: "aged-alpha", title: "Aged", project: "alpha", created: OLD });
    appendEvent(archDir, { type: "claimed", slug: "aged-alpha", worker: "w1", at: OLD });
    writeChat(archDir, "aged-alpha in flight\n");
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW });
    // No stale (huge threshold), no mismatch (on-branch), has board + chat → clean.
    assert.equal(find(findings, "aged-alpha"), undefined, "threshold makes it not stale");
  });
});

test("ageDays option overrides config/default", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "aged-alpha", title: "Aged", project: "alpha", created: OLD });
    appendEvent(archDir, { type: "claimed", slug: "aged-alpha", worker: "w1", at: OLD });
    writeChat(archDir, "aged-alpha noted\n");
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW, ageDays: 100000 });
    assert.equal(find(findings, "aged-alpha"), undefined, "explicit ageDays override wins");
  });
});

test("cgr.staleness.branchMatch:false disables the branch-mismatch signal", () => {
  withArchDir(({ archDir }) => {
    fs.writeFileSync(path.join(archDir, "config.json"),
      JSON.stringify({ cgr: { staleness: { branchMatch: false } } }, null, 2));
    writeGoal(archDir, { slug: "orphan-beta", title: "Orphan", project: "beta", created: OLD });
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW });
    const f = find(findings, "orphan-beta");
    assert.ok(f, "still stale on the other axes");
    assert.ok(!f.reasons.includes("branch-mismatch"), "branch dimension is off");
  });
});

test("branchMatch option overrides config/default", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "orphan-beta", title: "Orphan", project: "beta", created: OLD });
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW, branchMatch: false });
    const f = find(findings, "orphan-beta");
    assert.ok(f && !f.reasons.includes("branch-mismatch"), "option disables branch dimension");
  });
});

test("no branch-mismatch when on a generic (main) branch", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "orphan-beta", title: "Orphan", project: "beta", created: OLD });
    const findings = detectStaleGoals(archDir, { branch: "main", now: NOW });
    const f = find(findings, "orphan-beta");
    assert.ok(f, "still surfaced on other axes");
    assert.ok(!f.reasons.includes("branch-mismatch"), "main → no single project context");
  });
});

test("no branch-mismatch when the goal's project matches the current branch", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "on-track", title: "On Track", project: "alpha", created: OLD });
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW });
    const f = find(findings, "on-track");
    assert.ok(f && !f.reasons.includes("branch-mismatch"), "same project → on-context");
  });
});

test("DEFAULT_STALENESS documents the sane defaults", () => {
  assert.equal(DEFAULT_STALENESS.ageDays, 14);
  assert.equal(DEFAULT_STALENESS.branchMatch, true);
});

console.log("\n  cgr-staleness — tolerance & purity");

test("missing board log and chat file are tolerated (no crash)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "solo", title: "Solo", created: OLD });
    // No .arch/board/ dir, no chat.md — the greenfield case.
    let findings;
    assert.doesNotThrow(() => { findings = detectStaleGoals(archDir, { branch: "main", now: NOW }); });
    assert.ok(Array.isArray(findings), "returns an array");
    const f = find(findings, "solo");
    assert.ok(f, "the untouched old goal is flagged");
    assert.ok(f.reasons.includes("no-board-event") && f.reasons.includes("no-chat-mention"));
  });
});

test("completely empty goals tree → empty findings, never throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-staleness-empty-"));
  try {
    const archDir = path.join(dir, ".arch"); // no goals/ at all
    let findings;
    assert.doesNotThrow(() => { findings = detectStaleGoals(archDir, { branch: "main", now: NOW }); });
    assert.deepEqual(findings, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the scan is PURE — it writes/moves/deletes nothing", () => {
  withArchDir(({ archDir }) => {
    const { filepath } = writeGoal(archDir, { slug: "orphan-beta", title: "Orphan", project: "beta", created: OLD });
    appendEvent(archDir, { type: "claimed", slug: "unrelated", worker: "w1", at: OLD });
    writeChat(archDir, "# board\nsome chatter\n");

    const goalBefore = fs.readFileSync(filepath, "utf8");
    const eventsBefore = fs.readFileSync(eventsPath(archDir), "utf8");
    const chatBefore = fs.readFileSync(path.join(goalsDir(archDir), "chat.md"), "utf8");
    const queueBefore = fs.readdirSync(path.join(queueDir(archDir), "beta")).sort();

    detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW });

    assert.equal(fs.readFileSync(filepath, "utf8"), goalBefore, "goal file untouched");
    assert.equal(fs.readFileSync(eventsPath(archDir), "utf8"), eventsBefore, "event log untouched");
    assert.equal(fs.readFileSync(path.join(goalsDir(archDir), "chat.md"), "utf8"), chatBefore, "chat untouched");
    assert.deepEqual(fs.readdirSync(path.join(queueDir(archDir), "beta")).sort(), queueBefore, "nothing moved");
  });
});

test("on-hold work is skipped (deliberate park is not cruft)", () => {
  withArchDir(({ archDir }) => {
    // Fake an on-hold goal directly in goals/ root (status is source of truth).
    fs.writeFileSync(path.join(goalsDir(archDir), "parked.md"),
      "---\nslug: parked\ntitle: Parked\nstatus: on-hold\nproject: beta\ncreated: 2026-01-01\n---\n\n# Parked\n");
    const findings = detectStaleGoals(archDir, { branch: "feat/alpha", now: NOW });
    assert.equal(find(findings, "parked"), undefined, "on-hold is intentional, not triaged");
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
