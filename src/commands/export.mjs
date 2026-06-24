#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { isMainModule, findArchDir, C } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import * as log from "../lib/logger.mjs";
import { loadFile, parseSystem } from "../lib/parsers.mjs";
import {
  compileAgentsMd,
  deriveDownstream,
  agentsTokenReport,
  DOWNSTREAM_FORMATS,
  AGENTS_MD_FILE,
} from "../lib/compile.mjs";

function banner() {
  commandBanner("arch-export", "Export .arch/ context for different AI tools");
}

// ── Exporters ───────────────────────────────────────────────────────
//
// AGENTS.md is the canonical compiled target. Every editor-specific export is
// DERIVED from that one artifact (deriveDownstream) rather than assembled in
// parallel — single source of orientation truth.

// Compile + write the canonical AGENTS.md orientation core.
function exportAgents(archDir, system) {
  log.agent("Compiling AGENTS.md (canonical orientation core)...");

  const content = compileAgentsMd({ archDir, system });
  const report = agentsTokenReport(content);

  fs.writeFileSync(AGENTS_MD_FILE, content);
  log.ok(`${AGENTS_MD_FILE} (${content.length} bytes, ~${report.tokens} tokens)`);
  if (!report.withinCeiling) {
    log.warn(`AGENTS.md is ${report.tokens} tokens — over the ${report.ceiling}-token orientation-core ceiling by ${report.overBy}. Trim .arch/ (SYSTEM Summary / rules / routing).`);
  }

  return { file: AGENTS_MD_FILE, size: content.length, tokens: report.tokens, withinCeiling: report.withinCeiling };
}

// Derive one editor format FROM the compiled AGENTS.md.
function exportDerived(archDir, system, format) {
  const spec = DOWNSTREAM_FORMATS[format];
  log.agent(`Deriving ${spec.file} from AGENTS.md...`);

  const agentsMd = compileAgentsMd({ archDir, system });
  const { file, content } = deriveDownstream(agentsMd, format);

  const dir = path.dirname(file);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(file, content);
  log.ok(`${file} (${content.length} bytes, derived from AGENTS.md)`);
  return { file, size: content.length, derivedFrom: AGENTS_MD_FILE };
}

const exportCursor = (archDir, system) => exportDerived(archDir, system, "cursor");
const exportWindsurf = (archDir, system) => exportDerived(archDir, system, "windsurf");
const exportCopilot = (archDir, system) => exportDerived(archDir, system, "copilot");
const exportAider = (archDir, system) => exportDerived(archDir, system, "aider");

function exportAll(archDir, system) {
  const results = [];
  results.push(exportAgents(archDir, system));
  for (const format of Object.keys(DOWNSTREAM_FORMATS)) {
    results.push(exportDerived(archDir, system, format));
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith("-"));
  const jsonMode = args.includes("--json");

  const archDir = findArchDir({ requireFile: "SYSTEM.md" });
  if (!archDir) {
    if (jsonMode) console.log(JSON.stringify({ error: "No .arch/ directory found. Run archkit first." }));
    else { banner(); log.error("No .arch/ directory found. Run archkit or archkit init first."); }
    process.exit(1);
  }

  const systemContent = loadFile(archDir, "SYSTEM.md");
  if (!systemContent) {
    if (jsonMode) console.log(JSON.stringify({ error: "SYSTEM.md not found in .arch/" }));
    else log.error("SYSTEM.md not found.");
    process.exit(1);
  }

  const system = parseSystem(systemContent);

  if (!jsonMode) banner();

  const exporters = {
    agents: exportAgents,
    cursor: exportCursor,
    windsurf: exportWindsurf,
    copilot: exportCopilot,
    aider: exportAider,
    all: exportAll,
  };

  if (!target || !exporters[target]) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Usage: archkit export <${Object.keys(exporters).join("|")}>`, available: Object.keys(exporters) }));
    } else {
      console.error(`  Usage: archkit export <target>\n`);
      console.error(`  Targets:`);
      console.error(`    agents      Compile AGENTS.md — the canonical orientation core`);
      console.error(`    cursor      Derive .cursorrules from AGENTS.md`);
      console.error(`    windsurf    Derive .windsurfrules from AGENTS.md`);
      console.error(`    copilot     Derive .github/copilot-instructions.md from AGENTS.md`);
      console.error(`    aider       Derive .aider-conventions.md from AGENTS.md`);
      console.error(`    all         AGENTS.md + all derived formats`);
      console.error("");
    }
    process.exit(1);
  }

  const results = exporters[target](archDir, system);

  if (jsonMode) {
    console.log(JSON.stringify({ success: true, exported: Array.isArray(results) ? results : [results] }));
  }
}

export { main };

if (isMainModule(import.meta.url)) {
  main();
}
