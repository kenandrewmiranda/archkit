#!/usr/bin/env node
// Tests for the CGR (Clear Goal Run) goal artifact + payload renderer.
//
// What this verifies:
//   - .arch/goals/<slug>.md written with parseable frontmatter
//   - Active/done lifecycle: list, complete, archive to done/
//   - Payload renderer stays under PAYLOAD_BUDGET (Claude Code slash-command limit)
//   - End-to-end via `archkit goal intake --json ...` and `... complete <slug>`

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  writeGoal,
  listGoals,
  loadGoal,
  completeGoal,
  renderPayload,
  parseGoal,
  PAYLOAD_BUDGET,
  slugify,
} from "../../src/lib/goals.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-goals-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n  goals — slugify");

test("slugify produces kebab-case from arbitrary text", () => {
  assert.equal(slugify("Fix Kalshi yes_bid → yes_bid_dollars"), "fix-kalshi-yes-bid-yes-bid-dollars");
  assert.equal(slugify("   trim & collapse   "), "trim-collapse");
  assert.equal(slugify(""), "goal");
});

console.log("\n  goals — writeGoal + parseGoal roundtrip");

test("writeGoal persists frontmatter + body, parseGoal recovers them", () => {
  withArchDir(({ archDir }) => {
    const { slug, filepath } = writeGoal(archDir, {
      title: "Fix Kalshi bid field",
      exitCriteria: ["dashboard non-null", "test passes"],
      filesToTouch: ["bot/copilot/kalshi.py"],
      requiredReading: [".arch/skills/kalshi.skill"],
      sourceAsk: "All prices showing as null",
    });
    assert.equal(slug, "fix-kalshi-bid-field");
    const raw = fs.readFileSync(filepath, "utf8");
    const { meta, body } = parseGoal(raw);
    assert.equal(meta.title, "Fix Kalshi bid field");
    assert.deepEqual(meta["exit-criteria"], ["dashboard non-null", "test passes"]);
    assert.deepEqual(meta["required-reading"], [".arch/skills/kalshi.skill"]);
    assert.ok(body.includes("# Fix Kalshi bid field"));
  });
});

console.log("\n  goals — list / complete lifecycle");

test("listGoals shows active goals; completeGoal archives to done/", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { title: "Goal A", exitCriteria: ["ship A"] });
    writeGoal(archDir, { title: "Goal B", exitCriteria: ["ship B"] });
    let active = listGoals(archDir);
    assert.equal(active.length, 2);
    completeGoal(archDir, "goal-a", { notes: "shipped 2026-05-25" });
    active = listGoals(archDir);
    assert.equal(active.length, 1);
    assert.equal(active[0].slug, "goal-b");
    const donePath = path.join(archDir, "goals", "done", "goal-a.md");
    assert.ok(fs.existsSync(donePath), "goal-a should be archived to done/");
    const archived = parseGoal(fs.readFileSync(donePath, "utf8"));
    assert.equal(archived.meta.status, "completed");
    assert.equal(archived.meta["completion-notes"], "shipped 2026-05-25");
  });
});

console.log("\n  goals — renderPayload");

test("payload includes slug, required reading, exit criteria, and fits budget", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, {
      title: "Fix Kalshi parse",
      exitCriteria: ["non-null prices", "test passes"],
      filesToTouch: ["a.py", "b.py"],
      requiredReading: [".arch/skills/kalshi.skill", ".arch/BOUNDARIES.md"],
      sourceAsk: "All prices showing as null in dashboard",
    });
    const { payload, length, withinBudget } = renderPayload(archDir, "fix-kalshi-parse");
    assert.ok(payload.startsWith("ARCHKIT GOAL: fix-kalshi-parse"));
    assert.ok(payload.includes(".arch/skills/kalshi.skill"));
    assert.ok(payload.includes("non-null prices"));
    assert.ok(payload.includes("archkit goal complete fix-kalshi-parse"));
    assert.ok(payload.includes("Source ask: All prices"));
    assert.equal(length, payload.length);
    assert.equal(withinBudget, true);
    assert.ok(length < PAYLOAD_BUDGET, `payload should be under ${PAYLOAD_BUDGET}, got ${length}`);
  });
});

test("payload truncates if metadata pushes past budget", () => {
  withArchDir(({ archDir }) => {
    // Construct an absurdly large exit criteria list + sourceAsk to blow budget
    const huge = Array.from({ length: 100 }, (_, i) => `criterion-${i} ` + "x".repeat(60));
    writeGoal(archDir, {
      title: "Huge",
      exitCriteria: huge,
      sourceAsk: "x".repeat(2000),
    });
    const { payload, withinBudget } = renderPayload(archDir, "huge");
    assert.ok(payload.length <= PAYLOAD_BUDGET);
    assert.equal(withinBudget, true);
  });
});

console.log("\n  end-to-end via `archkit goal intake --json` + complete");

function runGoal(args, cwd) {
  return execFileSync("node", [ARCHKIT, "goal", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

test("intake writes files + emits payloads, complete returns nextGoal", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-goals-e2e-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"),
      "# SYSTEM.md\n## Type: Internal\n## Pattern: x\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
    const intake = JSON.stringify({
      sourceAsk: "Two unrelated bugs to fix",
      goals: [
        { title: "First goal", exitCriteria: ["A done"] },
        { title: "Second goal", exitCriteria: ["B done"], requiredReading: [".arch/skills/foo.skill"] },
      ],
    });
    const intakeOut = JSON.parse(runGoal(["intake", "--json", intake], dir));
    assert.equal(intakeOut.written.length, 2);
    assert.equal(intakeOut.payloads.length, 2);
    assert.ok(intakeOut.payloads[0].payload.startsWith("ARCHKIT GOAL: first-goal"));
    assert.ok(intakeOut.payloads[1].payload.includes(".arch/skills/foo.skill"));

    const listOut = JSON.parse(runGoal(["list", "--json"], dir));
    assert.equal(listOut.active.length, 2);

    const completeOut = JSON.parse(runGoal(["complete", "first-goal", "--json"], dir));
    assert.equal(completeOut.slug, "first-goal");
    assert.ok(completeOut.nextGoal, "should suggest next goal");
    assert.equal(completeOut.nextGoal.slug, "second-goal");

    const finalOut = JSON.parse(runGoal(["complete", "second-goal", "--json"], dir));
    assert.equal(finalOut.nextGoal, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log("\n  v1.7 quick-win — recovery suggestions on unknown-slug error");

test("CLI goal payload <unknown-slug> errors with a helpful message", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-goals-recov-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"),
      "## Type: Internal\n## Pattern: x\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
    let stderr = "";
    let exitCode = 0;
    try {
      execFileSync("node", [ARCHKIT, "goal", "payload", "nonexistent-slug"],
        { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      exitCode = err.status;
      stderr = (err.stderr || "").toString();
    }
    assert.notEqual(exitCode, 0, "should exit non-zero on unknown slug");
    // unknown-slug throws from renderPayload as a generic Error; archkit's
    // outer handler in goal.mjs prints the message to stderr
    assert.ok(/unknown goal/i.test(stderr), `expected 'unknown goal' in stderr, got: ${stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
