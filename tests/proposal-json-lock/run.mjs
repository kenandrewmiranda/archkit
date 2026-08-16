#!/usr/bin/env node
// proposal-json-lock — the last lock-free read-modify-writes over CGR JSON.
//
// tests/fslock proves the PRIMITIVE. tests/cgr-concurrency proves the GOAL FILE
// mutators adopted it. tests/board-json-lock closed the sidecar counters and the
// chat board. This suite closes what that lane disclosed and did not own — the
// two proposal stores and the project config:
//
//   1. writeGoalProposal lost record. The dedup is a check-then-act, and its
//      writer is bin/archkit-stop-hook.mjs — a fresh process at every turn-end in
//      every open session. Two sessions that surface the SAME follow-up hash both
//      saw "absent", both wrote, and the second replaced the first's record after
//      the first had already reported it as newly created.
//
//   2. acceptGraphProposal lost gap. The sharpest of the three: a load-modify-
//      write of a file another session also writes. It reads the gap list,
//      appends a node line to the cluster .graph, then writes the list back minus
//      one — so a gap a completing goal recorded in that window is erased, and it
//      is unrecoverable because the goal that detected it is already done. The
//      .graph append is the same defect one level down: two accepters each write
//      "everything I saw plus my line", so the loser's node line vanishes while
//      its gap is still consumed.
//
//   3. writeFinalizeConfig lost knob. .arch/config.json is not a private sidecar
//      — it carries the review disables, the api gate, the escalation threshold
//      and the integration branch. A lost update reverts a project policy in a
//      git-tracked file nobody is watching.
//
// REAL PROCESSES, BEHIND A BARRIER. An in-process fake proves nothing about a
// rename, and children launched in a burst can be accidentally serialised by
// spawn latency — so every child announces itself and blocks until all of them
// are provably in flight.
//
// EVERY RACE HAS A NEGATIVE CONTROL that reproduces the PRE-fix code and MUST
// lose. A protected run that passes because nothing interleaved is worthless, so
// if a control ever stops losing data this suite fails loudly and says the
// workload has gone too soft to prove anything.
//
// Every fixture is an mkdtemp'd project with its own .arch/; nothing here can
// reach the live board (scripts/arch-write-guard.cjs would EACCES it anyway).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  writeGoalProposal,
  listGoalProposals,
  promoteGoalProposal,
  writeGraphProposal,
  listGraphProposals,
  acceptGraphProposal,
  writeFinalizeConfig,
  readFinalizeConfig,
  loadGoal,
  FINALIZE_STEPS,
} from "../../src/lib/goals.mjs";
import { archLockPath, LOCK_WAIT_MS } from "../../src/lib/fslock.mjs";
import {
  proposalFixture,
  graphFixture,
  configFixture,
  tempProject,
  fillerGaps,
  acceptableGaps,
  acceptFile,
  witnessFile,
  bigExcerpt,
  cleanupTemps,
  childPath,
  runChild,
  runTogether,
  readLog,
  clusterNodeIds,
  proposedPath,
  graphProposalPath,
  clusterPath,
  configPath,
} from "./fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHILD_PROPOSAL = childPath("child-proposal.mjs");
const CHILD_RECORD = childPath("child-graph-record.mjs");
const CHILD_ACCEPT = childPath("child-graph-accept.mjs");
const CHILD_CONFIG = childPath("child-config.mjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

async function atest(name, fn) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// TORN READS ARE A RESULT, NOT A CRASH. An in-place whole-file rewrite lets a
// shorter write land over a longer file, so the pre-fix runs genuinely leave JSON
// that no reader can parse — the failure mode atomic replace exists to prevent.
// The controls must be able to REPORT that instead of dying on it, and the locked
// runs assert it never happens.
function readJsonTorn(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return { torn: true, value: null }; }
  try { return { torn: false, value: JSON.parse(raw) }; }
  catch { return { torn: true, value: null }; }
}

console.log("\nproposal-json-lock — goal proposals, graph gaps + config.json under the write contract (ADR 0030)\n");

// ═══════════════════════════════════════════════════════════════════════════
console.log("race 1 — concurrent sessions recording the SAME deferred follow-up");
// ═══════════════════════════════════════════════════════════════════════════

const PROPOSAL_WRITERS = 6;
const SHARED_HASH = "sharedhash01";
const EXCERPT_BYTES = 320 * 1024;

async function proposalRace(mode) {
  const { dir, archDir } = proposalFixture();
  const logFile = path.join(dir, "proposal.log");
  fs.writeFileSync(logFile, "");

  await runTogether(dir, Array.from({ length: PROPOSAL_WRITERS }, (_, i) => (readyDir, goFile) =>
    runChild(CHILD_PROPOSAL, [mode, archDir, SHARED_HASH, `session-${i}`, EXCERPT_BYTES, logFile, readyDir, goFile], dir)));

  const records = readLog(logFile);
  const creators = records.filter((r) => r.sharedCreated === true).map((r) => r.source);
  const { torn, value: onDisk } = readJsonTorn(proposedPath(archDir, SHARED_HASH));
  return { records, creators, onDisk, torn, archDir };
}

await atest(`locked: ${PROPOSAL_WRITERS} sessions racing one hash, exactly ONE records it`, async () => {
  const r = await proposalRace("lock");
  assert.equal(r.records.length, PROPOSAL_WRITERS, "every contender reported");
  for (const rec of r.records) {
    assert.equal(rec.error, null, `contender ${rec.source} threw: ${rec.error}`);
    assert.equal(rec.failedOpen, 0, `contender ${rec.source} failed OPEN — the run proves nothing about the lock`);
  }
  assert.deepEqual(
    r.creators.length,
    1,
    `${r.creators.length} sessions were told they created the proposal: ${r.creators.join(", ")}`,
  );
  // The other half of the defect: the record on disk must belong to the caller
  // that was told it created it. A later writer replacing it is exactly the
  // "erased what another session just recorded" failure.
  assert.equal(r.torn, false, "the record was left unparseable — a reader saw a half-written file");
  assert.equal(r.onDisk.source, r.creators[0], "the surviving record is not the one the creator wrote");
  assert.equal(r.onDisk.contextExcerpt.length, EXCERPT_BYTES, "the record is whole — no torn write");
  // Collateral: the lock must not have cost anyone their OWN distinct proposal.
  const hashes = new Set(listGoalProposals(r.archDir).map((p) => p.hash));
  for (const rec of r.records) {
    assert.ok(hashes.has(`own-${rec.source}`), `${rec.source}'s own proposal is missing`);
  }
  assert.equal(hashes.size, PROPOSAL_WRITERS + 1, "one shared proposal + one per session");
});

await atest("NEGATIVE CONTROL: the pre-fix check-then-act lets several sessions record the same hash", async () => {
  // Sampled rather than single-shot: the control is inherently probabilistic (it
  // is a race), and a suite that demands a loss on one specific attempt would be
  // the flaky one. Losing on NONE of the attempts means the workload can no
  // longer lose a record at all — at which point the locked run proves nothing
  // and this must fail, loudly.
  const attempts = 2;
  const runs = [];
  for (let i = 0; i < attempts; i++) runs.push(await proposalRace("nolock"));
  const worst = Math.max(...runs.map((r) => r.creators.length));
  assert.ok(
    worst > 1,
    `the pre-fix dedup admitted exactly one writer across ${attempts} attempts — the workload is too weak to prove anything`,
  );
  const clobbered = runs.some((r) => r.creators.length > 1 && (r.torn || r.onDisk.source !== r.creators[0]));
  assert.ok(clobbered, "and at least one run left a record belonging to a session that wrote over the first one");
  console.log(`      negative control admitted ${runs.map((r) => `${r.creators.length}/${PROPOSAL_WRITERS}`).join(", ")} writers of one hash`);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nrace 2 — a goal recording graph gaps while sessions accept them");
// ═══════════════════════════════════════════════════════════════════════════

const GAP_SLUG = "contended-goal";
// The recorder deliberately finishes its rounds while the accepters are still
// rewriting: erasing "the gap another session just recorded" requires an accept
// whose WRITE lands after the recorder's last one, from a READ taken before it.
// A recorder that outlives every accepter cannot be raced at all, and the control
// would then only ever demonstrate the .graph half of the defect.
const ACCEPTERS = 4;
const ACCEPT_ATTEMPTS = 16;
const RECORD_ROUNDS = 10;
const RECORD_PAUSE_MS = 0;
const ACCEPT_DEADLINE_MS = 20_000;
const BASE_GAPS = [...fillerGaps(), ...acceptableGaps(ACCEPTERS, ACCEPT_ATTEMPTS)];
const ACCEPT_TOTAL = ACCEPTERS * ACCEPT_ATTEMPTS;

async function gapRace(mode) {
  const { dir, archDir } = graphFixture();
  const logFile = path.join(dir, "graph.log");
  fs.writeFileSync(logFile, "");
  const gapsFile = path.join(dir, "gaps.json");
  fs.writeFileSync(gapsFile, JSON.stringify(BASE_GAPS));
  // Seed the store so the accepters have something to consume from the first
  // instant; the recorder then keeps re-recording underneath them.
  writeGraphProposal(archDir, GAP_SLUG, BASE_GAPS);
  const nodesBefore = clusterNodeIds(archDir, "lib").length;

  await runTogether(dir, [
    (readyDir, goFile) => runChild(
      CHILD_RECORD,
      [mode, archDir, GAP_SLUG, RECORD_ROUNDS, gapsFile, RECORD_PAUSE_MS, logFile, readyDir, goFile],
      dir,
    ),
    ...Array.from({ length: ACCEPTERS }, (_, i) => (readyDir, goFile) => runChild(
      CHILD_ACCEPT,
      [mode, archDir, GAP_SLUG, i, ACCEPT_ATTEMPTS, ACCEPT_DEADLINE_MS, logFile, readyDir, goFile],
      dir,
    )),
  ]);

  const records = readLog(logFile);
  const recorder = records.find((r) => r.role === "recorder");
  const accepters = records.filter((r) => r.role === "accepter");
  const accepted = accepters.flatMap((a) => a.accepted || []);
  const anomalies = accepters.flatMap((a) => a.anomalies || []);

  const nodes = clusterNodeIds(archDir, "lib");
  // Every accepted gap must have left exactly one node line behind. Fewer means a
  // concurrent accepter's whole-file .graph write erased it — the file it
  // documented is now undocumented with nothing left to re-detect it.
  const lostNodeLines = (nodesBefore + accepted.length) - nodes.length;

  // A torn proposal is the worst case of all: every gap in it is lost at once,
  // so it counts as such rather than aborting the measurement.
  const { torn, value: proposal } = readJsonTorn(graphProposalPath(archDir, GAP_SLUG));
  const gapFiles = new Set(torn ? [] : proposal.gaps.map((g) => g.file));
  const lastWitness = witnessFile(recorder?.lastRound ?? -1);
  const witnessLost = !gapFiles.has(lastWitness);
  const fillerLost = BASE_GAPS.filter((g) => g.file.includes("filler") && !gapFiles.has(g.file)).length;

  // How long the accepters kept rewriting AFTER the recorder's last record. This
  // is the window in which the lost-record defect can happen at all; if it ever
  // goes to zero the workload has gone soft and the witness assertion below is
  // vacuously true, so the locked run checks it explicitly.
  const tailMs = Math.max(...accepters.map((a) => a.endedAt)) - (recorder?.endedAt ?? Infinity);

  return {
    records, recorder, accepters, accepted, anomalies,
    nodes, lostNodeLines, witnessLost, lastWitness, fillerLost, tailMs, torn, archDir,
  };
}

await atest(`locked: all ${ACCEPT_TOTAL} accepted gaps land, and the last recorded gap survives`, async () => {
  const r = await gapRace("lock");
  assert.equal(r.records.length, ACCEPTERS + 1, "every contender reported");
  for (const rec of r.records) {
    assert.equal(rec.error, null, `contender ${rec.role} threw: ${rec.error}`);
    assert.equal(rec.failedOpen, 0, `contender ${rec.role} failed OPEN — the run proves nothing about the lock`);
  }
  assert.deepEqual(r.anomalies, [], `accepts were refused: ${r.anomalies.join(", ")}`);
  assert.equal(r.accepted.length, ACCEPT_TOTAL, "every accepter completed its full round of accepts");
  assert.equal(
    r.lostNodeLines,
    0,
    `${r.lostNodeLines}/${ACCEPT_TOTAL} authored node lines were erased by a concurrent accept`,
  );
  assert.equal(new Set(r.nodes).size, r.nodes.length, "no node line was appended twice");
  assert.equal(r.torn, false, "the gap list was left unparseable — a reader saw a half-written file");
  assert.equal(
    r.witnessLost,
    false,
    `the gap the recorder wrote last (${r.lastWitness}) was erased by an accept's stale rewrite`,
  );
  assert.equal(r.fillerLost, 0, `${r.fillerLost} untouched gaps disappeared from the proposal`);
  // The consumed gaps are gone from the store only insofar as the recorder did
  // not re-record them — what must never happen is a gap vanishing without an
  // accept, which the two assertions above cover from both directions.
  assert.ok(listGraphProposals(r.archDir).length === 1, "the proposal itself survived the race");
});

await atest("NEGATIVE CONTROL: the pre-fix accept erases node lines and recorded gaps", async () => {
  const attempts = 2;
  const runs = [];
  for (let i = 0; i < attempts; i++) runs.push(await gapRace("nolock"));
  const worstNodes = Math.max(...runs.map((r) => r.lostNodeLines));
  const anyWitnessLost = runs.some((r) => r.witnessLost);
  // The lost-RECORD half of the defect can only happen while an accepter is still
  // rewriting after the recorder's last record. If that tail ever vanishes the
  // workload has gone soft and the witness half proves nothing, whatever the
  // verdict below says.
  assert.ok(
    runs.some((r) => r.tailMs > 0),
    "no accepter rewrote the gap list after the recorder's last record in any attempt — the workload can no longer " +
    "express the lost-record defect at all (raise ACCEPT_ATTEMPTS or lower RECORD_ROUNDS)",
  );
  assert.ok(
    worstNodes > 0 || anyWitnessLost,
    `the pre-fix accept lost nothing across ${attempts} attempts (node lines lost: ${runs.map((r) => r.lostNodeLines).join(", ")}; ` +
    `last-recorded gap lost: ${runs.map((r) => r.witnessLost).join(", ")}) — the workload is too weak to prove anything`,
  );
  console.log(
    `      negative control lost ${runs.map((r) => `${r.lostNodeLines}/${r.accepted.length}`).join(", ")} node lines,` +
    ` erased the last recorded gap in ${runs.filter((r) => r.witnessLost).length}/${attempts} runs` +
    ` (accepters kept writing ${runs.map((r) => `${r.tailMs}ms`).join(", ")} past it)` +
    ` and left the gap list unparseable in ${runs.filter((r) => r.torn).length}/${attempts}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nrace 3 — concurrent merge-writes of .arch/config.json");
// ═══════════════════════════════════════════════════════════════════════════

// One writer per finalize step, each always writing the SAME value for its own
// key: the serialised result is therefore fully determined, whatever the order.
const CONFIG_ROUNDS = 4;
const CONFIG_TARGET = Object.fromEntries(FINALIZE_STEPS.map((s, i) => [s.key, i % 2 === 0]));

async function configRace(mode) {
  const { dir, archDir } = configFixture();
  const logFile = path.join(dir, "config.log");
  fs.writeFileSync(logFile, "");
  const before = readJson(configPath(archDir));

  await runTogether(dir, FINALIZE_STEPS.map((s) => (readyDir, goFile) => runChild(
    CHILD_CONFIG,
    [mode, archDir, s.key, String(CONFIG_TARGET[s.key]), CONFIG_ROUNDS, logFile, readyDir, goFile],
    dir,
  )));

  const records = readLog(logFile);
  const steps = readFinalizeConfig(archDir).steps;
  const wrong = FINALIZE_STEPS.filter((s) => steps[s.key] !== CONFIG_TARGET[s.key]).map((s) => s.key);
  // An in-place rewrite can leave config.json unparseable, at which point every
  // project knob in it silently reverts to a default for every reader. Measured,
  // not crashed on.
  const { torn, value: after } = readJsonTorn(configPath(archDir));
  return { records, steps, wrong, before, after, torn, archDir };
}

await atest(`locked: ${FINALIZE_STEPS.length} concurrent merge-writes all survive`, async () => {
  const r = await configRace("lock");
  assert.equal(r.records.length, FINALIZE_STEPS.length, "every contender reported");
  for (const rec of r.records) {
    assert.equal(rec.error, null, `contender ${rec.stepKey} threw: ${rec.error}`);
    assert.equal(rec.failedOpen, 0, `contender ${rec.stepKey} failed OPEN — the run proves nothing about the lock`);
  }
  assert.deepEqual(r.wrong, [], `${r.wrong.length} steps were reverted by a concurrent merge: ${r.wrong.join(", ")}`);
  assert.equal(r.torn, false, "config.json was left unparseable — every knob in it would read as a default");
  // The collateral, and the reason this file is not a private sidecar: every
  // other project knob must be byte-for-byte what it was.
  assert.deepEqual(r.after.review, r.before.review, "the review disables were rewritten");
  assert.deepEqual(r.after.apiGate, r.before.apiGate, "the api gate config was rewritten");
  assert.equal(r.after.cgr.escalateAfter, r.before.cgr.escalateAfter, "an unrelated cgr key was dropped");
  assert.equal(Object.keys(r.after.filler).length, Object.keys(r.before.filler).length, "config bulk survived intact");
});

await atest("NEGATIVE CONTROL: the pre-fix merge-write reverts concurrent knobs", async () => {
  // Three attempts rather than two: config.json is the smallest of the three
  // fixtures, so its window is the narrowest and a single sample is the one most
  // likely to come up clean on a fast, idle machine.
  const attempts = 3;
  const runs = [];
  for (let i = 0; i < attempts; i++) runs.push(await configRace("nolock"));
  const worst = Math.max(...runs.map((r) => r.wrong.length));
  assert.ok(
    worst > 0,
    `the pre-fix merge never lost a knob across ${attempts} attempts — the workload is too weak to prove anything`,
  );
  console.log(
    `      negative control reverted ${runs.map((r) => `${r.wrong.length}/${FINALIZE_STEPS.length}`).join(", ")} steps` +
    ` and left config.json unparseable in ${runs.filter((r) => r.torn).length}/${attempts} runs`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nfail-open — acquisition failure is LOUD, and never fails closed (ADR 0030 §7)");
// ═══════════════════════════════════════════════════════════════════════════

// A FOREIGN, FRESH lockfile: a pid that is not ours, stamped now, so it is not a
// corpse the TTL may break. The mutation must still happen (fail OPEN — these sit
// on the Stop hook and the MCP request path, and failing closed would hang every
// turn-end), and it must SAY that it ran unprotected. Silence here is the bug:
// "best-effort" is only acceptable while it is auditable.
function holdForeignLock(archDir) {
  const lockPath = archLockPath(archDir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({
    pid: 999_999,
    host: "somewhere-else",
    token: "foreign",
    acquiredAt: new Date().toISOString(),
    acquiredAtMs: Date.now(),
    meta: { op: "a mutation this process cannot see" },
  })}\n`);
  return lockPath;
}

// Run `fn` with a foreign holder in place and collect the warnings it emitted.
async function underForeignLock(archDir, fn) {
  holdForeignLock(archDir);
  const warnings = [];
  const onWarn = (w) => warnings.push(w);
  process.on("warning", onWarn);
  const t0 = Date.now();
  const value = fn();
  const elapsed = Date.now() - t0;
  await new Promise((r) => setImmediate(r)); // emitWarning lands on the next tick
  process.off("warning", onWarn);
  return { value, elapsed, loud: warnings.filter((w) => w.name === "ArchkitLockWarning") };
}

await atest("writeGoalProposal under a foreign lock still records, and warns that it did", async () => {
  const { archDir } = proposalFixture();
  const r = await underForeignLock(archDir, () => writeGoalProposal(archDir, { hash: "under-lock", title: "T" }));
  assert.equal(r.value, true, "the proposal was recorded anyway — fail OPEN, not fail closed");
  assert.ok(fs.existsSync(proposedPath(archDir, "under-lock")), "and it is on disk");
  assert.ok(r.loud.length > 0, "the fail-open was silent — nothing warned that the record was written unprotected");
  assert.ok(
    r.loud.some((w) => /writeGoalProposal/.test(w.message)),
    `the warning does not name the operation: ${r.loud.map((w) => w.message).join(" | ")}`,
  );
  console.log(`      fail-open cost ${r.elapsed}ms (budget ${LOCK_WAIT_MS}ms per acquisition)`);
});

await atest("acceptGraphProposal under a foreign lock still accepts, and warns that it did", async () => {
  const { archDir } = graphFixture();
  writeGraphProposal(archDir, "foreign-goal", [
    { kind: "undocumented-file", file: "src/lib/one.mjs", cluster: "lib", node: "@lib", suggestedLine: "x" },
    { kind: "undocumented-file", file: "src/lib/two.mjs", cluster: "lib", node: "@lib", suggestedLine: "y" },
  ]);
  const r = await underForeignLock(archDir, () => acceptGraphProposal(archDir, "foreign-goal", {
    file: "src/lib/one.mjs",
    line: "One [S] : src/lib/one.mjs — a helper | Goals → THIS",
  }));
  assert.equal(r.value.ok, true, "the accept happened anyway — fail OPEN, not fail closed");
  assert.equal(r.value.remainingGaps, 1, "and the gap list was rewritten");
  assert.ok(clusterNodeIds(archDir, "lib").includes("One"), "the node line landed in the cluster");
  assert.ok(
    r.loud.some((w) => /acceptGraphProposal/.test(w.message)),
    `nothing warned that the gap list was rewritten unprotected: ${r.loud.map((w) => w.message).join(" | ") || "(silence)"}`,
  );
});

await atest("writeFinalizeConfig under a foreign lock still writes, and warns that it did", async () => {
  const { archDir } = configFixture();
  const r = await underForeignLock(archDir, () => writeFinalizeConfig(archDir, { steps: { push: true } }));
  assert.equal(r.value.steps.push, true, "the merge happened anyway — fail OPEN, not fail closed");
  assert.equal(readFinalizeConfig(archDir).steps.push, true, "and it is on disk");
  assert.ok(
    r.loud.some((w) => /writeFinalizeConfig/.test(w.message)),
    `nothing warned that config.json was merged unprotected: ${r.loud.map((w) => w.message).join(" | ") || "(silence)"}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nsingle-process behaviour — unchanged by the conversion");
// ═══════════════════════════════════════════════════════════════════════════

test("writeGoalProposal dedups by hash and keeps the FIRST record", () => {
  const { archDir } = tempProject("single-proposal");
  assert.equal(writeGoalProposal(archDir, { hash: "abc123", title: "Do X", source: "first" }), true);
  assert.equal(writeGoalProposal(archDir, { hash: "abc123", title: "Do X again", source: "second" }), false, "dedup");
  const rec = readJson(proposedPath(archDir, "abc123"));
  assert.equal(rec.title, "Do X", "the first record is the one kept");
  assert.equal(rec.source, "first");
  assert.equal(listGoalProposals(archDir).length, 1);
  // The record shape is unchanged: 2-space JSON, no trailing newline added.
  assert.equal(fs.readFileSync(proposedPath(archDir, "abc123"), "utf8"), JSON.stringify(rec, null, 2));
  // And no staging file is left behind by the atomic write.
  assert.deepEqual(
    fs.readdirSync(path.join(archDir, "goals", "proposed")).filter((f) => !f.endsWith(".json")),
    [],
    "a temp file survived the write",
  );
});

test("promoteGoalProposal still writes the goal and consumes the proposal exactly once", () => {
  const { archDir } = tempProject("single-promote");
  writeGoalProposal(archDir, { hash: "h9", title: "Add retries", exitCriteria: ["retries work"] });
  const r = promoteGoalProposal(archDir, "h9");
  assert.equal(r.slug, "add-retries");
  assert.equal(loadGoal(archDir, "add-retries").meta.title, "Add retries");
  assert.equal(listGoalProposals(archDir).length, 0, "the proposal is consumed");
  assert.equal(promoteGoalProposal(archDir, "h9"), null, "a second promote finds nothing");
});

test("writeGraphProposal round-trips through listGraphProposals, and writes nothing for no gaps", () => {
  const { archDir } = graphFixture();
  const written = writeGraphProposal(archDir, "some-goal", [
    { kind: "undocumented-file", file: "src/lib/new.mjs", cluster: "lib", node: "@lib", suggestedLine: "l" },
  ]);
  assert.ok(written.proposalPath.endsWith("some-goal.json"));
  assert.equal(written.count, 1);
  const [p] = listGraphProposals(archDir);
  assert.equal(p.slug, "some-goal");
  assert.equal(p.gaps.length, 1);
  assert.equal(writeGraphProposal(archDir, "empty-goal", []), null, "no gaps → no file, as before");
  assert.equal(listGraphProposals(archDir).length, 1);
});

test("acceptGraphProposal drops only the consumed gap, then deletes the emptied proposal", () => {
  const { archDir } = graphFixture();
  writeGraphProposal(archDir, "multi", [
    { kind: "undocumented-file", file: "src/lib/a.mjs", cluster: "lib", node: "@lib", suggestedLine: "a" },
    { kind: "undocumented-file", file: "src/lib/b.mjs", cluster: "lib", node: "@lib", suggestedLine: "b" },
  ]);
  const first = acceptGraphProposal(archDir, "multi", {
    file: "src/lib/a.mjs", line: "A [S] : src/lib/a.mjs — helper a | Goals → THIS",
  });
  assert.equal(first.ok, true);
  assert.equal(first.remainingGaps, 1);
  assert.equal(first.proposalRemoved, false);
  assert.deepEqual(readJson(graphProposalPath(archDir, "multi")).gaps.map((g) => g.file), ["src/lib/b.mjs"]);
  const second = acceptGraphProposal(archDir, "multi", {
    file: "src/lib/b.mjs", line: "B [S] : src/lib/b.mjs — helper b | Goals → THIS",
  });
  assert.equal(second.proposalRemoved, true);
  assert.ok(!fs.existsSync(graphProposalPath(archDir, "multi")), "the emptied proposal is deleted, as before");
  assert.deepEqual(clusterNodeIds(archDir, "lib"), ["Goals", "A", "B"], "both lines appended, in order");
  // Refusals still surface a reason rather than guessing.
  assert.equal(acceptGraphProposal(archDir, "nope", { line: "X [S] : a — b | c" }).reason, "unknown_proposal");
});

test("acceptGraphProposal rejects a malformed line and leaves the .graph untouched", () => {
  const { archDir } = graphFixture();
  writeGraphProposal(archDir, "bad", [
    { kind: "undocumented-file", file: "src/lib/c.mjs", cluster: "lib", node: "@lib", suggestedLine: "c" },
  ]);
  const before = fs.readFileSync(clusterPath(archDir, "lib"), "utf8");
  const r = acceptGraphProposal(archDir, "bad", { file: "src/lib/c.mjs", line: "this is not a node line" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "malformed_line");
  assert.equal(fs.readFileSync(clusterPath(archDir, "lib"), "utf8"), before, "the cluster is byte-identical");
  assert.equal(readJson(graphProposalPath(archDir, "bad")).gaps.length, 1, "and the gap is still there to retry");
  assert.deepEqual(
    fs.readdirSync(path.join(archDir, "clusters")).filter((f) => f.includes("probe")),
    [],
    "the validation probe cleaned itself up",
  );
});

test("writeFinalizeConfig merges, stamps configured, and preserves every other key", () => {
  const { archDir } = tempProject("single-config");
  fs.writeFileSync(configPath(archDir), `${JSON.stringify({ review: { disable: ["x"] }, cgr: { leaseTtlHours: 9 } }, null, 2)}\n`);
  writeFinalizeConfig(archDir, { steps: { push: true }, ciCd: "github-actions" });
  const cfg = readJson(configPath(archDir));
  assert.deepEqual(cfg.review, { disable: ["x"] }, "unrelated top-level keys survive");
  assert.equal(cfg.cgr.leaseTtlHours, 9, "sibling cgr keys survive");
  assert.equal(cfg.cgr.finalize.configured, true, "one-time setup is stamped");
  assert.equal(cfg.cgr.finalize.ciCd, "github-actions");
  assert.equal(cfg.cgr.finalize.steps.push, true);
  assert.equal(cfg.cgr.finalize.steps.changelog, true, "defaults for untouched steps");
  writeFinalizeConfig(archDir, { enabled: false });
  assert.equal(readFinalizeConfig(archDir).enabled, false);
  assert.equal(readFinalizeConfig(archDir).steps.push, true, "a later patch keeps earlier steps");
  assert.ok(fs.readFileSync(configPath(archDir), "utf8").endsWith("}\n"), "still 2-space JSON + trailing newline");
});

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nsource audit — the contract is an invariant nothing else enforces");
// ═══════════════════════════════════════════════════════════════════════════

// ADR 0030's own "harder" note: a new fs.writeFileSync against .arch/ silently
// opts out of the contract and no behavioural test fails. So these mutators are
// pinned by a scan, exactly as tests/board-json-lock pins the sidecar ones.

const GOALS_SRC = fs.readFileSync(path.join(REPO_ROOT, "src/lib/goals.mjs"), "utf8");

// A function's text: from its declaration to the next top-level declaration.
// Line-anchored rather than brace-counted, so a brace inside a template literal
// or a comment cannot silently truncate the slice and hand the scan an alibi.
function functionBody(src, name) {
  const re = new RegExp(`^(?:export )?function ${name}\\(`, "m");
  const m = re.exec(src);
  assert.ok(m, `${name} not found — the audit is scanning for a function that no longer exists`);
  const rest = src.slice(m.index + m[0].length);
  const end = /^(?:export )?(?:function|const|class) /m.exec(rest);
  return rest.slice(0, end ? end.index : rest.length);
}

// Every writer of the two proposal stores and of config.json. Reads
// (listGoalProposals / listGraphProposals / readFinalizeConfig) stay lock-free
// and tolerant by design — the contract covers writers.
const LOCKED_JSON_WRITERS = [
  "writeGoalProposal",
  "promoteGoalProposal",
  "writeGraphProposal",
  "acceptGraphProposal",
  "writeFinalizeConfig",
];

for (const name of LOCKED_JSON_WRITERS) {
  test(`AUDIT: goals.mjs ${name} routes through withGoalsLock`, () => {
    assert.match(functionBody(GOALS_SRC, name), /withGoalsLock\(/, `${name} mutates shared JSON outside the lock`);
  });
}

for (const name of ["writeGoalProposal", "writeGraphProposal", "acceptGraphProposal", "writeFinalizeConfig", "appendValidatedNodeLine"]) {
  test(`AUDIT: goals.mjs ${name} writes atomically, never in place`, () => {
    const body = functionBody(GOALS_SRC, name);
    assert.doesNotMatch(body, /fs\.writeFileSync\(/, `${name} still writes shared state in place`);
    assert.match(body, /atomicWriteFileSync\(/, `${name} does not write through the atomic primitive`);
  });
}

test("AUDIT: writeGoalProposal no longer hand-rolls its own tmp+rename", () => {
  // ADR 0030 §1 promoted exactly this pattern into the primitive. A re-derived
  // copy would silently drop the random suffix and the win32 replace retry.
  const body = functionBody(GOALS_SRC, "writeGoalProposal");
  assert.doesNotMatch(body, /renameSync\(/, "writeGoalProposal renames a temp file itself instead of using the primitive");
  assert.doesNotMatch(body, /\.tmp/, "writeGoalProposal still builds its own temp path");
});

test("AUDIT: writeGoalProposal checks for an existing record INSIDE the lock", () => {
  const body = functionBody(GOALS_SRC, "writeGoalProposal");
  const lockAt = body.indexOf("withGoalsLock(");
  const checkAt = body.indexOf("existsSync(");
  assert.ok(lockAt >= 0 && checkAt >= 0, "expected both a lock and an existence check");
  assert.ok(checkAt > lockAt, "check-then-act outside the lock is the bug; the check must sit inside the callback");
});

for (const name of ["acceptGraphProposal", "writeFinalizeConfig"]) {
  test(`AUDIT: goals.mjs ${name} reads the file it rewrites INSIDE the lock`, () => {
    const body = functionBody(GOALS_SRC, name);
    const lockAt = body.indexOf("withGoalsLock(");
    const readAt = body.indexOf("readFileSync(");
    const writeAt = body.indexOf("atomicWriteFileSync(");
    assert.ok(lockAt >= 0, `${name} does not take the lock`);
    assert.ok(readAt > lockAt, "read-then-lock is the bug; the read must sit inside the lock callback");
    assert.ok(writeAt > readAt, "and the rewrite must follow the re-read, not a snapshot");
  });
}

test("AUDIT: the raw .graph writer appendValidatedNodeLine is reachable ONLY from a locked body", () => {
  // appendValidatedNodeLine deliberately does NOT acquire (its one caller already
  // holds the lock for the whole read-append-drop-gap sequence, and a second
  // acquire would re-pay the fail-open budget inside it). That makes it an
  // unguarded read-modify-write, so its reachability is pinned: definition +
  // exactly one call site, which is audited above as taking the lock.
  const calls = (GOALS_SRC.match(/appendValidatedNodeLine\(/g) || []).length;
  assert.equal(calls, 2, `appendValidatedNodeLine has ${calls - 1} call sites — expected exactly acceptGraphProposal`);
  const body = functionBody(GOALS_SRC, "acceptGraphProposal");
  assert.match(body, /appendValidatedNodeLine\(/, "acceptGraphProposal no longer appends through the validated writer");
});

// ── done ─────────────────────────────────────────────────────────────────────

cleanupTemps();
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
