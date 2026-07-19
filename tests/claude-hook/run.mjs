#!/usr/bin/env node

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeClaudeSettings, addSessionStartHook } from "../../src/lib/claude-settings.mjs";
import { ARCHKIT_PROTOCOL_SKILL } from "../../src/data/skill-templates.mjs";
import { writeGoal, startGoal, markTesting, markOnHold } from "../../src/lib/goals.mjs";

// Run the SessionStart hook in an archkit project rooted at `dir`, return the
// parsed additionalContext string.
function runSessionStart(dir, source = "startup") {
  const out = execFileSync("node", [SESSION_HOOK], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, hook_event_name: "SessionStart", source }),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
  });
  return JSON.parse(out.toString("utf8")).hookSpecificOutput?.additionalContext || "";
}

function withArchProject(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-sst-board-"));
  const archDir = path.join(tmp, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Naming\nFiles: kebab\n");
  try { fn({ tmp, archDir }); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../bin/archkit-claude-hook.mjs");
const SESSION_HOOK = path.resolve(__dirname, "../../bin/archkit-session-start.mjs");

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

// ── SessionStart Hook ─────────────────────────────────────────────────────────

test("addSessionStartHook adds entry to empty settings", () => {
  const result = addSessionStartHook({}, "archkit-session-start");
  assert.ok(Array.isArray(result.hooks?.SessionStart));
  assert.equal(result.hooks.SessionStart.length, 1);
  assert.equal(result.hooks.SessionStart[0].hooks[0].command, "archkit-session-start");
});

test("addSessionStartHook does not duplicate", () => {
  const first = addSessionStartHook({}, "archkit-session-start");
  const second = addSessionStartHook(first, "archkit-session-start");
  assert.equal(second.hooks.SessionStart.length, 1);
});

test("addSessionStartHook preserves other SessionStart entries", () => {
  const existing = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "other-tool", timeout: 3000 }] },
      ],
    },
  };
  const result = addSessionStartHook(existing, "archkit-session-start");
  assert.equal(result.hooks.SessionStart.length, 2);
});

test("session-start hook emits greenfield-setup context outside an archkit project", () => {
  // v1.5.2: when no .arch/ exists, the hook nudges the agent toward the
  // /archkit-init wizard skill rather than silently falling through. Without
  // this, agents discover the legacy `archkit init` CLI scaffolder first and
  // never find the v1.5+ skill-based wizard.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-sst-empty-"));
  try {
    const out = execFileSync("node", [SESSION_HOOK], {
      cwd: tmp,
      input: JSON.stringify({ cwd: tmp, hook_event_name: "SessionStart" }),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const parsed = JSON.parse(out.toString("utf8"));
    assert.equal(parsed.hookSpecificOutput?.hookEventName, "SessionStart");
    // v1.5.4 — collapsed to a single canonical action: call archkit_init.
    // The MCP tool itself returns the full wizard inline + PRD signal +
    // skeleton index + nextStep hint, so the hook no longer needs to
    // describe SKILL.md paths, escape hatches, or runtime mechanics.
    assert.ok(
      parsed.hookSpecificOutput?.additionalContext?.includes("archkit_init"),
      "setup context should name archkit_init as the canonical action"
    );
    assert.ok(
      parsed.hookSpecificOutput?.additionalContext?.includes("legacy `archkit init` CLI"),
      "setup context should still steer away from the legacy CLI scaffolder"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("session-start hook emits additionalContext inside an archkit project", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-sst-arch-"));
  try {
    fs.mkdirSync(path.join(tmp, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".arch", "SYSTEM.md"), "# System\n");

    const out = execFileSync("node", [SESSION_HOOK], {
      cwd: tmp,
      input: JSON.stringify({ cwd: tmp, hook_event_name: "SessionStart" }),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const parsed = JSON.parse(out.toString("utf8"));
    assert.equal(parsed.hookSpecificOutput?.hookEventName, "SessionStart");
    assert.ok(
      parsed.hookSpecificOutput?.additionalContext?.includes("archkit_resolve_warmup"),
      "additionalContext should mention archkit_resolve_warmup"
    );
    assert.ok(
      parsed.hookSpecificOutput.additionalContext.includes(".arch/"),
      "additionalContext should mention .arch/"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── SessionStart compact board snapshot (cgr-conductor-startup-board-awareness) ─

test("session-start emits a compact board snapshot + conductor nudge for a mixed board", () => {
  withArchProject(({ tmp, archDir }) => {
    // Mixed board: ungrouped queue + a project track + verification debt →
    // triage would surface a choice, so the snapshot must nudge to the conductor.
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });
    writeGoal(archDir, { slug: "p-a1", title: "A1", order: 1, project: "alpha" });
    writeGoal(archDir, { slug: "t-1", title: "T1", order: 2 });
    startGoal(archDir, "t-1");
    markTesting(archDir, "t-1");

    const ctx = runSessionStart(tmp);
    assert.ok(ctx.includes("[archkit CGR board]"), "snapshot line present");
    assert.ok(/queue 1 \(next q-1\)/.test(ctx), "queue count + next slug");
    assert.ok(/testing 1/.test(ctx), "testing count");
    assert.ok(/projects \(alpha:1\)/.test(ctx), "project label:count");
    assert.ok(/on-hold 0/.test(ctx), "on-hold count");
    assert.ok(/Mixed board/.test(ctx), "mixed board nudge present");
    assert.ok(ctx.includes("/mcp__archkit__conductor"), "nudges to the conductor to choose");
    // Still carries the base in-project digest (not a replacement).
    assert.ok(ctx.includes("archkit_resolve_warmup"), "base digest preserved");
  });
});

test("session-start omits the board snapshot when no goals exist (greenfield stays clean)", () => {
  withArchProject(({ tmp }) => {
    const ctx = runSessionStart(tmp);
    assert.ok(ctx.includes("archkit_resolve_warmup"), "base in-project digest still emitted");
    assert.ok(!ctx.includes("[archkit CGR board]"), "no snapshot line when there are no goals");
  });
});

test("session-start snapshot on a single-track queue omits the mixed-board nudge", () => {
  withArchProject(({ tmp, archDir }) => {
    writeGoal(archDir, { slug: "q-1", title: "Q1", order: 0 });
    writeGoal(archDir, { slug: "q-2", title: "Q2", order: 1 });
    const ctx = runSessionStart(tmp);
    assert.ok(ctx.includes("[archkit CGR board]"), "snapshot present for a live queue");
    assert.ok(/queue 2 \(next q-1\)/.test(ctx), "queue depth + next");
    assert.ok(!/Mixed board/.test(ctx), "single obvious track → no choice nudge");
  });
});

test("session-start snapshot surfaces only-on-hold work (parked board is not empty)", () => {
  withArchProject(({ tmp, archDir }) => {
    writeGoal(archDir, { slug: "h-1", title: "H1", order: 0 });
    startGoal(archDir, "h-1");
    markOnHold(archDir, "h-1");
    const ctx = runSessionStart(tmp);
    assert.ok(ctx.includes("[archkit CGR board]"), "parked-only board still shows a snapshot");
    assert.ok(/on-hold 1/.test(ctx), "on-hold count surfaced");
    assert.ok(/Mixed board/.test(ctx), "parked-only work routes to the conductor choice");
  });
});

// ── Init --install-hooks Integration ─────────────────────────────────────────

const ARCHKIT_BIN = path.resolve(__dirname, "../../bin/archkit.mjs");

function withGitDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-claude-init-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("--install-hooks --claude writes both git hook and claude settings", () => {
  withGitDir((dir) => {
    const out = execFileSync("node", [ARCHKIT_BIN, "init", "--install-hooks", "--claude", "--json"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
    const result = JSON.parse(out.toString("utf8").trim());
    assert.equal(result.status, "installed", "status should be 'installed'");
    assert.ok(result.git_hook, "git_hook field should be present");
    assert.ok(result.claude_hook, "claude_hook field should be present");

    const hookPath = path.join(dir, ".git", "hooks", "pre-commit");
    assert.ok(fs.existsSync(hookPath), ".git/hooks/pre-commit should exist");

    const settingsPath = path.join(dir, ".claude", "settings.json");
    assert.ok(fs.existsSync(settingsPath), ".claude/settings.json should exist");

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.ok(
      Array.isArray(settings.hooks?.PreToolUse) && settings.hooks.PreToolUse.length >= 1,
      "PreToolUse should have at least 1 entry"
    );
    assert.ok(
      Array.isArray(settings.hooks?.SessionStart) && settings.hooks.SessionStart.length >= 1,
      "SessionStart should have at least 1 entry"
    );
    const sstCommands = settings.hooks.SessionStart.flatMap(h => h.hooks?.map(hh => hh.command) || []);
    assert.ok(
      sstCommands.some(c => c?.includes("archkit-session-start")),
      "SessionStart should include the archkit-session-start command"
    );
  });
});

test("--install-hooks --claude-only skips git hook", () => {
  withGitDir((dir) => {
    execFileSync("node", [ARCHKIT_BIN, "init", "--install-hooks", "--claude-only", "--json"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });

    const hookPath = path.join(dir, ".git", "hooks", "pre-commit");
    assert.ok(!fs.existsSync(hookPath), ".git/hooks/pre-commit should NOT exist");

    const settingsPath = path.join(dir, ".claude", "settings.json");
    assert.ok(fs.existsSync(settingsPath), ".claude/settings.json should exist");
  });
});

test("--install-hooks --mcp skips registration cleanly when claude CLI is absent", () => {
  withGitDir((dir) => {
    // Build an isolated PATH that can run node + the CLI probe but has no
    // `claude` — exercises the graceful-degradation branch of installMcpEntry.
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-no-claude-"));
    try {
      let pathValue;
      if (process.platform === "win32") {
        // Symlinks are privileged on Windows. Instead include node's own dir and
        // System32 (so node + `where`/cmd resolve); `claude` is absent from both.
        const nodeDir = path.dirname(process.execPath);
        const sys32 = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
        pathValue = [isolatedDir, nodeDir, sys32].join(path.delimiter);
      } else {
        const nodePath = execFileSync("which", ["node"], { encoding: "utf8" }).trim();
        const whichPath = execFileSync("which", ["which"], { encoding: "utf8" }).trim();
        fs.symlinkSync(nodePath, path.join(isolatedDir, "node"));
        fs.symlinkSync(whichPath, path.join(isolatedDir, "which"));
        pathValue = isolatedDir;
      }

      const out = execFileSync(process.execPath, [ARCHKIT_BIN, "init", "--install-hooks", "--claude-only", "--mcp", "--json"], {
        cwd: dir,
        env: { ...process.env, PATH: pathValue },
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      });
      const result = JSON.parse(out.toString("utf8").trim());
      assert.equal(result.status, "installed", "init itself should still succeed");
      assert.equal(result.mcp, false, "mcp.registered should be false when claude CLI is missing");
      assert.ok(
        String(result.mcp_action || "").startsWith("skipped:"),
        `mcp_action should be 'skipped:*', got ${result.mcp_action}`
      );
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});

test("--install-hooks --claude merges with existing settings", () => {
  withGitDir((dir) => {
    // Pre-create .claude/settings.json with a Bash hook
    const claudeDir = path.join(dir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    const existingSettings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "some-other-tool", timeout: 3000 }] },
        ],
      },
    };
    fs.writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify(existingSettings, null, 2));

    execFileSync("node", [ARCHKIT_BIN, "init", "--install-hooks", "--claude-only", "--json"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });

    const settingsPath = path.join(dir, ".claude", "settings.json");
    const merged = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.ok(
      Array.isArray(merged.hooks?.PreToolUse) && merged.hooks.PreToolUse.length >= 2,
      `PreToolUse should have >= 2 entries after merge, got ${merged.hooks?.PreToolUse?.length}`
    );
    const matchers = merged.hooks.PreToolUse.map(h => h.matcher);
    assert.ok(matchers.includes("Bash"), "Original Bash hook should be preserved");
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
