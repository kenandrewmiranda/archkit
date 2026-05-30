#!/usr/bin/env node
// Tests for MCP resources — .arch/ artifacts exposed as archkit://… handles.

import { strict as assert } from "node:assert";
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
    .catch((err) => { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-res-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "decisions"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## App: test\n## Type: Internal\nMARKER_SYSTEM\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "## Nodes\n@auth = [auth] → src/features/auth/\n");
  fs.writeFileSync(path.join(arch, "BOUNDARIES.md"), "# Boundaries\n- BAN: src/web/* -> src/db/*\n");
  fs.writeFileSync(path.join(arch, "skills", "stripe.skill"), "# stripe\nMARKER_SKILL\n");
  fs.writeFileSync(path.join(arch, "decisions", "0001-use-postgres.md"), "# 1. Use Postgres\n\n- **Status**: Accepted\n\n## Decision\n\nMARKER_ADR\n");
  return tmp;
}

async function withClient(cwd, fn) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [ARCHKIT_MCP], cwd });
  const client = new Client({ name: "res-test", version: "0" }, { capabilities: {} });
  await client.connect(transport);
  try { await fn(client); } finally { await client.close(); }
}

await log("listResources includes the static files + template-listed skills/decisions", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);
      assert.ok(uris.includes("archkit://system"), "system resource listed");
      assert.ok(uris.includes("archkit://index"), "index resource listed");
      assert.ok(uris.includes("archkit://boundaries"), "boundaries resource listed");
      assert.ok(uris.includes("archkit://skill/stripe"), "skill enumerated via template list");
      assert.ok(uris.includes("archkit://decision/1"), "decision enumerated via template list");
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

await log("readResource returns raw file contents for static + templated URIs", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const sys = await client.readResource({ uri: "archkit://system" });
      assert.match(sys.contents[0].text, /MARKER_SYSTEM/);
      const skill = await client.readResource({ uri: "archkit://skill/stripe" });
      assert.match(skill.contents[0].text, /MARKER_SKILL/);
      const adr = await client.readResource({ uri: "archkit://decision/1" });
      assert.match(adr.contents[0].text, /MARKER_ADR/);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

console.log("");
console.log(`  Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
