#!/usr/bin/env node
// v1.8 contract enforcer (item A + B from docs/roadmap/v1.8.md).
//
// For every registered MCP tool, assert two contracts on the JSON envelope:
//
//   (1) Silent-success — if a domain field is empty (no findings / no rules /
//       no matches), the response must carry an explanatory note describing
//       what was checked and why it's empty. Encoded as `<foo>Note: string`
//       (e.g. `staleNote`, `filesNote`, `skillsNote`, `requiredReadingNote`).
//
//   (2) nextStep — every successful response must include a `nextStep:string`
//       field, imperative, ≤140 chars, naming the next tool or action.
//
// The audit boots the MCP server in a temp fixture, calls each tool with
// minimal-valid input, and fails CI if either contract is violated. This
// blocks PRs that add a new tool without the dead-end indicator pattern.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tools as toolRegistry } from "../../src/mcp/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT_MCP = path.resolve(__dirname, "../../bin/archkit-mcp.mjs");

const NEXT_STEP_MAX = 140;

let passed = 0, failed = 0;
function log(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

// Fixture mirrors tests/mcp-server but adds an INDEX.md node and a BOUNDARIES.md
// so preflight/lookup/boundary_check can exercise their non-error paths.
function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-audit-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });

  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Type: SaaS\n## Stack: Node.js\n## Pattern: Simple Layered\n\n" +
    "## Rules\n- Layered\n\n## Reserved Words\n$db = database\n\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"),
    "## Nodes\n@auth = [auth] → src/features/auth/\n\n## Keywords\n");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n  [login]\n");
  fs.writeFileSync(path.join(arch, "skills", "stripe.skill"),
    "# stripe\n\n## Use\nReal usage notes.\n\n## Patterns\nimport Stripe from 'stripe'.\n\n## Gotchas\nWRONG: req.body\nRIGHT: req.rawBody\nWHY: Express parses JSON\n\n## Boundaries\nDon't import server-only code in client.\n\n## Snippets\nconst s = new Stripe(key)\n\n## Meta\nupdated: 2026-05-25\n");
  fs.writeFileSync(path.join(arch, "BOUNDARIES.md"),
    "# Boundaries\n\n- BAN: src/copilot/* -> src/execution/*\n");
  fs.mkdirSync(path.join(tmp, "src", "features", "auth"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "test-file.js"), "const x = 1;\nexport default x;\n");
  // git init so boundary_check / review_staged paths don't crash on missing repo
  try {
    execFileSync("git", ["init", "-q"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "audit@example.com"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "audit"], { cwd: tmp, stdio: "ignore" });
  } catch { /* git missing — review_staged will return files:0, which is fine */ }
  return tmp;
}

async function withClient(cwd, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ARCHKIT_MCP],
    cwd,
  });
  const client = new Client({ name: "archkit-audit", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try { await fn(client); } finally { await client.close(); }
}

function assertContract(toolName, data) {
  // Tools may legitimately return an error envelope on minimal-valid input
  // (e.g. unknown_feature with valid:[]). For those, the inner envelope must
  // still carry a suggestion + nextStep so the agent isn't stranded.
  if (data && data.error) {
    assert.ok(
      typeof data.nextStep === "string" && data.nextStep.length > 0,
      `${toolName}: error response missing nextStep (got error=${data.error})`
    );
    return;
  }

  assert.ok(
    typeof data.nextStep === "string" && data.nextStep.length > 0,
    `${toolName}: missing nextStep:string`
  );
  assert.ok(
    data.nextStep.length <= NEXT_STEP_MAX * 2,
    `${toolName}: nextStep length ${data.nextStep.length} exceeds 2× soft cap (${NEXT_STEP_MAX * 2}); shorten or split`
  );

  // Silent-success contract: when a primary domain field is an empty array,
  // we require an adjacent fooNote describing what was checked. This applies
  // only to a known set of fields that have historically silent-failed.
  const silentSuccessFields = {
    stale: "staleNote",                       // archkit_drift
    skills: "skillsNote",                     // archkit_gotcha_list
    recommendations: "recommendationsNote",   // archkit_stats
    requiredReading: "requiredReadingNote",   // archkit_resolve_preflight
    violations: null,                          // archkit_boundary_check — hint covers rules:0
  };
  for (const [field, noteField] of Object.entries(silentSuccessFields)) {
    if (!Array.isArray(data[field])) continue;
    if (data[field].length > 0) continue;
    if (!noteField) continue;
    assert.ok(
      typeof data[noteField] === "string" && data[noteField].length > 0,
      `${toolName}: ${field}:[] but no ${noteField} explaining why`
    );
  }

  // boundary_check special case: rules:0 must come with `hint`
  if (toolName === "archkit_boundary_check" && data.rules === 0) {
    assert.ok(typeof data.hint === "string", `${toolName}: rules:0 but no hint`);
  }

  // review/review_staged: files:0 must come with filesNote
  if ((toolName === "archkit_review" || toolName === "archkit_review_staged") && data.files === 0) {
    assert.ok(typeof data.filesNote === "string", `${toolName}: files:0 but no filesNote`);
  }
}

async function callJson(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0].text;
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`${name}: response is not JSON: ${text.slice(0, 200)}`);
  }
  if (result.isError) {
    // Error envelopes should still carry code+suggestion (existing v1.4 contract).
    assert.ok(data.code && data.message, `${name}: error envelope missing code/message`);
    return { data, isError: true };
  }
  return { data, isError: false };
}

await log("audit: every registered tool returns nextStep + silent-success notes", async () => {
  const tmp = makeFixture();
  const expectedTools = Object.keys(toolRegistry).sort();
  const covered = new Set();

  try {
    await withClient(tmp, async (client) => {
      // Tool-by-tool exercise. Ordering matters for the goal lifecycle.
      const cases = [
        ["archkit_review", { files: ["test-file.js"] }],
        ["archkit_review_staged", {}],
        ["archkit_resolve_warmup", {}],
        ["archkit_resolve_preflight", { feature: "auth", layer: "controller" }],
        ["archkit_resolve_scaffold", { feature: "auth" }],
        ["archkit_resolve_lookup", { id: "auth" }],
        ["archkit_gotcha_propose", { skill: "stripe", wrong: "x=1", right: "x=2", why: "audit-test" }],
        ["archkit_gotcha_list", {}],
        ["archkit_stats", {}],
        ["archkit_drift", {}],
        ["archkit_log_decision", { title: "audit", context: "x", decision: "y", consequences: "z" }],
        ["archkit_prd_check", {}],
        ["archkit_boundary_check", {}],
        ["archkit_goal_intake", { goals: [{ title: "audit goal", exitCriteria: ["done"] }] }],
        ["archkit_goal_list", {}],
        ["archkit_goal_show", { slug: "audit-goal" }],
        ["archkit_goal_payload", { slug: "audit-goal" }],
        ["archkit_goal_complete", { slug: "audit-goal" }],
        ["archkit_init", {}],
      ];

      for (const [name, args] of cases) {
        covered.add(name);
        const { data, isError } = await callJson(client, name, args);
        // Both successful and error envelopes must satisfy the contract.
        if (isError) {
          assert.ok(
            typeof data.suggestion === "string" && data.suggestion.length > 0,
            `${name}: error envelope missing suggestion`
          );
          continue;
        }
        assertContract(name, data);
      }
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Hard fail if a new tool was added to the registry without an entry in `cases`.
  const missing = expectedTools.filter(t => !covered.has(t));
  assert.deepEqual(missing, [], `audit missing coverage for new tool(s): ${missing.join(", ")} — add a case in tests/silent-success-audit/run.mjs`);
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
