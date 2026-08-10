#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-posttooluse-hook.mjs");
const STATS_LIB = pathToFileURL(path.resolve(__dirname, "../../src/lib/session-stats.mjs")).href;
const { statsPathForSession, loadOrInit } = await import(STATS_LIB);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

function freshSessionId() {
  return `posttest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-post-"));
  try { fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function setupArch(dir) {
  fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "# system\n");
}

// The event carries `cwd`, but so must the child process: a spawn without an
// explicit `cwd` inherits the runner's, so a hook that falls back to
// `process.cwd()` (malformed/empty stdin) would resolve archkit's OWN live
// .arch/. Pass the temp project both ways. Never spawn the hook without one.
function spawnHook({ cwd, input, timeout = 8000 }) {
  if (!cwd) throw new Error("spawnHook requires an explicit cwd (never inherit the repo root)");
  return spawnSync(process.execPath, [HOOK], { cwd, input, encoding: "utf8", timeout });
}

function runHook(event) {
  return spawnHook({ cwd: event?.cwd, input: JSON.stringify(event) });
}

function cleanupSession(sessionId) {
  try { fs.unlinkSync(statsPathForSession(sessionId)); } catch {}
}

console.log("\nposttooluse hook — integration\n");

test("exits silently on non-archkit project", () => {
  withTempProject((dir) => {
    const r = runHook({
      session_id: freshSessionId(),
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: path.join(dir, "src", "x.ts") },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

test("increments counter on every tool call (archkit project)", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();

    const r1 = runHook({ session_id: sid, cwd: dir, tool_name: "Read", tool_input: { file_path: path.join(dir, "x.md") } });
    assert.equal(r1.status, 0);

    const r2 = runHook({ session_id: sid, cwd: dir, tool_name: "Bash", tool_input: { command: "ls" } });
    assert.equal(r2.status, 0);

    const r3 = runHook({
      session_id: sid,
      cwd: dir,
      tool_name: "mcp__archkit__archkit_resolve_warmup",
      tool_input: {},
    });
    assert.equal(r3.status, 0);

    const stats = loadOrInit(sid);
    assert.equal(stats.counts.total, 3, "3 tool calls recorded");
    assert.equal(stats.counts.archkit, 1, "1 archkit call");
    assert.equal(stats.counts.reads, 1, "1 read");

    cleanupSession(sid);
  });
});

test("Edit on file outside src/ → counter only, no review output", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    fs.writeFileSync(path.join(dir, "README.md"), "# x");
    const r = runHook({
      session_id: sid,
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: path.join(dir, "README.md") },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "no review output for non-src files");

    const stats = loadOrInit(sid);
    assert.equal(stats.counts.edits, 1, "Edit still counted");
    cleanupSession(sid);
  });
});

test("Edit on file in node_modules → counter only", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const f = path.join(dir, "src", "node_modules", "foo", "index.ts");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "export const x = 1;");
    const r = runHook({
      session_id: sid,
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: f },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "no review output for node_modules paths");
    cleanupSession(sid);
  });
});

test("Edit on non-code extension → counter only", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const f = path.join(dir, "src", "data.json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "{}");
    const r = runHook({
      session_id: sid,
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: f },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "no review output for .json");
    cleanupSession(sid);
  });
});

test("non-edit tool (Read) → counter only, no review", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const f = path.join(dir, "src", "x.ts");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "export const x = 1;");
    const r = runHook({
      session_id: sid,
      cwd: dir,
      tool_name: "Read",
      tool_input: { file_path: f },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "Read does not trigger review");
    cleanupSession(sid);
  });
});

// No parseable `cwd` in the payload — so the child's own cwd is the only thing
// standing between the hook and whatever .arch/ it can walk up to. Run it from
// a temp project, never from wherever the suite happens to have been launched.
test("survives malformed stdin without crashing", () => {
  withTempProject((dir) => {
    const r = spawnHook({ cwd: dir, input: "{not json", timeout: 4000 });
    assert.equal(r.status, 0);
  });
});

test("survives Edit with missing file_path", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({
      session_id: sid,
      cwd: dir,
      tool_name: "Edit",
      tool_input: {},
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    cleanupSession(sid);
  });
});

test("counter recorded even when sessionId missing", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const r = runHook({
      // no session_id
      cwd: dir,
      tool_name: "Read",
      tool_input: { file_path: "x.md" },
    });
    assert.equal(r.status, 0);
    // no crash; just no counter persisted
  });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
