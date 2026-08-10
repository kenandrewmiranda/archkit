#!/usr/bin/env node
// Tests for the MCP TOOL-DESCRIPTION BUDGET (tool-description-diet).
//
// Tool descriptions are loaded into agent context on every session whether or
// not the tool is ever called, so they are archkit's largest fixed token cost.
// This suite is the ratchet that keeps them from silently regrowing.
//
// What this verifies:
//   EC1 — every description leads with ONE sentence naming what the tool does
//         (first sentence is short, and is not a bare "Returns {" shape dump)
//   EC2 — no description re-litigates rationale in prose: ADR references are
//         POINTERS ("ADR 0013"), never a restated narrative
//   EC3 — the surface stays at or under its total byte budget (the post-diet
//         measurement), i.e. at most half the pre-diet 50581 bytes
//   EC4 — confusable tool pairs stay separable: each names the other, and each
//         carries a `Trigger:` clause
//   EC5 — a PER-DESCRIPTION byte ceiling holds for every tool
//
// See docs/mcp-tool-surface.md for the description contract these assert.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tools } from "../../src/mcp/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

// ── The budget ───────────────────────────────────────────────────────────────
// PER_DESCRIPTION_CEILING is the contract: no single description may exceed it.
// It is deliberately tight — the largest description today is 796 bytes, so the
// ceiling sits just above the real high-water mark rather than at a round number
// far above it. Raising it is a decision, not an accident.
const PER_DESCRIPTION_CEILING = 800;

// PRE_DIET_TOTAL is the measured baseline before tool-description-diet.
// TOTAL_BUDGET must stay at or under half of it (exit criterion 3).
const PRE_DIET_TOTAL = 50581;
const TOTAL_BUDGET = 25290; // floor(PRE_DIET_TOTAL / 2)

const bytes = (s) => Buffer.byteLength(s, "utf8");
const entries = Object.entries(tools);

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  FAIL ${msg}`);
};
const ok = (msg) => console.log(`  ok   ${msg}`);

console.log("mcp-tool-descriptions");

// ── EC5 — per-description ceiling (the anti-regrowth ratchet) ────────────────
{
  const over = entries
    .map(([name, tool]) => [name, bytes(tool.description || "")])
    .filter(([, n]) => n > PER_DESCRIPTION_CEILING)
    .sort((a, b) => b[1] - a[1]);

  if (over.length) {
    fail(
      `EC5 ${over.length} description(s) exceed the ${PER_DESCRIPTION_CEILING}-byte ceiling:\n` +
        over.map(([n, b]) => `       ${b}b  ${n}`).join("\n") +
        "\n       Trim them, or move the prose to docs/mcp-tool-surface.md / an ADR.",
    );
  } else {
    const max = Math.max(...entries.map(([, t]) => bytes(t.description || "")));
    ok(`EC5 every description <= ${PER_DESCRIPTION_CEILING}b (largest ${max}b)`);
  }
}

// ── EC3 — total surface budget ───────────────────────────────────────────────
{
  const total = entries.reduce((n, [, t]) => n + bytes(t.description || ""), 0);
  if (total > TOTAL_BUDGET) {
    fail(
      `EC3 total description bytes ${total} exceeds the ${TOTAL_BUDGET}-byte budget ` +
        `(half of the pre-diet ${PRE_DIET_TOTAL})`,
    );
  } else {
    const pct = Math.round((1 - total / PRE_DIET_TOTAL) * 100);
    ok(`EC3 total ${total}b <= ${TOTAL_BUDGET}b budget (${pct}% below the pre-diet ${PRE_DIET_TOTAL}b)`);
  }
}

// ── EC1 — every description leads with a single what-it-does sentence ────────
{
  const bad = [];
  for (const [name, tool] of entries) {
    const d = (tool.description || "").trim();
    if (!d) {
      bad.push(`${name}: empty description`);
      continue;
    }
    // First sentence = up to the first ". " that is not inside a path/version.
    const m = /^(.*?[.:])(\s|$)/.exec(d);
    const lead = m ? m[1] : d;
    if (bytes(lead) > 260) bad.push(`${name}: lead sentence is ${bytes(lead)}b (max 260)`);
    if (/^Returns\b/i.test(d)) bad.push(`${name}: leads with a return-shape dump, not what it does`);
  }
  if (bad.length) fail(`EC1 lead-line contract:\n       ${bad.join("\n       ")}`);
  else ok(`EC1 all ${entries.length} descriptions lead with one what-it-does sentence`);
}

// ── EC2 — ADRs are cited as pointers, not restated ───────────────────────────
{
  // A pointer looks like "ADR 0013" / "ADR 0014/0015" / "ADR 0020, 0021".
  // Anything that spells out an ADR's narrative ("the strategy is three tiers",
  // "the policy reserves...") is prose that belongs in the ADR itself.
  const bad = [];
  for (const [name, tool] of entries) {
    const d = tool.description || "";
    for (const ref of d.match(/ADR\s+\d[^)\].,;]*/g) || []) {
      if (!/^ADR \d{4}([/,]\s?\d{4})*( tier \d)?$/.test(ref.trim())) {
        bad.push(`${name}: ADR reference is not a bare pointer -> "${ref.trim()}"`);
      }
    }
    // Narrative giveaways that historically padded these strings.
    for (const phrase of ["the strategy is", "the policy reserves", "predates these and", "after working several projects"]) {
      if (d.toLowerCase().includes(phrase)) bad.push(`${name}: carries rationale prose ("${phrase}...") — move it to the ADR`);
    }
  }
  if (bad.length) fail(`EC2 ADR pointers:\n       ${bad.join("\n       ")}`);
  else ok("EC2 ADR references are bare pointers; no rationale narrative inline");
}

// ── EC4 — confusable pairs stay separable ────────────────────────────────────
{
  // THE reference case is conductor / session_state; the rest are the other
  // pairs an agent is most likely to mix up.
  const pairs = [
    ["archkit_conductor", "archkit_session_state"],
    ["archkit_goal_testing", "archkit_goal_hold"],
    ["archkit_goal_hold", "archkit_goal_complete"],
    ["archkit_goal_testing", "archkit_goal_complete"],
    ["archkit_review", "archkit_review_staged"],
    ["archkit_resolve_warmup", "archkit_doctor"],
    ["archkit_drift", "archkit_sync"],
    ["archkit_prd_check", "archkit_audit_spec"],
    ["archkit_api_register", "archkit_api_override"],
    ["archkit_goal_promote", "archkit_goal_dismiss"],
    ["archkit_goal_reconcile", "archkit_board_conflict"],
  ];
  const bad = [];
  for (const [a, b] of pairs) {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ]) {
      const d = tools[self]?.description;
      if (!d) {
        bad.push(`${self}: tool missing from the registry`);
        continue;
      }
      if (!d.includes(other)) bad.push(`${self}: does not name its confusable neighbour ${other}`);
    }
  }
  // Every description must state its distinguishing trigger.
  for (const [name, tool] of entries) {
    const d = tool.description || "";
    if (!/Trigger:/.test(d)) bad.push(`${name}: no "Trigger:" clause naming when to reach for it`);
  }
  if (bad.length) fail(`EC4 separability:\n       ${bad.join("\n       ")}`);
  else ok(`EC4 ${pairs.length} confusable pairs cross-reference; every description names its trigger`);
}

// ── The contract doc the descriptions point at must exist ────────────────────
{
  const doc = path.join(root, "docs", "mcp-tool-surface.md");
  if (!fs.existsSync(doc)) {
    fail("docs/mcp-tool-surface.md is missing — descriptions point at it for the moved rationale");
  } else {
    const text = fs.readFileSync(doc, "utf8");
    if (!text.includes(String(PER_DESCRIPTION_CEILING))) {
      fail(`docs/mcp-tool-surface.md does not document the ${PER_DESCRIPTION_CEILING}-byte ceiling`);
    } else {
      ok("docs/mcp-tool-surface.md documents the contract and the ceiling");
    }
  }
}

if (failures) {
  console.error(`\nmcp-tool-descriptions: ${failures} failure(s)`);
  process.exit(1);
}
console.log("mcp-tool-descriptions: all checks passed");
