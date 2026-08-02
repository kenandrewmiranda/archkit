#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-stop-hook.mjs");
const STATS_LIB = pathToFileURL(path.resolve(__dirname, "../../src/lib/session-stats.mjs")).href;
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

// Spawn the Stop hook against a temp project.
//
// `cwd` is passed BOTH in the event payload and as the child process's actual
// working directory. The payload alone is not enough: the hook falls back to
// `process.cwd()` whenever the event has no `cwd` (malformed/empty stdin), and
// a child with no explicit cwd inherits the test runner's — the repo root.
// That made the hook's queue-drain consolidation fire against archkit's OWN
// live .arch/ board on every `npm test`, archiving real CGRs and writing a
// digest. Never spawn a hook here without an explicit cwd.
function spawnHook({ cwd, input, timeout = 8000 }) {
  if (!cwd) throw new Error("spawnHook requires an explicit cwd (never inherit the repo root)");
  return spawnSync(process.execPath, [HOOK], {
    input,
    cwd,
    encoding: "utf8",
    timeout,
  });
}

function runHook({ cwd, sessionId, assistantResponse }) {
  const event = {
    session_id: sessionId,
    cwd,
    hook_event_name: "Stop",
    assistant_response: assistantResponse || "",
  };
  return spawnHook({ cwd, input: JSON.stringify(event) });
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
    // Non-blocking nudges are surfaced to the user via `systemMessage`
    // (Stop hooks have no additionalContext channel).
    const ctx = out.systemMessage;
    assert.ok(ctx, "should emit systemMessage");
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
    assert.match(out.systemMessage, /proposed ADR/);

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
    assert.doesNotMatch(out2.systemMessage, /Drafted \d+ proposed ADR/);

    cleanupSession(sid);
  });
});

test("drafts a proposed goal when deferred-work language detected", () => {
  withTempProject((dir) => {
    setupArch(dir);
    const sid = freshSessionId();
    const r = runHook({
      cwd: dir,
      sessionId: sid,
      assistantResponse: "Shipped the upload path. Follow-up: add retry/backoff to the upload client in a later session.",
    });
    assert.equal(r.status, 0);
    const proposedDir = path.join(dir, ".arch", "goals", "proposed");
    assert.ok(fs.existsSync(proposedDir), "proposed goals dir created");
    const files = fs.readdirSync(proposedDir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 1, "≥1 goal proposal written");
    const proposal = JSON.parse(fs.readFileSync(path.join(proposedDir, files[0]), "utf8"));
    assert.match(proposal.hash, /^[a-f0-9]{12}$/);
    assert.ok(proposal.title, "has a title");

    const out = JSON.parse(r.stdout);
    assert.match(out.systemMessage, /follow-up goal proposal/i);
    assert.match(out.systemMessage, /goal_review/);

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
    assert.match(out.systemMessage, /BOUNDARY VIOLATION/);
    assert.match(out.systemMessage, /U-002/);
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
    assert.match(out.systemMessage, /target ≥75%/);
    cleanupSession(sid);
  });
});

test("survives malformed stdin event without crashing", () => {
  // No `cwd` in the payload (it isn't parseable) — so the child's own cwd is
  // what the hook resolves .arch/ from. It MUST be the temp project.
  withTempProject((dir) => {
    const r = spawnHook({ cwd: dir, input: "{not valid json", timeout: 4000 });
    assert.equal(r.status, 0);
  });
});

test("survives empty stdin", () => {
  withTempProject((dir) => {
    const r = spawnHook({ cwd: dir, input: "", timeout: 4000 });
    assert.equal(r.status, 0);
  });
});

// ── cwd isolation regression guard ───────────────────────────────────────────
//
// The leak this suite caused: an eventless hook run inherited the runner's cwd
// (the repo root), found archkit's real .arch/, saw a drained queue and
// consolidated LIVE completed CGRs into done/archive/ + a digest. Pin the
// invariant at the suite level so it cannot silently come back.

test("no spawn in this suite omits cwd", () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const re = /\b(spawnSync|spawn|execFileSync|execSync)\s*\(/g;
  const offenders = [];
  let m;
  while ((m = re.exec(src))) {
    // Slice the whole call by balancing parens, then check for a cwd option.
    let depth = 0;
    let end = src.length;
    for (let i = re.lastIndex - 1; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) { end = i; break; }
    }
    const call = src.slice(m.index, end + 1);
    if (/\bcwd\s*[,:}]/.test(call)) continue;
    offenders.push(`line ${src.slice(0, m.index).split("\n").length}: ${call.replace(/\s+/g, " ").slice(0, 80)}`);
  }
  assert.deepEqual(offenders, [], `spawn without an explicit cwd:\n  ${offenders.join("\n  ")}`);
});

test("an eventless hook run never touches an .arch/ outside its own cwd", () => {
  withTempProject((outer) => {
    // A decoy project one level up from the child's cwd stands in for the repo
    // root. If the hook ever resolved .arch/ from anywhere but its own cwd
    // subtree this would be mutated — but here the walk-up is legitimate, so
    // the real assertion is the sibling: a temp project the child is NOT in.
    const sibling = path.join(outer, "sibling");
    fs.mkdirSync(sibling, { recursive: true });
    setupArch(sibling);
    const before = fs.readdirSync(path.join(sibling, ".arch")).sort();

    const isolated = path.join(outer, "isolated");
    fs.mkdirSync(isolated, { recursive: true });
    setupArch(isolated);

    const r = spawnHook({ cwd: isolated, input: "", timeout: 4000 });
    assert.equal(r.status, 0);
    assert.deepEqual(fs.readdirSync(path.join(sibling, ".arch")).sort(), before,
      "a hook run in one project must not write into another project's .arch/");
  });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
