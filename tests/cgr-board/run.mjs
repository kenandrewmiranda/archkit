#!/usr/bin/env node
// Tests for the CGR 2.0 persistent board (board-state-manager, ADR 0014).
//
// What this verifies:
//   - appendEvent / readEvents round-trip + unknown-type rejection + torn-line tolerance
//   - foldEvents is PURE/deterministic (same events → identical fold)
//   - sessionState is deterministic (same inputs + same `now` → identical board)
//   - the seven derived slices: lanes, frontier, blocked, in_flight, merge_queue,
//     conflicts, leases_expired — driven by events folded over CGR frontmatter
//   - the board is purely DERIVED — no separate mutable board file is created
//   - extended CGR frontmatter round-trips (lane/owns/depends_on/exclusive/
//     completion/lease/lineage/criteria-met/handoff), incl. inline-JSON objects
//   - concurrent/parallel append safety — N processes appending M events each
//     produce N*M intact, individually-parseable NDJSON lines (no torn writes)

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  EVENT_TYPES,
  appendEvent,
  readEvents,
  eventsPath,
  foldEvents,
  sessionState,
} from "../../src/lib/board.mjs";
import {
  writeGoal,
  loadGoal,
  startGoal,
  stampGoalFields,
  laneOf,
  ownsOf,
  dependsOnOf,
  exclusiveOf,
  completionOf,
  leaseOf,
  lineageOf,
  criteriaMetOf,
  handoffOf,
  goalsDir,
} from "../../src/lib/goals.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOARD_URL = pathToFileURL(path.resolve(__dirname, "../../src/lib/board.mjs")).href;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

function freshArch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-board-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  return arch;
}

// Write a CGR directly at goals/<slug>.md with a chosen status — gives full
// control over lane/owns/depends_on without driving the whole intake/start flow.
// Uses the public goals API: writeGoal (→ queue, pending) then stampGoalFields +
// startGoal as needed.
function liveGoal(arch, slug, { status = "in-progress", lane, owns, dependsOn, exclusive, completion } = {}) {
  writeGoal(arch, { slug, title: slug, exitCriteria: ["x"] });
  if (status === "in-progress") startGoal(arch, slug); // moves queue → root, status in-progress
  const fields = {};
  if (lane !== undefined) fields.lane = lane;
  if (owns !== undefined) fields.owns = owns;
  if (dependsOn !== undefined) fields.dependsOn = dependsOn;
  if (exclusive !== undefined) fields.exclusive = exclusive;
  if (completion !== undefined) fields.completion = completion;
  if (Object.keys(fields).length) stampGoalFields(arch, slug, fields);
  return slug;
}
function pendingGoal(arch, slug, { lane, dependsOn } = {}) {
  writeGoal(arch, { slug, title: slug, exitCriteria: ["x"] });
  const fields = {};
  if (lane !== undefined) fields.lane = lane;
  if (dependsOn !== undefined) fields.dependsOn = dependsOn;
  if (Object.keys(fields).length) stampGoalFields(arch, slug, fields);
  return slug;
}

// ── append / read ───────────────────────────────────────────────────────────

test("appendEvent + readEvents round-trip", () => {
  const arch = freshArch();
  const rec = appendEvent(arch, { type: "claimed", slug: "a", worker: "w1", lane: "L" });
  assert.equal(rec.type, "claimed");
  assert.ok(rec.at, "append stamps `at`");
  const events = readEvents(arch);
  assert.equal(events.length, 1);
  assert.equal(events[0].slug, "a");
  assert.equal(events[0].worker, "w1");
});

test("EVENT_TYPES is the closed vocabulary from the ADR", () => {
  assert.deepEqual(
    [...EVENT_TYPES].sort(),
    ["claimed", "completed", "conflict", "fissioned", "lease-expired", "merged"],
  );
});

test("appendEvent refuses an unknown event type", () => {
  const arch = freshArch();
  assert.throws(() => appendEvent(arch, { type: "bogus", slug: "a" }), /unknown board event type/);
  assert.equal(readEvents(arch).length, 0, "nothing written on rejection");
});

test("readEvents skips torn/partial lines", () => {
  const arch = freshArch();
  appendEvent(arch, { type: "claimed", slug: "a" });
  fs.appendFileSync(eventsPath(arch), '{"type":"completed","slug":"b"\n'); // torn (no close)
  appendEvent(arch, { type: "completed", slug: "a" });
  const events = readEvents(arch);
  assert.equal(events.length, 2, "the torn middle line is skipped, valid ones survive");
  assert.deepEqual(events.map((e) => e.slug), ["a", "a"]);
});

// ── determinism ──────────────────────────────────────────────────────────────

test("foldEvents is pure/deterministic", () => {
  const events = [
    { type: "claimed", slug: "a", at: "2026-06-23T10:00:00.000Z", worker: "w1", lane: "L1" },
    { type: "claimed", slug: "b", at: "2026-06-23T10:01:00.000Z", worker: "w2", lane: "L2" },
    { type: "completed", slug: "a", at: "2026-06-23T10:05:00.000Z", completion: "full" },
    { type: "conflict", slugs: ["a", "b"], files: ["src/x.mjs"], at: "2026-06-23T10:06:00.000Z" },
  ];
  const f1 = foldEvents(events);
  const f2 = foldEvents(events);
  assert.deepEqual(f1, f2);
  assert.equal(f1.bySlug.get("a").lifecycle, "completed");
  assert.equal(f1.bySlug.get("b").lifecycle, "claimed");
  assert.equal(f1.conflicts.length, 1);
});

test("sessionState is deterministic for fixed inputs + now", () => {
  const arch = freshArch();
  liveGoal(arch, "a", { lane: "backend", owns: ["src/lib/*"] });
  pendingGoal(arch, "b", { lane: "frontend" });
  appendEvent(arch, { type: "claimed", slug: "a", worker: "w1", lane: "backend",
    lease: { worker: "w1", expires: "2026-06-23T12:00:00.000Z" } });
  const now = "2026-06-23T11:00:00.000Z";
  const s1 = sessionState(arch, { now });
  const s2 = sessionState(arch, { now });
  assert.deepEqual(s1, s2);
  assert.deepEqual(Object.keys(s1).sort(),
    ["blocked", "conflicts", "frontier", "handoffs", "in_flight", "lanes", "leases_expired", "merge_queue"]);
});

// ── derived slices ───────────────────────────────────────────────────────────

test("in_flight → merge_queue → done lifecycle", () => {
  const arch = freshArch();
  liveGoal(arch, "a", { lane: "L" });
  appendEvent(arch, { type: "claimed", slug: "a", worker: "w1", lane: "L" });
  let s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  assert.deepEqual(s.in_flight.map((f) => f.slug), ["a"]);
  assert.equal(s.merge_queue.length, 0);

  appendEvent(arch, { type: "completed", slug: "a", completion: "partial" });
  s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  assert.equal(s.in_flight.length, 0, "completed leaves in_flight");
  assert.deepEqual(s.merge_queue.map((m) => m.slug), ["a"]);
  assert.equal(s.merge_queue[0].completion, "partial");

  appendEvent(arch, { type: "merged", slug: "a" });
  s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  assert.equal(s.merge_queue.length, 0, "merged leaves merge_queue");
});

test("blocked vs frontier driven by depends_on + completed event", () => {
  const arch = freshArch();
  pendingGoal(arch, "dependent", { dependsOn: ["dep"] });
  let s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  assert.deepEqual(s.blocked.map((b) => b.slug), ["dependent"]);
  assert.deepEqual(s.blocked[0].blockedOn, ["dep"]);
  assert.equal(s.frontier.length, 0, "blocked goal is not on the frontier");

  // Satisfy the dep purely by folding a completed event (dep lives nowhere as a file).
  appendEvent(arch, { type: "completed", slug: "dep" });
  s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  assert.equal(s.blocked.length, 0, "dep satisfied → no longer blocked");
  assert.deepEqual(s.frontier.map((f) => f.slug), ["dependent"]);
});

test("lanes group every live CGR by lane", () => {
  const arch = freshArch();
  liveGoal(arch, "a", { lane: "backend" });
  liveGoal(arch, "b", { lane: "backend" });
  liveGoal(arch, "c", { lane: "frontend" });
  liveGoal(arch, "d", {}); // no lane → default
  const s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  assert.deepEqual(s.lanes.backend, ["a", "b"]);
  assert.deepEqual(s.lanes.frontend, ["c"]);
  assert.deepEqual(s.lanes.default, ["d"]);
});

test("leases_expired from lease TTL and explicit event", () => {
  const arch = freshArch();
  liveGoal(arch, "x", { lane: "L" });
  liveGoal(arch, "y", { lane: "L" });
  appendEvent(arch, { type: "claimed", slug: "x", worker: "w1", lane: "L",
    lease: { worker: "w1", expires: "2026-06-23T10:00:00.000Z" } }); // past
  appendEvent(arch, { type: "claimed", slug: "y", worker: "w2", lane: "L",
    lease: { worker: "w2", expires: "2026-06-23T23:00:00.000Z" } }); // future
  const s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  assert.deepEqual(s.leases_expired.map((l) => l.slug), ["x"]);
  assert.equal(s.leases_expired[0].worker, "w1");

  // An explicit lease-expired event also surfaces, independent of a TTL clock.
  const arch2 = freshArch();
  appendEvent(arch2, { type: "claimed", slug: "z", worker: "w3" });
  appendEvent(arch2, { type: "lease-expired", slug: "z", worker: "w3" });
  const s2 = sessionState(arch2, { now: "2026-06-23T11:00:00.000Z" });
  assert.deepEqual(s2.leases_expired.map((l) => l.slug), ["z"]);
  assert.equal(s2.in_flight.length, 0, "an expired lease is no longer in_flight");
});

test("conflicts: file-overlap among live CGRs + conflict events", () => {
  const arch = freshArch();
  liveGoal(arch, "a", { lane: "L1", owns: ["src/lib/board.mjs"] });
  liveGoal(arch, "b", { lane: "L2", owns: ["src/lib/*"] }); // glob overlaps board.mjs
  appendEvent(arch, { type: "conflict", slugs: ["a", "b"], files: ["src/lib/board.mjs"] });
  const s = sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  const fileOverlap = s.conflicts.find((c) => c.source === "file-overlap");
  const evConflict = s.conflicts.find((c) => c.source === "event");
  assert.ok(fileOverlap, "derived file-overlap conflict present");
  assert.deepEqual(fileOverlap.slugs, ["a", "b"]);
  assert.equal(fileOverlap.crossLane, true, "different lanes → crossLane");
  assert.ok(evConflict, "event-sourced conflict present");
});

// ── purely derived: no mutable board file ────────────────────────────────────

test("board is purely derived — only the event log exists on disk", () => {
  const arch = freshArch();
  liveGoal(arch, "a", { lane: "L" });
  appendEvent(arch, { type: "claimed", slug: "a" });
  sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  sessionState(arch, { now: "2026-06-23T11:00:00.000Z" });
  const boardFiles = fs.readdirSync(path.join(arch, "board"));
  assert.deepEqual(boardFiles, ["events.ndjson"],
    "folding writes nothing — the only board file is the append-only log");
});

// ── extended frontmatter round-trip ──────────────────────────────────────────

test("extended CGR frontmatter round-trips (incl. inline-JSON objects)", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "g", title: "g", exitCriteria: ["one", "two"] });
  stampGoalFields(arch, "g", {
    lane: "backend",
    owns: ["src/lib/*.mjs", "src/mcp/tools.mjs"],
    dependsOn: ["upstream-a", "upstream-b"],
    exclusive: true,
    completion: "partial",
    lease: { worker: "w7", expires: "2026-06-23T12:00:00.000Z" },
    lineage: { forked_from: "g-original", supersedes: null, superseded_by: "g-next" },
    criteriaMet: [true, false],
    handoff: ".arch/board/handoff/g.md",
  });
  const g = loadGoal(arch, "g");
  assert.equal(laneOf(g), "backend");
  assert.deepEqual(ownsOf(g), ["src/lib/*.mjs", "src/mcp/tools.mjs"]);
  assert.deepEqual(dependsOnOf(g), ["upstream-a", "upstream-b"]);
  assert.equal(exclusiveOf(g), true);
  assert.equal(completionOf(g), "partial");
  assert.deepEqual(leaseOf(g), { worker: "w7", expires: "2026-06-23T12:00:00.000Z" });
  assert.deepEqual(lineageOf(g), { forked_from: "g-original", supersedes: null, superseded_by: "g-next" });
  assert.deepEqual(criteriaMetOf(g), [true, false]);
  assert.equal(handoffOf(g), ".arch/board/handoff/g.md");
});

test("accessors are tolerant of absent/garbage fields", () => {
  const arch = freshArch();
  writeGoal(arch, { slug: "bare", title: "bare", exitCriteria: ["x"] });
  const g = loadGoal(arch, "bare");
  assert.equal(laneOf(g), null);
  assert.deepEqual(ownsOf(g), []);
  assert.deepEqual(dependsOnOf(g), []);
  assert.equal(exclusiveOf(g), false);
  assert.equal(completionOf(g), null);
  assert.equal(leaseOf(g), null);
  assert.equal(lineageOf(g), null);
  assert.deepEqual(criteriaMetOf(g), []);
  assert.equal(handoffOf(g), null);
  // A malformed inline-JSON lease must degrade to null, never throw.
  g.meta.lease = "{not valid json";
  assert.equal(leaseOf(g), null);
});

// ── concurrent / parallel append safety ──────────────────────────────────────

await testAsync("parallel appends from N processes produce N*M intact lines", async () => {
  const arch = freshArch();
  fs.mkdirSync(path.join(arch, "board"), { recursive: true });
  const N = 8, M = 50;

  const worker = `
    const { appendEvent } = await import(process.env.BOARD_URL);
    const n = Number(process.env.COUNT), wid = process.env.WID, arch = process.env.ARCH_DIR;
    for (let i = 0; i < n; i++) appendEvent(arch, { type: "claimed", slug: wid + "-" + i, worker: wid });
  `;

  await Promise.all(Array.from({ length: N }, (_, w) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", worker], {
      env: { ...process.env, BOARD_URL, ARCH_DIR: arch, COUNT: String(M), WID: `w${w}` },
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)));
  })));

  // Every non-empty line must parse on its own — a torn interleave would yield a
  // line that fails JSON.parse. Assert against the RAW file, not readEvents
  // (which would silently swallow a torn line and hide the failure).
  const raw = fs.readFileSync(eventsPath(arch), "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  assert.equal(lines.length, N * M, `expected ${N * M} lines, got ${lines.length}`);
  let intact = 0;
  for (const line of lines) { JSON.parse(line); intact++; }
  assert.equal(intact, N * M, "every appended line is individually valid JSON (no torn writes)");
  // And the slugs are exactly the N*M unique ids the workers wrote.
  const slugs = new Set(readEvents(arch).map((e) => e.slug));
  assert.equal(slugs.size, N * M, "all unique worker slugs present");
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
