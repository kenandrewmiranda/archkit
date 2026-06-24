#!/usr/bin/env node
// Tests for AGENTS.md as the canonical orientation core (agents-md-export).
//
// What this verifies:
//   - compileAgentsMd emits the canonical core: compact Intent + Boundaries
//     (rules + reserved words + BAN directives) + Routing (nodes → files +
//     edges), and stays within the orientation-core token ceiling
//     (exit-criteria 1 & 3)
//   - deriveDownstream produces editor formats FROM the compiled AGENTS.md —
//     the derived body is the canonical body, not an independently-assembled
//     artifact (exit-criterion 2)
//   - `archkit export agents` / `export all` write AGENTS.md + the derived
//     editor files, and the derived files carry the AGENTS.md body
//   - `archkit stats --json` reports the AGENTS.md token report and FLAGS an
//     over-ceiling core with a recommendation (exit-criterion 3 enforcement)

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileAgentsMd,
  deriveDownstream,
  agentsTokenReport,
  AGENTS_MD_TOKEN_CEILING,
  AGENTS_MD_FILE,
  DOWNSTREAM_FORMATS,
} from "../../src/lib/compile.mjs";
import { parseSystem } from "../../src/lib/parsers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; }
}

const SYSTEM = [
  "# SYSTEM.md",
  "## Type: Internal",
  "## Pattern: layered",
  "## Stack: Node.js (ESM)",
  "## Summary",
  "demo app — a small layered service used to exercise the AGENTS.md compiler.",
  "## Rules",
  "- ESM only; no transpile step.",
  "- Libraries stay pure.",
  "## Reserved Words",
  "$arch = the resolved .arch/ directory (found via findArchDir)",
  "$next = the nextStep string every MCP tool result must carry",
  "## Naming",
  "Files: kebab-case",
].join("\n");

const INDEX = [
  "# INDEX.md",
  "## Keywords → Nodes",
  "goal, relay → @cli",
  "parser, pure → @lib",
  "## Nodes → Clusters → Files",
  "@cli → [cli] → src/commands/",
  "@lib → [lib] → src/lib/",
  "## Cross-references",
  "@cli → @lib (commands import pure helpers)",
].join("\n");

const BOUNDARIES = [
  "# BOUNDARIES.md",
  "- NEVER import a command from a pure library. (BAN: src/lib/* -> src/commands/*)",
].join("\n");

function makeArch({ system = SYSTEM, index = INDEX, boundaries = BOUNDARIES } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-agents-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(arch, { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), system);
  if (index) fs.writeFileSync(path.join(arch, "INDEX.md"), index);
  if (boundaries) fs.writeFileSync(path.join(arch, "BOUNDARIES.md"), boundaries);
  return { tmp, arch };
}

// ── compileAgentsMd: canonical core ──────────────────────────────────

test("compileAgentsMd emits Intent + Boundaries + Routing sections", () => {
  const { arch } = makeArch();
  const md = compileAgentsMd({ archDir: arch });
  assert.match(md, /^# AGENTS\.md/);
  assert.match(md, /## Intent/);
  assert.match(md, /## Boundaries/);
  assert.match(md, /## Routing/);
});

test("compileAgentsMd folds in pattern/stack, rules, reserved words, BANs, routing edges", () => {
  const { arch } = makeArch();
  const md = compileAgentsMd({ archDir: arch });
  assert.match(md, /Pattern: layered/);
  assert.match(md, /Stack: Node\.js/);
  assert.match(md, /ESM only/);                       // a rule
  assert.match(md, /\$arch/);                          // a reserved word
  assert.match(md, /BAN: src\/lib\/\* -> src\/commands\/\*/); // machine-enforceable directive
  assert.match(md, /@cli → src\/commands\//);          // node → path routing
  assert.match(md, /Edges: .*@cli→@lib/);              // cross-ref edges
});

test("compileAgentsMd accepts a pre-parsed system (no double parse)", () => {
  const { arch } = makeArch();
  const sys = parseSystem(fs.readFileSync(path.join(arch, "SYSTEM.md"), "utf8"));
  const md = compileAgentsMd({ archDir: arch, system: sys });
  assert.match(md, /## Intent/);
});

test("compiled AGENTS.md stays within the orientation-core token ceiling", () => {
  const { arch } = makeArch();
  const md = compileAgentsMd({ archDir: arch });
  const report = agentsTokenReport(md);
  assert.equal(report.ceiling, AGENTS_MD_TOKEN_CEILING);
  assert.ok(report.withinCeiling, `expected within ceiling, got ${report.tokens}/${report.ceiling}`);
  assert.equal(report.overBy, 0);
});

test("agentsTokenReport flags an over-ceiling core", () => {
  const huge = "# AGENTS.md\n" + "padding word ".repeat(3000);
  const report = agentsTokenReport(huge);
  assert.equal(report.withinCeiling, false);
  assert.ok(report.overBy > 0);
  assert.ok(report.tokens > AGENTS_MD_TOKEN_CEILING);
});

// ── deriveDownstream: derived FROM AGENTS.md ─────────────────────────

test("deriveDownstream derives each editor format FROM the AGENTS.md body", () => {
  const { arch } = makeArch();
  const md = compileAgentsMd({ archDir: arch });
  // The canonical body sans the AGENTS.md H1 must appear verbatim in every
  // derived format — proving derivation, not parallel emission.
  const canonicalBody = md.replace(/^# AGENTS\.md\n?/, "").trimStart();
  for (const [format, spec] of Object.entries(DOWNSTREAM_FORMATS)) {
    const { file, content } = deriveDownstream(md, format);
    assert.equal(file, spec.file);
    assert.ok(content.includes(canonicalBody), `${format} should carry the canonical AGENTS.md body`);
    assert.match(content, new RegExp(`Derived by archkit from AGENTS\\.md`));
    assert.match(content, new RegExp(spec.tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("deriveDownstream rejects an unknown format", () => {
  assert.throws(() => deriveDownstream("# AGENTS.md\n", "nope"), /Unknown downstream format/);
});

// ── CLI: export agents / export all ──────────────────────────────────

test("`export agents` writes AGENTS.md within ceiling (--json report)", () => {
  const { tmp } = makeArch();
  const out = execFileSync(process.execPath, [ARCHKIT, "export", "agents", "--json"], { cwd: tmp, encoding: "utf8" });
  const res = JSON.parse(out);
  assert.equal(res.success, true);
  const agents = res.exported.find(e => e.file === AGENTS_MD_FILE);
  assert.ok(agents, "AGENTS.md should be in the export result");
  assert.equal(agents.withinCeiling, true);
  assert.ok(fs.existsSync(path.join(tmp, AGENTS_MD_FILE)));
});

test("`export all` writes AGENTS.md + every derived file, each marked derivedFrom AGENTS.md", () => {
  const { tmp } = makeArch();
  const out = execFileSync(process.execPath, [ARCHKIT, "export", "all", "--json"], { cwd: tmp, encoding: "utf8" });
  const res = JSON.parse(out);
  const files = res.exported.map(e => e.file);
  assert.ok(files.includes(AGENTS_MD_FILE));
  for (const spec of Object.values(DOWNSTREAM_FORMATS)) {
    assert.ok(files.includes(spec.file), `missing ${spec.file}`);
    const written = fs.readFileSync(path.join(tmp, spec.file), "utf8");
    // Derived file carries the canonical body's distinctive routing line.
    assert.match(written, /@cli → src\/commands\//);
  }
  const derived = res.exported.filter(e => e.derivedFrom);
  assert.equal(derived.length, Object.keys(DOWNSTREAM_FORMATS).length);
  derived.forEach(d => assert.equal(d.derivedFrom, AGENTS_MD_FILE));
});

// ── stats: token-ceiling enforcement ─────────────────────────────────

test("`stats --json` reports AGENTS.md within ceiling for a lean spec", () => {
  const { tmp } = makeArch();
  const out = execFileSync(process.execPath, [ARCHKIT, "stats", "--json"], { cwd: tmp, encoding: "utf8" });
  const res = JSON.parse(out);
  assert.ok(res.agents, "stats should include an agents slice");
  assert.equal(res.agents.file, AGENTS_MD_FILE);
  assert.equal(res.agents.withinCeiling, true);
  assert.equal(res.agents.ceiling, AGENTS_MD_TOKEN_CEILING);
});

test("`stats --json` flags an over-ceiling AGENTS.md with a recommendation", () => {
  // A bloated SYSTEM Summary pushes the compiled core past the ceiling.
  const bloatedSummary = "## Summary\n" + "this orientation core is deliberately far too verbose. ".repeat(250);
  const system = SYSTEM.replace("## Summary\ndemo app — a small layered service used to exercise the AGENTS.md compiler.", bloatedSummary);
  const { tmp } = makeArch({ system });
  const out = execFileSync(process.execPath, [ARCHKIT, "stats", "--json"], { cwd: tmp, encoding: "utf8" });
  const res = JSON.parse(out);
  assert.equal(res.agents.withinCeiling, false);
  assert.ok(res.agents.overBy > 0);
  assert.ok(
    res.recommendations.some(r => /AGENTS\.md/.test(r) && /ceiling/.test(r)),
    `expected an over-ceiling recommendation, got: ${JSON.stringify(res.recommendations)}`
  );
});

console.log(`\n${passed}/${passed + failed} passed.`);
if (failed) process.exit(1);
