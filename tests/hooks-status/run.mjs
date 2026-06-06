#!/usr/bin/env node
// Tests for guardrail-hook detection + install (archkit_install_hooks / D-HOOKS).
//
// What this verifies:
//   - detectArchkitHooks recognizes both plugin-form and npm-form commands
//   - addGuardrailHooks is idempotent and preserves existing hooks
//   - gatherHooksStatus aggregates project + user scope and detects plugin
//   - runHooksInstallJson emits config by default and writes it with apply:true

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  detectArchkitHooks,
  addGuardrailHooks,
  renderGuardrailHooks,
  guardrailHookCommand,
  ARCHKIT_GUARDRAIL_HOOKS,
} from "../../src/lib/claude-settings.mjs";
import { gatherHooksStatus } from "../../src/lib/hooks-status.mjs";
import { runHooksInstallJson, runHooksStatusJson } from "../../src/commands/hooks.mjs";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

const EVENTS = ARCHKIT_GUARDRAIL_HOOKS.map((h) => h.event);

// A throwaway project with .arch/ + an isolated fake HOME, so we never read or
// write the real ~/.claude/settings.json.
function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-hooks-"));
  const archDir = path.join(root, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "# SYSTEM.md\n## Type: Internal\n");
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  try { return fn({ root, archDir, home }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

console.log("\n  hooks-status — detection");

test("detectArchkitHooks recognizes plugin-form and npm-form commands", () => {
  const settings = {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/bin/archkit-session-start.mjs" }] }],
      Stop: [{ hooks: [{ type: "command", command: "archkit-stop-hook" }] }],
      PreToolUse: [{ hooks: [{ type: "command", command: "some-other-tool" }] }],
    },
  };
  const found = detectArchkitHooks(settings);
  assert.ok(found.has("SessionStart"), "plugin-form SessionStart detected");
  assert.ok(found.has("Stop"), "npm-form Stop detected");
  assert.ok(!found.has("PostToolUse"), "absent hook not falsely detected");
});

test("detectArchkitHooks returns empty set for settings with no hooks", () => {
  assert.equal(detectArchkitHooks({}).size, 0);
  assert.equal(detectArchkitHooks({ hooks: {} }).size, 0);
});

console.log("\n  hooks-status — addGuardrailHooks");

test("addGuardrailHooks adds the full guardrail set into empty settings", () => {
  const { settings, added } = addGuardrailHooks({});
  assert.deepEqual(added.sort(), [...EVENTS].sort());
  assert.deepEqual([...detectArchkitHooks(settings)].sort(), [...EVENTS].sort());
});

test("addGuardrailHooks is idempotent and preserves unrelated hooks", () => {
  const existing = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "archkit-stop-hook", timeout: 8 }] }],
      PreToolUse: [{ hooks: [{ type: "command", command: "my-linter" }] }],
    },
  };
  const { settings, added } = addGuardrailHooks(existing);
  assert.ok(!added.includes("Stop"), "existing Stop not duplicated");
  assert.equal(settings.hooks.Stop.length, 1, "Stop has exactly one entry");
  assert.ok(settings.hooks.PreToolUse.some((g) => g.hooks[0].command === "my-linter"), "unrelated hook preserved");
  // Running again adds nothing.
  const again = addGuardrailHooks(settings);
  assert.equal(again.added.length, 0, "second pass is a no-op");
});

test("renderGuardrailHooks includes the PostToolUse matcher", () => {
  const { hooks } = renderGuardrailHooks();
  assert.ok(hooks.PostToolUse[0].matcher.includes("mcp__archkit__"), "matcher carried through");
  assert.equal(hooks.SessionStart[0].matcher, undefined, "non-matcher hooks have no matcher key");
});

console.log("\n  hooks-status — portable command forms");

// Pull every hook command string out of a { hooks: {...} } object.
function allCommands(hooks) {
  const out = [];
  for (const event of Object.keys(hooks || {})) {
    for (const group of hooks[event] || []) {
      for (const h of group.hooks || []) out.push(String(h.command || ""));
    }
  }
  return out;
}

// A hook command is portable iff it carries no absolute, machine-specific
// filesystem path: no home dir, no leading /Users|/home|... unix path, no
// Windows drive path. The two allowed forms are a bare bin name and the
// `node $CLAUDE_PROJECT_DIR/bin/<bin>.mjs` form ($CLAUDE_PROJECT_DIR is a
// placeholder Claude Code expands at hook time, not a literal absolute path).
function assertPortable(cmd) {
  assert.ok(!cmd.includes(os.homedir()), `command must not embed the home dir: ${cmd}`);
  assert.ok(!/(^|\s)\/(Users|home|root|opt|usr|var|private|tmp|Applications)\//.test(cmd),
    `command must not embed an absolute unix path: ${cmd}`);
  assert.ok(!/[A-Za-z]:\\/.test(cmd), `command must not embed a Windows drive path: ${cmd}`);
}

test("guardrailHookCommand falls back to the bare bin without projectDir", () => {
  assert.equal(guardrailHookCommand("archkit-stop-hook"), "archkit-stop-hook");
  assert.equal(guardrailHookCommand("archkit-stop-hook", { projectDir: "/nope/missing" }),
    "archkit-stop-hook", "non-existent projectDir/bin falls back to bare bin");
});

test("guardrailHookCommand uses $CLAUDE_PROJECT_DIR when the bin lives in the project", () => {
  withProject(({ root }) => {
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "bin", "archkit-stop-hook.mjs"), "// stub\n");
    const cmd = guardrailHookCommand("archkit-stop-hook", { projectDir: root });
    assert.equal(cmd, "node $CLAUDE_PROJECT_DIR/bin/archkit-stop-hook.mjs");
    assertPortable(cmd);
  });
});

test("renderGuardrailHooks emits zero absolute filesystem paths (bare-bin form)", () => {
  for (const cmd of allCommands(renderGuardrailHooks().hooks)) assertPortable(cmd);
});

test("renderGuardrailHooks emits zero absolute paths with projectDir ($CLAUDE_PROJECT_DIR form)", () => {
  withProject(({ root }) => {
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    for (const spec of ARCHKIT_GUARDRAIL_HOOKS) {
      fs.writeFileSync(path.join(root, "bin", `${spec.bin}.mjs`), "// stub\n");
    }
    const cmds = allCommands(renderGuardrailHooks({ projectDir: root }).hooks);
    assert.equal(cmds.length, ARCHKIT_GUARDRAIL_HOOKS.length);
    for (const cmd of cmds) {
      assert.ok(cmd.includes("$CLAUDE_PROJECT_DIR"), `expected portable form, got: ${cmd}`);
      assertPortable(cmd);
    }
  });
});

test("this repo's committed .claude/settings.json contains no absolute paths", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const settingsPath = path.join(repoRoot, ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) return; // tolerated on clones without the dogfood config
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const cmds = allCommands(settings.hooks);
  assert.ok(cmds.length > 0, "settings.json should wire at least one hook");
  for (const cmd of cmds) assertPortable(cmd);
});

console.log("\n  hooks-status — gatherHooksStatus");

test("gatherHooksStatus reports all missing when nothing is wired", () => {
  withProject(({ root, home }) => {
    const status = gatherHooksStatus(root, { home });
    assert.equal(status.installed, false);
    assert.equal(status.via, "none");
    assert.deepEqual(status.missing.sort(), [...EVENTS].sort());
  });
});

test("gatherHooksStatus reports installed when project settings carry the set", () => {
  withProject(({ root, home }) => {
    const { settings } = addGuardrailHooks({});
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify(settings));
    const status = gatherHooksStatus(root, { home });
    assert.equal(status.installed, true);
    assert.equal(status.via, "settings");
    assert.deepEqual(status.missing, []);
  });
});

test("gatherHooksStatus treats an enabled archkit plugin as fully installed", () => {
  withProject(({ root, home }) => {
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "archkit@some-marketplace": true } })
    );
    const status = gatherHooksStatus(root, { home });
    assert.equal(status.installed, true);
    assert.equal(status.via, "plugin");
    assert.deepEqual(status.missing, []);
  });
});

console.log("\n  hooks-status — install runner");

test("runHooksStatusJson + runHooksInstallJson emit config (and carry nextStep)", () => {
  withProject(({ root }) => {
    const prev = process.cwd();
    process.chdir(root);
    try {
      const status = runHooksStatusJson({ cwd: root });
      assert.equal(status.installed, false);
      assert.match(status.nextStep, /archkit_install_hooks/);

      const emit = runHooksInstallJson({ cwd: root });
      assert.equal(emit.action, "emit");
      assert.ok(emit.hooksConfig.hooks.Stop, "emitted config includes the Stop hook");
      assert.ok(emit.nextStep, "emit has nextStep");
    } finally { process.chdir(prev); }
  });
});

test("runHooksInstallJson apply:true writes the project settings and is then a noop", () => {
  withProject(({ root }) => {
    const prev = process.cwd();
    process.chdir(root);
    try {
      const applied = runHooksInstallJson({ cwd: root, apply: true });
      assert.equal(applied.action, "applied");
      assert.deepEqual(applied.added.sort(), [...EVENTS].sort());
      const written = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));
      assert.deepEqual([...detectArchkitHooks(written)].sort(), [...EVENTS].sort());
      // Re-running is a no-op now.
      const again = runHooksInstallJson({ cwd: root, apply: true });
      assert.equal(again.action, "noop");
    } finally { process.chdir(prev); }
  });
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
