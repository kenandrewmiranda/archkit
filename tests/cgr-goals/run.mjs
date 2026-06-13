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
  compareGoals,
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

test("compareGoals breaks ties by epic then slug", () => {
  const mk = (slug, order, epic) => ({ slug, meta: { order, epic } });
  // Same order → epic decides; same epic → slug decides.
  assert.ok(compareGoals(mk("x", 1, "a"), mk("y", 1, "b")) < 0, "epic a before b");
  assert.ok(compareGoals(mk("y", 1, "a"), mk("x", 1, "a")) > 0, "same epic falls to slug");
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
