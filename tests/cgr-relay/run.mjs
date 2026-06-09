#!/usr/bin/env node
// Tests for the CGR fresh-context relay loop (proto/cgr-relay-loop).
//
// What this verifies:
//   - Active-goal lifecycle: startGoal → in-progress, getActiveGoal finds it
//   - nextEligibleGoal respects depends-on (skips dep-blocked goals)
//   - Turn-cap state: bump increments, reset clears
//   - /mcp__archkit__goal_next prompt marks in-progress + injects payload
//   - Stop hook blocks (decision:block) while a goal is in-progress,
//     does NOT block on a question-to-user, nudges when none active,
//     and stays silent once the goal is done.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  writeGoal,
  startGoal,
  getActiveGoal,
  nextEligibleGoal,
  completeGoal,
  markTesting,
  loadGoal,
  parseGoal,
  bumpLoopBlock,
  readLoopState,
  resetLoopState,
  statusOf,
  goalsCompletedOn,
  consolidateGoals,
  deriveElapsedMs,
  formatDuration,
  effortOf,
  stampDate,
} from "../../src/lib/goals.mjs";
import { prompts, relayHeader, doneTodayTally } from "../../src/mcp/prompts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-stop-hook.mjs");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

// Works for both sync and async fn: for an async body we attach cleanup to the
// returned promise so the temp dir survives until the body resolves.
function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-relay-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Naming\nFiles: kebab\n");
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  let result;
  try { result = fn({ dir, archDir }); }
  catch (err) { cleanup(); throw err; }
  if (result && typeof result.then === "function") return result.finally(cleanup);
  cleanup();
  return result;
}

// Run the Stop hook with a synthetic event; return parsed stdout (or null).
function runHook({ cwd, assistant_response = "" }) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify({ cwd, assistant_response }),
    encoding: "utf8",
  });
  const trimmed = out.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

console.log("\n  cgr-relay — active-goal lifecycle");

await test("startGoal flips status to in-progress and getActiveGoal finds it", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "First", exitCriteria: ["tests pass"] });
    assert.equal(getActiveGoal(archDir), null, "nothing active before startGoal");
    startGoal(archDir, "g1");
    const active = getActiveGoal(archDir);
    assert.ok(active, "a goal is active after startGoal");
    assert.equal(active.slug, "g1");
    assert.equal(statusOf(active), "in-progress");
    assert.ok(active.meta.started, "started date recorded");
  });
});

await test("nextEligibleGoal skips a goal whose depends-on is incomplete, returns it once the dep is done", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "base", title: "Base", exitCriteria: ["done"] });
    writeGoal(archDir, { slug: "dependent", title: "Dependent", exitCriteria: ["done"], dependsOn: ["base"] });
    // Both planned. listGoals order is filesystem (alphabetical): base before dependent.
    let next = nextEligibleGoal(archDir);
    assert.equal(next.slug, "base", "picks the unblocked goal first");
    completeGoal(archDir, "base");
    next = nextEligibleGoal(archDir);
    assert.equal(next.slug, "dependent", "dependent becomes eligible after base completes");
  });
});

await test("nextEligibleGoal prefers an in-progress goal over planned ones", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "aaa", title: "A", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "zzz", title: "Z", exitCriteria: ["x"] });
    startGoal(archDir, "zzz");
    assert.equal(nextEligibleGoal(archDir).slug, "zzz", "resume the in-progress goal");
  });
});

console.log("\n  cgr-relay — turn-cap state");

await test("bumpLoopBlock increments per slug; resetLoopState clears; startGoal clears stale counter", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    assert.equal(bumpLoopBlock(archDir, "g1"), 1);
    assert.equal(bumpLoopBlock(archDir, "g1"), 2);
    assert.equal(readLoopState(archDir)["g1"], 2);
    resetLoopState(archDir);
    assert.deepEqual(readLoopState(archDir), {});
    bumpLoopBlock(archDir, "g1");
    startGoal(archDir, "g1"); // starting a goal resets its counter
    assert.equal(readLoopState(archDir)["g1"], undefined);
  });
});

console.log("\n  cgr-relay — goal_next prompt");

await test("goal_next marks the next goal in-progress and injects a relay payload", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "First goal", exitCriteria: ["criterion A", "criterion B"] });
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const res = await prompts.goal_next.handler();
      const text = res.messages[0].content.text;
      assert.match(text, /\[archkit CGR relay\] Active goal: g1/);
      assert.match(text, /criterion A/);
      assert.match(text, /archkit_goal_complete g1/);
    } finally {
      process.chdir(prevCwd);
    }
    assert.equal(statusOf(getActiveGoal(archDir)), "in-progress", "goal_next started the goal");
  });
});

await test("goal_next on an empty queue returns guidance, starts nothing", async () => {
  await withArchDir(async ({ dir, archDir }) => {
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const res = await prompts.goal_next.handler();
      assert.match(res.messages[0].content.text, /No eligible CGR goal/);
    } finally {
      process.chdir(prevCwd);
    }
    assert.equal(getActiveGoal(archDir), null);
  });
});

console.log("\n  cgr-relay — relay header composition (done-today + restatement)");

await test("in-progress header asks for a one-sentence restatement and shows no tally when nothing done today", () => {
  const header = relayHeader("g1", "in-progress", { tallyLine: "" });
  assert.match(header, /Active goal: g1/);
  assert.match(header, /restate this goal in ONE sentence/i, "restatement instruction present");
  assert.ok(!/Done today/.test(header), "empty-today case shows no tally line");
});

await test("testing header restates built-vs-verifying and frames the verification window", () => {
  const header = relayHeader("g2", "testing", { tallyLine: "✓ Done today (1): First" });
  assert.match(header, /Active goal: g2 \(TESTING/);
  assert.match(header, /restate in ONE sentence what was already built and what still needs verifying/i);
  assert.match(header, /verification window/);
  assert.match(header, /^✓ Done today \(1\): First/, "tally breadcrumb leads the header");
});

await test("tally line counts goals completed today across done/ raw + digest, deduped", () => {
  withArchDir(({ archDir }) => {
    const today = new Date().toISOString().slice(0, 10);
    // Two completed today: one already consolidated into the digest, one still
    // raw at done/ root (consolidate drains everything terminal, so digest the
    // first BEFORE completing the second to keep one of each).
    writeGoal(archDir, { slug: "digested-one", title: "Digested One", exitCriteria: ["x"] });
    startGoal(archDir, "digested-one"); completeGoal(archDir, "digested-one");
    consolidateGoals(archDir, { date: today }); // digested-one → digest
    writeGoal(archDir, { slug: "raw-one", title: "Raw One", exitCriteria: ["x"] });
    startGoal(archDir, "raw-one"); completeGoal(archDir, "raw-one"); // stays raw at done/ root

    const done = goalsCompletedOn(archDir, today);
    assert.equal(done.length, 2, "both goals counted, deduped by slug");
    assert.deepEqual(done.map((g) => g.slug).sort(), ["digested-one", "raw-one"]);

    const tally = doneTodayTally(archDir, today);
    assert.match(tally, /^✓ Done today \(2\):/);
    assert.match(tally, /Raw One/);
    assert.match(tally, /Digested One/);

    // A different day sees nothing → empty tally (graceful empty case).
    assert.equal(doneTodayTally(archDir, "1999-01-01"), "", "no tally for a day with no completions");
    assert.deepEqual(goalsCompletedOn(archDir, "1999-01-01"), []);
  });
});

console.log("\n  cgr-relay — per-goal time capture");

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

await test("startGoal/markTesting/completeGoal stamp full ISO-8601 datetimes (not date-only)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    assert.match(loadGoal(archDir, "g1").meta.started, ISO_DATETIME, "started is a datetime");

    markTesting(archDir, "g1");
    assert.match(loadGoal(archDir, "g1").meta["testing-since"], ISO_DATETIME, "testing-since is a datetime");

    const { archivedAt } = completeGoal(archDir, "g1");
    const { meta } = parseGoal(fs.readFileSync(archivedAt, "utf8"));
    assert.match(meta.completed, ISO_DATETIME, "completed is a datetime");
  });
});

await test("deriveElapsedMs / formatDuration compute wall-clock from started→completed", () => {
  // Pure derivation over fixed datetimes: 2h30m apart.
  const ms = deriveElapsedMs("2026-06-09T10:00:00.000Z", "2026-06-09T12:30:00.000Z");
  assert.equal(ms, 2.5 * 3600 * 1000, "2h30m in ms");
  assert.equal(formatDuration(ms), "2h 30m");
  assert.equal(formatDuration(45 * 60 * 1000), "45m");
  assert.equal(formatDuration(30 * 1000), "30s");
  // completed-before-started is not a valid span.
  assert.equal(deriveElapsedMs("2026-06-09T12:00:00Z", "2026-06-09T10:00:00Z"), null);
});

await test("parseGoal exposes elapsedMs on the goal record; completeGoal returns a non-negative elapsed", () => {
  withArchDir(({ archDir }) => {
    // A goal record carrying both datetime stamps surfaces elapsedMs directly.
    const synthetic = parseGoal(
      "---\nslug: s\nstarted: 2026-06-09T09:00:00.000Z\ncompleted: 2026-06-09T10:00:00.000Z\n---\n\nbody\n"
    );
    assert.equal(synthetic.elapsedMs, 3600 * 1000, "1h elapsed on the parsed record");

    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    const res = completeGoal(archDir, "g1");
    assert.equal(typeof res.elapsedMs, "number", "completeGoal derives elapsed");
    assert.ok(res.elapsedMs >= 0, "elapsed is non-negative");
    assert.equal(res.effort.source, "derived", "no override → derived effort");
  });
});

await test("explicit timeSpent override is persisted as time-spent and beats derived elapsed", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    const res = completeGoal(archDir, "g1", { timeSpent: "90m" });
    assert.equal(res.effort.source, "explicit", "override wins over derived");
    assert.equal(res.effort.display, "90m");
    assert.equal(typeof res.elapsedMs, "number", "derived elapsed still computed alongside");

    const { meta } = parseGoal(fs.readFileSync(res.archivedAt, "utf8"));
    assert.equal(meta["time-spent"], "90m", "persisted as time-spent frontmatter key");
    assert.equal(effortOf({ meta }).source, "explicit");
    assert.equal(effortOf({ meta }).display, "90m");
  });
});

await test("legacy date-only stamps degrade gracefully — no elapsed, no parse crash", () => {
  withArchDir(({ archDir }) => {
    // A pre-upgrade goal: date-only started/completed.
    const goalsRoot = path.join(archDir, "goals", "done");
    fs.mkdirSync(goalsRoot, { recursive: true });
    const legacy = "---\nslug: old\nstatus: completed\nstarted: 2026-06-01\ncompleted: 2026-06-02\n---\n\nlegacy\n";
    const fp = path.join(goalsRoot, "old.md");
    fs.writeFileSync(fp, legacy);

    const parsed = parseGoal(fs.readFileSync(fp, "utf8"));
    assert.equal(parsed.elapsedMs, null, "date-only → no elapsed (no midnight fiction)");
    assert.equal(effortOf(parsed).source, "none", "no effort to show");
    assert.equal(effortOf(parsed).display, null);
    assert.equal(deriveElapsedMs("2026-06-01", "2026-06-02"), null, "date-only pair derives nothing");

    // Day-grouping still finds the legacy completed goal (stampDate is a no-op).
    assert.equal(stampDate("2026-06-02"), "2026-06-02");
    const done = goalsCompletedOn(archDir, "2026-06-02");
    assert.deepEqual(done.map((g) => g.slug), ["old"], "legacy date-only goal still counted today");
    // Consolidation over a date-only legacy goal must not throw.
    assert.doesNotThrow(() => consolidateGoals(archDir, { date: "2026-06-02" }));
  });
});

console.log("\n  cgr-relay — Stop hook guard");

await test("Stop hook blocks (decision:block) while a goal is in-progress", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["tests pass", "no console.log"] });
    startGoal(archDir, "g1");
    const out = runHook({ cwd: dir, assistant_response: "I made some edits." });
    assert.ok(out, "hook produced output");
    assert.equal(out.decision, "block");
    assert.match(out.reason, /goal "g1" is still in progress/);
    assert.match(out.reason, /tests pass/);
    assert.match(out.reason, /archkit_goal_complete g1/);
  });
});

await test("Stop hook does NOT block when the response is a question to the user", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["tests pass"] });
    startGoal(archDir, "g1");
    const out = runHook({ cwd: dir, assistant_response: "Which database should I use, Postgres or SQLite?" });
    assert.ok(out, "hook produced output");
    assert.notEqual(out.decision, "block");
    assert.match(out.systemMessage, /reads as a question to the user/);
  });
});

await test("Stop hook nudges (no block) when no goal active but one is queued", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] }); // planned, not started
    const out = runHook({ cwd: dir, assistant_response: "Here is a summary." });
    assert.ok(out, "hook produced output");
    assert.notEqual(out.decision, "block");
    assert.match(out.systemMessage, /goal_next/);
  });
});

await test("Stop hook consolidates once on queue-drain, then is silent", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "g1", title: "G1", exitCriteria: ["x"] });
    startGoal(archDir, "g1");
    completeGoal(archDir, "g1"); // raw lands in done/ un-consolidated
    // First stop after drain: the session-end safety net consolidates the
    // terminal goal into the digest + archives the raw CGR, and says so once.
    const first = runHook({ cwd: dir, assistant_response: "All done." });
    assert.ok(first && first.systemMessage, "produces a consolidation notice");
    assert.match(first.systemMessage, /consolidated/i);
    assert.ok(!first.decision, "never blocks when nothing is queued");
    assert.ok(
      fs.existsSync(path.join(archDir, "goals", "done", "archive", "g1.md")),
      "raw CGR preserved verbatim under done/archive/"
    );
    // Idempotent: nothing left to drain → silent on the next stop.
    const second = runHook({ cwd: dir, assistant_response: "Still nothing to do." });
    assert.equal(second, null, "silent once the queue is drained and consolidated");
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
