#!/usr/bin/env node
// Tests for the CGR incremental consolidation / digest phase.
//
// What this verifies (cgr-consolidation-digest exit-criteria):
//   - consolidateGoals produces a dated per-day digest summarizing completed work
//   - It is INCREMENTAL — works while other goals are still pending (NOT gated
//     on the queue being empty)
//   - Raw completed CGR files are preserved VERBATIM under done/archive/<slug>.md
//   - The digest is discoverable/searchable (listDigests/searchDigests) + surfaces
//     through the existing archkit_goal_list surface
//   - isGoalDone still resolves after a raw file is archived (depends-on survives)
//   - Re-running consolidation is idempotent (no dupes, no lost content)
//   - End-to-end: completing the LAST goal drains the queue and triggers it

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  writeGoal,
  completeGoal,
  consolidateGoals,
  listDigests,
  searchDigests,
  listTerminalGoals,
  isGoalDone,
  archiveDir,
  digestDir,
} from "../../src/lib/goals.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-consol-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n  consolidation — digest generation + raw archival");

test("consolidateGoals digests completed goals and archives raw files verbatim", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { title: "First thing", exitCriteria: ["a done"] });
    writeGoal(archDir, { title: "Second thing", exitCriteria: ["b done"] });
    completeGoal(archDir, "first-thing", { notes: "shipped the first thing" });
    completeGoal(archDir, "second-thing", { notes: "shipped the second thing" });

    // Capture verbatim content of the raw done/ files BEFORE consolidation.
    const doneDirPath = path.join(archDir, "goals", "done");
    const rawFirst = fs.readFileSync(path.join(doneDirPath, "first-thing.md"), "utf8");
    const rawSecond = fs.readFileSync(path.join(doneDirPath, "second-thing.md"), "utf8");

    const r = consolidateGoals(archDir, { date: "2026-06-07" });
    assert.equal(r.consolidated, 2);
    assert.deepEqual(r.slugs.sort(), ["first-thing", "second-thing"]);

    // Digest exists, is dated, and names both goals.
    const digestPath = path.join(digestDir(archDir), "2026-06-07.md");
    assert.ok(fs.existsSync(digestPath), "dated digest should be written");
    const digest = fs.readFileSync(digestPath, "utf8");
    assert.ok(digest.includes("# CGR digest — 2026-06-07"));
    assert.ok(digest.includes("first-thing"));
    assert.ok(digest.includes("second-thing"));
    assert.ok(digest.includes("shipped the first thing"), "digest carries completion notes");
    assert.ok(digest.includes("goals/done/archive/first-thing.md"), "digest points at raw archive");

    // Raw files moved to archive/ VERBATIM (byte-for-byte equal to pre-consolidation).
    const aFirst = path.join(archiveDir(archDir), "first-thing.md");
    const aSecond = path.join(archiveDir(archDir), "second-thing.md");
    assert.ok(fs.existsSync(aFirst) && fs.existsSync(aSecond), "raw files archived");
    assert.equal(fs.readFileSync(aFirst, "utf8"), rawFirst, "archived raw is verbatim");
    assert.equal(fs.readFileSync(aSecond, "utf8"), rawSecond, "archived raw is verbatim");

    // Top-level done/ no longer holds the drained raw files.
    assert.ok(!fs.existsSync(path.join(doneDirPath, "first-thing.md")));
    assert.equal(listTerminalGoals(archDir).length, 0, "nothing left to consolidate");
  });
});

console.log("\n  consolidation — incremental (NOT gated on empty queue)");

test("consolidateGoals runs while other goals are still pending/in-progress", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { title: "Pending work", exitCriteria: ["later"] });   // stays in queue
    writeGoal(archDir, { title: "Done work", exitCriteria: ["now"] });
    completeGoal(archDir, "done-work", { notes: "finished mid-sprint" });

    // A goal is still active in goals/ root — consolidation must NOT require an
    // empty queue.
    const r = consolidateGoals(archDir, { date: "2026-06-07" });
    assert.equal(r.consolidated, 1);
    assert.deepEqual(r.slugs, ["done-work"]);
    assert.ok(fs.existsSync(path.join(archiveDir(archDir), "done-work.md")));
    // The still-pending goal is untouched in goals/ root.
    assert.ok(fs.existsSync(path.join(archDir, "goals", "pending-work.md")));
  });
});

console.log("\n  consolidation — idempotent re-run");

test("re-running consolidation is a no-op (no dupes, no lost content)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { title: "Only one", exitCriteria: ["x"] });
    completeGoal(archDir, "only-one", {});
    consolidateGoals(archDir, { date: "2026-06-07" });
    const digestPath = path.join(digestDir(archDir), "2026-06-07.md");
    const after1 = fs.readFileSync(digestPath, "utf8");

    const r2 = consolidateGoals(archDir, { date: "2026-06-07" });
    assert.equal(r2.consolidated, 0, "second run finds nothing terminal to drain");
    const after2 = fs.readFileSync(digestPath, "utf8");
    assert.equal(after1, after2, "digest unchanged on idempotent re-run");
    // Exactly one entry marker for the slug.
    const markers = after2.match(/<!-- cgr-digest-slug: only-one -->/g) || [];
    assert.equal(markers.length, 1, "no duplicate digest entry");
  });
});

test("same-day second batch appends to the existing digest without dupes", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { title: "Batch one", exitCriteria: ["x"] });
    completeGoal(archDir, "batch-one", {});
    consolidateGoals(archDir, { date: "2026-06-07" });

    writeGoal(archDir, { title: "Batch two", exitCriteria: ["y"] });
    completeGoal(archDir, "batch-two", {});
    const r = consolidateGoals(archDir, { date: "2026-06-07" });
    assert.equal(r.consolidated, 1);

    const digest = fs.readFileSync(path.join(digestDir(archDir), "2026-06-07.md"), "utf8");
    assert.ok(digest.includes("batch-one") && digest.includes("batch-two"), "both batches present");
    assert.equal((digest.match(/# CGR digest/g) || []).length, 1, "single header");
  });
});

console.log("\n  consolidation — depends-on survives archival");

test("isGoalDone resolves whether the raw file is in done/ or done/archive/", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { title: "Dependency", exitCriteria: ["x"] });
    completeGoal(archDir, "dependency", {});
    assert.equal(isGoalDone(archDir, "dependency"), true, "done before consolidation");
    consolidateGoals(archDir, { date: "2026-06-07" });
    assert.equal(isGoalDone(archDir, "dependency"), true, "still done after archival");
  });
});

console.log("\n  consolidation — discoverable + searchable");

test("listDigests / searchDigests surface the digest like decisions/", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { title: "Kalshi parser fix", exitCriteria: ["x"] });
    completeGoal(archDir, "kalshi-parser-fix", { notes: "fixed null prices" });
    consolidateGoals(archDir, { date: "2026-06-07" });

    const digests = listDigests(archDir);
    assert.equal(digests.length, 1);
    assert.equal(digests[0].date, "2026-06-07");
    assert.ok(digests[0].slugs.includes("kalshi-parser-fix"));
    assert.ok(digests[0].count >= 1);

    const hits = searchDigests(archDir, { query: "kalshi" });
    assert.equal(hits.length, 1, "keyword search finds the digest by slug");
    assert.ok(hits[0].score > 0);
    const miss = searchDigests(archDir, { query: "nonexistentterm" });
    assert.equal(miss.length, 0);
  });
});

console.log("\n  end-to-end — queue-drain triggers consolidation via the CLI");

function runGoal(args, cwd) {
  return execFileSync("node", [ARCHKIT, "goal", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

test("completing the last goal drains the queue + consolidates; goal_list surfaces it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-consol-e2e-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"),
      "# SYSTEM.md\n## Type: Internal\n## Pattern: x\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
    const intake = JSON.stringify({
      sourceAsk: "Two small tasks",
      goals: [
        { title: "Alpha", exitCriteria: ["A"] },
        { title: "Beta", exitCriteria: ["B"] },
      ],
    });
    runGoal(["intake", "--json", intake], dir);

    // Completing the first goal does NOT drain the queue → no consolidation yet.
    const first = JSON.parse(runGoal(["complete", "alpha", "--json"], dir));
    assert.equal(first.consolidation, null, "no consolidation while queue has work");

    // Completing the last goal drains the queue → consolidation fires.
    const last = JSON.parse(runGoal(["complete", "beta", "--json"], dir));
    assert.ok(last.consolidation, "consolidation runs on queue-drain");
    assert.ok(last.consolidation.consolidated >= 1, "drained goals were consolidated");

    // Raw archived + digest written on disk.
    const archive = path.join(dir, ".arch", "goals", "done", "archive");
    assert.ok(fs.existsSync(path.join(archive, "alpha.md")));
    assert.ok(fs.existsSync(path.join(archive, "beta.md")));

    // archkit_goal_list (the existing surface) exposes the digest, not a dead file.
    const list = JSON.parse(runGoal(["list", "--json"], dir));
    assert.ok(Array.isArray(list.digests) && list.digests.length >= 1, "goal list surfaces digests");
    assert.ok(list.archived >= 2, "goal list reports archived raw count");
    assert.ok(list.digests[0].slugs.includes("alpha") || list.digests[0].slugs.includes("beta"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
