#!/usr/bin/env node
// Tests for the PreToolUse guardrail hook (v1.9 flagship feature).
//
// Two layers:
//   1. Unit — src/lib/pretooluse-eval.mjs: post-edit reconstruction + the
//      "only flag NEWLY-introduced banned imports" precision rule.
//   2. Integration — bin/archkit-pretooluse-hook.mjs end-to-end: a banned-import
//      edit is DENIED (permissionDecision:"deny"); a clean edit is ALLOWED
//      (exit 0, empty stdout); and the hook fails open on every edge case.
//
// Import-spec note: like boundary-check, matching is a path-prefix on the
// NORMALIZED import spec, so the violating specs below spell out the BAN
// target's path (e.g. "src/commands/review.mjs" against `-> src/commands/*`).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  isEditTool,
  computePostEditContent,
  evaluateProposedEdit,
  formatBlockReason,
} from "../../src/lib/pretooluse-eval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-pretooluse-hook.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

const BAN = "# BOUNDARIES.md\n- BAN: src/lib/* -> src/commands/*\n";
const BANNED_IMPORT = 'import { runReview } from "src/commands/review.mjs";';
const CLEAN_IMPORT = 'import { parse } from "src/lib/parsers.mjs";';

// ───────────────────────────────── unit: computePostEditContent ─────────────
console.log("\n  pretooluse-eval — computePostEditContent");

test("Write returns the full proposed content", () => {
  const after = computePostEditContent("Write", { file_path: "x.mjs", content: "A\nB\n" }, "OLD");
  assert.equal(after, "A\nB\n");
});

test("Edit applies first-occurrence replacement", () => {
  const after = computePostEditContent("Edit", { old_string: "foo", new_string: "bar" }, "foo foo");
  assert.equal(after, "bar foo");
});

test("Edit with replace_all replaces every occurrence", () => {
  const after = computePostEditContent("Edit", { old_string: "foo", new_string: "bar", replace_all: true }, "foo foo");
  assert.equal(after, "bar bar");
});

test("MultiEdit applies edits in sequence", () => {
  const after = computePostEditContent("MultiEdit", { edits: [
    { old_string: "a", new_string: "b" },
    { old_string: "b", new_string: "c" },
  ] }, "a");
  assert.equal(after, "c");
});

test("Edit with no matching old_string is a no-op", () => {
  const after = computePostEditContent("Edit", { old_string: "zzz", new_string: "q" }, "abc");
  assert.equal(after, "abc");
});

// ───────────────────────────────── unit: evaluateProposedEdit ───────────────
console.log("\n  pretooluse-eval — evaluateProposedEdit");

function evalEdit(opts) {
  return evaluateProposedEdit({
    fileRel: "src/lib/foo.mjs",
    filePath: "/proj/src/lib/foo.mjs",
    boundariesContent: BAN,
    currentContent: "",
    ...opts,
  });
}

test("Write that introduces a banned import → 1 violation", () => {
  const r = evalEdit({ toolName: "Write", toolInput: { content: `${BANNED_IMPORT}\nexport const x = 1;\n` } });
  assert.equal(r.violations.length, 1, JSON.stringify(r));
  assert.equal(r.violations[0].imported, "src/commands/review.mjs");
  assert.match(r.violations[0].rule, /src\/lib\/\* -> src\/commands\/\*/);
});

test("Write with only an allowed import → no violation", () => {
  const r = evalEdit({ toolName: "Write", toolInput: { content: `${CLEAN_IMPORT}\nexport const x = 1;\n` } });
  assert.equal(r.violations.length, 0, JSON.stringify(r));
});

test("Edit that adds a banned import line → blocked", () => {
  const r = evalEdit({
    toolName: "Edit",
    currentContent: "export const x = 1;\n",
    toolInput: { old_string: "export const x = 1;", new_string: `${BANNED_IMPORT}\nexport const x = 1;` },
  });
  assert.equal(r.violations.length, 1, JSON.stringify(r));
});

test("PRECISION: editing a file that ALREADY has the banned import does not block", () => {
  // The banned import predates the edit; the edit only touches unrelated code.
  const current = `${BANNED_IMPORT}\nexport const x = 1;\n`;
  const r = evalEdit({
    toolName: "Edit",
    currentContent: current,
    toolInput: { old_string: "export const x = 1;", new_string: "export const x = 2;" },
  });
  assert.equal(r.violations.length, 0, "must not re-block a pre-existing violation");
});

test("PRECISION: REMOVING a banned import is allowed", () => {
  const current = `${BANNED_IMPORT}\nexport const x = 1;\n`;
  const r = evalEdit({
    toolName: "Edit",
    currentContent: current,
    toolInput: { old_string: `${BANNED_IMPORT}\n`, new_string: "" },
  });
  assert.equal(r.violations.length, 0, "removing a banned import should never block");
});

test("file outside any BAN source glob → no violation even with banned import", () => {
  const r = evaluateProposedEdit({
    fileRel: "src/commands/whatever.mjs", // commands MAY import commands
    filePath: "/proj/src/commands/whatever.mjs",
    boundariesContent: BAN,
    currentContent: "",
    toolName: "Write",
    toolInput: { content: `${BANNED_IMPORT}\n` },
  });
  assert.equal(r.violations.length, 0, JSON.stringify(r));
});

test("no BAN rules → no violation", () => {
  const r = evalEdit({
    boundariesContent: "# BOUNDARIES.md\n- NEVER hardcode secrets\n",
    toolName: "Write",
    toolInput: { content: `${BANNED_IMPORT}\n` },
  });
  assert.equal(r.violations.length, 0);
});

test("isEditTool recognizes Edit/Write/MultiEdit only", () => {
  assert.ok(isEditTool("Edit") && isEditTool("Write") && isEditTool("MultiEdit"));
  assert.ok(!isEditTool("Read") && !isEditTool("Bash") && !isEditTool(""));
});

test("formatBlockReason is actionable", () => {
  const reason = formatBlockReason([{ file: "src/lib/foo.mjs", line: 1, imported: "src/commands/x.mjs", rule: "BAN: src/lib/* -> src/commands/*", source: "BOUNDARIES.md:2" }]);
  assert.match(reason, /blocked this edit/);
  assert.match(reason, /src\/commands\/x\.mjs/);
  assert.match(reason, /BOUNDARIES\.md/);
});

// ───────────────────────────────── integration: the hook binary ────────────
console.log("\n  pretooluse hook — integration");

function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-pre-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "# system\n");
    fs.writeFileSync(path.join(dir, ".arch", "BOUNDARIES.md"), BAN);
    fs.mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runHook(event) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
    timeout: 8000,
  });
}

function decisionOf(stdout) {
  if (!stdout) return null;
  try { return JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? null; }
  catch { return null; }
}

test("banned-import Write → DENIED with a reason", () => {
  withProject((dir) => {
    const f = path.join(dir, "src", "lib", "bad.mjs");
    const r = runHook({
      cwd: dir,
      tool_name: "Write",
      tool_input: { file_path: f, content: `${BANNED_IMPORT}\nexport const x = 1;\n` },
    });
    assert.equal(r.status, 0, "hook always exits 0");
    assert.equal(decisionOf(r.stdout), "deny", `expected deny, got: ${r.stdout}`);
    const out = JSON.parse(r.stdout);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /BAN: src\/lib\/\* -> src\/commands\/\*/);
  });
});

test("clean Write → ALLOWED (exit 0, empty stdout)", () => {
  withProject((dir) => {
    const f = path.join(dir, "src", "lib", "good.mjs");
    const r = runHook({
      cwd: dir,
      tool_name: "Write",
      tool_input: { file_path: f, content: `${CLEAN_IMPORT}\nexport const x = 1;\n` },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "clean edit must not emit a deny envelope");
  });
});

test("banned-import Edit on existing file → DENIED", () => {
  withProject((dir) => {
    const f = path.join(dir, "src", "lib", "edit-me.mjs");
    fs.writeFileSync(f, "export const x = 1;\n");
    const r = runHook({
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: f, old_string: "export const x = 1;", new_string: `${BANNED_IMPORT}\nexport const x = 1;` },
    });
    assert.equal(decisionOf(r.stdout), "deny", r.stdout);
  });
});

test("editing a file that already violates (unrelated change) → ALLOWED", () => {
  withProject((dir) => {
    const f = path.join(dir, "src", "lib", "dirty.mjs");
    fs.writeFileSync(f, `${BANNED_IMPORT}\nexport const x = 1;\n`);
    const r = runHook({
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: f, old_string: "export const x = 1;", new_string: "export const x = 2;" },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", "must not block an unrelated edit to an already-dirty file");
  });
});

test("non-edit tool (Read) → ALLOWED", () => {
  withProject((dir) => {
    const r = runHook({ cwd: dir, tool_name: "Read", tool_input: { file_path: path.join(dir, "src", "lib", "x.mjs") } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

test("no BOUNDARIES.md → ALLOWED (nothing to enforce)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-pre-nob-"));
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "# system\n");
    fs.mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
    const r = runHook({
      cwd: dir,
      tool_name: "Write",
      tool_input: { file_path: path.join(dir, "src", "lib", "x.mjs"), content: `${BANNED_IMPORT}\n` },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("non-archkit project → ALLOWED", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-pre-noarch-"));
  try {
    const r = runHook({
      cwd: dir,
      tool_name: "Write",
      tool_input: { file_path: path.join(dir, "src", "lib", "x.mjs"), content: `${BANNED_IMPORT}\n` },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("malformed stdin → ALLOWED (fails open)", () => {
  const r = spawnSync(process.execPath, [HOOK], { input: "{not json", encoding: "utf8", timeout: 4000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("Edit with missing file_path → ALLOWED", () => {
  withProject((dir) => {
    const r = runHook({ cwd: dir, tool_name: "Edit", tool_input: {} });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
