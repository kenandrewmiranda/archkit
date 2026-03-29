#!/usr/bin/env node

/**
 * arch-stats — Show coverage and health of your .arch/ context system
 * 
 * Usage:
 *   node stats.mjs              Full dashboard
 *   node stats.mjs --skills     Skills coverage only
 *   node stats.mjs --graphs     Graph coverage only  
 *   node stats.mjs --stale      Show stale/empty files that need attention
 */

import fs from "fs";
import path from "path";
import { C, ICONS as I, findArchDir as _findArchDir, divider } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";

function banner() {
  commandBanner("arch-stats", "Context engineering health dashboard");
}

function findArchDir() {
  return _findArchDir({ requireFile: "SYSTEM.md" });
}

function progressBar(filled, total, width = 20) {
  if (total === 0) return `${C.gray}${"░".repeat(width)}${C.reset}`;
  const ratio = Math.min(filled / total, 1);
  const filledWidth = Math.round(ratio * width);
  const emptyWidth = width - filledWidth;
  const color = ratio >= 0.7 ? C.green : ratio >= 0.3 ? C.yellow : C.red;
  return `${color}${"█".repeat(filledWidth)}${C.gray}${"░".repeat(emptyWidth)}${C.reset}`;
}

// ── Analysis functions ──────────────────────────────────────────────────

function analyzeSystem(archDir) {
  const fp = path.join(archDir, "SYSTEM.md");
  if (!fs.existsSync(fp)) return { exists: false };
  const content = fs.readFileSync(fp, "utf8");
  const rules = (content.match(/^- .+/gm) || []).length;
  const reserved = (content.match(/^\$.+=/gm) || []).length;
  const hasNaming = content.includes("## Naming");
  const hasOnGenerate = content.includes("## On Generate");
  return { exists: true, rules, reserved, hasNaming, hasOnGenerate, size: content.length };
}

function analyzeIndex(archDir) {
  const fp = path.join(archDir, "INDEX.md");
  if (!fs.existsSync(fp)) return { exists: false };
  const content = fs.readFileSync(fp, "utf8");
  const nodeRoutes = (content.match(/→ @\w+/g) || []).length;
  const skillRoutes = (content.match(/→ \$\w+/g) || []).length;
  const crossRefs = (content.match(/^@\w+ → @\w+/gm) || []).length;
  const hasTODO = content.includes("TODO");
  return { exists: true, nodeRoutes, skillRoutes, crossRefs, hasTODO, size: content.length };
}

function analyzeSkills(archDir) {
  const dir = path.join(archDir, "skills");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".skill")).map(f => {
    const id = f.replace(".skill", "");
    const content = fs.readFileSync(path.join(dir, f), "utf8");
    const gotchas = (content.match(/^WRONG:/gm) || []).length;
    const realGotchas = gotchas - (content.match(/^WRONG: \[/gm) || []).length; // Subtract placeholder gotchas
    const hasUse = content.includes("## Use") && !content.includes("[How YOUR");
    const hasPatterns = content.includes("## Patterns") && !content.includes("[Import paths");
    const hasSnippets = content.includes("## Snippets") && !content.includes("[2-3 ");
    const hasBoundaries = content.includes("## Boundaries") && !content.includes("[What ");
    const hasMeta = content.includes("## Meta") && !content.includes("[PACKAGE_NAME]");

    const completeness = [hasMeta, hasUse, hasPatterns, realGotchas > 0, hasBoundaries, hasSnippets].filter(Boolean).length;

    return { id, gotchas: realGotchas, hasUse, hasPatterns, hasSnippets, hasBoundaries, hasMeta, completeness, maxCompleteness: 6, size: content.length };
  });
}

function analyzeGraphs(archDir) {
  const dir = path.join(archDir, "clusters");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".graph")).map(f => {
    const id = f.replace(".graph", "");
    const content = fs.readFileSync(path.join(dir, f), "utf8");
    const nodes = (content.match(/\[.+\]\s+:/g) || []).length;
    const hasSubscribers = !content.includes("[subscribers]");
    return { id, nodes, hasSubscribers, size: content.length };
  });
}

function analyzeApis(archDir) {
  const dir = path.join(archDir, "apis");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".api")).map(f => {
    const id = f.replace(".api", "");
    const content = fs.readFileSync(path.join(dir, f), "utf8");
    const endpoints = (content.match(/^(?:GET|POST|PUT|PATCH|DEL|DELETE)\s+/gm) || []).length;
    const types = (content.match(/^\w+ = \{/gm) || []).length;
    const isStub = content.includes("[VERSION]") || content.includes("[BASE_URL]");
    return { id, endpoints, types, isStub, size: content.length };
  });
}

// ── Display functions ───────────────────────────────────────────────────

function displaySystemHealth(sys) {
  console.log(`${C.cyan}${C.bold}  SYSTEM.md${C.reset}`);
  if (!sys.exists) {
    console.log(`  ${C.red}${I.cross} Not found${C.reset}`);
    return;
  }
  console.log(`  ${C.green}${I.check}${C.reset} ${sys.rules} rules | ${sys.reserved} reserved words | ${sys.size} bytes`);
  if (!sys.hasNaming) console.log(`  ${C.yellow}${I.warn} Missing ## Naming section${C.reset}`);
  if (!sys.hasOnGenerate) console.log(`  ${C.yellow}${I.warn} Missing ## On Generate section${C.reset}`);
}

function displayIndexHealth(idx) {
  console.log(`${C.cyan}${C.bold}  INDEX.md${C.reset}`);
  if (!idx.exists) {
    console.log(`  ${C.red}${I.cross} Not found${C.reset}`);
    return;
  }
  console.log(`  ${C.green}${I.check}${C.reset} ${idx.nodeRoutes} node routes | ${idx.skillRoutes} skill routes | ${idx.crossRefs} cross-refs`);
  if (idx.hasTODO) console.log(`  ${C.yellow}${I.warn} Has unresolved TODO items — fill in cross-refs${C.reset}`);
  if (idx.crossRefs === 0) console.log(`  ${C.yellow}${I.warn} No cross-references defined — map feature dependencies${C.reset}`);
}

function displaySkillsHealth(skills) {
  console.log(`${C.cyan}${C.bold}  Skills (${skills.length} files)${C.reset}`);
  if (skills.length === 0) {
    console.log(`  ${C.gray}No skill files found.${C.reset}`);
    return;
  }

  const totalGotchas = skills.reduce((s, sk) => s + sk.gotchas, 0);
  const avgCompleteness = skills.reduce((s, sk) => s + sk.completeness, 0) / skills.length;

  console.log(`  ${totalGotchas} total gotchas | avg completeness: ${(avgCompleteness / 6 * 100).toFixed(0)}%`);
  console.log("");

  // Header
  console.log(`  ${C.gray}${"Skill".padEnd(18)} Gotchas  Completeness         Status${C.reset}`);
  console.log(`  ${C.gray}${"─".repeat(62)}${C.reset}`);

  for (const sk of skills.sort((a, b) => a.completeness - b.completeness)) {
    const bar = progressBar(sk.completeness, sk.maxCompleteness, 12);
    const pct = `${((sk.completeness / sk.maxCompleteness) * 100).toFixed(0)}%`.padStart(4);

    let status;
    if (sk.completeness === 0) status = `${C.red}skeleton — needs all sections filled${C.reset}`;
    else if (sk.completeness <= 2) status = `${C.yellow}partial — fill remaining sections${C.reset}`;
    else if (sk.gotchas === 0) status = `${C.yellow}no gotchas yet — add WRONG/RIGHT/WHY${C.reset}`;
    else if (sk.completeness < sk.maxCompleteness) status = `${C.blue}good — ${sk.maxCompleteness - sk.completeness} section${sk.maxCompleteness - sk.completeness > 1 ? "s" : ""} remaining${C.reset}`;
    else status = `${C.green}complete${C.reset}`;

    const gotchaStr = sk.gotchas > 0 ? `${C.green}${sk.gotchas.toString().padStart(4)}${C.reset}` : `${C.gray}   0${C.reset}`;

    console.log(`  ${sk.id.padEnd(18)} ${gotchaStr}     ${bar} ${pct}  ${status}`);
  }

  // Highlight empty skills
  const empty = skills.filter(sk => sk.completeness === 0);
  if (empty.length > 0) {
    console.log("");
    console.log(`  ${C.yellow}${I.warn} ${empty.length} skill${empty.length > 1 ? "s are" : " is"} still skeleton${empty.length > 1 ? "s" : ""}:${C.reset}`);
    console.log(`  ${C.gray}  ${empty.map(s => s.id).join(", ")}${C.reset}`);
    console.log(`  ${C.dim}  Fill these in as you encounter gotchas, or run:${C.reset}`);
    console.log(`  ${C.cyan}  node gotcha.mjs --interactive${C.reset}`);
  }
}

function displayGraphsHealth(graphs) {
  console.log(`${C.cyan}${C.bold}  Graphs (${graphs.length} files)${C.reset}`);
  if (graphs.length === 0) {
    console.log(`  ${C.gray}No graph files found.${C.reset}`);
    return;
  }

  const totalNodes = graphs.reduce((s, g) => s + g.nodes, 0);
  console.log(`  ${totalNodes} total nodes across ${graphs.length} clusters`);
  console.log("");

  console.log(`  ${C.gray}${"Cluster".padEnd(18)} Nodes  Status${C.reset}`);
  console.log(`  ${C.gray}${"─".repeat(50)}${C.reset}`);

  for (const g of graphs) {
    const nodeStr = g.nodes.toString().padStart(5);
    let status;
    if (g.nodes === 0) status = `${C.red}empty — define nodes${C.reset}`;
    else if (g.id === "events" && !g.hasSubscribers) status = `${C.yellow}events have [subscribers] placeholders${C.reset}`;
    else status = `${C.green}${I.check}${C.reset}`;
    console.log(`  ${g.id.padEnd(18)} ${nodeStr}  ${status}`);
  }
}

function displayApisHealth(apis) {
  if (apis.length === 0) return;
  console.log(`${C.cyan}${C.bold}  API Contracts (${apis.length} files)${C.reset}`);
  console.log("");

  console.log(`  ${C.gray}${"API".padEnd(18)} Endpoints  Types  Status${C.reset}`);
  console.log(`  ${C.gray}${"─".repeat(55)}${C.reset}`);

  for (const a of apis) {
    const epStr = a.endpoints.toString().padStart(6);
    const tyStr = a.types.toString().padStart(5);
    const status = a.isStub ? `${C.yellow}stub — fill from OpenAPI/SDK${C.reset}` : `${C.green}${I.check} populated${C.reset}`;
    console.log(`  ${a.id.padEnd(18)} ${epStr}  ${tyStr}  ${status}`);
  }
}

function calculateHealthScore(sys, idx, skills, graphs, apis) {
  let score = 0;
  const checks = [];

  // SYSTEM.md (max 10)
  if (sys.exists) {
    const s = Math.min(10, 4 + (sys.rules > 0 ? 2 : 0) + (sys.reserved > 0 ? 2 : 0) + (sys.hasNaming ? 1 : 0) + (sys.hasOnGenerate ? 1 : 0));
    score += s;
    checks.push({ name: "SYSTEM.md", score: s, max: 10 });
  } else checks.push({ name: "SYSTEM.md", score: 0, max: 10 });

  // INDEX.md (max 10)
  if (idx.exists) {
    const s = 3 + (idx.nodeRoutes > 0 ? 2 : 0) + (idx.skillRoutes > 0 ? 2 : 0) + (idx.crossRefs > 0 ? 3 : 0);
    score += s;
    checks.push({ name: "INDEX.md", score: s, max: 10 });
  } else checks.push({ name: "INDEX.md", score: 0, max: 10 });

  // Skills (max 30)
  if (skills.length > 0) {
    const avgComp = skills.reduce((s, sk) => s + sk.completeness / sk.maxCompleteness, 0) / skills.length;
    const totalGotchas = skills.reduce((s, sk) => s + sk.gotchas, 0);
    let ss = Math.round(avgComp * 15);
    if (totalGotchas >= 5) ss += 5;
    if (totalGotchas >= 15) ss += 5;
    if (totalGotchas >= 30) ss += 5;
    ss = Math.min(30, ss);
    score += ss;
    checks.push({ name: "Skills", score: ss, max: 30 });
  } else checks.push({ name: "Skills", score: 0, max: 30 });

  // Graphs (max 20)
  if (graphs.length > 0) {
    const totalNodes = graphs.reduce((s, g) => s + g.nodes, 0);
    let gs = 5;
    if (totalNodes >= 5) gs += 5;
    if (totalNodes >= 15) gs += 5;
    if (totalNodes >= 30) gs += 5;
    gs = Math.min(20, gs);
    score += gs;
    checks.push({ name: "Graphs", score: gs, max: 20 });
  } else checks.push({ name: "Graphs", score: 0, max: 20 });

  // APIs (max 10)
  if (apis.length > 0) {
    const populated = apis.filter(a => !a.isStub).length;
    const s = Math.round((populated / apis.length) * 10);
    score += s;
    checks.push({ name: "APIs", score: s, max: 10 });
  } else checks.push({ name: "APIs", score: 0, max: 10 });

  const pct = Math.round((score / 80) * 100);
  return { score, pct, checks };
}

function displayOverallScore(sys, idx, skills, graphs, apis) {
  console.log(`${C.cyan}${C.bold}  Overall Health Score${C.reset}`);
  console.log("");

  const { pct, checks } = calculateHealthScore(sys, idx, skills, graphs, apis);

  // Display score bar
  const barWidth = 30;
  const filled = Math.round((pct / 100) * barWidth);
  const color = pct >= 70 ? C.green : pct >= 40 ? C.yellow : C.red;
  console.log(`  ${color}${C.bold}${pct}%${C.reset} ${color}${"█".repeat(filled)}${C.gray}${"░".repeat(barWidth - filled)}${C.reset}`);
  console.log("");

  // Per-category
  for (const ch of checks) {
    const cpct = ch.max > 0 ? Math.round((ch.score / ch.max) * 100) : 0;
    const bar = progressBar(ch.score, ch.max, 10);
    console.log(`  ${ch.name.padEnd(12)} ${bar} ${cpct.toString().padStart(3)}% ${C.dim}(${ch.score}/${ch.max})${C.reset}`);
  }

  console.log("");

  // Recommendations
  const recs = [];
  if (!sys.exists) recs.push("Run archkit to generate SYSTEM.md");
  if (!idx.exists) recs.push("Run archkit to generate INDEX.md");
  if (idx.exists && idx.crossRefs === 0) recs.push("Add cross-references to INDEX.md (which features depend on which)");
  if (skills.length > 0) {
    const empty = skills.filter(s => s.completeness === 0);
    if (empty.length > 0) recs.push(`Fill in ${empty.length} skeleton skill${empty.length > 1 ? "s" : ""}: ${empty.slice(0, 3).map(s => s.id).join(", ")}${empty.length > 3 ? "..." : ""}`);
    const noGotchas = skills.filter(s => s.gotchas === 0 && s.completeness > 0);
    if (noGotchas.length > 0) recs.push(`Add gotchas to: ${noGotchas.slice(0, 3).map(s => s.id).join(", ")} — run: node gotcha.mjs -i`);
  }
  if (apis.length > 0) {
    const stubs = apis.filter(a => a.isStub);
    if (stubs.length > 0) recs.push(`Populate ${stubs.length} API stub${stubs.length > 1 ? "s" : ""}: ${stubs.map(a => a.id).join(", ")}`);
  }

  if (recs.length > 0) {
    console.log(`  ${C.yellow}${C.bold}Recommendations:${C.reset}`);
    recs.forEach((r, i) => console.log(`  ${C.yellow}${i + 1}.${C.reset} ${r}`));
  } else {
    console.log(`  ${C.green}${C.bold}${I.star} System is well-maintained!${C.reset}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  const archDir = findArchDir();
  if (!archDir) {
    banner();
    console.log(`${C.red}  ${I.warn} Cannot find .arch/ directory.${C.reset}`);
    console.log(`${C.gray}  Run archkit first, or run this from your project root.${C.reset}\n`);
    process.exit(1);
  }

  const sys = analyzeSystem(archDir);
  const idx = analyzeIndex(archDir);
  const skills = analyzeSkills(archDir);
  const graphs = analyzeGraphs(archDir);
  const apis = analyzeApis(archDir);

  // Compact mode: one-line summary for git hooks and session start
  if (args.includes("--compact")) {
    const totalGotchas = skills.reduce((s, sk) => s + sk.gotchas, 0);
    const totalNodes = graphs.reduce((s, g) => s + g.nodes, 0);
    const emptySkills = skills.filter(s => s.completeness === 0).length;
    const { pct } = calculateHealthScore(sys, idx, skills, graphs, apis);

    const color = pct >= 70 ? C.green : pct >= 40 ? C.yellow : C.red;
    console.log(`${C.cyan}  ${I.arch}${C.reset} .arch/ health: ${color}${C.bold}${pct}%${C.reset} ${C.dim}| ${graphs.length} graphs (${totalNodes} nodes) | ${skills.length} skills (${totalGotchas} gotchas) | ${emptySkills > 0 ? `${C.yellow}${emptySkills} empty${C.reset}${C.dim}` : "all configured"}${C.reset}`);
    return;
  }

  banner();
  console.log(`${C.gray}  Reading .arch/ from ${archDir}${C.reset}`);
  console.log("");

  const showAll = args.length === 0;

  if (showAll || args.includes("--skills")) {
    displaySkillsHealth(skills);
    console.log("");
    divider();
    console.log("");
  }

  if (showAll || args.includes("--graphs")) {
    displayGraphsHealth(graphs);
    console.log("");
    divider();
    console.log("");
  }

  if (showAll) {
    displaySystemHealth(sys);
    console.log("");
    displayIndexHealth(idx);
    console.log("");
    if (apis.length > 0) {
      displayApisHealth(apis);
      console.log("");
    }
    divider();
    console.log("");
  }

  if (showAll || args.includes("--stale")) {
    displayOverallScore(sys, idx, skills, graphs, apis);
    console.log("");
  }
}

main();
