#!/usr/bin/env node

/**
 * arch-review — Check code against your .arch/ rules and skills
 * 
 * Usage:
 *   node review.mjs <file>                   Review a single file
 *   node review.mjs <file1> <file2> ...      Review multiple files
 *   node review.mjs --staged                 Review git staged files
 *   node review.mjs --dir src/features/      Review all files in a directory
 * 
 * What it checks:
 *   - SYSTEM.md rules (architecture violations)
 *   - .skill gotchas (known bad patterns)
 *   - .graph boundaries (cross-feature imports)
 *   - Reserved word conventions ($tenant, $err, etc.)
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { C, ICONS as I, findArchDir as _findArchDir } from "./lib/shared.mjs";

function banner() {
  console.log("");
  console.log(`${C.cyan}${C.bold}  ${I.arch} arch-review${C.reset}`);
  console.log(`${C.gray}  Check code against your .arch/ rules and skills${C.reset}`);
  console.log("");
}

function findArchDir() {
  return _findArchDir({ requireFile: "SYSTEM.md" });
}

// ── Load .arch/ context ─────────────────────────────────────────────────

function loadSystem(archDir) {
  const fp = path.join(archDir, "SYSTEM.md");
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf8");
}

function loadSkills(archDir) {
  const skillsDir = path.join(archDir, "skills");
  if (!fs.existsSync(skillsDir)) return {};
  const skills = {};
  for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))) {
    const id = file.replace(".skill", "");
    const content = fs.readFileSync(path.join(skillsDir, file), "utf8");
    const gotchas = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("WRONG:")) {
        const wrong = lines[i].replace("WRONG:", "").trim();
        const right = (lines[i + 1] || "").replace("RIGHT:", "").trim();
        const why = (lines[i + 2] || "").replace("WHY:", "").trim();
        if (wrong && !wrong.startsWith("[")) {
          gotchas.push({ wrong, right, why });
        }
      }
    }
    skills[id] = { content, gotchas };
  }
  return skills;
}

function loadGraphs(archDir) {
  const clustersDir = path.join(archDir, "clusters");
  if (!fs.existsSync(clustersDir)) return {};
  const graphs = {};
  for (const file of fs.readdirSync(clustersDir).filter(f => f.endsWith(".graph"))) {
    const id = file.replace(".graph", "");
    graphs[id] = fs.readFileSync(path.join(clustersDir, file), "utf8");
  }
  return graphs;
}

function parseRules(systemContent) {
  if (!systemContent) return [];
  const rules = [];
  const lines = systemContent.split("\n");
  let inRules = false;
  for (const line of lines) {
    if (line.startsWith("## Rules")) { inRules = true; continue; }
    if (line.startsWith("## ") && inRules) { inRules = false; continue; }
    if (inRules && line.startsWith("- ")) {
      rules.push(line.replace(/^- /, "").trim());
    }
  }
  return rules;
}

function parseReservedWords(systemContent) {
  if (!systemContent) return {};
  const words = {};
  const lines = systemContent.split("\n");
  let inReserved = false;
  for (const line of lines) {
    if (line.startsWith("## Reserved Words")) { inReserved = true; continue; }
    if (line.startsWith("## ") && inReserved) { inReserved = false; continue; }
    if (inReserved && line.includes(" = ")) {
      const [key, ...rest] = line.split(" = ");
      words[key.trim()] = rest.join(" = ").trim();
    }
  }
  return words;
}

// ── Checks ──────────────────────────────────────────────────────────────

function checkGotchas(code, skills) {
  const findings = [];
  for (const [skillId, skill] of Object.entries(skills)) {
    for (const gotcha of skill.gotchas) {
      if (code.includes(gotcha.wrong)) {
        findings.push({
          severity: "error",
          type: "gotcha",
          skill: skillId,
          message: `Known bad pattern: ${gotcha.wrong}`,
          fix: `Replace with: ${gotcha.right}`,
          reason: gotcha.why,
          pattern: gotcha.wrong,
        });
      }
    }
  }
  return findings;
}

function checkArchitectureRules(code, filepath, rules, reservedWords) {
  const findings = [];
  const filename = path.basename(filepath);
  const dir = path.dirname(filepath);

  // Check: business logic in controller
  if (filename.includes("controller") || filename.includes("Cont")) {
    // Look for direct DB imports/calls
    const dbPatterns = [/prisma\./g, /\.query\(/g, /\.findMany\(/g, /\.create\(/g, /pool\./g, /knex\(/g];
    for (const pat of dbPatterns) {
      if (pat.test(code)) {
        findings.push({
          severity: "warning",
          type: "architecture",
          message: "Possible direct database call in controller",
          fix: "Controllers should delegate to services. Move DB logic to the service layer.",
          reason: "Rule: Controllers thin. Services own logic. Repos own DB.",
        });
        break;
      }
    }

    // Look for complex business logic (many if/else, switch)
    const ifCount = (code.match(/\bif\s*\(/g) || []).length;
    if (ifCount > 5) {
      findings.push({
        severity: "warning",
        type: "architecture",
        message: `Controller has ${ifCount} conditional branches — possible business logic leak`,
        fix: "Extract complex logic to the service layer. Controller should validate, delegate, respond.",
        reason: "Rule: Controllers thin.",
      });
    }
  }

  // Check: repo returning raw rows
  if (filename.includes("repository") || filename.includes("Repo")) {
    if (code.includes("rows[0]") || code.includes(".rows") || code.includes("result.rows")) {
      findings.push({
        severity: "info",
        type: "architecture",
        message: "Repository may be returning raw database rows",
        fix: "Map raw rows to typed domain objects before returning.",
        reason: "Repos should return typed domain objects, never raw rows.",
      });
    }
  }

  // Check: missing tenant scoping
  if (reservedWords["$tenant"]) {
    if ((filename.includes("repository") || filename.includes("Repo") || filename.includes("repo"))
        && !code.includes("tenant") && !code.includes("TENANT") && (code.includes("SELECT") || code.includes("findMany") || code.includes(".query"))) {
      // Only flag if there are actual queries but no tenant reference
      const hasQuery = /SELECT|findMany|findFirst|\.query|\.where/i.test(code);
      const hasTenant = /tenant/i.test(code);
      if (hasQuery && !hasTenant) {
        findings.push({
          severity: "error",
          type: "architecture",
          message: "Database query without tenant scoping detected",
          fix: "Include $tenant (tenant_id) in all database queries. RLS is safety net, not primary filter.",
          reason: "Rule: All DB queries include $tenant.",
        });
      }
    }
  }

  // Check: cross-feature imports
  const importMatches = code.matchAll(/(?:import|require)\s*(?:\(|{|\s).*?(?:from\s+)?['"]([^'"]+)['"]/g);
  for (const match of importMatches) {
    const importPath = match[1];
    if (importPath.includes("features/")) {
      // Extract the feature being imported from
      const importFeature = importPath.split("features/")[1]?.split("/")[0];
      // Extract the current feature
      const currentParts = filepath.split("features/");
      const currentFeature = currentParts.length > 1 ? currentParts[1].split("/")[0] : null;

      if (importFeature && currentFeature && importFeature !== currentFeature) {
        findings.push({
          severity: "warning",
          type: "boundary",
          message: `Cross-feature import: ${currentFeature} → ${importFeature}`,
          fix: `Use a shared interface instead of direct import. Create ${importFeature}.interface.ts`,
          reason: "Rule: Features never import across boundaries. Cross-feature = shared interface.",
        });
      }
    }
  }

  // Check: floating point money
  if (reservedWords["$money"]) {
    const floatMoney = /(?:price|amount|cost|total|subtotal|tax|discount|balance|revenue)\s*[:=]\s*[\d]+\.[\d]+/gi;
    if (floatMoney.test(code)) {
      findings.push({
        severity: "error",
        type: "convention",
        message: "Floating point value for money detected",
        fix: "Use integer cents via $money type. 19.99 → 1999. Never floating point.",
        reason: "Rule: ALL money in cents (integer). Never float.",
      });
    }
  }

  // Check: inline error strings instead of typed errors
  if (reservedWords["$err"]) {
    const inlineErrors = /throw new Error\(['"`]/g;
    const matches = code.match(inlineErrors);
    if (matches && matches.length > 0) {
      findings.push({
        severity: "info",
        type: "convention",
        message: `${matches.length} generic Error throw(s) — should use typed $err classes`,
        fix: "Replace throw new Error('...') with throw new NotFoundError(...) or ValidationError(...)",
        reason: "Rule: Errors use $err types. Centralized handler formats response.",
      });
    }
  }

  return findings;
}

function checkFileLocation(filepath, graphs) {
  const findings = [];
  // Check if file is in a known cluster location
  const parts = filepath.split("/");
  const featuresIdx = parts.indexOf("features");
  if (featuresIdx !== -1 && parts[featuresIdx + 1]) {
    const feature = parts[featuresIdx + 1];
    const hasGraph = Object.keys(graphs).includes(feature);
    if (!hasGraph) {
      findings.push({
        severity: "info",
        type: "coverage",
        message: `Feature "${feature}" has no .graph file in .arch/clusters/`,
        fix: `Create ${feature}.graph to define its architecture nodes and dependencies.`,
        reason: "Every feature should have a graph for AI context resolution.",
      });
    }
  }
  return findings;
}

// ── File collection ─────────────────────────────────────────────────────

function getFiles(args) {
  const files = [];

  if (args.includes("--staged")) {
    try {
      const staged = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" });
      files.push(...staged.trim().split("\n").filter(f => f && (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".py"))));
    } catch {
      console.log(`${C.red}  ${I.warn} Not a git repository or no staged files.${C.reset}`);
    }
    return files;
  }

  if (args.includes("--dir")) {
    const dirIdx = args.indexOf("--dir");
    const dir = args[dirIdx + 1];
    if (dir && fs.existsSync(dir)) {
      const walk = (d) => {
        for (const item of fs.readdirSync(d, { withFileTypes: true })) {
          if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules") {
            walk(path.join(d, item.name));
          } else if (item.isFile() && /\.(ts|tsx|js|mjs|py)$/.test(item.name)) {
            files.push(path.join(d, item.name));
          }
        }
      };
      walk(dir);
    }
    return files;
  }

  // Direct file arguments
  for (const arg of args.filter(a => !a.startsWith("-"))) {
    if (fs.existsSync(arg)) files.push(arg);
  }

  return files;
}

// ── Display ─────────────────────────────────────────────────────────────

function displayFindings(filepath, findings) {
  if (findings.length === 0) {
    console.log(`${C.green}  ${I.check} ${filepath}${C.reset} ${C.dim}— clean${C.reset}`);
    return;
  }

  const errors = findings.filter(f => f.severity === "error");
  const warnings = findings.filter(f => f.severity === "warning");
  const infos = findings.filter(f => f.severity === "info");

  console.log("");
  console.log(`  ${C.bold}${filepath}${C.reset}`);

  const summary = [];
  if (errors.length) summary.push(`${C.red}${errors.length} error${errors.length > 1 ? "s" : ""}${C.reset}`);
  if (warnings.length) summary.push(`${C.yellow}${warnings.length} warning${warnings.length > 1 ? "s" : ""}${C.reset}`);
  if (infos.length) summary.push(`${C.blue}${infos.length} info${C.reset}`);
  console.log(`  ${summary.join("  ")}`);
  console.log("");

  for (const f of findings) {
    const color = f.severity === "error" ? C.red : f.severity === "warning" ? C.yellow : C.blue;
    const icon = f.severity === "error" ? I.cross : f.severity === "warning" ? I.warn : I.dot;

    console.log(`  ${color}${icon} ${f.severity.toUpperCase()}${C.reset} ${C.dim}[${f.type}]${C.reset}`);
    console.log(`    ${f.message}`);
    console.log(`    ${C.green}Fix: ${f.fix}${C.reset}`);
    if (f.reason) console.log(`    ${C.dim}${f.reason}${C.reset}`);
    console.log("");
  }
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    banner();
    console.log(`${C.yellow}  Usage:${C.reset}`);
    console.log(`${C.gray}    node review.mjs <file>                   Review a single file${C.reset}`);
    console.log(`${C.gray}    node review.mjs <file1> <file2>          Review multiple files${C.reset}`);
    console.log(`${C.gray}    node review.mjs --staged                 Review git staged files${C.reset}`);
    console.log(`${C.gray}    node review.mjs --dir src/features/      Review a directory${C.reset}`);
    console.log("");
    console.log(`${C.yellow}  What it checks:${C.reset}`);
    console.log(`${C.gray}    ${I.dot} .skill gotchas — known bad patterns from your team's experience${C.reset}`);
    console.log(`${C.gray}    ${I.dot} Architecture rules — controller/service/repo layer violations${C.reset}`);
    console.log(`${C.gray}    ${I.dot} Boundary violations — cross-feature imports${C.reset}`);
    console.log(`${C.gray}    ${I.dot} Convention checks — money as float, generic errors, missing tenant${C.reset}`);
    console.log(`${C.gray}    ${I.dot} Coverage gaps — features without .graph files${C.reset}`);
    console.log("");
    process.exit(0);
  }

  banner();

  const archDir = findArchDir();
  if (!archDir) {
    console.log(`${C.red}  ${I.warn} Cannot find .arch/ directory.${C.reset}`);
    console.log(`${C.gray}  Run archkit first, or run this from your project root.${C.reset}\n`);
    process.exit(1);
  }

  console.log(`${C.gray}  Loading .arch/ context from ${archDir}${C.reset}`);

  const systemContent = loadSystem(archDir);
  const rules = parseRules(systemContent);
  const reservedWords = parseReservedWords(systemContent);
  const skills = loadSkills(archDir);
  const graphs = loadGraphs(archDir);

  const gotchaCount = Object.values(skills).reduce((s, sk) => s + sk.gotchas.length, 0);
  console.log(`${C.gray}  ${rules.length} rules | ${Object.keys(skills).length} skills (${gotchaCount} gotchas) | ${Object.keys(graphs).length} graphs${C.reset}`);
  console.log("");

  const files = getFiles(args);
  if (files.length === 0) {
    console.log(`${C.yellow}  ${I.warn} No files to review.${C.reset}\n`);
    process.exit(0);
  }

  console.log(`${C.cyan}  Reviewing ${files.length} file${files.length > 1 ? "s" : ""}...${C.reset}`);

  const agentMode = args.includes("--agent");
  const allFindings = {};
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;
  let cleanFiles = 0;

  for (const filepath of files) {
    const code = fs.readFileSync(filepath, "utf8");
    const findings = [
      ...checkGotchas(code, skills),
      ...checkArchitectureRules(code, filepath, rules, reservedWords),
      ...checkFileLocation(filepath, graphs),
    ];

    if (agentMode) {
      allFindings[filepath] = findings;
    } else {
      displayFindings(filepath, findings);
    }

    totalErrors += findings.filter(f => f.severity === "error").length;
    totalWarnings += findings.filter(f => f.severity === "warning").length;
    totalInfos += findings.filter(f => f.severity === "info").length;
    if (findings.length === 0) cleanFiles++;
  }

  if (agentMode) {
    console.log(JSON.stringify({
      files: files.length,
      errors: totalErrors,
      warnings: totalWarnings,
      infos: totalInfos,
      clean: cleanFiles,
      pass: totalErrors === 0,
      findings: allFindings,
    }));
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Summary
  console.log(`${C.gray}  ${"─".repeat(64)}${C.reset}`);
  console.log("");
  console.log(`  ${C.bold}Review Summary${C.reset}`);
  console.log(`  ${C.gray}${files.length} file${files.length > 1 ? "s" : ""} reviewed${C.reset}`);

  if (totalErrors === 0 && totalWarnings === 0 && totalInfos === 0) {
    console.log(`  ${C.green}${C.bold}${I.check} All clean! No issues found.${C.reset}`);
  } else {
    if (totalErrors > 0) console.log(`  ${C.red}${I.cross} ${totalErrors} error${totalErrors > 1 ? "s" : ""}${C.reset} ${C.dim}(must fix)${C.reset}`);
    if (totalWarnings > 0) console.log(`  ${C.yellow}${I.warn} ${totalWarnings} warning${totalWarnings > 1 ? "s" : ""}${C.reset} ${C.dim}(should fix)${C.reset}`);
    if (totalInfos > 0) console.log(`  ${C.blue}${I.dot} ${totalInfos} info${C.reset} ${C.dim}(consider)${C.reset}`);
    if (cleanFiles > 0) console.log(`  ${C.green}${I.check} ${cleanFiles} clean file${cleanFiles > 1 ? "s" : ""}${C.reset}`);
  }

  console.log("");

  if (totalErrors > 0) {
    console.log(`  ${C.dim}Tip: Run ${C.reset}${C.cyan}node gotcha.mjs --interactive${C.reset}${C.dim} to add new gotchas you discover.${C.reset}`);
    console.log("");
    process.exit(1);
  }
}

main();
