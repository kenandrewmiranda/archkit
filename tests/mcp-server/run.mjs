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
      assert.ok(info.version.startsWith("1.4."));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("tools/list returns all 10 tools", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name).sort();
      assert.deepEqual(names, [
        "archkit_drift",
        "archkit_gotcha_list",
        "archkit_gotcha_propose",
        "archkit_resolve_lookup",
        "archkit_resolve_preflight",
        "archkit_resolve_scaffold",
        "archkit_resolve_warmup",
        "archkit_review",
        "archkit_review_staged",
        "archkit_stats",
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

await log("server shuts down cleanly on SIGTERM", async () => {
  const tmp = makeFixture();
  const child = spawn(process.execPath, [ARCHKIT_MCP], { cwd: tmp, stdio: ["pipe", "pipe", "pipe"] });
  await new Promise(resolve => setTimeout(resolve, 500));
  child.kill("SIGTERM");
  const code = await new Promise(resolve => child.on("exit", resolve));
  assert.equal(code, 0, `expected clean exit (0), got ${code}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
