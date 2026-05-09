#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-userpromptsubmit-hook.mjs");
const STATS_LIB = path.resolve(__dirname, "../../src/lib/session-stats.mjs");
const { statsPathForSession, loadOrInit } = await import(STATS_LIB);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

function freshSessionId() {
  return `upstest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-ups-"));
  try { fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function setupArch(dir, opts = {}) {
  fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "# system\n");
  if (opts.withIndex !== false) {
    fs.writeFileSync(
      path.join(dir, ".arch", "INDEX.md"),
      [
        "# INDEX.md",
        "",
        "## Conv: features",
        "## Shared: shared",
        "",
        "## Keywords → Nodes",
        "auth, login, signup → @auth",
        "billing, checkout, payment → @billing",
        "search, query → @search",
        "",
        "## Keywords → Skills",
        "rls, tenant → $rls-helpers",
        "money, currency → $money-helpers",
        "",
        "## Nodes → Clusters → Files",
        "@auth = [auth] → src/features/auth/",
        "@billing = [billing] → src/features/billing/",
        "",
      ].join("\n")
    );
  }
}

function runHook(event) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
    timeout: 4000,
  });
}

function cleanupSession(sessionId) {
  try { fs.unlinkSync(statsPathForSession(sessionId)); } catch {}
}

console.log("\nuserpromptsubmit hook — integration\n");

test("exits silently on non-archkit project", () => {
  withTempProject((dir) => {
    const r = runHook({
      session_id: freshSessionId(),
      cwd: dir,
      prompt: "add an auth feature please",
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

test("starts a new task in session-stats on every prompt", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();

    const r1 = runHook({ session_id: sid, cwd: dir, prompt: "first prompt" });
    assert.equal(r1.status, 0);
    const r2 = runHook({ session_id: sid, cwd: dir, prompt: "second prompt" });
    assert.equal(r2.status, 0);

    const stats = loadOrInit(sid);
    assert.equal(stats.tasks.length, 2, "two tasks recorded");
    cleanupSession(sid);
  });
});

test("pre-loads node match when ≥2 keywords hit", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({
      session_id: sid,
      cwd: dir,
      prompt: "wire up auth and login flow for the user signup",
    });
    assert.equal(r.status, 0);
    assert.ok(r.stdout, "should emit context for multi-keyword match");
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /@auth/);
    assert.match(ctx, /archkit_resolve_lookup/);
    cleanupSession(sid);
  });
});

test("does NOT pre-load when only 1 keyword hits (low-relevance threshold)", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({
      session_id: sid,
      cwd: dir,
      prompt: "tell me about the search feature briefly",
    });
    assert.equal(r.status, 0);
    // "search" is the only matching keyword for @search → 1 hit < threshold (2)
    assert.equal(r.stdout, "", "single-keyword match should not pre-load");
    cleanupSession(sid);
  });
});

test("pre-loads skill match alongside node match", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({
      session_id: sid,
      cwd: dir,
      prompt: "set up rls and tenant scoping for the auth and login pages",
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /@auth/);
    assert.match(ctx, /\$rls-helpers/);
    cleanupSession(sid);
  });
});

test("skips pre-loading on slash commands", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({
      session_id: sid,
      cwd: dir,
      prompt: "/archkit-init build me an auth signup login flow",
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "slash command must not pre-load");

    // But task should still start
    const stats = loadOrInit(sid);
    assert.equal(stats.tasks.length, 1);
    cleanupSession(sid);
  });
});

test("starts task even when no INDEX.md exists", () => {
  withTempProject((dir) => {
    setupArch(dir, { withIndex: false });
    const sid = freshSessionId();
    const r = runHook({ session_id: sid, cwd: dir, prompt: "add auth signup" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "no INDEX.md → no pre-load");

    const stats = loadOrInit(sid);
    assert.equal(stats.tasks.length, 1, "task still started");
    cleanupSession(sid);
  });
});

test("survives malformed stdin", () => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: "{not json",
    encoding: "utf8",
    timeout: 3000,
  });
  assert.equal(r.status, 0);
});

test("survives empty prompt", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({ session_id: sid, cwd: dir, prompt: "" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    cleanupSession(sid);
  });
});

test("walks up to find .arch/ from a subdirectory", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const subdir = path.join(dir, "src", "features", "auth");
    fs.mkdirSync(subdir, { recursive: true });
    const sid = freshSessionId();
    const r = runHook({ session_id: sid, cwd: subdir, prompt: "add auth signup login" });
    assert.equal(r.status, 0);
    assert.ok(r.stdout, "should still find .arch/ via parent walk");
    cleanupSession(sid);
  });
});

test("latency budget — single invocation completes under 500ms cold", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const start = Date.now();
    runHook({ session_id: sid, cwd: dir, prompt: "add an auth feature with login" });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `cold-start took ${elapsed}ms, budget 500ms`);
    cleanupSession(sid);
  });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
