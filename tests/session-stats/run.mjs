#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOD = pathToFileURL(path.resolve(__dirname, "../../src/lib/session-stats.mjs")).href;

const {
  statsPathForSession,
  loadOrInit,
  save,
  startTask,
  recordToolCall,
  computeUtilization,
  formatUtilizationLine,
  hashPrompt,
} = await import(MOD);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

console.log("\nsession-stats lib\n");

test("statsPathForSession sanitizes session_id", () => {
  const p = statsPathForSession("abc-123");
  assert.ok(p.endsWith("archkit-stats-abc-123.json"));

  const evil = statsPathForSession("../../etc/passwd");
  assert.ok(!evil.includes("/etc/"), "must not allow path traversal");
  assert.ok(evil.includes(os.tmpdir()), "must stay under tmpdir");
});

test("statsPathForSession returns null for empty/garbage", () => {
  assert.equal(statsPathForSession(""), null);
  assert.equal(statsPathForSession(null), null);
  assert.equal(statsPathForSession("///"), null);
});

test("loadOrInit creates fresh stats with v1 schema", () => {
  const sid = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const s = loadOrInit(sid);
  assert.equal(s.version, 1);
  assert.equal(s.sessionId, sid);
  assert.deepEqual(s.tasks, []);
  assert.equal(s.counts.archkit, 0);
  assert.equal(s.counts.edits, 0);
  assert.equal(s.counts.total, 0);
});

test("save + loadOrInit round-trips state", () => {
  const sid = `test-${Date.now()}-rt`;
  const s = loadOrInit(sid);
  startTask(s, "build the auth feature");
  recordToolCall(s, "mcp__archkit__archkit_resolve_preflight");
  recordToolCall(s, "Edit");
  save(s);

  const reloaded = loadOrInit(sid);
  assert.equal(reloaded.tasks.length, 1);
  assert.equal(reloaded.tasks[0].preflightCalled, true);
  assert.equal(reloaded.tasks[0].edited, true);
  assert.equal(reloaded.counts.archkit, 1);
  assert.equal(reloaded.counts.edits, 1);

  // cleanup
  fs.unlinkSync(statsPathForSession(sid));
});

test("hashPrompt is stable + 12 hex chars", () => {
  const h1 = hashPrompt("foo");
  const h2 = hashPrompt("foo");
  const h3 = hashPrompt("bar");
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[a-f0-9]{12}$/);
});

test("recordToolCall tags task as instrumented when preflight precedes edit", () => {
  const s = loadOrInit(`test-${Date.now()}-instr`);
  startTask(s, "task A");
  recordToolCall(s, "mcp__archkit__archkit_resolve_preflight");
  recordToolCall(s, "Read");
  recordToolCall(s, "Edit");

  const t = s.tasks[0];
  assert.equal(t.preflightCalled, true);
  assert.equal(t.edited, true);
  assert.equal(t.archkitCalls, 1);
  assert.equal(t.edits, 1);
});

test("preflight AFTER edit does not count as instrumented", () => {
  const s = loadOrInit(`test-${Date.now()}-late`);
  startTask(s, "task B");
  recordToolCall(s, "Edit");
  recordToolCall(s, "mcp__archkit__archkit_resolve_preflight"); // too late

  const t = s.tasks[0];
  assert.equal(t.preflightCalled, false, "preflight after first edit must not retroactively instrument");
  assert.equal(t.edited, true);
});

test("archkit_resolve_lookup also instruments", () => {
  const s = loadOrInit(`test-${Date.now()}-lookup`);
  startTask(s, "task C");
  recordToolCall(s, "mcp__archkit__archkit_resolve_lookup");
  recordToolCall(s, "Write");

  assert.equal(s.tasks[0].preflightCalled, true);
});

test("non-preflight archkit tool does NOT instrument", () => {
  const s = loadOrInit(`test-${Date.now()}-other`);
  startTask(s, "task D");
  recordToolCall(s, "mcp__archkit__archkit_stats");
  recordToolCall(s, "Edit");

  // archkit_stats is an archkit call but not a preflight/lookup, so it
  // doesn't count toward "consulted archkit for context before editing"
  assert.equal(s.tasks[0].preflightCalled, false);
  assert.equal(s.tasks[0].archkitCalls, 1, "still counted as archkit call");
});

test("computeUtilization — empty session", () => {
  const s = loadOrInit(`test-${Date.now()}-empty`);
  const u = computeUtilization(s);
  assert.equal(u.perTaskPct, null);
  assert.equal(u.taskCount, 0);
  assert.equal(u.tasksEdited, 0);
});

test("computeUtilization — perTaskPct ignores non-editing tasks", () => {
  const s = loadOrInit(`test-${Date.now()}-mix`);
  startTask(s, "ask only");          // no edits
  recordToolCall(s, "Read");

  startTask(s, "edit instrumented"); // instrumented
  recordToolCall(s, "mcp__archkit__archkit_resolve_preflight");
  recordToolCall(s, "Edit");

  startTask(s, "edit uninstrumented"); // not instrumented
  recordToolCall(s, "Edit");

  const u = computeUtilization(s);
  assert.equal(u.taskCount, 3);
  assert.equal(u.tasksEdited, 2);
  assert.equal(u.tasksInstrumented, 1);
  assert.equal(u.perTaskPct, 50, "1 of 2 editing tasks = 50%");
});

test("computeUtilization — perSessionRatio uses non-archkit tool count as denom", () => {
  const s = loadOrInit(`test-${Date.now()}-ratio`);
  startTask(s, "x");
  // 3 archkit calls, 4 edits/reads → ratio 0.75
  recordToolCall(s, "mcp__archkit__archkit_resolve_warmup");
  recordToolCall(s, "mcp__archkit__archkit_resolve_lookup");
  recordToolCall(s, "mcp__archkit__archkit_review");
  recordToolCall(s, "Read");
  recordToolCall(s, "Read");
  recordToolCall(s, "Edit");
  recordToolCall(s, "Write");

  const u = computeUtilization(s);
  assert.equal(u.archkitCalls, 3);
  assert.equal(u.perSessionRatio, 0.75);
});

test("formatUtilizationLine — on target", () => {
  const s = loadOrInit(`test-${Date.now()}-on`);
  startTask(s, "task");
  recordToolCall(s, "mcp__archkit__archkit_resolve_preflight");
  recordToolCall(s, "Edit");

  const line = formatUtilizationLine(computeUtilization(s));
  assert.match(line, /on target/);
  assert.match(line, /100%/);
});

test("formatUtilizationLine — below target", () => {
  const s = loadOrInit(`test-${Date.now()}-below`);
  startTask(s, "task");
  recordToolCall(s, "Edit"); // no preflight

  const line = formatUtilizationLine(computeUtilization(s));
  assert.match(line, /below target/);
  assert.match(line, /0%/);
});

test("loadOrInit recovers from corrupt stats file", () => {
  const sid = `test-${Date.now()}-corrupt`;
  const file = statsPathForSession(sid);
  fs.writeFileSync(file, "{not valid json");

  const s = loadOrInit(sid);
  assert.equal(s.version, 1);
  assert.deepEqual(s.tasks, []);

  fs.unlinkSync(file);
});

test("loadOrInit reinitializes on schema version mismatch", () => {
  const sid = `test-${Date.now()}-vmismatch`;
  const file = statsPathForSession(sid);
  fs.writeFileSync(file, JSON.stringify({ version: 99, sessionId: sid, tasks: [{}] }));

  const s = loadOrInit(sid);
  assert.equal(s.version, 1);
  assert.deepEqual(s.tasks, []);

  fs.unlinkSync(file);
});

test("task history caps at 200 entries", () => {
  const s = loadOrInit(`test-${Date.now()}-cap`);
  for (let i = 0; i < 250; i++) startTask(s, `prompt ${i}`);
  assert.equal(s.tasks.length, 200);
  assert.equal(s.tasks[0].promptHash, hashPrompt("prompt 50"));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
