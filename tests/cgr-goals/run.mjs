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
  nextEligibleGoal,
  routeNextGoal,
  queueBranchName,
  ensureQueueBranch,
  readQueueBranch,
  clearQueueBranchIfDrained,
  detectBucketDrain,
  detectMainline,
  bucketBranch,
  bucketMergeGuidance,
  bucketCompletion,
  sortGoals,
  nextOrderBase,
  renderPayload,
  graphSlice,
  parseGoal,
  PAYLOAD_BUDGET,
  RELAY_PAYLOAD_BUDGET,
  detectGraphGaps,
  writeGraphProposal,
  listGraphProposals,
  acceptGraphProposal,
  slugify,
  filesToTouchOf,
  computeFileConflicts,
  detectFileConflicts,
  startGoal,
  markTesting,
  markOnHold,
  abandonGoal,
  statusOf,
  queueDir,
  goalsDir,
  testingDir,
  doneDir,
  migratePendingGoalsToQueue,
  appendChatEntry,
  readChatBoard,
  chatBoardPath,
  CHAT_BOARD_FILENAME,
  CHAT_BOARD_REL,
} from "../../src/lib/goals.mjs";
import { loadGraphCluster } from "../../src/lib/parsers.mjs";

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

test("relay budget carries more than the copy-paste ceiling can", () => {
  withArchDir(({ archDir }) => {
    assert.ok(RELAY_PAYLOAD_BUDGET > PAYLOAD_BUDGET, "relay ceiling must exceed copy-paste");
    const huge = Array.from({ length: 100 }, (_, i) => `criterion-${i} ` + "x".repeat(60));
    writeGoal(archDir, { title: "Huge", exitCriteria: huge, sourceAsk: "x".repeat(2000) });
    const tight = renderPayload(archDir, "huge");
    const relay = renderPayload(archDir, "huge", { budget: RELAY_PAYLOAD_BUDGET });
    assert.ok(tight.length <= PAYLOAD_BUDGET);
    assert.ok(relay.length <= RELAY_PAYLOAD_BUDGET);
    assert.ok(relay.length > tight.length, "relay payload should retain more content");
    assert.equal(relay.withinBudget, true);
  });
});

test("relay budget shows a fuller source-ask than the copy-paste teaser", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { title: "Ask", exitCriteria: ["x"], sourceAsk: "S".repeat(600) });
    const tight = renderPayload(archDir, "ask").payload;
    const relay = renderPayload(archDir, "ask", { budget: RELAY_PAYLOAD_BUDGET }).payload;
    assert.ok(tight.includes("S".repeat(240)) && !tight.includes("S".repeat(241)), "copy-paste caps source-ask at 240");
    assert.ok(relay.includes("S".repeat(600)), "relay carries the full 600-char source-ask");
  });
});

console.log("\n  goals — graphSlice (node-graph neighborhood)");

// Minimal but realistic .arch graph: one INDEX with two nodes + a cross-ref,
// and the matching lib.graph with a per-file node line.
function withGraphArch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-slice-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(archDir, "INDEX.md"), [
    "# INDEX.md",
    "## Nodes → Clusters → Files",
    "@lib → [lib] → src/lib/",
    "@cli → [cli] → src/commands/",
    "## Cross-references",
    "@cli → @lib (commands import pure helpers)",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(archDir, "clusters", "lib.graph"),
    "--- lib [feature] ---\nGoals [U] : src/lib/goals.mjs — list/read/move CGR goal files, pure | GoalCmd,StopHook → THIS\n---\n");
  fs.writeFileSync(path.join(archDir, "clusters", "cli.graph"),
    "--- cli [feature] ---\nGoalCmd [U] : src/commands/goal.mjs — CGR goal CLI | ArchkitBin → THIS → Goals\n---\n");
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("graphSlice returns the matching node line + flow for a touched file", () => {
  withGraphArch(({ archDir }) => {
    const slice = graphSlice(archDir, ["src/lib/goals.mjs"]).join("\n");
    assert.ok(slice.includes("@lib (src/lib/)"), `expected @lib header, got:\n${slice}`);
    assert.ok(slice.includes("Goals: src/lib/goals.mjs"), "expected the Goals node line");
    assert.ok(slice.includes("[GoalCmd,StopHook → THIS]"), "expected the node in/out flow");
  });
});

test("graphSlice surfaces cross-reference edges touching the involved cluster", () => {
  withGraphArch(({ archDir }) => {
    const slice = graphSlice(archDir, ["src/lib/goals.mjs"]).join("\n");
    assert.ok(/Edges:.*@cli → @lib/.test(slice), `expected @cli → @lib edge, got:\n${slice}`);
  });
});

test("graphSlice stays silent for paths under no mapped node", () => {
  withGraphArch(({ archDir }) => {
    assert.deepEqual(graphSlice(archDir, [".arch/decisions/"]), []);
    assert.deepEqual(graphSlice(archDir, []), []);
  });
});

test("graphSlice never throws when INDEX/clusters are absent", () => {
  withArchDir(({ archDir }) => {
    assert.deepEqual(graphSlice(archDir, ["src/lib/goals.mjs"]), []);
  });
});

test("renderPayload embeds the graph slice when files-to-touch map to nodes", () => {
  withGraphArch(({ archDir }) => {
    writeGoal(archDir, {
      title: "Touch goals lib",
      exitCriteria: ["done"],
      filesToTouch: ["src/lib/goals.mjs"],
    });
    const { payload, withinBudget } = renderPayload(archDir, "touch-goals-lib");
    assert.ok(payload.includes("Graph slice (related nodes & edges"), "payload should carry the slice header");
    assert.ok(payload.includes("Goals: src/lib/goals.mjs"), "payload should carry the node line");
    assert.equal(withinBudget, true);
  });
});

console.log("\n  goals — detectGraphGaps (write-back reconciliation)");

test("detectGraphGaps flags an undocumented file under an existing cluster", () => {
  withGraphArch(({ archDir }) => {
    // src/lib/ is @lib; goals.mjs is the only node line — new.mjs is undocumented.
    const gaps = detectGraphGaps(archDir, ["src/lib/new.mjs"]);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].kind, "undocumented-file");
    assert.equal(gaps[0].cluster, "lib");
    assert.equal(gaps[0].node, "@lib");
    assert.ok(gaps[0].suggestedLine.startsWith("New [U] : src/lib/new.mjs"), gaps[0].suggestedLine);
  });
});

test("detectGraphGaps stays silent for files already represented as nodes", () => {
  withGraphArch(({ archDir }) => {
    assert.deepEqual(detectGraphGaps(archDir, ["src/lib/goals.mjs"]), []);
  });
});

test("detectGraphGaps flags a file under no cluster as unmapped-area", () => {
  withGraphArch(({ archDir }) => {
    const gaps = detectGraphGaps(archDir, ["src/payments/charge.mjs"]);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].kind, "unmapped-area");
  });
});

test("detectGraphGaps excludes tests, .arch/, and non-code paths", () => {
  withGraphArch(({ archDir }) => {
    assert.deepEqual(
      detectGraphGaps(archDir, [
        "tests/foo/run.mjs", "src/lib/thing.test.mjs", "__tests__/x.js",
        ".arch/decisions/0001.md", "README.md", "src/lib/styles.css",
      ]),
      [],
    );
  });
});

test("writeGraphProposal persists gaps and listGraphProposals reads them back", () => {
  withGraphArch(({ archDir }) => {
    const gaps = detectGraphGaps(archDir, ["src/lib/new.mjs"]);
    const written = writeGraphProposal(archDir, "some-goal", gaps);
    assert.ok(written.proposalPath.endsWith("some-goal.json"));
    assert.ok(fs.existsSync(written.proposalPath));
    const proposals = listGraphProposals(archDir);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].slug, "some-goal");
    assert.equal(proposals[0].gaps.length, 1);
    // No gaps → writes nothing, returns null.
    assert.equal(writeGraphProposal(archDir, "empty-goal", []), null);
  });
});

console.log("\n  goals — acceptGraphProposal (write-back accept)");

test("acceptGraphProposal appends an authored node line to an existing .graph", () => {
  withGraphArch(({ archDir }) => {
    const gaps = detectGraphGaps(archDir, ["src/lib/new.mjs"]);
    writeGraphProposal(archDir, "accept-goal", gaps);
    const line = "New [S] : src/lib/new.mjs — new pure helper | GoalCmd → THIS";
    const r = acceptGraphProposal(archDir, "accept-goal", { file: "src/lib/new.mjs", line });
    assert.equal(r.ok, true);
    assert.equal(r.cluster, "lib");
    // The line is now a parseable node in lib.graph (validated via loadGraphCluster).
    const cluster = loadGraphCluster(archDir, "lib");
    const ids = cluster.nodes.map((n) => n.id);
    assert.ok(ids.includes("New"), `expected New node, got: ${ids.join(", ")}`);
    assert.ok(ids.includes("Goals"), "existing node must be preserved");
  });
});

test("acceptGraphProposal removes the consumed proposal once its last gap is resolved", () => {
  withGraphArch(({ archDir }) => {
    const gaps = detectGraphGaps(archDir, ["src/lib/new.mjs"]);
    writeGraphProposal(archDir, "accept-goal", gaps);
    assert.equal(listGraphProposals(archDir).length, 1);
    const r = acceptGraphProposal(archDir, "accept-goal", {
      file: "src/lib/new.mjs",
      line: "New [S] : src/lib/new.mjs — helper | GoalCmd → THIS",
    });
    assert.equal(r.proposalRemoved, true);
    assert.equal(r.remainingGaps, 0);
    assert.equal(listGraphProposals(archDir).length, 0);
  });
});

test("acceptGraphProposal drops only the resolved gap when others remain", () => {
  withGraphArch(({ archDir }) => {
    const gaps = detectGraphGaps(archDir, ["src/lib/new.mjs", "src/commands/extra.mjs"]);
    assert.equal(gaps.length, 2);
    writeGraphProposal(archDir, "multi-goal", gaps);
    const r = acceptGraphProposal(archDir, "multi-goal", {
      file: "src/lib/new.mjs",
      line: "New [S] : src/lib/new.mjs — helper | GoalCmd → THIS",
    });
    assert.equal(r.ok, true);
    assert.equal(r.proposalRemoved, false);
    assert.equal(r.remainingGaps, 1);
    const [remaining] = listGraphProposals(archDir);
    assert.equal(remaining.gaps.length, 1);
    assert.equal(remaining.gaps[0].file, "src/commands/extra.mjs");
  });
});

test("acceptGraphProposal rejects a malformed line and never corrupts the .graph", () => {
  withGraphArch(({ archDir }) => {
    const gaps = detectGraphGaps(archDir, ["src/lib/new.mjs"]);
    writeGraphProposal(archDir, "accept-goal", gaps);
    const before = fs.readFileSync(path.join(archDir, "clusters", "lib.graph"), "utf8");
    const r = acceptGraphProposal(archDir, "accept-goal", {
      file: "src/lib/new.mjs",
      line: "this is not a node line at all",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "malformed_line");
    // .graph untouched and the proposal is NOT consumed.
    assert.equal(fs.readFileSync(path.join(archDir, "clusters", "lib.graph"), "utf8"), before);
    assert.equal(listGraphProposals(archDir).length, 1);
  });
});

test("acceptGraphProposal defers unmapped-area gaps with a clear reason (no silent no-op)", () => {
  withGraphArch(({ archDir }) => {
    const gaps = detectGraphGaps(archDir, ["src/payments/charge.mjs"]);
    assert.equal(gaps[0].kind, "unmapped-area");
    writeGraphProposal(archDir, "unmapped-goal", gaps);
    const r = acceptGraphProposal(archDir, "unmapped-goal", {
      file: "src/payments/charge.mjs",
      line: "Charge [S] : src/payments/charge.mjs — x | y",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unmapped_area");
    // Proposal preserved — the gap is deferred, not consumed.
    assert.equal(listGraphProposals(archDir).length, 1);
  });
});

test("acceptGraphProposal surfaces unknown/ambiguous proposals instead of guessing", () => {
  withGraphArch(({ archDir }) => {
    assert.equal(acceptGraphProposal(archDir, "nope", { line: "X [S] : a | b" }).reason, "unknown_proposal");
    const gaps = detectGraphGaps(archDir, ["src/lib/new.mjs", "src/commands/extra.mjs"]);
    writeGraphProposal(archDir, "ambig-goal", gaps);
    // No file given + >1 gap → ambiguous, not first-gap-wins.
    assert.equal(acceptGraphProposal(archDir, "ambig-goal", { line: "X [S] : a | b" }).reason, "ambiguous_gap");
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

console.log("\n  cgr-goal-ordering — intentional sequencing (order + epic)");

test("writeGoal persists order + epic to parseable frontmatter", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g", title: "G", order: 3, epic: "OAuth Migration" });
    const g = loadGoal(archDir, "g");
    assert.equal(String(g.meta.order), "3");
    assert.equal(g.meta.epic, "oauth-migration", "epic is slugified on write");
  });
});

test("order=0 survives the round-trip (not dropped as falsy)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "z", title: "Z", order: 0 });
    assert.equal(String(loadGoal(archDir, "z").meta.order), "0");
  });
});

test("listGoals returns goals in order, not readdir/alpha order", () => {
  withArchDir(({ archDir }) => {
    // Slugs deliberately reverse-alpha vs intended order to prove order wins.
    writeGoal(archDir, { slug: "aaa", title: "A", order: 2 });
    writeGoal(archDir, { slug: "zzz", title: "Z", order: 1 });
    const slugs = listGoals(archDir).map((g) => g.slug);
    assert.deepEqual(slugs, ["zzz", "aaa"], "lower order first regardless of slug");
  });
});

test("goals without order sort after ordered ones, alpha among themselves", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "bbb", title: "B" });           // no order
    writeGoal(archDir, { slug: "aaa", title: "A" });           // no order
    writeGoal(archDir, { slug: "ordered", title: "O", order: 5 });
    const slugs = listGoals(archDir).map((g) => g.slug);
    assert.deepEqual(slugs, ["ordered", "aaa", "bbb"], "ordered first, then alpha fallback");
  });
});

test("nextEligibleGoal honors order over alphabetical slug", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "aaa-first-alpha", title: "A", order: 9 });
    writeGoal(archDir, { slug: "zzz-last-alpha", title: "Z", order: 1 });
    assert.equal(nextEligibleGoal(archDir).slug, "zzz-last-alpha", "order 1 picked before alpha");
  });
});

test("sortGoals is epic-primary — an epic drains fully before the next begins", () => {
  const mk = (slug, order, epic) => ({ slug, meta: { order, epic } });
  // epic A = {0, 5}, epic B = {1}, ungrouped = {2}. A's earliest order (0) beats
  // B's (1) and the lone goal (2), so ALL of A runs before B — even A's order-5
  // goal jumps ahead of B's order-1 goal. That's "finish X before starting Y".
  const sorted = sortGoals([
    mk("a1", 0, "alpha"), mk("a2", 5, "alpha"),
    mk("b1", 1, "beta"),
    mk("u1", 2, ""),
  ]).map((g) => g.slug);
  assert.deepEqual(sorted, ["a1", "a2", "b1", "u1"]);
});

test("sortGoals keeps an epic contiguous and ordered within it", () => {
  const mk = (slug, order, epic) => ({ slug, meta: { order, epic } });
  const sorted = sortGoals([
    mk("a-late", 9, "alpha"), mk("a-early", 3, "alpha"),
  ]).map((g) => g.slug);
  assert.deepEqual(sorted, ["a-early", "a-late"], "within-epic by order");
});

test("sortGoals collapses to pure order when no epics exist", () => {
  const mk = (slug, order) => ({ slug, meta: { order } });
  const sorted = sortGoals([mk("z", 2), mk("a", 1)]).map((g) => g.slug);
  assert.deepEqual(sorted, ["a", "z"], "no epics → order-ascending, slug irrelevant");
});

test("nextOrderBase returns max assigned order + 1 (0 when none)", () => {
  withArchDir(({ archDir }) => {
    assert.equal(nextOrderBase(archDir), 0, "0 when no goal carries an order");
    writeGoal(archDir, { slug: "a", title: "A", order: 4 });
    writeGoal(archDir, { slug: "b", title: "B" });            // no order, ignored
    assert.equal(nextOrderBase(archDir), 5, "max(4)+1");
  });
});

test("intake auto-stamps order from batch position, offset past existing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-goals-order-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"),
      "# SYSTEM.md\n## Type: Internal\n## Pattern: x\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
    const batch1 = JSON.stringify({ goals: [
      { title: "First", exitCriteria: ["a"] },
      { title: "Second", exitCriteria: ["b"] },
    ] });
    runGoal(["intake", "--json", batch1], dir);
    const archDir = path.join(dir, ".arch");
    assert.equal(String(loadGoal(archDir, "first").meta.order), "0");
    assert.equal(String(loadGoal(archDir, "second").meta.order), "1");

    // A follow-up intake appends after the current queue, not back at 0.
    const batch2 = JSON.stringify({ goals: [{ title: "Third", exitCriteria: ["c"] }] });
    runGoal(["intake", "--json", batch2], dir);
    assert.equal(String(loadGoal(archDir, "third").meta.order), "2", "next batch offsets past existing");

    // list surfaces queue order; explicit epic produces the grouped view.
    writeGoal(archDir, { slug: "grouped", title: "Grouped", order: 10, epic: "alpha" });
    const listOut = JSON.parse(runGoal(["list", "--json"], dir));
    assert.deepEqual(listOut.active.map((g) => g.slug), ["first", "second", "third", "grouped"]);
    assert.ok(listOut.epics && listOut.epics.alpha.includes("grouped"), "epics view groups by epic");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log("\n  cgr-project-branch-grouping — branch-isolated feature sets (project)");

test("writeGoal slugifies + persists project; parseGoal round-trips it", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "p", title: "P", project: "OAuth UI" });
    const g = loadGoal(archDir, "p");
    assert.equal(g.meta.project, "oauth-ui", "project is slugified on write");
    // Round-trip: re-parse the raw file to prove it emits + parses cleanly.
    const raw = fs.readFileSync(g.filepath, "utf8");
    assert.equal(parseGoal(raw).meta.project, "oauth-ui");
  });
});

test("project is absent on goals that don't set it (legacy untouched)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "noproj", title: "No Project" });
    assert.equal(loadGoal(archDir, "noproj").meta.project, undefined);
  });
});

test("renderPayload injects a branch-prework block for a project goal", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "feat-a", title: "Feat A", project: "Search Revamp" });
    const { payload } = renderPayload(archDir, "feat-a");
    assert.ok(payload.includes("Branch prework (project: search-revamp)"), "names the project");
    assert.ok(payload.includes("git switch -c feat/search-revamp"), "create-branch guidance");
    assert.ok(payload.includes("git switch feat/search-revamp"), "switch-if-exists guidance");
    assert.ok(/commit each completed CGR to that branch/i.test(payload), "commit-per-CGR guidance");
    assert.ok(/archkit only emits this guidance/i.test(payload), "instruct-not-act note");
  });
});

test("renderPayload omits the branch-prework block when no project", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "plain", title: "Plain" });
    const { payload } = renderPayload(archDir, "plain");
    assert.ok(!payload.includes("Branch prework"), "no prework block without a project");
  });
});

test("goal_list surfaces a projects view mirroring epics", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-goals-proj-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"),
      "# SYSTEM.md\n## Type: Internal\n## Pattern: x\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
    const archDir = path.join(dir, ".arch");
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 0, project: "alpha" });
    writeGoal(archDir, { slug: "p-a2", title: "A2", order: 1, project: "alpha" });
    writeGoal(archDir, { slug: "p-b1", title: "B1", order: 2, project: "beta" });
    writeGoal(archDir, { slug: "ungrouped", title: "U", order: 3 });
    const listOut = JSON.parse(runGoal(["list", "--json"], dir));
    assert.deepEqual(listOut.projects.alpha, ["p-a1", "p-a2"], "project alpha -> its slugs in queue order");
    assert.deepEqual(listOut.projects.beta, ["p-b1"], "project beta -> its slug");
    assert.ok(!("ungrouped" in (listOut.projects || {})), "no '(ungrouped)' bucket — only real projects listed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("goal_list omits projects view entirely when no goal carries a project", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-goals-noproj-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"),
      "# SYSTEM.md\n## Type: Internal\n## Pattern: x\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
    writeGoal(path.join(dir, ".arch"), { slug: "solo", title: "Solo" });
    const listOut = JSON.parse(runGoal(["list", "--json"], dir));
    assert.ok(!("projects" in listOut), "projects key absent when no project goals exist");
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

console.log("\n  cgr-files-to-touch-conflict-detection — cross-CGR file overlap");

// Build a parsed-goal record by hand for the PURE overlap core (no fs needed).
const mkGoal = (slug, status, files, project) => ({
  slug,
  meta: {
    slug,
    title: slug.toUpperCase(),
    status,
    "files-to-touch": files,
    ...(project ? { project } : {}),
  },
});

test("filesToTouchOf normalizes, dedupes, and tolerates missing/scalar fields", () => {
  assert.deepEqual(filesToTouchOf({ meta: { "files-to-touch": ["./a.js", "a.js", " b.js "] } }), ["a.js", "b.js"]);
  assert.deepEqual(filesToTouchOf({ meta: { "files-to-touch": "solo.js" } }), ["solo.js"]);
  assert.deepEqual(filesToTouchOf({ meta: {} }), []);
  assert.deepEqual(filesToTouchOf({}), []);
  assert.deepEqual(filesToTouchOf(null), []);
});

test("computeFileConflicts reports overlap with other live goals + shared paths", () => {
  const target = mkGoal("target", "in-progress", ["src/lib/a.mjs", "src/lib/b.mjs"]);
  const all = [
    target,
    mkGoal("other-live", "testing", ["src/lib/b.mjs", "src/lib/c.mjs"]),
    mkGoal("disjoint-live", "in-progress", ["src/lib/z.mjs"]),
  ];
  const conflicts = computeFileConflicts(target, all);
  assert.equal(conflicts.length, 1, "only the overlapping live goal is a conflict");
  assert.equal(conflicts[0].slug, "other-live");
  assert.deepEqual(conflicts[0].files, ["src/lib/b.mjs"], "reports the shared path only");
});

test("computeFileConflicts excludes the target itself and non-live goals", () => {
  const target = mkGoal("target", "in-progress", ["shared.mjs"]);
  const all = [
    target,
    mkGoal("self-dupe", "in-progress", ["shared.mjs"]), // distinct slug, overlaps → conflict
    mkGoal("pending-one", "pending", ["shared.mjs"]),   // not live → ignored
    mkGoal("onhold-one", "on-hold", ["shared.mjs"]),    // not live → ignored
    mkGoal("done-one", "completed", ["shared.mjs"]),    // not live → ignored
  ];
  const conflicts = computeFileConflicts(target, all);
  assert.deepEqual(conflicts.map((c) => c.slug), ["self-dupe"], "only the live non-target overlap");
});

test("computeFileConflicts flags cross-project (cross-branch) overlap as high risk, sorted first", () => {
  const target = mkGoal("target", "in-progress", ["shared.mjs"], "alpha");
  const all = [
    target,
    mkGoal("same-branch", "in-progress", ["shared.mjs"], "alpha"), // same project → low risk
    mkGoal("other-branch", "testing", ["shared.mjs"], "beta"),     // cross project → high risk
  ];
  const conflicts = computeFileConflicts(target, all);
  assert.equal(conflicts.length, 2);
  assert.equal(conflicts[0].slug, "other-branch", "cross-project conflict sorts first");
  assert.equal(conflicts[0].crossProject, true);
  assert.equal(conflicts[0].project, "beta");
  assert.equal(conflicts[1].slug, "same-branch");
  assert.equal(conflicts[1].crossProject, false);
});

test("computeFileConflicts returns [] for no overlap and for empty files-to-touch (never throws)", () => {
  const target = mkGoal("target", "in-progress", ["a.mjs"]);
  // No overlap.
  assert.deepEqual(computeFileConflicts(target, [target, mkGoal("x", "in-progress", ["b.mjs"])]), []);
  // Empty target files → nothing to conflict on.
  assert.deepEqual(computeFileConflicts(mkGoal("t2", "in-progress", []), [mkGoal("y", "in-progress", ["a.mjs"])]), []);
  // Empty other-goal files → no shared paths.
  assert.deepEqual(computeFileConflicts(target, [target, mkGoal("z", "testing", [])]), []);
  // Garbage inputs don't throw.
  assert.deepEqual(computeFileConflicts(null, null), []);
});

test("detectFileConflicts reads .arch/ and never throws on an unknown slug", () => {
  withArchDir(({ archDir }) => {
    assert.deepEqual(detectFileConflicts(archDir, "nope"), [], "unknown slug → []");
    writeGoal(archDir, { slug: "g-a", title: "A", filesToTouch: ["src/lib/shared.mjs", "src/lib/a.mjs"] });
    writeGoal(archDir, { slug: "g-b", title: "B", filesToTouch: ["src/lib/shared.mjs"] });
    // Both pending → no live overlap yet.
    assert.deepEqual(detectFileConflicts(archDir, "g-a"), []);
    // Make both live: g-a in-progress, g-b in testing.
    startGoal(archDir, "g-a");
    markTesting(archDir, "g-b");
    const conflicts = detectFileConflicts(archDir, "g-a");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].slug, "g-b");
    assert.deepEqual(conflicts[0].files, ["src/lib/shared.mjs"]);
  });
});

test("renderPayload injects a CONFLICT block when a live goal overlaps; silent otherwise", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "feat-x", title: "Feat X", filesToTouch: ["src/lib/shared.mjs"], project: "alpha" });
    writeGoal(archDir, { slug: "feat-y", title: "Feat Y", filesToTouch: ["src/lib/shared.mjs"], project: "beta" });
    // No conflict while feat-y is still pending.
    assert.ok(!renderPayload(archDir, "feat-x").payload.includes("CONFLICT"), "silent when no live overlap");
    startGoal(archDir, "feat-x");
    markTesting(archDir, "feat-y");
    const { payload } = renderPayload(archDir, "feat-x");
    assert.ok(payload.includes("⚠ CONFLICT"), "conflict block present");
    assert.ok(payload.includes("feat-y"), "names the overlapping goal");
    assert.ok(payload.includes("src/lib/shared.mjs"), "names the shared file");
    assert.ok(/cross-branch — high risk/.test(payload), "flags cross-project overlap");
  });
});

console.log("\n  cgr-agent-chat-coordination-board — shared gitignored chat board");

test("appendChatEntry creates the board with a header; readChatBoard round-trips it", () => {
  withArchDir(({ archDir }) => {
    const r = appendChatEntry(archDir, {
      slug: "feat-x", project: "alpha", files: ["./src/lib/a.mjs", "src/lib/a.mjs", " b.mjs "], note: "announcing",
    });
    assert.equal(r.written, true);
    assert.equal(r.slug, "feat-x");
    assert.equal(r.branch, "feat/alpha", "branch derived from project when not given");
    assert.deepEqual(r.files, ["src/lib/a.mjs", "b.mjs"], "files normalized + deduped");
    // File exists at goals/chat.md with the human-readable header.
    const raw = fs.readFileSync(chatBoardPath(archDir), "utf8");
    assert.ok(raw.startsWith("# CGR agent coordination board"), "header written on first append");
    assert.ok(raw.includes("src/lib/a.mjs"), "human-readable files line present");
    // Structured read-back.
    const entries = readChatBoard(archDir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].slug, "feat-x");
    assert.equal(entries[0].project, "alpha");
    assert.equal(entries[0].branch, "feat/alpha");
    assert.deepEqual(entries[0].files, ["src/lib/a.mjs", "b.mjs"]);
    assert.equal(entries[0].note, "announcing");
    assert.ok(entries[0].at, "timestamp stamped");
  });
});

test("readChatBoard returns entries newest-first and honors limit", () => {
  withArchDir(({ archDir }) => {
    appendChatEntry(archDir, { slug: "one", files: ["a.mjs"] });
    appendChatEntry(archDir, { slug: "two", files: ["b.mjs"] });
    appendChatEntry(archDir, { slug: "three", files: ["c.mjs"] });
    const all = readChatBoard(archDir);
    assert.deepEqual(all.map((e) => e.slug), ["three", "two", "one"], "newest first");
    const limited = readChatBoard(archDir, { limit: 2 });
    assert.deepEqual(limited.map((e) => e.slug), ["three", "two"], "limit caps the count");
  });
});

test("explicit branch overrides the project-derived one; an entry with no files is tolerated", () => {
  withArchDir(({ archDir }) => {
    const r = appendChatEntry(archDir, { slug: "g", project: "alpha", branch: "custom-branch" });
    assert.equal(r.branch, "custom-branch", "explicit branch wins");
    const raw = fs.readFileSync(chatBoardPath(archDir), "utf8");
    assert.ok(raw.includes("(none declared)"), "empty files render as (none declared)");
    assert.deepEqual(readChatBoard(archDir)[0].files, []);
  });
});

test("readChatBoard tolerates a missing board (returns [], never throws)", () => {
  withArchDir(({ archDir }) => {
    assert.deepEqual(readChatBoard(archDir), [], "no board file → []");
  });
});

test("listGoals excludes the chat board from scanning", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "real-goal", title: "Real" });
    appendChatEntry(archDir, { slug: "real-goal", files: ["x.mjs"] });
    // chat.md is a .md file in goals/ root but must not be picked up as a goal.
    const slugs = listGoals(archDir).map((g) => g.slug);
    assert.deepEqual(slugs, ["real-goal"], "only the real goal, board excluded");
    assert.equal(CHAT_BOARD_FILENAME, "chat.md");
  });
});

test("renderPayload injects the coordination-board prework block", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "feat-x", title: "Feat X", project: "alpha", filesToTouch: ["src/lib/a.mjs"] });
    const { payload } = renderPayload(archDir, "feat-x");
    assert.ok(payload.includes(`Coordination board — \`${CHAT_BOARD_REL}\``), "names the shared board path");
    assert.ok(/READ the board/.test(payload), "instructs READ before editing");
    assert.ok(/APPEND an announce-entry/.test(payload), "instructs APPEND an announce-entry");
    assert.ok(payload.includes("branch feat/alpha"), "names the project branch in the announce guidance");
  });
});

test("board prework tells the agent to check the board when a conflict is flagged", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "feat-x", title: "Feat X", filesToTouch: ["src/lib/shared.mjs"], project: "alpha" });
    writeGoal(archDir, { slug: "feat-y", title: "Feat Y", filesToTouch: ["src/lib/shared.mjs"], project: "beta" });
    startGoal(archDir, "feat-x");
    markTesting(archDir, "feat-y");
    const { payload } = renderPayload(archDir, "feat-x");
    assert.ok(/CHECK the board and coordinate/.test(payload), "conflict → board-check guidance");
  });
});

test("gitignore wiring keeps the board shared (never commits into a feature branch)", () => {
  const gitignore = fs.readFileSync(path.resolve(__dirname, "../../.gitignore"), "utf8");
  assert.ok(
    gitignore.split("\n").some((l) => l.trim() === CHAT_BOARD_REL),
    `.gitignore must ignore ${CHAT_BOARD_REL} so the board stays shared`,
  );
});

console.log("\n  cgr-queue-folder-layout — queue drawer + dual-read + migration");

const queuePath = (archDir, ...rest) => path.join(queueDir(archDir), ...rest);
const rootGoalPath = (archDir, slug) => path.join(goalsDir(archDir), `${slug}.md`);

test("writeGoal writes new pending goals to goals/queue/, not the root", () => {
  withArchDir(({ archDir }) => {
    const { filepath } = writeGoal(archDir, { slug: "q1", title: "Q1", exitCriteria: ["x"] });
    assert.equal(path.resolve(filepath), path.resolve(queuePath(archDir, "q1.md")), "lands in queue/");
    assert.ok(fs.existsSync(queuePath(archDir, "q1.md")), "queue file exists");
    assert.ok(!fs.existsSync(rootGoalPath(archDir, "q1")), "nothing written to goals/ root");
  });
});

test("a project goal nests under goals/queue/<project>/", () => {
  withArchDir(({ archDir }) => {
    const { filepath } = writeGoal(archDir, { slug: "q2", title: "Q2", project: "Search Revamp" });
    assert.equal(path.resolve(filepath), path.resolve(queuePath(archDir, "search-revamp", "q2.md")), "nests under project subfolder");
    assert.ok(fs.existsSync(queuePath(archDir, "search-revamp", "q2.md")));
    // Still resolvable + listed despite the extra nesting.
    assert.equal(loadGoal(archDir, "q2").meta.project, "search-revamp");
    assert.ok(listGoals(archDir).some((g) => g.slug === "q2"));
  });
});

test("DUAL-READ: a legacy goal at goals/ root stays visible to listGoals + loadGoal", () => {
  withArchDir(({ archDir }) => {
    // Simulate a pre-upgrade project: a pending goal sitting at the root, written
    // directly (NOT via writeGoal, which would queue it).
    fs.mkdirSync(goalsDir(archDir), { recursive: true });
    fs.writeFileSync(rootGoalPath(archDir, "legacy"),
      "---\nslug: legacy\ntitle: Legacy\nstatus: pending\n---\n\n# Legacy\n");
    const found = loadGoal(archDir, "legacy");
    assert.ok(found, "loadGoal resolves a root-level legacy goal");
    assert.equal(path.resolve(found.filepath), path.resolve(rootGoalPath(archDir, "legacy")));
    assert.ok(listGoals(archDir).some((g) => g.slug === "legacy"), "listGoals surfaces it");
  });
});

test("DUAL-READ: queue and root goals are listed together", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "queued", title: "Queued" });          // → queue/
    fs.writeFileSync(rootGoalPath(archDir, "rooted"),                  // legacy root
      "---\nslug: rooted\ntitle: Rooted\nstatus: pending\n---\n\n# Rooted\n");
    const slugs = listGoals(archDir).map((g) => g.slug).sort();
    assert.deepEqual(slugs, ["queued", "rooted"], "both locations contribute");
  });
});

test("migration moves root PENDING goals into queue/, leaving other states put", () => {
  withArchDir(({ archDir }) => {
    fs.mkdirSync(goalsDir(archDir), { recursive: true });
    const put = (slug, status, extra = "") =>
      fs.writeFileSync(rootGoalPath(archDir, slug),
        `---\nslug: ${slug}\ntitle: ${slug}\nstatus: ${status}\n${extra}---\n\n# ${slug}\n`);
    put("pend", "pending");
    put("legacy-planned", "planned");      // alias for pending → migrates
    put("active", "in-progress");          // stays at root
    put("parked", "on-hold");              // stays at root
    put("withproj", "pending", "project: alpha\n");

    const { moved } = migratePendingGoalsToQueue(archDir);
    assert.deepEqual(moved.sort(), ["legacy-planned", "pend", "withproj"], "only pending/planned move");

    assert.ok(fs.existsSync(queuePath(archDir, "pend.md")));
    assert.ok(fs.existsSync(queuePath(archDir, "legacy-planned.md")));
    assert.ok(fs.existsSync(queuePath(archDir, "alpha", "withproj.md")), "project goal nests on migration");
    assert.ok(!fs.existsSync(rootGoalPath(archDir, "pend")), "source removed from root");

    // in-progress + on-hold are untouched at root.
    assert.ok(fs.existsSync(rootGoalPath(archDir, "active")), "in-progress stays at root");
    assert.ok(fs.existsSync(rootGoalPath(archDir, "parked")), "on-hold stays at root");
  });
});

test("migration leaves testing/ and done/ goals untouched", () => {
  withArchDir(({ archDir }) => {
    fs.mkdirSync(testingDir(archDir), { recursive: true });
    fs.mkdirSync(doneDir(archDir), { recursive: true });
    fs.writeFileSync(path.join(testingDir(archDir), "t.md"),
      "---\nslug: t\ntitle: T\nstatus: testing\n---\n\n# T\n");
    fs.writeFileSync(path.join(doneDir(archDir), "d.md"),
      "---\nslug: d\ntitle: D\nstatus: completed\n---\n\n# D\n");
    migratePendingGoalsToQueue(archDir);
    assert.ok(fs.existsSync(path.join(testingDir(archDir), "t.md")), "testing untouched");
    assert.ok(fs.existsSync(path.join(doneDir(archDir), "d.md")), "done untouched");
    assert.ok(!fs.existsSync(queuePath(archDir, "t.md")), "testing goal not pulled into queue");
  });
});

test("migration is idempotent — a re-run moves nothing and creates no duplicate", () => {
  withArchDir(({ archDir }) => {
    fs.mkdirSync(goalsDir(archDir), { recursive: true });
    fs.writeFileSync(rootGoalPath(archDir, "p"),
      "---\nslug: p\ntitle: P\nstatus: pending\n---\n\n# P\n");
    const first = migratePendingGoalsToQueue(archDir);
    assert.deepEqual(first.moved, ["p"]);
    const second = migratePendingGoalsToQueue(archDir);
    assert.deepEqual(second.moved, [], "second run is a no-op");
    // Exactly one copy survives — in queue/, not root.
    assert.ok(fs.existsSync(queuePath(archDir, "p.md")));
    assert.ok(!fs.existsSync(rootGoalPath(archDir, "p")));
    assert.equal(listGoals(archDir).filter((g) => g.slug === "p").length, 1, "no duplicate listing");
  });
});

test("transitions relocate a legacy ROOT pending goal without leaving a duplicate", () => {
  withArchDir(({ archDir }) => {
    fs.mkdirSync(goalsDir(archDir), { recursive: true });
    fs.writeFileSync(rootGoalPath(archDir, "leg"),
      "---\nslug: leg\ntitle: Leg\nstatus: pending\n---\n\n# Leg\n");
    // startGoal runs ensureGoalsLayout (migrates root→queue) THEN loads, so the
    // relocate to root must not co-exist with the migrated queue copy.
    startGoal(archDir, "leg");
    assert.equal(statusOf(loadGoal(archDir, "leg")), "in-progress");
    assert.ok(fs.existsSync(rootGoalPath(archDir, "leg")), "in-progress lives at root");
    assert.ok(!fs.existsSync(queuePath(archDir, "leg.md")), "no leftover queue copy");
    assert.equal(listGoals(archDir).filter((g) => g.slug === "leg").length, 1, "single live entry");
  });
});

test("full lifecycle from queue: start → testing → complete relocates cleanly", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "life", title: "Life", exitCriteria: ["x"] }); // queue/
    startGoal(archDir, "life");
    assert.ok(fs.existsSync(rootGoalPath(archDir, "life")) && !fs.existsSync(queuePath(archDir, "life.md")));
    markTesting(archDir, "life");
    assert.ok(fs.existsSync(path.join(testingDir(archDir), "life.md")) && !fs.existsSync(rootGoalPath(archDir, "life")));
    completeGoal(archDir, "life", {});
    assert.ok(fs.existsSync(path.join(doneDir(archDir), "life.md")), "archived to done/");
    assert.equal(listGoals(archDir).length, 0, "nothing live remains");
  });
});

test("markOnHold + abandon resolve a queued goal from either location", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "hold-me", title: "Hold" });   // queue/
    markOnHold(archDir, "hold-me");
    assert.equal(statusOf(loadGoal(archDir, "hold-me")), "on-hold");
    assert.ok(fs.existsSync(rootGoalPath(archDir, "hold-me")), "on-hold lives at root");
    assert.ok(!fs.existsSync(queuePath(archDir, "hold-me.md")));

    writeGoal(archDir, { slug: "drop-me", title: "Drop" });   // queue/
    abandonGoal(archDir, "drop-me", { reason: "obsolete" });
    assert.ok(fs.existsSync(path.join(doneDir(archDir), "drop-me.md")), "abandoned archived to done/");
    assert.ok(!fs.existsSync(queuePath(archDir, "drop-me.md")));
  });
});

console.log("\n  cgr-relay-queue-vs-project-routing — queue-vs-project choice + shared dated branch");

test("routeNextGoal auto-picks (single) when only ungrouped goals exist", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-a", title: "QA", order: 0 });
    writeGoal(archDir, { slug: "q-b", title: "QB", order: 1 });
    const route = routeNextGoal(archDir);
    assert.equal(route.kind, "single", "only the queue bucket → no choice");
    assert.equal(route.goal.slug, "q-a", "auto-picks the first in queue order");
  });
});

test("routeNextGoal auto-picks (single) when only project goals exist", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "p-a", title: "PA", order: 0, project: "alpha" });
    writeGoal(archDir, { slug: "p-b", title: "PB", order: 1, project: "alpha" });
    const route = routeNextGoal(archDir);
    assert.equal(route.kind, "single", "only the project bucket → no choice");
    assert.equal(route.goal.slug, "p-a");
  });
});

test("routeNextGoal SURFACES A CHOICE when both buckets are non-empty", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });            // ungrouped
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 1, project: "alpha" });
    writeGoal(archDir, { slug: "p-a2", title: "A2", order: 2, project: "alpha" });
    writeGoal(archDir, { slug: "p-b1", title: "B1", order: 3, project: "beta" });
    const route = routeNextGoal(archDir);
    assert.equal(route.kind, "choice", "both queue + projects → choice, not auto-pick");
    assert.deepEqual(route.queue, ["q-1"]);
    assert.equal(route.queueNext, "q-1", "queue track's next slug");
    assert.deepEqual(route.projects.alpha, ["p-a1", "p-a2"], "project alpha in queue order");
    assert.deepEqual(route.projects.beta, ["p-b1"]);
    assert.equal(route.projectNext.alpha, "p-a1", "project track's next slug");
    assert.equal(route.projectNext.beta, "p-b1");
  });
});

test("in-progress resume takes precedence over the routing choice", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 1, project: "alpha" });
    startGoal(archDir, "q-1"); // a genuinely active goal
    const route = routeNextGoal(archDir);
    assert.equal(route.kind, "resume", "active goal resumed, never interrupted by the choice");
    assert.equal(route.goal.slug, "q-1");
  });
});

test("a dep-blocked project goal does not trigger the choice (deps precedence)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });                         // ungrouped, eligible
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 1, project: "alpha", dependsOn: ["missing-dep"] });
    const route = routeNextGoal(archDir);
    assert.equal(route.kind, "single", "blocked project goal isn't eligible → only the queue bucket remains");
    assert.equal(route.goal.slug, "q-1");
  });
});

test("queueBranchName derives cgr-queue-<date>; archkit stamps the day", () => {
  assert.equal(queueBranchName("2026-06-20"), "cgr-queue-2026-06-20");
  assert.equal(queueBranchName("2026-06-20T16:08:29.585Z"), "cgr-queue-2026-06-20", "datetime trimmed to day");
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(queueBranchName(), `cgr-queue-${today}`, "defaults to today");
});

test("ensureQueueBranch records ONCE and reuses across multiple queue goals", () => {
  withArchDir(({ archDir }) => {
    assert.equal(readQueueBranch(archDir), null, "nothing recorded initially");
    const first = ensureQueueBranch(archDir, { date: "2026-06-20" });
    assert.equal(first, "cgr-queue-2026-06-20");
    assert.equal(readQueueBranch(archDir), "cgr-queue-2026-06-20", "persisted");
    // A later pick on a different day still REUSES the recorded batch branch.
    const second = ensureQueueBranch(archDir, { date: "2026-07-01" });
    assert.equal(second, "cgr-queue-2026-06-20", "reused, not re-minted per pick");
    assert.equal(readQueueBranch(archDir), "cgr-queue-2026-06-20");
  });
});

test("renderPayload: ungrouped goal gets create-then-switch queue-branch guidance when projects are live", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "p-a1", title: "A1", project: "alpha" });   // activates the parallel regime
    writeGoal(archDir, { slug: "q-1", title: "Q1" });                      // ungrouped
    writeGoal(archDir, { slug: "q-2", title: "Q2" });                      // ungrouped
    const today = new Date().toISOString().slice(0, 10);
    // First queue goal, nothing recorded yet → CREATE.
    const create = renderPayload(archDir, "q-1").payload;
    assert.ok(create.includes("Branch prework (shared queue branch)"), "queue-branch block present");
    assert.ok(create.includes(`git switch -c cgr-queue-${today}`), "first goal: create -c");
    assert.ok(!create.includes(`\`git switch cgr-queue-${today}\``), "first goal is not a bare switch");
    // Record the branch (as startGoal would) → subsequent goals SWITCH.
    startGoal(archDir, "q-1");
    const switchPayload = renderPayload(archDir, "q-2").payload;
    assert.ok(switchPayload.includes(`git switch cgr-queue-${today}\``), "later goal: switch to existing");
    assert.ok(!switchPayload.includes("git switch -c"), "later goal does NOT re-create");
  });
});

test("renderPayload: no queue-branch block for an ungrouped goal when NO project is live (back-compat)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "solo", title: "Solo" });
    const payload = renderPayload(archDir, "solo").payload;
    assert.ok(!payload.includes("Branch prework"), "single-track users keep pre-feature behavior");
  });
});

test("startGoal records the queue branch for an ungrouped goal, but not for a project goal", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "proj", title: "Proj", project: "alpha" });
    startGoal(archDir, "proj");
    assert.equal(readQueueBranch(archDir), null, "a project goal branches feat/<project>, not the queue branch");
    writeGoal(archDir, { slug: "plain", title: "Plain" });
    startGoal(archDir, "plain");
    assert.ok(/^cgr-queue-\d{4}-\d{2}-\d{2}$/.test(readQueueBranch(archDir) || ""), "ungrouped start mints the dated queue branch");
  });
});

test("the feat/<project> and cgr-queue-<date> schemes never collide", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "p-a1", title: "A1", project: "alpha" });
    writeGoal(archDir, { slug: "q-1", title: "Q1" });
    const projPayload = renderPayload(archDir, "p-a1").payload;
    assert.ok(projPayload.includes("git switch -c feat/alpha"), "project goal uses feat/<project>");
    assert.ok(!projPayload.includes("cgr-queue-"), "project goal never mentions the queue branch");
    const queuePayload = renderPayload(archDir, "q-1").payload;
    assert.ok(queuePayload.includes("cgr-queue-"), "queue goal uses cgr-queue-<date>");
    assert.ok(!queuePayload.includes("feat/alpha"), "queue goal never mentions feat/<project>");
  });
});

test("clearQueueBranchIfDrained drops the branch only once the queue empties", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "p-a1", title: "A1", project: "alpha" });
    writeGoal(archDir, { slug: "q-1", title: "Q1" });
    writeGoal(archDir, { slug: "q-2", title: "Q2" });
    ensureQueueBranch(archDir, { date: "2026-06-20" });
    // Two ungrouped goals still live → state retained.
    completeGoal(archDir, "q-1", {});
    assert.equal(readQueueBranch(archDir), "cgr-queue-2026-06-20", "still queued work → branch retained");
    // Last ungrouped goal done → state cleared (a project goal doesn't keep it).
    completeGoal(archDir, "q-2", {});
    assert.equal(readQueueBranch(archDir), null, "ungrouped queue drained → branch state cleared");
  });
});

test("CLI `goal start <slug>` marks the goal in-progress and prints its payload", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-goals-start-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"),
      "# SYSTEM.md\n## Type: Internal\n## Pattern: x\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
    const archDir = path.join(dir, ".arch");
    writeGoal(archDir, { slug: "q-1", title: "Q1", project: "alpha" });
    writeGoal(archDir, { slug: "q-2", title: "Q2" });
    const out = JSON.parse(runGoal(["start", "q-2", "--json"], dir));
    assert.equal(out.slug, "q-2");
    assert.equal(out.status, "in-progress");
    assert.ok(out.payload.startsWith("ARCHKIT GOAL: q-2"), "returns the goal's payload");
    assert.equal(statusOf(loadGoal(archDir, "q-2")), "in-progress", "goal is now in-progress");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log("\n  cgr-project-completion-merge-or-archive — end-of-bucket merge-or-archive");

test("detectBucketDrain: completing the LAST live goal of a project drains it", () => {
  // p-a1 is being completed; the only sibling is terminal → bucket drains.
  const d = detectBucketDrain([
    mkGoal("p-a1", "in-progress", [], "alpha"),
    mkGoal("done-a", "completed", [], "alpha"),
  ], "p-a1");
  assert.equal(d.drained, true);
  assert.equal(d.bucket, "project");
  assert.equal(d.project, "alpha");
  assert.equal(d.remaining, 0);
});

test("detectBucketDrain: a non-last completion does NOT drain (sibling still live)", () => {
  const d = detectBucketDrain([
    mkGoal("p-a1", "in-progress", [], "alpha"),
    mkGoal("p-a2", "pending", [], "alpha"),   // sibling still live
  ], "p-a1");
  assert.equal(d.drained, false, "mid-bucket completion must not drain");
  assert.equal(d.remaining, 1);
  assert.equal(d.bucket, "project");
});

test("detectBucketDrain: other projects + the queue don't keep a project bucket alive", () => {
  const d = detectBucketDrain([
    mkGoal("p-a1", "in-progress", [], "alpha"),
    mkGoal("p-b1", "pending", [], "beta"),    // different project bucket
    mkGoal("q-1", "pending", []),             // ungrouped queue bucket
  ], "p-a1");
  assert.equal(d.drained, true, "only the SAME bucket's live goals count");
});

test("detectBucketDrain: on-hold/abandoned siblings don't keep a bucket alive", () => {
  const d = detectBucketDrain([
    mkGoal("p-a1", "in-progress", [], "alpha"),
    mkGoal("p-parked", "on-hold", [], "alpha"),     // parked → not live
    mkGoal("p-dropped", "abandoned", [], "alpha"),  // terminal → not live
  ], "p-a1");
  assert.equal(d.drained, true, "parked/terminal don't count as live work");
});

test("detectBucketDrain: the ungrouped queue drains independently of projects", () => {
  const d = detectBucketDrain([
    mkGoal("q-1", "in-progress", []),         // ungrouped, being completed
    mkGoal("p-a1", "pending", [], "alpha"),   // a project goal — different bucket
  ], "q-1");
  assert.equal(d.drained, true);
  assert.equal(d.bucket, "queue");
  assert.equal(d.project, null);
});

test("detectBucketDrain: a still-live ungrouped sibling keeps the queue bucket alive", () => {
  const d = detectBucketDrain([
    mkGoal("q-1", "in-progress", []),
    mkGoal("q-2", "testing", []),   // ungrouped sibling in testing → live
  ], "q-1");
  assert.equal(d.drained, false);
  assert.equal(d.bucket, "queue");
});

test("detectBucketDrain: tolerates an unknown slug / garbage input and never throws", () => {
  assert.deepEqual(detectBucketDrain([], "nope"), { drained: false, bucket: null, project: null, remaining: 0 });
  assert.equal(detectBucketDrain(null, "x").drained, false);
});

test("detectMainline: config cgr.mainline wins over detection", () => {
  withArchDir(({ archDir }) => {
    fs.writeFileSync(path.join(archDir, "config.json"), JSON.stringify({ cgr: { mainline: "develop" } }));
    const m = detectMainline(archDir);
    assert.equal(m.mainline, "develop");
    assert.equal(m.source, "config");
  });
});

test("detectMainline: detects master from loose refs WITHOUT running git", () => {
  withArchDir(({ archDir }) => {
    // archDir is <dir>/.arch — fake a .git at the repo root with a master ref.
    const heads = path.join(path.dirname(archDir), ".git", "refs", "heads");
    fs.mkdirSync(heads, { recursive: true });
    fs.writeFileSync(path.join(heads, "master"), "0".repeat(40) + "\n");
    const m = detectMainline(archDir);
    assert.equal(m.mainline, "master");
    assert.equal(m.source, "detected");
  });
});

test("detectMainline: prefers main over master when both refs exist", () => {
  withArchDir(({ archDir }) => {
    const heads = path.join(path.dirname(archDir), ".git", "refs", "heads");
    fs.mkdirSync(heads, { recursive: true });
    fs.writeFileSync(path.join(heads, "master"), "0".repeat(40) + "\n");
    fs.writeFileSync(path.join(heads, "main"), "0".repeat(40) + "\n");
    assert.equal(detectMainline(archDir).mainline, "main");
  });
});

test("detectMainline: detects from packed-refs when no loose ref exists", () => {
  withArchDir(({ archDir }) => {
    const gitDir = path.join(path.dirname(archDir), ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "packed-refs"),
      "# pack-refs with: peeled fully-peeled sorted\n" + "0".repeat(40) + " refs/heads/master\n");
    assert.equal(detectMainline(archDir).mainline, "master");
  });
});

test("detectMainline: defaults to main when no config + no repo", () => {
  withArchDir(({ archDir }) => {
    const m = detectMainline(archDir);
    assert.equal(m.mainline, "main");
    assert.equal(m.source, "default");
  });
});

test("bucketMergeGuidance emits the documented `git switch <mainline> && git merge <branch>`", () => {
  assert.equal(
    bucketMergeGuidance({ branch: "feat/alpha", mainline: "main" }),
    "git switch main && git merge feat/alpha",
  );
  assert.equal(
    bucketMergeGuidance({ branch: "cgr-queue-2026-06-20", mainline: "develop" }),
    "git switch develop && git merge cgr-queue-2026-06-20",
  );
});

test("bucketBranch resolves feat/<project> for a project bucket, the recorded queue branch otherwise", () => {
  withArchDir(({ archDir }) => {
    assert.equal(bucketBranch(archDir, { bucket: "project", project: "alpha" }), "feat/alpha");
    ensureQueueBranch(archDir, { date: "2026-06-20" });
    assert.equal(bucketBranch(archDir, { bucket: "queue", project: null }), "cgr-queue-2026-06-20");
  });
});

test("bucketCompletion: composes merge guidance for a drained project; null mid-bucket", () => {
  withArchDir(({ archDir }) => {
    // Sibling still live → mid-bucket → no prompt.
    assert.equal(bucketCompletion(archDir, [
      mkGoal("p-a1", "in-progress", [], "alpha"),
      mkGoal("p-a2", "pending", [], "alpha"),
    ], "p-a1"), null);
    // Last live goal of alpha → bucket drains → choice composed.
    const bc = bucketCompletion(archDir, [
      mkGoal("p-a2", "in-progress", [], "alpha"),
      mkGoal("done-a", "completed", [], "alpha"),
    ], "p-a2");
    assert.equal(bc.bucket, "project");
    assert.equal(bc.project, "alpha");
    assert.equal(bc.branch, "feat/alpha");
    assert.equal(bc.mainline, "main");
    assert.equal(bc.mainlineSource, "default");
    assert.equal(bc.mergeGuidance, "git switch main && git merge feat/alpha");
  });
});

test("bucketCompletion: draining the ungrouped queue points at the recorded queue branch", () => {
  withArchDir(({ archDir }) => {
    ensureQueueBranch(archDir, { date: "2026-06-20" });
    const bc = bucketCompletion(archDir, [mkGoal("q-1", "in-progress", [])], "q-1");
    assert.equal(bc.bucket, "queue");
    assert.equal(bc.project, null);
    assert.equal(bc.branch, "cgr-queue-2026-06-20");
    assert.equal(bc.mergeGuidance, "git switch main && git merge cgr-queue-2026-06-20");
  });
});

test("runGoalComplete surfaces the merge-or-archive choice ONLY when the bucket drains, and archives as today", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-bucket-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"),
      "# SYSTEM.md\n## Type: Internal\n## Pattern: x\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
    const archDir = path.join(dir, ".arch");
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 0, project: "alpha" });
    writeGoal(archDir, { slug: "p-a2", title: "A2", order: 1, project: "alpha" });

    // Completing p-a1 with p-a2 still live → mid-bucket, NO choice.
    startGoal(archDir, "p-a1");
    const out1 = JSON.parse(runGoal(["complete", "p-a1", "--json"], dir));
    assert.equal(out1.bucketCompletion, null, "mid-bucket completion → no merge/archive prompt");

    // Completing p-a2 (now the last live goal of alpha) → bucket drains.
    startGoal(archDir, "p-a2");
    const out2 = JSON.parse(runGoal(["complete", "p-a2", "--json"], dir));
    assert.ok(out2.bucketCompletion, "last-of-bucket completion → choice surfaced");
    assert.equal(out2.bucketCompletion.bucket, "project");
    assert.equal(out2.bucketCompletion.project, "alpha");
    assert.equal(out2.bucketCompletion.branch, "feat/alpha");
    assert.equal(out2.bucketCompletion.mergeGuidance, "git switch main && git merge feat/alpha");
    assert.ok(/MERGE into main/.test(out2.nextStep), "nextStep leads with the merge-or-archive choice");
    // Archive-only half (criterion 4): the CGRs consolidate into done/ as today;
    // archkit runs NO git, so the branch is left untouched on disk.
    assert.ok(out2.consolidation && out2.consolidation.consolidated >= 1, "bucket drain consolidates CGRs into done/");
    const archived = fs.readdirSync(path.join(archDir, "goals", "done", "archive")).filter((f) => f.endsWith(".md"));
    assert.ok(archived.includes("p-a1.md") && archived.includes("p-a2.md"), "raw CGRs preserved under done/archive/");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
