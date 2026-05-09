#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-stop-hook.mjs");
const STATS_LIB = path.resolve(__dirname, "../../src/lib/session-stats.mjs");
const { statsPathForSession } = await import(STATS_LIB);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

function freshSessionId() {
  return `stoptest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-stop-"));
  try { fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function setupArch(dir) {
  fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "# system\n");
  fs.writeFileSync(
    path.join(dir, ".arch", "BOUNDARIES.md"),
    [
      "# BOUNDARIES.md",
      "",
      "## Universal Boundaries",
      "- NEVER use string concatenation for SQL queries.",
      "- NEVER commit secrets, API keys, or credentials to code.",
      "- NEVER trust client-side input. Validate at the API boundary.",
      "",
    ].join("\n")
  );
}

function runHook({ cwd, sessionId, assistantResponse }) {
  const event = {
    session_id: sessionId,
    cwd,
    hook_event_name: "Stop",
    assistant_response: assistantResponse || "",
  };
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
    timeout: 8000,
  });
  return r;
}

function cleanupSession(sessionId) {
  try { fs.unlinkSync(statsPathForSession(sessionId)); } catch {}
}

console.log("\nstop hook — integration\n");

test("exits silently on non-archkit project", () => {
  withTempProject((dir) => {
    const r = runHook({ cwd: dir, sessionId: freshSessionId(), assistantResponse: "anything" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "no stdout when no .arch/");
  });
});

test("emits BOUNDARIES + utilization on archkit project, no decisions", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({ cwd: dir, sessionId: sid, assistantResponse: "Just thinking out loud here." });
    assert.equal(r.status, 0);
    assert.ok(r.stdout, "should emit context");
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "Stop");
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /archkit utilization/);
    assert.match(ctx, /Active BOUNDARIES/);
    assert.match(ctx, /NEVER use string concatenation/);
    cleanupSession(sid);
  });
});

test("writes proposed ADR file when decision-language detected", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({
      cwd: dir,
      sessionId: sid,
      assistantResponse: "We'll use Postgres over MongoDB because RLS solves the multi-tenant case cleanly.",
    });
    assert.equal(r.status, 0);
    const proposalDir = path.join(dir, ".arch", "decisions", "proposed");
    assert.ok(fs.existsSync(proposalDir), "proposed dir created");
    const files = fs.readdirSync(proposalDir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 1, "≥1 proposal written");

    const proposal = JSON.parse(fs.readFileSync(path.join(proposalDir, files[0]), "utf8"));
    assert.match(proposal.hash, /^[a-f0-9]{12}$/);
    assert.ok(proposal.titleHint);
    assert.ok(proposal.contextExcerpt);
    assert.ok(proposal.regexMatch);
    assert.equal(proposal.source, "stop-hook");
    assert.match(proposal.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    const out = JSON.parse(r.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /proposed ADR/);

    cleanupSession(sid);
  });
});

test("dedups proposals across turns by hash", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const text = "We'll use Postgres for auth.";

    const r1 = runHook({ cwd: dir, sessionId: sid, assistantResponse: text });
    assert.equal(r1.status, 0);

    const r2 = runHook({ cwd: dir, sessionId: sid, assistantResponse: text });
    assert.equal(r2.status, 0);

    const files = fs.readdirSync(path.join(dir, ".arch", "decisions", "proposed"))
      .filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1, "second turn should dedup, not create a duplicate");

    const out2 = JSON.parse(r2.stdout);
    // newProposals should be 0 on the second turn — no "Drafted N proposed" line
    assert.doesNotMatch(out2.hookSpecificOutput.additionalContext, /Drafted \d+ proposed ADR/);

    cleanupSession(sid);
  });
});

test("flags boundary violation when assistant response contains hardcoded sk- key", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({
      cwd: dir,
      sessionId: sid,
      assistantResponse: 'Here is the code:\n```\nconst KEY = "sk-abc123def456ghi789jkl012mno345pq";\n```',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /BOUNDARY VIOLATION/);
    assert.match(out.hookSpecificOutput.additionalContext, /U-002/);
    cleanupSession(sid);
  });
});

test("walks up to find .arch/ from a subdirectory", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const subdir = path.join(dir, "src", "features", "auth");
    fs.mkdirSync(subdir, { recursive: true });
    const sid = freshSessionId();
    const r = runHook({ cwd: subdir, sessionId: sid, assistantResponse: "thinking" });
    assert.equal(r.status, 0);
    assert.ok(r.stdout, "should still find .arch/ via parent walk");
    cleanupSession(sid);
  });
});

test("utilization line contains target percentage", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({ cwd: dir, sessionId: sid, assistantResponse: "x" });
    const out = JSON.parse(r.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /target ≥75%/);
    cleanupSession(sid);
  });
});

test("survives malformed stdin event without crashing", () => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: "{not valid json",
    encoding: "utf8",
    timeout: 4000,
  });
  assert.equal(r.status, 0);
});

test("survives empty stdin", () => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: "",
    encoding: "utf8",
    timeout: 4000,
  });
  assert.equal(r.status, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
