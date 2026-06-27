#!/usr/bin/env node
// E2E test: spawn archkit-mcp as a subprocess, talk via stdio JSON-RPC
// using the MCP SDK's client. Verifies transport, tool registration,
// and round-trip semantics.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT_MCP = path.resolve(__dirname, "../../bin/archkit-mcp.mjs");

let passed = 0, failed = 0;

function log(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-e2e-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Type: Internal Tool\n## Stack: Node.js\n## Pattern: Simple Layered\n\n## Rules\n- Layered\n\n## Reserved Words\n\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n  [login]\n");
  fs.writeFileSync(path.join(tmp, "test-file.js"), "const x = 1;\nexport default x;\n");
  return tmp;
}

// Write a planned CGR goal into a fixture so the relay prompts (goal_next /
// goal_status) have something to load. Uses the same simple key:value + block
// list frontmatter that src/lib/goals.mjs parses.
function writeGoal(tmp, { slug, title, status = "planned" }) {
  const dir = path.join(tmp, ".arch", "goals");
  fs.mkdirSync(dir, { recursive: true });
  const md = [
    "---",
    `slug: ${slug}`,
    `title: ${title}`,
    `status: ${status}`,
    "created: 2026-06-06",
    "exit-criteria:",
    "  - First exit criterion",
    "  - Second exit criterion",
    "verify-command: npm test",
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, `${slug}.md`), md);
}

async function withClient(cwd, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ARCHKIT_MCP],
    cwd,
  });
  const client = new Client({ name: "archkit-e2e-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

await log("initialize handshake succeeds", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const info = client.getServerVersion();
      assert.equal(info.name, "archkit");
      // Version-agnostic: just require a semver-shaped string so a version bump
      // doesn't require touching this test (the server version is informational).
      assert.match(info.version, /^\d+\.\d+\.\d+/);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("tools/list returns all 41 tools", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name).sort();
      assert.deepEqual(names, [
        "archkit_audit_spec",
        "archkit_boundary_check",
        "archkit_boundary_propose",
        "archkit_conductor",
        "archkit_decisions_search",
        "archkit_doctor",
        "archkit_drift",
        "archkit_finalize_config",
        "archkit_goal_abandon",
        "archkit_goal_complete",
        "archkit_goal_consolidate",
        "archkit_goal_defer",
        "archkit_goal_dismiss",
        "archkit_goal_fission",
        "archkit_goal_handoff",
        "archkit_goal_hold",
        "archkit_goal_intake",
        "archkit_goal_list",
        "archkit_goal_payload",
        "archkit_goal_promote",
        "archkit_goal_show",
        "archkit_goal_start",
        "archkit_goal_testing",
        "archkit_goal_verify",
        "archkit_gotcha_list",
        "archkit_gotcha_propose",
        "archkit_graph_accept",
        "archkit_init",
        "archkit_init_generate",
        "archkit_install_hooks",
        "archkit_log_decision",
        "archkit_prd_check",
        "archkit_resolve_lookup",
        "archkit_resolve_preflight",
        "archkit_resolve_scaffold",
        "archkit_resolve_warmup",
        "archkit_review",
        "archkit_review_staged",
        "archkit_session_state",
        "archkit_stats",
        "archkit_sync",
        "archkit_verify_wiring",
        "archkit_worklog",
      ]);
      const review = tools.find(t => t.name === "archkit_review");
      assert.ok(review.description.includes("When to use"), "description should include 'When to use' prose");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("archkit_review happy path", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const result = await client.callTool({
        name: "archkit_review",
        arguments: { files: ["test-file.js"] },
      });
      assert.equal(result.isError, undefined, `unexpected error: ${JSON.stringify(result)}`);
      const data = JSON.parse(result.content[0].text);
      assert.equal(typeof data.files, "number");
      assert.equal(typeof data.pass, "boolean");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("archkit_review error path: missing file", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const result = await client.callTool({
        name: "archkit_review",
        arguments: { files: ["does-not-exist.js"] },
      });
      assert.equal(result.isError, true);
      const env = JSON.parse(result.content[0].text);
      assert.equal(env.code, "file_not_found");
      assert.equal(typeof env.suggestion, "string");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("archkit_resolve_warmup happy path", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const result = await client.callTool({ name: "archkit_resolve_warmup", arguments: {} });
      assert.equal(result.isError, undefined);
      const data = JSON.parse(result.content[0].text);
      assert.equal(typeof data.pass, "boolean");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("invalid_input on schema violation", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const result = await client.callTool({
        name: "archkit_review",
        arguments: { files: [] }, // violates min(1)
      });
      assert.equal(result.isError, true);
      // Schema violations may be caught at the MCP protocol level (before the tool handler),
      // producing a raw error string, or at the tool-handler level producing a JSON envelope.
      const text = result.content[0].text;
      const isProtocolError = text.includes("Input validation error") || text.includes("invalid_input") || text.includes("-32602");
      const isToolError = (() => { try { return JSON.parse(text).code === "invalid_input"; } catch { return false; } })();
      assert.ok(isProtocolError || isToolError, `expected invalid_input error, got: ${text}`);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("prompts/list registers the CGR relay prompts", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map(p => p.name).sort();
      // Unified relay: `conductor` is the one advance command; `intake` decomposes
      // an ask. The old `goal_next` was folded into `conductor`.
      assert.deepEqual(names, ["conductor", "goal_resume", "goal_review", "goal_status", "intake"]);
      const cond = prompts.find(p => p.name === "conductor");
      assert.ok(cond, "conductor prompt should be registered");
      assert.equal(typeof cond.description, "string");
      assert.ok(cond.description.length > 0, "conductor should carry a description");
      assert.ok(prompts.find(p => p.name === "intake"), "intake prompt should be registered");
      assert.ok(!prompts.find(p => p.name === "goal_next"), "goal_next should no longer be registered");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("conductor prompt foregrounds the next single goal (former goal_next)", async () => {
  const tmp = makeFixture();
  writeGoal(tmp, { slug: "demo-goal", title: "Demo relay goal" });
  try {
    await withClient(tmp, async (client) => {
      const res = await client.getPrompt({ name: "conductor", arguments: {} });
      // Shape: { messages: [{ role: "user", content: { type: "text", text } }] }
      assert.ok(Array.isArray(res.messages) && res.messages.length === 1, "expected one message");
      const msg = res.messages[0];
      assert.equal(msg.role, "user");
      assert.equal(msg.content.type, "text");
      const text = msg.content.text;
      // One eligible goal → no parallelism → conductor foregrounds it (relay header
      // + rendered payload markers), exactly as goal_next used to.
      assert.match(text, /\[archkit CGR relay\] Active goal: demo-goal/);
      assert.match(text, /archkit_goal_complete demo-goal/);
      assert.match(text, /ARCHKIT GOAL: demo-goal/);
      assert.match(text, /First exit criterion/);
    });
    // conductor marks the goal in-progress as a side effect — confirm it stuck.
    const onDisk = fs.readFileSync(path.join(tmp, ".arch", "goals", "demo-goal.md"), "utf8");
    assert.match(onDisk, /status: in-progress/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("conductor prompt with empty queue returns a nothing-to-advance notice", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const res = await client.getPrompt({ name: "conductor", arguments: {} });
      const text = res.messages[0].content.text;
      assert.match(text, /Nothing to advance/);
      assert.match(text, /\/mcp__archkit__intake/);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("intake prompt returns decomposition guidance", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const res = await client.getPrompt({ name: "intake", arguments: {} });
      const text = res.messages[0].content.text;
      assert.match(text, /archkit_goal_intake/);
      assert.match(text, /\/mcp__archkit__conductor/);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("server shuts down cleanly on SIGTERM", async () => {
  const tmp = makeFixture();
  const child = spawn(process.execPath, [ARCHKIT_MCP], { cwd: tmp, stdio: ["pipe", "pipe", "pipe"] });
  await new Promise(resolve => setTimeout(resolve, 500));
  child.kill("SIGTERM");
  const code = await new Promise(resolve => child.on("exit", resolve));
  if (process.platform === "win32") {
    // Windows has no POSIX signals — kill() maps to TerminateProcess, so the
    // child is force-terminated with a null exit code rather than exiting 0.
    // The meaningful assertion is simply that the server stopped (exit fired).
    assert.ok(code === null || code === 0, `server should terminate, got ${code}`);
  } else {
    assert.equal(code, 0, `expected clean exit (0), got ${code}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
