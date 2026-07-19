#!/usr/bin/env node
// Tests for the API-doc hard gate (PreToolUse). Three layers:
//   1. Unit — src/hooks/pretooluse.mjs: source-file scoping, the detect->
//      clearance predicate, no-op-when-disabled, and the actionable deny reason.
//   2. Integration — bin/archkit-pretooluse-hook.mjs end-to-end: an edit that
//      touches an uncleared API is DENIED with a named, actionable reason; the
//      same edit ALLOWS once the API is registered OR overridden; a disabled
//      gate ALLOWS; and a .arch/ or docs edit ALLOWS.
//   3. Install wiring — the PreToolUse gate is installed by archkit_install_hooks
//      and the emitted settings block is idempotent (re-install adds nothing).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  evaluateApiGate,
  formatApiGateDenyReason,
  isGatedSourceFile,
} from "../../src/hooks/pretooluse.mjs";
import { registerApi, overrideApi } from "../../src/lib/api-registry.mjs";
import {
  ARCHKIT_GUARDRAIL_HOOKS,
  addGuardrailHooks,
  detectArchkitHooks,
} from "../../src/lib/claude-settings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-pretooluse-hook.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

// An external SDK import that api-detect flags as an sdk-import "stripe".
const STRIPE_SRC = 'import Stripe from "stripe";\nexport const s = new Stripe("k");\n';

// ── unit: isGatedSourceFile ──────────────────────────────────────────────────
console.log("\n  api-gate — isGatedSourceFile");

test("code source files are gated", () => {
  assert.ok(isGatedSourceFile("src/lib/x.mjs"));
  assert.ok(isGatedSourceFile("app/main.py"));
  assert.ok(isGatedSourceFile("pkg/handler.go"));
});

test("docs / config / data are NOT gated", () => {
  assert.ok(!isGatedSourceFile("README.md"));
  assert.ok(!isGatedSourceFile("docs/guide.md"));
  assert.ok(!isGatedSourceFile("config.json"));
  assert.ok(!isGatedSourceFile("pnpm-lock.yaml"));
});

test(".arch/** is never gated even for code-ish files", () => {
  assert.ok(!isGatedSourceFile(".arch/apis.json"));
  assert.ok(!isGatedSourceFile(".arch/scripts/thing.mjs"));
  assert.ok(!isGatedSourceFile("node_modules/dep/index.js"));
});

// ── unit: evaluateApiGate ────────────────────────────────────────────────────
console.log("\n  api-gate — evaluateApiGate");

// A throwaway archDir under a project root. `archDir` = <root>/.arch.
function tmpProject({ config } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-apigate-"));
  const archDir = path.join(root, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# system\n");
  if (config !== undefined) {
    fs.writeFileSync(path.join(archDir, "config.json"), JSON.stringify(config));
  }
  return { root, archDir };
}

function writeGate(opts) {
  return evaluateApiGate({
    toolName: "Write",
    toolInput: { file_path: opts.fileRel, content: opts.content },
    currentContent: "",
    ...opts,
  });
}

test("edit touching an uncleared API → DENY naming the API + both commands", () => {
  const { archDir } = tmpProject();
  const reason = writeGate({ archDir, fileRel: "src/pay.mjs", content: STRIPE_SRC });
  assert.ok(reason, "expected a deny reason");
  assert.match(reason, /API-doc hard gate/);
  assert.match(reason, /"stripe"/, "names the API id");
  assert.match(reason, /archkit_api_register stripe --doc <ref>/, "register command verbatim");
  assert.match(reason, /archkit_api_override stripe --reason/, "override command verbatim");
});

test("same edit ALLOWED after the API is REGISTERED with a doc", () => {
  const { archDir } = tmpProject();
  registerApi(archDir, { id: "stripe", kind: "doc", ref: "https://stripe.com/docs/api" });
  const reason = writeGate({ archDir, fileRel: "src/pay.mjs", content: STRIPE_SRC });
  assert.equal(reason, null, "cleared by a registered doc ref");
});

test("same edit ALLOWED after the API is OVERRIDDEN with a reason", () => {
  const { archDir } = tmpProject();
  overrideApi(archDir, { id: "stripe", reason: "vendored shim, no external docs" });
  const reason = writeGate({ archDir, fileRel: "src/pay.mjs", content: STRIPE_SRC });
  assert.equal(reason, null, "cleared by an explicit override");
});

test("no-op when apiGate.enabled is false", () => {
  const { archDir } = tmpProject({ config: { apiGate: { enabled: false } } });
  const reason = writeGate({ archDir, fileRel: "src/pay.mjs", content: STRIPE_SRC });
  assert.equal(reason, null, "disabled gate never blocks");
});

test(".arch/ and docs edits are ALLOWED even with an API-shaped body", () => {
  const { archDir } = tmpProject();
  assert.equal(writeGate({ archDir, fileRel: ".arch/notes.mjs", content: STRIPE_SRC }), null);
  assert.equal(writeGate({ archDir, fileRel: "docs/api.md", content: STRIPE_SRC }), null);
  assert.equal(writeGate({ archDir, fileRel: "config.json", content: STRIPE_SRC }), null);
});

test("in-repo path-style import (head is a project dir) is NOT gated", () => {
  const { root, archDir } = tmpProject();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const reason = writeGate({
    archDir,
    fileRel: "src/a.mjs",
    content: 'import { x } from "src/lib/util.mjs";\n',
  });
  assert.equal(reason, null, "a bare 'src/...' specifier is an in-repo import, not an external API");
});

test("non-edit tool is a no-op", () => {
  const { archDir } = tmpProject();
  assert.equal(
    evaluateApiGate({ archDir, toolName: "Read", toolInput: { file_path: "src/x.mjs" }, fileRel: "src/x.mjs" }),
    null,
  );
});

test("only one uncleared API of many blocks with all named", () => {
  const { archDir } = tmpProject();
  registerApi(archDir, { id: "stripe", kind: "doc", ref: "https://stripe.com/docs" });
  const reason = writeGate({
    archDir,
    fileRel: "src/multi.mjs",
    content: 'import Stripe from "stripe";\nimport OpenAI from "openai";\n',
  });
  assert.ok(reason, "openai is still uncleared");
  assert.match(reason, /"openai"/);
  assert.doesNotMatch(reason, /"stripe"/, "cleared API is not listed");
});

test("formatApiGateDenyReason spells out both commands per API", () => {
  const reason = formatApiGateDenyReason([{ api: "aws.s3", evidence: "sdk-import" }]);
  assert.match(reason, /archkit_api_register aws\.s3 --doc <ref>/);
  assert.match(reason, /archkit_api_override aws\.s3 --reason/);
});

// ── integration: the hook binary ─────────────────────────────────────────────
console.log("\n  api-gate — hook integration");

function withProject({ config, boundaries } = {}, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-apigate-hook-"));
  try {
    const archDir = path.join(dir, ".arch");
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# system\n");
    if (config !== undefined) fs.writeFileSync(path.join(archDir, "config.json"), JSON.stringify(config));
    if (boundaries !== undefined) fs.writeFileSync(path.join(archDir, "BOUNDARIES.md"), boundaries);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runHook(event) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), encoding: "utf8", timeout: 8000 });
}

function decisionOf(stdout) {
  if (!stdout) return null;
  try { return JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? null; }
  catch { return null; }
}

test("uncleared-API Write → DENIED with an actionable reason", () => {
  withProject({}, (dir) => {
    const f = path.join(dir, "src", "pay.mjs");
    const r = runHook({ cwd: dir, tool_name: "Write", tool_input: { file_path: f, content: STRIPE_SRC } });
    assert.equal(r.status, 0, "hook always exits 0");
    assert.equal(decisionOf(r.stdout), "deny", `expected deny, got: ${r.stdout}`);
    const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /"stripe"/);
    assert.match(reason, /archkit_api_register stripe --doc <ref>/);
    assert.match(reason, /archkit_api_override stripe --reason/);
  });
});

test("same Write ALLOWED after archkit_api_register", () => {
  withProject({}, (dir) => {
    registerApi(path.join(dir, ".arch"), { id: "stripe", kind: "doc", ref: "https://stripe.com/docs" });
    const f = path.join(dir, "src", "pay.mjs");
    const r = runHook({ cwd: dir, tool_name: "Write", tool_input: { file_path: f, content: STRIPE_SRC } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "registered API must not be blocked");
  });
});

test("same Write ALLOWED after archkit_api_override", () => {
  withProject({}, (dir) => {
    overrideApi(path.join(dir, ".arch"), { id: "stripe", reason: "no public docs, reviewed" });
    const f = path.join(dir, "src", "pay.mjs");
    const r = runHook({ cwd: dir, tool_name: "Write", tool_input: { file_path: f, content: STRIPE_SRC } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "overridden API must not be blocked");
  });
});

test("disabled gate → ALLOWED", () => {
  withProject({ config: { apiGate: { enabled: false } } }, (dir) => {
    const f = path.join(dir, "src", "pay.mjs");
    const r = runHook({ cwd: dir, tool_name: "Write", tool_input: { file_path: f, content: STRIPE_SRC } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "disabled gate never blocks");
  });
});

test(".arch/ edit → ALLOWED (not a source file)", () => {
  withProject({}, (dir) => {
    const f = path.join(dir, ".arch", "apis.json");
    const r = runHook({ cwd: dir, tool_name: "Write", tool_input: { file_path: f, content: STRIPE_SRC } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", ".arch edits are never gated");
  });
});

test("docs edit → ALLOWED (not a source file)", () => {
  withProject({}, (dir) => {
    const f = path.join(dir, "docs.md");
    const r = runHook({ cwd: dir, tool_name: "Write", tool_input: { file_path: f, content: STRIPE_SRC } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "docs edits are never gated");
  });
});

test("uncleared-API Write blocks even with NO BOUNDARIES.md", () => {
  withProject({}, (dir) => {
    // no BOUNDARIES.md written — the api-gate must still fire.
    const f = path.join(dir, "src", "pay.mjs");
    const r = runHook({ cwd: dir, tool_name: "Write", tool_input: { file_path: f, content: STRIPE_SRC } });
    assert.equal(decisionOf(r.stdout), "deny", r.stdout);
  });
});

// ── install wiring: the gate rides the installed PreToolUse hook ─────────────
console.log("\n  api-gate — install wiring");

test("archkit_install_hooks installs the PreToolUse gate", () => {
  const spec = ARCHKIT_GUARDRAIL_HOOKS.find(
    (h) => h.event === "PreToolUse" && h.bin === "archkit-pretooluse-hook"
  );
  assert.ok(spec, "the PreToolUse guardrail (which carries the api-gate) is in the install set");
  assert.match(spec.matcher, /Edit|Write|MultiEdit/);
  const { settings } = addGuardrailHooks({});
  assert.ok(detectArchkitHooks(settings).has("PreToolUse"), "install wires PreToolUse");
});

test("emitted settings block is idempotent (re-install adds nothing)", () => {
  const first = addGuardrailHooks({});
  const again = addGuardrailHooks(first.settings);
  assert.equal(again.added.length, 0, "second install is a no-op");
  const preToolUse = again.settings.hooks.PreToolUse || [];
  const gateEntries = preToolUse.filter((g) =>
    (g.hooks || []).some((h) => String(h.command || "").includes("archkit-pretooluse-hook"))
  );
  assert.equal(gateEntries.length, 1, "the PreToolUse gate is not duplicated");
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
