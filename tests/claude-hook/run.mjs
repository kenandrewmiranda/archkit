#!/usr/bin/env node

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeClaudeSettings } from "../../src/lib/claude-settings.mjs";
import { ARCHKIT_PROTOCOL_SKILL } from "../../src/data/skill-templates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-claude-hook.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

console.log("\narchkit-claude-hook + skill templates + settings merge\n");

// ── Skill Template ────────────────────────────────────────────────────────────

test("ARCHKIT_PROTOCOL_SKILL contains archkit resolve preflight reference", () => {
  assert.ok(
    ARCHKIT_PROTOCOL_SKILL.includes("archkit resolve preflight"),
    "Expected ARCHKIT_PROTOCOL_SKILL to include 'archkit resolve preflight'"
  );
});

test("ARCHKIT_PROTOCOL_SKILL has frontmatter", () => {
  assert.ok(
    ARCHKIT_PROTOCOL_SKILL.startsWith("---\nname: archkit-protocol"),
    "Expected ARCHKIT_PROTOCOL_SKILL to start with '---\\nname: archkit-protocol'"
  );
});

// ── Claude Settings Merge ─────────────────────────────────────────────────────

test("mergeClaudeSettings adds hook to empty settings", () => {
  const result = mergeClaudeSettings(
    {},
    "Edit|Write|MultiEdit",
    'archkit-claude-hook "$TOOL_INPUT_PATH"'
  );
  assert.ok(result.hooks, "result should have hooks");
  assert.ok(Array.isArray(result.hooks.PreToolUse), "PreToolUse should be an array");
  assert.equal(result.hooks.PreToolUse.length, 1, "Should have exactly one hook entry");
  assert.equal(result.hooks.PreToolUse[0].matcher, "Edit|Write|MultiEdit");
});

test("mergeClaudeSettings preserves existing hooks", () => {
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "some-other-tool", timeout: 3000 }],
        },
      ],
    },
  };
  const result = mergeClaudeSettings(
    existing,
    "Edit|Write|MultiEdit",
    'archkit-claude-hook "$TOOL_INPUT_PATH"'
  );
  assert.equal(result.hooks.PreToolUse.length, 2, "Should have both hooks present");
  const matchers = result.hooks.PreToolUse.map(h => h.matcher);
  assert.ok(matchers.includes("Bash"), "Original Bash hook should be preserved");
  assert.ok(matchers.includes("Edit|Write|MultiEdit"), "archkit hook should be added");
});

test("mergeClaudeSettings does not duplicate same archkit hook", () => {
  const args = ["Edit|Write|MultiEdit", 'archkit-claude-hook "$TOOL_INPUT_PATH"'];
  const first = mergeClaudeSettings({}, ...args);
  const second = mergeClaudeSettings(first, ...args);
  assert.equal(
    second.hooks.PreToolUse.length,
    1,
    "Should only have one archkit hook entry after calling merge twice"
  );
});

// ── Hook Binary ───────────────────────────────────────────────────────────────

test("hook exits 0 silently for unknown paths", () => {
  execFileSync("node", [HOOK, "/some/random/path/file.txt"], {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
  });
});

test("hook exits 0 silently when no path arg given", () => {
  execFileSync("node", [HOOK], {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
