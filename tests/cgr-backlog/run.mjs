#!/usr/bin/env node
// Tests for the CGR backlog-threshold ordering knob (cgr-backlog-ordering).
//
// What this verifies:
//   - nextEligibleGoal is pending-first BELOW the testing backlog threshold
//   - it flips to testing-first AT/ABOVE the threshold (count OR age trigger)
//   - the threshold is a real config knob: .arch/config.json → cgr.backlogThreshold
//     overrides the default, and the default is the slack pending-first batch
//   - resume-in-progress and depends-on resolution still take precedence over
//     the threshold ordering
//   - testingBacklogOverThreshold / backlogThreshold behave as documented

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeGoal,
  startGoal,
  markTesting,
  completeGoal,
  nextEligibleGoal,
  loadGoal,
  testingDir,
  goalsDir,
  backlogThreshold,
  testingBacklogOverThreshold,
  DEFAULT_BACKLOG_THRESHOLD,
} from "../../src/lib/goals.mjs";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-backlog-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  let result;
  try { result = fn({ dir, archDir }); }
  catch (err) { cleanup(); throw err; }
  if (result && typeof result.then === "function") return result.finally(cleanup);
  cleanup();
  return result;
}

function writeConfig(archDir, config) {
  fs.writeFileSync(path.join(archDir, "config.json"), JSON.stringify(config, null, 2));
}

// Park a goal in `testing` with an explicit testing-since date (for age tests).
function park(archDir, slug, { since } = {}) {
  writeGoal(archDir, { slug, title: slug.toUpperCase(), exitCriteria: ["x"] });
  startGoal(archDir, slug);
  markTesting(archDir, slug);
  if (since) {
    const g = loadGoal(archDir, slug);
    g.meta["testing-since"] = since;
    const body = g.body || "";
    const fm = Object.entries(g.meta).map(([k, v]) =>
      Array.isArray(v) ? `${k}:\n${v.map((i) => `  - ${i}`).join("\n")}` : `${k}: ${v}`).join("\n");
    fs.writeFileSync(path.join(testingDir(archDir), `${slug}.md`), `---\n${fm}\n---\n\n${body}`);
  }
}

console.log("\n  cgr-backlog — config knob defaults + overrides");

await test("backlogThreshold returns the slack default when no config present", () => {
  withArchDir(({ archDir }) => {
    assert.deepEqual(backlogThreshold(archDir), { ...DEFAULT_BACKLOG_THRESHOLD });
    assert.equal(DEFAULT_BACKLOG_THRESHOLD.count, 5);
    assert.equal(DEFAULT_BACKLOG_THRESHOLD.ageDays, 7);
  });
});

await test("backlogThreshold overlays .arch/config.json over the defaults", () => {
  withArchDir(({ archDir }) => {
    writeConfig(archDir, { cgr: { backlogThreshold: { count: 2 } } });
    assert.deepEqual(backlogThreshold(archDir), { count: 2, ageDays: 7 });
  });
});

await test("backlogThreshold falls back to defaults on malformed config (never throws)", () => {
  withArchDir(({ archDir }) => {
    fs.writeFileSync(path.join(archDir, "config.json"), "{ not valid json");
    assert.deepEqual(backlogThreshold(archDir), { ...DEFAULT_BACKLOG_THRESHOLD });
  });
});

console.log("\n  cgr-backlog — testingBacklogOverThreshold triggers");

await test("count trigger: fires at/above count, not below", () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ meta: { "testing-since": "2099-01-01" } }));
  assert.equal(testingBacklogOverThreshold(mk(1), { count: 2 }), false, "1 < 2");
  assert.equal(testingBacklogOverThreshold(mk(2), { count: 2 }), true, "2 >= 2");
  assert.equal(testingBacklogOverThreshold([], { count: 2 }), false, "empty backlog never fires");
});

await test("age trigger: fires when oldest testing goal is at/over ageDays", () => {
  const now = new Date("2026-06-07T00:00:00Z");
  const fresh = [{ meta: { "testing-since": "2026-06-06" } }]; // 1 day
  const stale = [{ meta: { "testing-since": "2026-05-01" } }]; // 37 days
  assert.equal(testingBacklogOverThreshold(fresh, { count: 99, ageDays: 7 }, now), false, "fresh, count not reached");
  assert.equal(testingBacklogOverThreshold(stale, { count: 99, ageDays: 7 }, now), true, "stale crosses ageDays");
});

console.log("\n  cgr-backlog — nextEligibleGoal ordering");

await test("below threshold: pending-first (default knob, small backlog)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "feat", title: "Feature", exitCriteria: ["x"] });
    park(archDir, "debt1"); // 1 testing goal, default count=5 → below threshold
    assert.equal(nextEligibleGoal(archDir).slug, "feat", "pending feature preferred while backlog small");
  });
});

await test("above threshold via count: testing-first (drain the backlog)", () => {
  withArchDir(({ archDir }) => {
    writeConfig(archDir, { cgr: { backlogThreshold: { count: 2, ageDays: 0 } } });
    writeGoal(archDir, { slug: "feat", title: "Feature", exitCriteria: ["x"] });
    park(archDir, "adebt"); // alphabetically first testing goal
    park(archDir, "bdebt"); // backlog now 2 == count → flip to testing-first
    assert.equal(nextEligibleGoal(archDir).slug, "adebt", "testing goal preferred once backlog crosses count");
  });
});

await test("above threshold via age: testing-first even with backlog of one", () => {
  withArchDir(({ archDir }) => {
    writeConfig(archDir, { cgr: { backlogThreshold: { count: 99, ageDays: 7 } } });
    writeGoal(archDir, { slug: "feat", title: "Feature", exitCriteria: ["x"] });
    park(archDir, "olddebt", { since: "2000-01-01" }); // ancient → age trigger fires
    assert.equal(nextEligibleGoal(archDir).slug, "olddebt", "aged testing goal forces a drain");
  });
});

await test("preferred bucket empty → falls through to the other bucket", () => {
  withArchDir(({ archDir }) => {
    // Above threshold (drain testing preferred) but only pending exists.
    writeConfig(archDir, { cgr: { backlogThreshold: { count: 1, ageDays: 0 } } });
    writeGoal(archDir, { slug: "feat", title: "Feature", exitCriteria: ["x"] });
    assert.equal(nextEligibleGoal(archDir).slug, "feat", "no testing backlog → pending still selected");
  });
});

console.log("\n  cgr-backlog — precedence is preserved");

await test("resume-in-progress takes precedence over the threshold ordering", () => {
  withArchDir(({ archDir }) => {
    // Backlog over threshold (would normally drain testing) but an in-progress
    // goal must still be resumed first.
    writeConfig(archDir, { cgr: { backlogThreshold: { count: 1, ageDays: 0 } } });
    park(archDir, "debt");                  // testing backlog over threshold
    writeGoal(archDir, { slug: "wip", title: "WIP", exitCriteria: ["x"] });
    startGoal(archDir, "wip");               // actively worked
    assert.equal(nextEligibleGoal(archDir).slug, "wip", "in-progress resumed before draining testing");
  });
});

await test("depends-on resolution still gates selection under the threshold", () => {
  withArchDir(({ archDir }) => {
    writeConfig(archDir, { cgr: { backlogThreshold: { count: 99, ageDays: 99 } } });
    writeGoal(archDir, { slug: "base", title: "Base", exitCriteria: ["x"] });
    writeGoal(archDir, { slug: "dependent", title: "Dependent", exitCriteria: ["x"], dependsOn: ["base"] });
    assert.equal(nextEligibleGoal(archDir).slug, "base", "dep-blocked goal skipped, unblocked one picked");
    startGoal(archDir, "base");
    completeGoal(archDir, "base");
    assert.equal(nextEligibleGoal(archDir).slug, "dependent", "dependent eligible once base completes");
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
