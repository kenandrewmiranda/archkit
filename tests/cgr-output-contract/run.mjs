#!/usr/bin/env node
// Tests for the MCP OUTPUT CONTRACT (terse-output-contract, ADR 0026) — the
// shared graph renderer in src/lib/format.mjs and its adoption by the CGR
// relay prompts in src/mcp/prompts.mjs.
//
// What this verifies:
//   EC1 — board + lane state renders as a compact GRAPH: lanes are branches,
//         goals are leaves, barriers are marked distinctly from ordinary lanes
//   EC2 — a FOUR-symbol severity vocabulary (action | attention | error | ok) is
//         defined once in format.mjs and reused by the prompts, which define no
//         severity table of their own
//   EC3 — emphasis is MARKDOWN ONLY: no ESC byte (\x1b) appears in any prompt
//         output or in any renderer's output, on any board shape
//   EC4 — the conductor prompt rebuilt on the shared renderer is at most HALF
//         the characters of the pre-contract prose shape for the SAME fixture
//         board (the old shape is pinned verbatim below as legacyConductorProse)
//   EC5 — the terse form loses tokens, not meaning: every instruction the prose
//         carried (loop steps 1..6, lane→slug map, barrier solo rule, merge
//         order + rebase precondition + path-extract fallback + verify + record,
//         the deep-review exception list, the integration-debt ledger, and the
//         "you spawn workers, archkit only emits the plan" framing) is still
//         present in the graph form

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SEVERITIES,
  SYM,
  GLYPH,
  LEGEND,
  ESC,
  sym,
  hasAnsi,
  stripAnsi,
  strong,
  code,
  stats,
  tree,
  laneTree,
  step,
  boardLine,
  convergenceGraph,
  debt,
  debtLine,
  conductorGraph,
} from "../../src/lib/format.mjs";
import { conductorPlan, appendEvent, renderConvergencePlan } from "../../src/lib/board.mjs";
import { writeGoal, startGoal, markTesting, stampGoalFields } from "../../src/lib/goals.mjs";
import { prompts, relayHeader, relayTriageChoice } from "../../src/mcp/prompts.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

const NOW = "2026-08-02T12:00:00.000Z";
const tmpDirs = [];

function freshProject({ testScript = "npm test" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-outputcontract-"));
  tmpDirs.push(root);
  const arch = path.join(root, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "# system\n");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", scripts: testScript ? { test: testScript } : {} }, null, 2),
  );
  return { root, arch };
}

function goal(arch, slug, { start = true, verifyCommand, ...stamped } = {}) {
  writeGoal(arch, { slug, title: slug, exitCriteria: ["x"], verifyCommand });
  if (start) startGoal(arch, slug);
  if (Object.keys(stamped).length) stampGoalFields(arch, slug, stamped);
  return slug;
}

// THE fixture board — one shape, reused by EC1/EC3/EC4/EC5 so the character
// ratio and the instruction audit are measured against the same thing. It is
// deliberately rich: two claimable lanes, a solo barrier, two workers in flight
// (one with an expired lease), a two-lane merge queue with a partial completion
// (a deep-review exception), and one already-merged CGR carrying no verify
// result (integration debt).
function fixtureBoard() {
  const { root, arch } = freshProject();
  goal(arch, "fmt-a", { start: false, lane: "output", owns: ["src/lib/format.mjs"] });
  goal(arch, "fmt-b", { start: false, lane: "output", owns: ["src/mcp/prompts.mjs"] });
  goal(arch, "brd-a", { start: false, lane: "board", owns: ["src/lib/board.mjs"] });
  goal(arch, "solo-x", { start: false, lane: "solo", exclusive: true, owns: ["package.json"] });

  goal(arch, "inflight-1", { lane: "flight", owns: ["src/x.mjs"] });
  appendEvent(arch, { type: "claimed", slug: "inflight-1", lane: "flight", worker: "w1", lease: { until: "2099-01-01T00:00:00.000Z" }, at: "2026-08-02T09:00:00.000Z" });
  goal(arch, "stuck", { lane: "flight", owns: ["src/y.mjs"] });
  appendEvent(arch, { type: "claimed", slug: "stuck", lane: "flight", worker: "w2", lease: { until: "2026-08-01T00:00:00.000Z" }, at: "2026-08-01T00:00:00.000Z" });

  goal(arch, "m1", { lane: "backend", owns: ["src/a.mjs", "src/b.mjs"] });
  goal(arch, "m2", { lane: "frontend", owns: ["src/c.mjs"] });
  appendEvent(arch, { type: "completed", slug: "m1", completion: "partial", at: "2026-08-02T10:00:00.000Z" });
  appendEvent(arch, { type: "completed", slug: "m2", at: "2026-08-02T11:00:00.000Z" });

  goal(arch, "olddebt", { lane: "relay" });
  appendEvent(arch, { type: "merged", slug: "olddebt", lane: "relay", at: NOW });
  return { root, arch };
}

// Run a prompt handler with cwd pointed at a fixture project.
async function promptText(root, name = "conductor") {
  const cwd = process.cwd();
  process.chdir(root);
  try { return (await prompts[name].handler()).messages[0].content.text; }
  finally { process.chdir(cwd); }
}

// ── The pinned PRE-CONTRACT shape (the prose the ADR replaced) ────────────────
//
// Copied verbatim from src/mcp/prompts.mjs as of commit abcf6f5, so EC4's ratio
// is measured against what the conductor ACTUALLY emitted, not an estimate. It
// still renders through board.mjs's renderConvergencePlan, which remains the
// verbose step-5 renderer. Do not "improve" this function — it is a baseline.
function legacyConductorProse(plan) {
  const c = plan.counts;
  const lines = [
    `[archkit CGR conductor] Orchestration pass — you are the CONDUCTOR, not a worker. Do NOT code in this context; dispatch and integrate.`,
    ``,
    `Board: ${c.frontier} frontier (${c.claimableLanes} claimable lane${c.claimableLanes === 1 ? "" : "s"}${c.barriers ? ` + ${c.barriers} barrier${c.barriers === 1 ? "" : "s"}` : ""}), ${c.in_flight} in flight, ${c.merge_queue} to merge, ${c.blocked} blocked, ${c.exceptions} exception${c.exceptions === 1 ? "" : "s"}, ${c.leases_expired} expired lease${c.leases_expired === 1 ? "" : "s"}.`,
    ``,
    `Run the loop:`,
    `1. RECLAIM ${c.leases_expired} orphan lease${c.leases_expired === 1 ? "" : "s"}${c.leases_expired ? ` (${plan.leasesExpired.map((l) => l.slug).join(", ")})` : ""} — their TTL elapsed; they're free to re-claim.`,
  ];
  const laneList = Object.entries(plan.claimableLanes);
  if (laneList.length) {
    lines.push(`2. CLAIM + DISPATCH — spawn ONE worker subagent per claimable lane, each in an isolated git worktree (lanes have disjoint ownership → run them in parallel):`);
    for (const [lane, slugs] of laneList) lines.push(`   • lane ${lane}: ${slugs.join(" → ")}`);
  } else {
    lines.push(`2. CLAIM + DISPATCH — no claimable lanes right now.`);
  }
  if (plan.barriers.length) lines.push(`   • BARRIERS (run SOLO, everything before merges first): ${plan.barriers.join(", ")}`);
  lines.push(
    `3. COLLECT each worker's handoff return (archkit_goal_handoff authored at wind-down).`,
    plan.exceptions.length
      ? `4. DEEP-REVIEW ONLY these exceptions — rubber-stamp the rest:\n${plan.exceptions.map((e) => `   • ${e.slug}: ${e.reasons.join(", ")}`).join("\n")}`
      : `4. DEEP-REVIEW: no exceptions — the returns are clean, rubber-stamp them.`,
    `5. ${renderConvergencePlan(plan.convergence).join("\n")}`,
    plan.unverifiedMerges.length
      ? `6. INTEGRATION DEBT — ${plan.unverifiedMerges.length} CGR${plan.unverifiedMerges.length === 1 ? " has" : "s have"} merged WITHOUT a green verify. Re-run the verify on ${plan.convergence.branch} and re-record with archkit_board_merged:\n${plan.unverifiedMerges.map((m) => `   • ${m.slug} (lane ${m.lane}): ${m.status}${m.command ? ` — ${m.command}` : ""} [${m.reason}]`).join("\n")}`
      : `6. INTEGRATION DEBT: none — every merge recorded so far carries a green verify.`,
    ``,
    `Read archkit_conductor / archkit_session_state for the structured plan. archkit emits the plan; YOU spawn workers, review, run the git rebases/merges, and run the verify command — archkit never runs git or your tests; it records the result you report via archkit_board_merged.`,
  );
  return lines.join("\n");
}

console.log("\nMCP output contract: a graph, four symbols, markdown only (ADR 0026)\n");

// ── EC1: the graph grammar ───────────────────────────────────────────────────

test("EC1: lanes are BRANCHES, goals are LEAVES, ordered by an explicit flow glyph", () => {
  const lines = laneTree({ output: ["fmt-a", "fmt-b"], board: ["brd-a"] }, []);
  assert.deepEqual(lines, [
    `  ${GLYPH.branch} output: fmt-a ${GLYPH.flow} fmt-b`,
    `  ${GLYPH.last} board: brd-a`,
  ]);
});

test("EC1: a BARRIER is marked distinctly from an ordinary lane", () => {
  const lines = laneTree({ output: ["fmt-a"] }, ["solo-x"]);
  const ordinary = lines.find((l) => l.includes("output"));
  const barrier = lines.find((l) => l.includes("solo-x"));
  assert.ok(!ordinary.includes(GLYPH.barrier), "an ordinary lane carries no barrier glyph");
  assert.ok(barrier.includes(GLYPH.barrier), "a barrier carries the barrier glyph");
  assert.ok(barrier.includes(SYM.attention), "a barrier is attention-severity");
  assert.match(barrier, /SOLO/, "and says it runs solo");
});

test("EC1: tree() draws a rail for continuation lines under a non-final node", () => {
  const lines = tree([{ text: "a", children: ["owns x"] }, { text: "b" }]);
  assert.deepEqual(lines, [
    `  ${GLYPH.branch} a`,
    `  ${GLYPH.pipe}  owns x`,
    `  ${GLYPH.last} b`,
  ]);
});

test("EC1: the board strip is a stat graph, not a sentence — no verb, no prose", () => {
  const line = boardLine({ frontier: 4, claimableLanes: 2, barriers: 1, in_flight: 2, merge_queue: 2, blocked: 0, exceptions: 1, leases_expired: 0 });
  assert.match(line, /^board /);
  assert.ok(line.includes(`frontier ${strong(4)}`), "counts are bolded when non-zero");
  assert.ok(line.includes("blocked 0"), "zeros stay plain — nothing owed, nothing marked");
  assert.ok(!/\b(is|are|has|have)\b/.test(line), "no prose verbs in a stat strip");
  assert.ok(line.split(GLYPH.sep).length > 4, "stats are separated by the graph separator");
});

test("EC1: an empty merge queue says so in ONE ok-severity line", () => {
  const lines = convergenceGraph({ groups: [], branch: "main" });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith(SYM.ok));
});

test("EC1: the convergence stage emits the per-point boilerplate ONCE, not per lane", () => {
  const arch = fixtureBoard().arch;
  const plan = conductorPlan(arch, { now: NOW });
  const text = convergenceGraph(plan.convergence).join("\n");
  const rebases = text.split("git -C W fetch").length - 1;
  assert.equal(plan.convergence.groups.length, 2, "the fixture has two integration points");
  assert.equal(rebases, 1, "the rebase template is emitted once for N lanes (O(1), not O(lanes))");
  assert.match(text, /1\) backend: m1/, "each point still gets its own leaf");
  assert.match(text, /2\) frontend: m2/);
});

// ── EC2: one severity vocabulary, defined once ───────────────────────────────

test("EC2: exactly FOUR severities — action, attention, error, ok", () => {
  assert.deepEqual([...SEVERITIES], ["action", "attention", "error", "ok"]);
  assert.deepEqual(Object.keys(SYM).sort(), ["action", "attention", "error", "ok"]);
  const glyphs = Object.values(SYM);
  assert.equal(new Set(glyphs).size, 4, "the four symbols are visually distinct");
  for (const s of SEVERITIES) assert.equal(sym(s), SYM[s]);
});

test("EC2: an unknown severity degrades to `action` rather than throwing a prompt down", () => {
  assert.equal(sym("nope"), SYM.action);
  assert.equal(sym(undefined), SYM.action);
});

test("EC2: the legend ships with the output, so the vocabulary is self-describing", () => {
  for (const s of SEVERITIES) assert.ok(LEGEND.includes(SYM[s]), `legend documents ${s}`);
  assert.ok(LEGEND.includes(GLYPH.barrier), "legend documents the barrier glyph");
});

test("EC2: prompts.mjs defines NO severity table of its own — it imports the shared one", () => {
  const src = fs.readFileSync(new URL("../../src/mcp/prompts.mjs", import.meta.url), "utf8");
  assert.match(src, /from "\.\.\/lib\/format\.mjs"/, "prompts import the shared renderer");
  // The literal glyphs must not be re-typed in prompts.mjs — every use goes
  // through SYM/GLYPH, which is what makes the vocabulary changeable in one place.
  // Checked on the non-ASCII glyphs only: `!` (attention) is also JS negation,
  // so its presence in source proves nothing either way.
  const body = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const [name, glyph] of Object.entries(SYM)) {
    if (/^[\x00-\x7f]+$/.test(glyph)) continue;
    assert.ok(!body.includes(glyph), `prompts.mjs must not hardcode the ${name} glyph ${glyph}`);
  }
  for (const glyph of [GLYPH.branch, GLYPH.barrier, GLYPH.after]) {
    assert.ok(!body.includes(glyph), `prompts.mjs must not hardcode the structural glyph ${glyph}`);
  }
});

test("EC2: emphasis is markdown, and it tracks actionability", () => {
  assert.equal(strong("x"), "**x**");
  assert.equal(code("x"), "`x`");
  const line = stats([["a", 3, "attention"], ["b", 0, "attention"]]);
  assert.ok(line.includes(`a ${SYM.attention}${strong(3)}`), "a non-zero attention stat is symbol + bold");
  assert.ok(line.includes("b 0"), "a zero is neither symbolled nor bolded");
});

// ── EC3: markdown only — no ANSI, anywhere ───────────────────────────────────

test("EC3: hasAnsi/stripAnsi detect and remove the ESC byte", () => {
  const colored = `${ESC}[32mgreen${ESC}[0m`;
  assert.equal(hasAnsi(colored), true);
  assert.equal(hasAnsi("plain **bold**"), false);
  assert.equal(stripAnsi(colored), "green");
  assert.equal(hasAnsi(stripAnsi(colored)), false);
});

test("EC3: no renderer in format.mjs emits an ESC byte", () => {
  const arch = fixtureBoard().arch;
  const plan = conductorPlan(arch, { now: NOW });
  const rendered = [
    LEGEND,
    boardLine(plan.counts),
    ...laneTree(plan.claimableLanes, plan.barriers),
    ...convergenceGraph(plan.convergence),
    debtLine(plan.unverifiedMerges),
    debtLine([]),
    step(1, "action", "x"),
    ...conductorGraph(plan),
  ].join("\n");
  assert.equal(hasAnsi(rendered), false, "rendered output must contain no \\x1b");
  assert.ok(!rendered.includes(ESC));
});

test("EC3: format.mjs SOURCE contains no literal ESC byte either", () => {
  const src = fs.readFileSync(new URL("../../src/lib/format.mjs", import.meta.url), "utf8");
  assert.ok(!src.includes(ESC), "the module that forbids ANSI must not contain the byte");
});

await testAsync("EC3: no MCP prompt result carries an ESC byte, on any board shape", async () => {
  // 1. the orchestration board
  const rich = fixtureBoard();
  // 2. a single-goal board (foreground relay + payload injection)
  const single = freshProject();
  goal(single.arch, "lone", { start: false });
  // 3. a mixed board (the ambiguity-gated triage choice)
  const mixed = freshProject();
  goal(mixed.arch, "q-1", { start: false });
  writeGoal(mixed.arch, { slug: "p-a1", title: "A1", exitCriteria: ["x"], project: "alpha" });
  // 4. a testing-debt board (goal_status buckets)
  const debtBoard = freshProject();
  goal(debtBoard.arch, "t-1");
  markTesting(debtBoard.arch, "t-1");
  // 5. an empty board
  const empty = freshProject();

  const shapes = [
    [rich.root, "conductor"], [single.root, "conductor"], [mixed.root, "conductor"],
    [empty.root, "conductor"], [debtBoard.root, "goal_status"], [empty.root, "goal_status"],
    [empty.root, "intake"], [empty.root, "goal_review"], [debtBoard.root, "goal_resume"],
  ];
  for (const [root, name] of shapes) {
    const text = await promptText(root, name);
    assert.equal(hasAnsi(text), false, `${name} on ${path.basename(root)} emitted an ESC byte`);
  }
  // The non-prompt string builders too.
  assert.equal(hasAnsi(relayHeader("g1", "in-progress", { windDownThreshold: 0.65 })), false);
  assert.equal(hasAnsi(relayHeader("g1", "testing", { tallyLine: "x" })), false);
  assert.equal(hasAnsi(relayTriageChoice({
    queue: ["q-1"], queueNext: "q-1", projects: { alpha: ["p-a1"] }, projectNext: { alpha: "p-a1" },
    testing: { count: 1, slugs: ["t-1"] }, onHold: { count: 1, slugs: ["h-1"] }, recommended: "q-1",
  })), false);
});

// ── EC4: at most half the characters, same fixture board ─────────────────────

await testAsync("EC4: the conductor prompt is <= HALF the pre-contract prose for the SAME board", async () => {
  const { root, arch } = fixtureBoard();
  const plan = conductorPlan(arch, { now: NOW });
  const before = legacyConductorProse(plan);
  const after = await promptText(root, "conductor");

  const ratio = after.length / before.length;
  console.log(`        chars before=${before.length} after=${after.length} ratio=${ratio.toFixed(3)}`);
  assert.ok(before.length > 0 && after.length > 0);
  assert.ok(ratio <= 0.5, `expected the terse form to be <= 50% of the prose form, got ${(ratio * 100).toFixed(1)}%`);
  assert.ok(after.split("\n").length < before.split("\n").length, "and fewer lines to scan");
});

test("EC4: the saving GROWS with the board — the per-lane boilerplate is not repeated", () => {
  // Same renderer, 1 lane vs 4 lanes: the prose form pays ~5 lines per lane, the
  // graph form pays one leaf, so the ratio must not get worse as lanes are added.
  const group = (order, lane, slug) => ({
    order, lane, slugs: [slug], dependsOnLanes: [], paths: [`src/${slug}.mjs`],
    precondition: { kind: "rebase-onto-tip", command: `git -C <worktree-for-${lane}> fetch && git -C <worktree-for-${lane}> rebase main` },
    integration: { on: "main", command: `git merge --no-ff <worktree-branch:${lane}>`, verify: "npm test", verifySource: "project" },
    fallback: { kind: "path-extract", on: "main", command: `git checkout <worktree-branch:${lane}> -- src/${slug}.mjs` },
    record: { tool: "archkit_board_merged" },
  });
  const mk = (n) => ({ branch: "main", split: false, groups: Array.from({ length: n }, (_, i) => group(i + 1, `l${i}`, `s${i}`)) });
  const ratioAt = (n) => convergenceGraph(mk(n)).join("\n").length / renderConvergencePlan(mk(n)).join("\n").length;
  const one = ratioAt(1);
  const four = ratioAt(4);
  assert.ok(four < one, `ratio must improve with lane count (1 lane ${one.toFixed(3)} -> 4 lanes ${four.toFixed(3)})`);
  assert.ok(four <= 0.5, `4-lane convergence should be <= half the prose form, got ${four.toFixed(3)}`);
});

// ── EC5: no instruction was lost, only tokens ────────────────────────────────

await testAsync("EC5: every instruction the prose carried survives in the graph form", async () => {
  const { root } = fixtureBoard();
  const text = await promptText(root, "conductor");

  // The framing: conductor role + instruct-not-act (archkit emits, you execute).
  assert.match(text, /\[archkit CGR conductor\]/, "the surface still identifies itself");
  assert.match(text, /conduct, don't code/i, "conductor-not-worker framing");
  assert.match(text, /YOU spawn workers/, "you spawn the workers");
  assert.match(text, /archkit only EMITS plans, records what you report/, "archkit runs nothing");

  // The six dispatch-loop steps, still numbered and still in order.
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.ok(new RegExp(`^${n} `, "m").test(text), `loop step ${n} present`);
  }
  assert.match(text, /reclaim/i, "1 reclaim orphan leases");
  assert.match(text, /claim \+ dispatch/i, "2 claim + dispatch");
  assert.match(text, /worktree/, "…one isolated git worktree per worker");
  assert.match(text, /parallel/, "…run in parallel");
  assert.match(text, /collect worker handoffs/i, "3 collect handoffs");
  assert.match(text, /archkit_goal_handoff/, "…named tool for the handoff");
  assert.match(text, /deep-review ONLY/, "4 deep-review only the exceptions");
  assert.match(text, /rubber-stamp the rest/, "…rubber-stamp the rest");
  assert.match(text, /m1\(partial-completion\)/, "…with the concrete exception list");
  assert.match(text, /CONVERGE \+ MERGE/, "5 the convergence stage");
  assert.match(text, /INTEGRATION DEBT/, "6 the integration-debt ledger");

  // The lane -> slug mapping, as a tree instead of bullets.
  assert.match(text, /board: brd-a/, "lane board maps to its slug");
  assert.match(text, /output: fmt-a → fmt-b/, "lane output keeps its intra-lane order");
  assert.match(text, /solo-x \*\*SOLO\*\*/, "the barrier is named and marked solo");

  // The merge order and every command the old step 5 spelled out per lane.
  assert.match(text, /IN ORDER/, "merge order is explicit");
  assert.match(text, /1\) backend: m1/, "point 1");
  assert.match(text, /2\) frontend: m2/, "point 2");
  assert.match(text, /git -C W fetch && git -C W rebase main/, "rebase-onto-tip precondition");
  assert.match(text, /git merge --no-ff W/, "the integrate command");
  assert.match(text, /npm test/, "the resolved verify command");
  assert.match(text, /archkit_board_merged/, "the record tool + its arguments");
  assert.match(text, /passed=<t\|f>/, "…including the pass/fail argument");
  assert.match(text, /git checkout W -- <owns>/, "the path-extract fallback");
  assert.match(text, /owns src\/a\.mjs src\/b\.mjs/, "…bounded by each lane's owned paths");
  assert.match(text, /REVERTS earlier merges/, "why the rebase is mandatory");
  assert.match(text, /Worktree-green ≠ main-green/, "why verify-after-each is mandatory");

  // The debt ledger's contents.
  assert.match(text, /olddebt \(lane relay\): unverified/, "the unverified merge is named");

  // The escape hatch to the structured plan.
  assert.match(text, /archkit_conductor/, "the structured-plan tools are still named");
  assert.match(text, /archkit_session_state/);
});

test("EC5: a clean board states the ok cases explicitly rather than going silent", () => {
  const clean = {
    counts: { frontier: 0, claimableLanes: 0, barriers: 0, in_flight: 0, merge_queue: 0, blocked: 0, exceptions: 0, leases_expired: 0 },
    claimableLanes: {}, barriers: [], leasesExpired: [], exceptions: [], unverifiedMerges: [],
    convergence: { branch: "main", groups: [] },
  };
  const text = conductorGraph(clean).join("\n");
  assert.match(text, /no expired leases/, "reclaim: explicit zero");
  assert.match(text, /no claimable lanes/, "dispatch: explicit zero");
  assert.match(text, /no exceptions/, "deep-review: explicit zero");
  assert.match(text, /merge queue empty/, "converge: explicit zero");
  assert.match(text, /INTEGRATION DEBT: none/, "debt: explicit zero — silence is never evidence");
});

test("EC5: an unresolvable verify is an ERROR leaf, never a silent gap", () => {
  const lines = convergenceGraph({
    branch: "main",
    groups: [{
      order: 1, lane: "L", slugs: ["a"], dependsOnLanes: [], paths: ["src/a.mjs"],
      precondition: { kind: "rebase-onto-tip", command: "git rebase main" },
      integration: { on: "main", command: "git merge --no-ff W", verify: null, verifySource: "none" },
      fallback: { kind: "path-extract", on: "main", command: "git checkout W -- src/a.mjs" },
      record: { tool: "archkit_board_merged" },
    }],
  }).join("\n");
  assert.ok(lines.includes(SYM.error), "the unverifiable point carries the error symbol");
  assert.match(lines, /record unverified, never assume green/);
});

test("EC5: cross-lane dependency order and split segments survive the graph form", () => {
  const lines = convergenceGraph({
    branch: "main", split: true, splitReason: "lane cycle",
    groups: [{
      order: 1, lane: "L", segment: 2, slugs: ["a", "b"], dependsOnLanes: ["M", "N"], paths: ["src/a.mjs"],
      precondition: { kind: "rebase-onto-tip", command: "x" },
      integration: { on: "main", command: "y", verify: "npm test", verifySource: "project" },
      fallback: { kind: "path-extract", on: "main", command: "z" },
      record: { tool: "archkit_board_merged" },
    }],
  }).join("\n");
  assert.match(lines, /mutually dependent \(lane cycle\)/, "the split reason survives");
  assert.match(lines, /L\/2:/, "the segment number survives");
  assert.match(lines, new RegExp(`${GLYPH.after}M,N`), "the lands-after edges survive");
  assert.match(lines, /a → b/, "intra-point order survives");
});

test("EC5: the debt ledger reports severity as data, not just as a glyph", () => {
  assert.deepEqual(debt([]).severity, "ok");
  const d = debt([{ slug: "s", lane: "L", status: "unverified", command: null, reason: "verify-not-run" }]);
  assert.equal(d.severity, "attention");
  assert.match(d.text, /s \(lane L\): unverified \[verify-not-run\]/);
  assert.ok(debtLine([]).startsWith(SYM.ok));
});

for (const dir of tmpDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
