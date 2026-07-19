#!/usr/bin/env node
// Tests for reconcileGoalsLayout — full-tree, status-driven placement reconcile.
//
// Status is the source of truth; the folder is a derived cache (ADR 0003). These
// verify that a goal buried anywhere in the tree is re-filed to the folder its
// status dictates, that zombie duplicate slugs collapse to the in-place copy,
// that status-less junk .md files are quarantined (never deleted), and that the
// whole thing is a pure dry-run under apply:false, never throws, and is
// idempotent on re-run.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  reconcileGoalsLayout,
  quarantineDir,
  goalsDir,
  queueDir,
  testingDir,
  doneDir,
  archiveDir,
} from "../../src/lib/goals.mjs";
import { runGoalReconcile } from "../../src/commands/goal.mjs";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-reconcile-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "goals"), { recursive: true });
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Write a goal .md at an ARBITRARY path under goals/ (bypassing writeGoal, which
// would file it correctly) so we can plant it out of place on purpose.
function plant(archDir, relPath, { slug, status, project, title } = {}) {
  const full = path.join(goalsDir(archDir), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fm = [
    `slug: ${slug}`,
    `title: ${title || slug}`,
    `status: ${status}`,
    ...(project ? [`project: ${project}`] : []),
  ].join("\n");
  fs.writeFileSync(full, `---\n${fm}\n---\n\n# ${title || slug}\n`);
  return full;
}

const exists = (...p) => fs.existsSync(path.join(...p));

console.log("\n  cgr-reconcile — canonical placement by status");

test("a pending goal buried 2 levels deep is found and re-filed into queue/", () => {
  withArchDir(({ archDir }) => {
    // goals/a/b/deep-pending.md — invisible to the one-level queue scan, so the
    // relay would skip it. The full-tree walk must find and re-file it.
    plant(archDir, "a/b/deep-pending.md", { slug: "deep-pending", status: "pending" });
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.ok(report.moved.some((m) => m.slug === "deep-pending" && m.status === "pending"));
    assert.ok(exists(queueDir(archDir), "deep-pending.md"), "landed in queue/");
    assert.ok(!exists(goalsDir(archDir), "a", "b", "deep-pending.md"), "source removed");
  });
});

test("a project-tagged pending goal is re-filed under queue/<project>/", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "stray.md", { slug: "stray", status: "pending", project: "Search Revamp" });
    reconcileGoalsLayout(archDir, { apply: true });
    assert.ok(exists(queueDir(archDir), "search-revamp", "stray.md"), "nests under slugified project");
    assert.ok(!exists(goalsDir(archDir), "stray.md"), "source removed");
  });
});

test("a completed goal sitting in queue/ is re-filed into done/", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "queue/comp.md", { slug: "comp", status: "completed" });
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.ok(report.moved.some((m) => m.slug === "comp" && m.status === "completed"));
    assert.ok(exists(doneDir(archDir), "comp.md"), "landed in done/");
    assert.ok(!exists(queueDir(archDir), "comp.md"), "source removed from queue/");
  });
});

test("an in-progress goal sitting in queue/ is re-filed to goals/ root", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "queue/ip.md", { slug: "ip", status: "in-progress" });
    reconcileGoalsLayout(archDir, { apply: true });
    assert.ok(exists(goalsDir(archDir), "ip.md"), "landed at root");
    assert.ok(!exists(queueDir(archDir), "ip.md"), "source removed from queue/");
  });
});

test("an on-hold goal in queue/ is re-filed to goals/ root", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "queue/parked.md", { slug: "parked", status: "on-hold" });
    reconcileGoalsLayout(archDir, { apply: true });
    assert.ok(exists(goalsDir(archDir), "parked.md"));
    assert.ok(!exists(queueDir(archDir), "parked.md"));
  });
});

console.log("\n  cgr-reconcile — already-placed goals are left alone");

test("goals already in their canonical folder are not moved", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "queue/pend.md", { slug: "pend", status: "pending" });
    plant(archDir, "live.md", { slug: "live", status: "in-progress" });
    plant(archDir, "testing/tst.md", { slug: "tst", status: "testing" });
    plant(archDir, "done/finished.md", { slug: "finished", status: "completed" });
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.equal(report.moved.length, 0, "nothing out of place");
    assert.equal(report.outOfPlaceCount, 0);
  });
});

test("an already-consolidated completed goal in done/archive/ is left in place", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "done/archive/old.md", { slug: "old", status: "completed" });
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.equal(report.moved.length, 0, "archive copy counts as placed");
    assert.ok(exists(archiveDir(archDir), "old.md"), "not dragged up to done/ top-level");
  });
});

console.log("\n  cgr-reconcile — duplicate slugs across dirs");

test("a duplicate slug collapses to the copy whose location matches its status", () => {
  withArchDir(({ archDir }) => {
    // status testing → canonical testing/. The queue/ copy is the zombie.
    const keep = plant(archDir, "testing/dup.md", { slug: "dup", status: "testing" });
    plant(archDir, "queue/sub/dup.md", { slug: "dup", status: "testing" });
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.equal(report.duplicates.length, 1);
    assert.equal(report.duplicates[0].slug, "dup");
    assert.ok(report.duplicates[0].kept.endsWith("testing/dup.md"), report.duplicates[0].kept);
    assert.ok(report.duplicates[0].removed.endsWith(path.join("queue", "sub", "dup.md")));
    assert.ok(fs.existsSync(keep), "in-place copy survives");
    assert.ok(!exists(queueDir(archDir), "sub", "dup.md"), "zombie removed");
  });
});

test("a duplicate slug with NO placed copy keeps one and re-files it", () => {
  withArchDir(({ archDir }) => {
    // Both copies out of place (status pending, neither in queue/).
    plant(archDir, "x/dup2.md", { slug: "dup2", status: "pending" });
    plant(archDir, "y/dup2.md", { slug: "dup2", status: "pending" });
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.equal(report.duplicates.length, 1, "one copy dropped as duplicate");
    // Exactly one survivor, now in queue/.
    assert.ok(exists(queueDir(archDir), "dup2.md"), "survivor re-filed to queue/");
    const survivors = [exists(goalsDir(archDir), "x", "dup2.md"), exists(goalsDir(archDir), "y", "dup2.md")];
    assert.deepEqual(survivors, [false, false], "both original locations cleared");
  });
});

console.log("\n  cgr-reconcile — quarantine of junk / status-less .md files");

test("a .md with no frontmatter is quarantined, not treated as a goal", () => {
  withArchDir(({ archDir }) => {
    const junk = path.join(goalsDir(archDir), "notes.md");
    fs.writeFileSync(junk, "# Just some notes\nnot a goal at all\n");
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.equal(report.quarantined.length, 1);
    assert.ok(report.quarantined[0].file.endsWith("notes.md"));
    assert.ok(exists(quarantineDir(archDir), "notes.md"), "moved into quarantine/");
    assert.ok(!fs.existsSync(junk), "removed from goals/ root");
  });
});

test("a .md with frontmatter but no status field is quarantined", () => {
  withArchDir(({ archDir }) => {
    const f = path.join(goalsDir(archDir), "half.md");
    fs.writeFileSync(f, "---\nslug: half\ntitle: Half\n---\n\n# Half\n");
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.equal(report.quarantined.length, 1);
    assert.equal(report.quarantined[0].reason, "missing status field");
    assert.ok(exists(quarantineDir(archDir), "half.md"));
  });
});

test("the coordination board and digest files are never quarantined or moved", () => {
  withArchDir(({ archDir }) => {
    fs.writeFileSync(path.join(goalsDir(archDir), "chat.md"), "# CGR agent coordination board\n");
    fs.mkdirSync(path.join(doneDir(archDir), "digest"), { recursive: true });
    fs.writeFileSync(path.join(doneDir(archDir), "digest", "2026-01-01.md"), "# Digest\nsummary\n");
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.equal(report.quarantined.length, 0, "board + digest are non-goals, skipped");
    assert.equal(report.moved.length, 0);
    assert.ok(exists(goalsDir(archDir), "chat.md"), "board untouched");
    assert.ok(exists(doneDir(archDir), "digest", "2026-01-01.md"), "digest untouched");
  });
});

console.log("\n  cgr-reconcile — dry-run, tolerance, idempotency, report shape");

test("apply:false is a pure dry-run — the report is computed but nothing is written", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "a/b/deep.md", { slug: "deep", status: "pending" });
    plant(archDir, "queue/dup.md", { slug: "keeper", status: "testing" });
    plant(archDir, "testing/keeper.md", { slug: "keeper", status: "testing" });
    const junk = path.join(goalsDir(archDir), "junk.md");
    fs.writeFileSync(junk, "no frontmatter here\n");

    const report = reconcileGoalsLayout(archDir, { apply: false });
    assert.ok(report.moved.length >= 1, "reports the move");
    assert.ok(report.duplicates.length >= 1, "reports the duplicate");
    assert.ok(report.quarantined.length >= 1, "reports the junk");

    // Disk is UNTOUCHED.
    assert.ok(exists(goalsDir(archDir), "a", "b", "deep.md"), "deep goal not moved");
    assert.ok(!exists(queueDir(archDir), "deep.md"), "queue/ not written");
    assert.ok(exists(queueDir(archDir), "dup.md"), "duplicate not removed");
    assert.ok(fs.existsSync(junk), "junk not quarantined");
    assert.ok(!fs.existsSync(quarantineDir(archDir)), "quarantine/ not even created");
  });
});

test("never throws on a missing/empty goals tree — returns an empty report", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-reconcile-empty-"));
  try {
    const archDir = path.join(dir, ".arch"); // no goals/ at all
    const report = reconcileGoalsLayout(archDir, { apply: true });
    assert.deepEqual(report.moved, []);
    assert.deepEqual(report.duplicates, []);
    assert.deepEqual(report.quarantined, []);
    assert.equal(report.outOfPlaceCount, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("idempotent — a second apply over a reconciled tree changes nothing", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "a/b/deep.md", { slug: "deep", status: "pending" });
    plant(archDir, "queue/comp.md", { slug: "comp", status: "completed" });
    plant(archDir, "queue/dup.md", { slug: "dup", status: "testing" });
    plant(archDir, "testing/dup.md", { slug: "dup", status: "testing" });
    fs.writeFileSync(path.join(goalsDir(archDir), "junk.md"), "garbage\n");

    const first = reconcileGoalsLayout(archDir, { apply: true });
    assert.ok(first.moved.length + first.duplicates.length + first.quarantined.length > 0, "first run does work");

    const second = reconcileGoalsLayout(archDir, { apply: true });
    assert.deepEqual(second.moved, [], "no moves on re-run");
    assert.deepEqual(second.duplicates, [], "no duplicates on re-run");
    assert.deepEqual(second.quarantined, [], "no quarantines on re-run");
    assert.equal(second.outOfPlaceCount, 0);
  });
});

test("report has the documented shape; outOfPlaceCount == moved.length", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "queue/comp.md", { slug: "comp", status: "completed" });
    plant(archDir, "queue/ip.md", { slug: "ip", status: "in-progress" });
    const report = reconcileGoalsLayout(archDir, { apply: false });
    for (const key of ["moved", "duplicates", "quarantined", "outOfPlaceCount"]) {
      assert.ok(key in report, `report has ${key}`);
    }
    assert.ok(Array.isArray(report.moved) && Array.isArray(report.duplicates) && Array.isArray(report.quarantined));
    for (const m of report.moved) {
      for (const k of ["slug", "from", "to", "status"]) assert.ok(k in m, `moved entry has ${k}`);
    }
    assert.equal(report.outOfPlaceCount, report.moved.length);
  });
});

test("legacy status aliases (planned/done) reconcile by their normalized status", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "legacy-planned.md", { slug: "lp", status: "planned" });   // → pending → queue/
    plant(archDir, "queue/legacy-done.md", { slug: "ld", status: "done" });   // → completed → done/
    reconcileGoalsLayout(archDir, { apply: true });
    assert.ok(exists(queueDir(archDir), "lp.md"), "planned alias filed to queue/");
    assert.ok(exists(doneDir(archDir), "ld.md"), "done alias filed to done/");
  });
});

console.log("\n  cgr-reconcile — runGoalReconcile handler (MCP wiring)");

test("handler dry-run by DEFAULT: reports proposed moves but writes nothing", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "a/b/deep.md", { slug: "deep", status: "pending" });
    const out = runGoalReconcile({ archDir }); // apply omitted → dry-run
    assert.equal(out.apply, false, "defaults to dry-run");
    assert.ok(out.moved.some((m) => m.slug === "deep"), "reports the move");
    assert.equal(out.outOfPlaceCount, out.moved.length, "count matches moved");
    assert.ok(typeof out.nextStep === "string" && out.nextStep.length > 0, "carries nextStep");
    // Disk untouched.
    assert.ok(exists(goalsDir(archDir), "a", "b", "deep.md"), "source still in place");
    assert.ok(!exists(queueDir(archDir), "deep.md"), "queue/ not written");
  });
});

test("handler apply:true performs the moves", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "queue/comp.md", { slug: "comp", status: "completed" });
    const out = runGoalReconcile({ archDir, apply: true });
    assert.equal(out.apply, true);
    assert.ok(out.moved.some((m) => m.slug === "comp" && m.status === "completed"));
    assert.ok(exists(doneDir(archDir), "comp.md"), "moved into done/");
    assert.ok(!exists(queueDir(archDir), "comp.md"), "source removed");
  });
});

test("handler on an already-tidy tree returns a reconcileNote + nextStep, no changes", () => {
  withArchDir(({ archDir }) => {
    plant(archDir, "queue/pend.md", { slug: "pend", status: "pending" });
    const out = runGoalReconcile({ archDir, apply: true });
    assert.equal(out.moved.length, 0);
    assert.equal(out.duplicates.length, 0);
    assert.equal(out.quarantined.length, 0);
    assert.ok(typeof out.reconcileNote === "string" && out.reconcileNote.length > 0, "silent-success note present");
    assert.ok(out.nextStep.length > 0);
  });
});

test("handler throws a structured no_arch_dir error when archDir is missing", () => {
  assert.throws(() => runGoalReconcile({ archDir: null }), (err) => err.code === "no_arch_dir");
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
