#!/usr/bin/env node
// Tests for the CGR worklog export (goal-worklog-export).
//
// What this verifies (goal-worklog-export exit-criteria):
//   - renderWorklog reads completed-goal data from done/ root, done/archive/,
//     AND consolidated done/digest/ entries (the three sources)
//   - Each entry shows title, outcome, completion notes, and time — explicit
//     effort verbatim, derived elapsed tagged '(elapsed)', never confused
//   - Default range is today; an explicit date range filters correctly
//   - Output is copy-pasteable markdown
//   - The CLI `archkit worklog --json` and the lib agree end-to-end

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  renderWorklog,
  collectWorklogEntries,
  effortToMs,
  formatDuration,
  consolidateGoals,
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-worklog-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Write a completed goal file directly (full control over stamps/effort/notes),
// into done/ root by default or done/archive/ when `dir:"archive"`.
function writeCompletedGoal(archDir, g) {
  const target = g.dir === "archive"
    ? path.join(archDir, "goals", "done", "archive")
    : path.join(archDir, "goals", "done");
  fs.mkdirSync(target, { recursive: true });
  const lines = [
    "---",
    `slug: ${g.slug}`,
    `title: ${g.title}`,
    `status: ${g.status || "completed"}`,
    `created: ${(g.started || g.completed || "").slice(0, 10)}`,
  ];
  if (g.started) lines.push(`started: ${g.started}`);
  if (g.completed) lines.push(`completed: ${g.completed}`);
  if (g["time-spent"]) lines.push(`time-spent: ${g["time-spent"]}`);
  if (g["completion-notes"]) lines.push(`completion-notes: ${g["completion-notes"]}`);
  if (g["tests-passed"]) { lines.push(`tests-passed: true`); lines.push(`tests-command: npm test`); }
  lines.push("---", "", `# ${g.title}`, "");
  fs.writeFileSync(path.join(target, `${g.slug}.md`), lines.join("\n") + "\n");
}

console.log("\n  worklog — rendering, range filtering, effort-vs-elapsed labeling");

test("effortToMs parses the durations formatDuration emits (and loose input)", () => {
  assert.equal(effortToMs("2h"), 2 * 3600000);
  assert.equal(effortToMs("90m"), 90 * 60000);
  assert.equal(effortToMs("1h 30m"), 90 * 60000);
  assert.equal(effortToMs("1h30m"), 90 * 60000);
  assert.equal(effortToMs("30s"), 30000);
  assert.equal(effortToMs(""), null);
  assert.equal(effortToMs("soon"), null);
  // Round-trips through formatDuration.
  assert.equal(formatDuration(effortToMs("2h 15m")), "2h 15m");
});

test("entry shows title, outcome, completion notes", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, {
      slug: "ship-auth", title: "Ship the auth flow",
      started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T10:00:00.000Z",
      "completion-notes": "Wired login + session cookie.", "tests-passed": true,
    });
    const { markdown, entries } = renderWorklog(archDir, { from: "2026-06-09", to: "2026-06-09" });
    assert.equal(entries.length, 1);
    assert.match(markdown, /# Worklog — 2026-06-09/);
    assert.match(markdown, /\*\*Ship the auth flow\*\* \(`ship-auth`\)/);
    assert.match(markdown, /completed \(tests: npm test passed\)/);
    assert.match(markdown, /Wired login \+ session cookie\./);
  });
});

test("explicit effort shown verbatim, NOT tagged elapsed", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, {
      slug: "explicit", title: "Explicit effort goal",
      started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T12:00:00.000Z", // 3h wall-clock
      "time-spent": "45m", // honest override — should WIN and not be tagged elapsed
    });
    const { markdown, entries } = renderWorklog(archDir, { from: "2026-06-09", to: "2026-06-09" });
    assert.equal(entries[0].effort.source, "explicit");
    assert.match(markdown, /— 45m$/m);
    assert.doesNotMatch(markdown, /45m \(elapsed\)/);
    assert.doesNotMatch(markdown, /3h/); // wall-clock must not leak when overridden
  });
});

test("derived elapsed is tagged '(elapsed)'", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, {
      slug: "derived", title: "Derived elapsed goal",
      started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T10:30:00.000Z", // 1h30m
    });
    const { markdown, entries } = renderWorklog(archDir, { from: "2026-06-09", to: "2026-06-09" });
    assert.equal(entries[0].effort.source, "derived");
    assert.match(markdown, /1h 30m \(elapsed\)/);
  });
});

test("legacy date-only goal shows no time (no fabricated span)", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, {
      slug: "legacy", title: "Legacy date-only goal",
      started: "2026-06-09", completed: "2026-06-09", // date-only, no time component
    });
    const { markdown, entries } = renderWorklog(archDir, { from: "2026-06-09", to: "2026-06-09" });
    assert.equal(entries[0].effort.source, "none");
    // Title line present but with no time segment after the outcome.
    assert.match(markdown, /\*\*Legacy date-only goal\*\* \(`legacy`\) — completed\n/);
    assert.match(markdown, /time untracked/);
  });
});

test("range filtering: only completions within [from,to] inclusive", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, { slug: "before", title: "Before", started: "2026-06-01T09:00:00.000Z", completed: "2026-06-01T10:00:00.000Z" });
    writeCompletedGoal(archDir, { slug: "inside", title: "Inside", started: "2026-06-05T09:00:00.000Z", completed: "2026-06-05T10:00:00.000Z" });
    writeCompletedGoal(archDir, { slug: "after", title: "After", started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T10:00:00.000Z" });

    const within = collectWorklogEntries(archDir, { from: "2026-06-04", to: "2026-06-06" });
    assert.deepEqual(within.map((e) => e.slug), ["inside"]);

    const fromOnly = collectWorklogEntries(archDir, { from: "2026-06-05", to: "" });
    assert.deepEqual(fromOnly.map((e) => e.slug).sort(), ["after", "inside"]);

    const toOnly = collectWorklogEntries(archDir, { from: "", to: "2026-06-01" });
    assert.deepEqual(toOnly.map((e) => e.slug), ["before"]);
  });
});

test("default range is today (injectable) — excludes other days", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, { slug: "yesterday", title: "Yesterday", started: "2026-06-08T09:00:00.000Z", completed: "2026-06-08T10:00:00.000Z" });
    writeCompletedGoal(archDir, { slug: "today", title: "Today", started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T10:00:00.000Z" });
    const { from, to, entries } = renderWorklog(archDir, { today: "2026-06-09" });
    assert.equal(from, "2026-06-09");
    assert.equal(to, "2026-06-09");
    assert.deepEqual(entries.map((e) => e.slug), ["today"]);
  });
});

test("reads from done/archive/ as well as done/ root", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, { slug: "root-goal", title: "Root goal", started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T09:30:00.000Z", dir: "root" });
    writeCompletedGoal(archDir, { slug: "archived-goal", title: "Archived goal", started: "2026-06-09T11:00:00.000Z", completed: "2026-06-09T12:00:00.000Z", dir: "archive" });
    const { entries } = renderWorklog(archDir, { from: "2026-06-09", to: "2026-06-09" });
    assert.deepEqual(entries.map((e) => e.slug).sort(), ["archived-goal", "root-goal"]);
  });
});

test("consolidated goal still appears once (no double-count root↔archive)", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, { slug: "dual", title: "Dual goal", started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T10:00:00.000Z", "completion-notes": "real notes" });
    // Consolidation moves the raw file into archive/ AND writes a digest entry.
    consolidateGoals(archDir, { date: "2026-06-09" });
    const { entries } = renderWorklog(archDir, { from: "2026-06-09", to: "2026-06-09" });
    assert.equal(entries.length, 1, "dedup across archive + digest");
    // Archive (rich) source wins over the sparse digest entry — notes survive.
    assert.equal(entries[0].notes, "real notes");
  });
});

test("digest-only entry surfaces as a sparse fallback", () => {
  withArchDir(({ archDir }) => {
    // A digest with an entry whose raw archive file is absent.
    const dDir = path.join(archDir, "goals", "done", "digest");
    fs.mkdirSync(dDir, { recursive: true });
    fs.writeFileSync(path.join(dDir, "2026-06-07.md"), [
      "# CGR digest — 2026-06-07", "",
      "<!-- cgr-digest-slug: ghost -->",
      "## ghost — Ghost goal",
      "- Outcome: completed (tests: npm test passed)",
      "- Date: 2026-06-07",
      "- Notes: only the digest survives",
      "- Raw: goals/done/archive/ghost.md", "",
    ].join("\n"));
    const { entries, markdown } = renderWorklog(archDir, { from: "2026-06-07", to: "2026-06-07" });
    assert.deepEqual(entries.map((e) => e.slug), ["ghost"]);
    assert.match(markdown, /\*\*Ghost goal\*\* \(`ghost`\)/);
  });
});

test("range total sums quantifiable effort and flags untracked", () => {
  withArchDir(({ archDir }) => {
    writeCompletedGoal(archDir, { slug: "a", title: "A", started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T10:00:00.000Z" }); // 1h elapsed
    writeCompletedGoal(archDir, { slug: "b", title: "B", started: "2026-06-09T11:00:00.000Z", completed: "2026-06-09T11:30:00.000Z", "time-spent": "30m" }); // 30m explicit
    writeCompletedGoal(archDir, { slug: "c", title: "C", started: "2026-06-09", completed: "2026-06-09" }); // untracked
    const r = renderWorklog(archDir, { from: "2026-06-09", to: "2026-06-09" });
    assert.equal(r.count, 3);
    assert.equal(r.totalMs, 90 * 60000); // 1h + 30m
    assert.equal(r.totalDisplay, "1h 30m");
    assert.match(r.markdown, /1 untracked/);
  });
});

test("empty range renders a clean 'no completed goals' message", () => {
  withArchDir(({ archDir }) => {
    const { count, markdown } = renderWorklog(archDir, { from: "2026-01-01", to: "2026-01-02" });
    assert.equal(count, 0);
    assert.match(markdown, /_No completed goals in 2026-01-01 → 2026-01-02\._/);
  });
});

test("CLI `archkit worklog --json` agrees with the lib", () => {
  withArchDir(({ archDir, dir }) => {
    writeCompletedGoal(archDir, { slug: "cli-goal", title: "CLI goal", started: "2026-06-09T09:00:00.000Z", completed: "2026-06-09T10:00:00.000Z", "completion-notes": "via cli" });
    const out = execFileSync(process.execPath, [ARCHKIT, "worklog", "--from", "2026-06-09", "--to", "2026-06-09", "--json"], { cwd: dir, encoding: "utf8" });
    const parsed = JSON.parse(out);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.entries[0].slug, "cli-goal");
    assert.match(parsed.markdown, /\*\*CLI goal\*\* \(`cli-goal`\)/);
    assert.match(parsed.nextStep, /Copy the markdown/);
  });
});

test("CLI rejects a malformed --from date", () => {
  withArchDir(({ dir }) => {
    let threw = false;
    try {
      execFileSync(process.execPath, [ARCHKIT, "worklog", "--from", "june", "--json"], { cwd: dir, encoding: "utf8" });
    } catch (e) {
      threw = true;
      const parsed = JSON.parse(e.stdout);
      assert.equal(parsed.error, "invalid_input");
    }
    assert.ok(threw, "expected non-zero exit on bad date");
  });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
