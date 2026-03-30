#!/usr/bin/env node

/**
 * arch-guard — Validation and guardrail system for .arch/ extensions
 *
 * Hard pass/fail gate. No extension registers without passing all checks.
 *
 * Usage:
 *   archkit guard validate <extension.mjs>     Validate a single extension
 *   archkit guard validate-all                  Validate all registered extensions
 *   archkit guard audit                         Full security audit of .arch/ system
 *   archkit guard policy                        Show current policy rules
 *   archkit guard enforce                       Re-validate all extensions, remove failures
 */

import fs from "fs";
import path from "path";
import { C, ICONS, findArchDir as _findArchDir, divider } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import { POLICY, VALID_CATEGORIES, ALLOWED_IMPORTS } from "./guard/policy.mjs";
import { runCheck, validateExtension } from "./guard/checks.mjs";

const I = { ...ICONS, pass: ICONS.check, fail: ICONS.cross };

function banner() {
  commandBanner("arch-guard", "Validation and guardrail system");
  console.log(`${C.gray}  Hard pass/fail gate for extensions and .arch/ integrity${C.reset}`);
  console.log("");
}

function findArchDir() {
  return _findArchDir();
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPLAY
// ═══════════════════════════════════════════════════════════════════════════

function displayResults(validation) {
  const { passed, filename, results } = validation;

  const statusIcon = passed ? `${C.green}${C.bold}PASS${C.reset}` : `${C.red}${C.bold}FAIL${C.reset}`;
  console.log(`  ${statusIcon} ${C.bold}${filename}${C.reset}`);
  console.log("");

  // Group by category
  const groups = {};
  for (const r of results) {
    if (!groups[r.group]) groups[r.group] = [];
    groups[r.group].push(r);
  }

  for (const [groupName, rules] of Object.entries(groups)) {
    const groupPassed = rules.every(r => r.passed || r.severity !== "FAIL");
    const icon = groupPassed ? `${C.green}${I.pass}${C.reset}` : `${C.red}${I.fail}${C.reset}`;
    console.log(`  ${icon} ${C.bold}${groupName}${C.reset}`);

    for (const r of rules) {
      if (r.passed) {
        console.log(`    ${C.green}${I.pass}${C.reset} ${C.dim}${r.id}${C.reset} ${r.name}`);
      } else {
        const color = r.severity === "FAIL" ? C.red : C.yellow;
        const sevLabel = r.severity === "FAIL" ? "FAIL" : "WARN";
        console.log(`    ${color}${I.fail} ${sevLabel}${C.reset} ${C.dim}${r.id}${C.reset} ${r.name}`);
      }
    }
    console.log("");
  }

  // Summary
  const fails = results.filter(r => !r.passed && r.severity === "FAIL");
  const warns = results.filter(r => !r.passed && r.severity === "WARN");
  const passes = results.filter(r => r.passed);

  console.log(`  ${C.green}${passes.length} passed${C.reset}  ${fails.length > 0 ? `${C.red}${fails.length} failed${C.reset}` : ""}  ${warns.length > 0 ? `${C.yellow}${warns.length} warnings${C.reset}` : ""}`);

  if (!passed) {
    console.log("");
    console.log(`  ${C.red}${I.lock} Extension REJECTED — fix the FAIL items above before registration.${C.reset}`);
  } else {
    console.log("");
    console.log(`  ${C.green}${I.shield} Extension APPROVED — safe to register.${C.reset}`);
  }

  return passed;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

async function cmdValidate(archDir, filepath) {
  const result = await validateExtension(filepath);
  displayResults(result);
  return result.passed;
}

async function cmdValidateAll(archDir) {
  const extDir = path.join(archDir, "extensions");
  if (!fs.existsSync(extDir)) {
    console.log(`${C.gray}  No extensions directory found.${C.reset}\n`);
    return true;
  }

  const files = fs.readdirSync(extDir).filter(f => f.endsWith(".mjs"));
  if (files.length === 0) {
    console.log(`${C.gray}  No extensions to validate.${C.reset}\n`);
    return true;
  }

  console.log(`${C.cyan}  Validating ${files.length} extension${files.length > 1 ? "s" : ""}...${C.reset}`);
  console.log("");

  let allPassed = true;
  const summaries = [];

  for (const file of files) {
    const filepath = path.join(extDir, file);
    const result = await validateExtension(filepath);
    displayResults(result);
    divider();
    console.log("");
    summaries.push({ name: file, passed: result.passed });
    if (!result.passed) allPassed = false;
  }

  // Final summary
  const passCount = summaries.filter(s => s.passed).length;
  const failCount = summaries.filter(s => !s.passed).length;

  console.log(`${C.bold}  Final: ${passCount} passed, ${failCount} failed${C.reset}`);
  if (allPassed) {
    console.log(`${C.green}  ${I.shield} All extensions are compliant.${C.reset}`);
  } else {
    console.log(`${C.red}  ${I.lock} ${failCount} extension${failCount > 1 ? "s" : ""} failed validation:${C.reset}`);
    summaries.filter(s => !s.passed).forEach(s => console.log(`${C.red}    ${I.fail} ${s.name}${C.reset}`));
  }
  console.log("");

  return allPassed;
}

async function cmdAudit(archDir) {
  console.log(`${C.cyan}${C.bold}  Full .arch/ Security Audit${C.reset}`);
  console.log("");

  const checks = [];

  // 1. Core files integrity
  console.log(`${C.blue}  ${I.shield} Core Files${C.reset}`);
  const coreFiles = ["SYSTEM.md", "INDEX.md"];
  for (const f of coreFiles) {
    const fp = path.join(archDir, f);
    const exists = fs.existsSync(fp);
    checks.push({ name: f, passed: exists, detail: exists ? "present" : "MISSING" });
    console.log(`  ${exists ? `${C.green}${I.pass}` : `${C.red}${I.fail}`}${C.reset} ${f} ${C.dim}${exists ? "— present" : "— MISSING"}${C.reset}`);
  }
  console.log("");

  // 2. Skills security
  console.log(`${C.blue}  ${I.shield} Skills Security${C.reset}`);
  const skillsDir = path.join(archDir, "skills");
  if (fs.existsSync(skillsDir)) {
    const skillFiles = fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"));
    for (const f of skillFiles) {
      const content = fs.readFileSync(path.join(skillsDir, f), "utf8");
      // Check for executable code in skill files (skills should be data, not code)
      const hasCode = /\b(import|require|function|const|let|var)\b/.test(content) && !content.includes("## Snippets");
      const hasSecrets = /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\[\]]{8,}/i.test(content);
      const safe = !hasCode && !hasSecrets;
      checks.push({ name: `skill:${f}`, passed: safe, detail: safe ? "clean" : hasSecrets ? "POSSIBLE SECRET" : "EXECUTABLE CODE" });
      console.log(`  ${safe ? `${C.green}${I.pass}` : `${C.red}${I.fail}`}${C.reset} ${f} ${!safe ? `${C.red}— ${hasSecrets ? "POSSIBLE SECRET FOUND" : "contains executable code"}${C.reset}` : ""}`);
    }
  }
  console.log("");

  // 3. Extension validation
  console.log(`${C.blue}  ${I.shield} Extensions${C.reset}`);
  const extDir = path.join(archDir, "extensions");
  if (fs.existsSync(extDir)) {
    const extFiles = fs.readdirSync(extDir).filter(f => f.endsWith(".mjs"));
    for (const f of extFiles) {
      const result = await validateExtension(path.join(extDir, f));
      const fails = result.results.filter(r => !r.passed && r.severity === "FAIL").length;
      checks.push({ name: `ext:${f}`, passed: result.passed, detail: result.passed ? "compliant" : `${fails} violations` });
      console.log(`  ${result.passed ? `${C.green}${I.pass}` : `${C.red}${I.fail}`}${C.reset} ${f} ${!result.passed ? `${C.red}— ${fails} violation${fails > 1 ? "s" : ""}${C.reset}` : ""}`);
    }
  }
  console.log("");

  // 4. Registry integrity
  console.log(`${C.blue}  ${I.shield} Registry Integrity${C.reset}`);
  const regPath = path.join(archDir, "extensions", "registry.json");
  if (fs.existsSync(regPath)) {
    try {
      const registry = JSON.parse(fs.readFileSync(regPath, "utf8"));
      const valid = Array.isArray(registry);
      checks.push({ name: "registry.json", passed: valid, detail: valid ? `${registry.length} entries` : "INVALID JSON" });
      console.log(`  ${valid ? `${C.green}${I.pass}` : `${C.red}${I.fail}`}${C.reset} registry.json ${C.dim}— ${valid ? `${registry.length} entries` : "INVALID"}${C.reset}`);

      // Check for orphaned entries (registered but file missing)
      if (valid) {
        for (const entry of registry) {
          const entryPath = path.join(extDir, entry.file);
          const exists = fs.existsSync(entryPath);
          if (!exists) {
            checks.push({ name: `orphan:${entry.name}`, passed: false, detail: "registered but file missing" });
            console.log(`  ${C.red}${I.fail}${C.reset} ${entry.name} ${C.red}— registered but file missing${C.reset}`);
          }
        }

        // Check for unregistered extensions (file exists but not in registry)
        if (fs.existsSync(extDir)) {
          const extFiles = fs.readdirSync(extDir).filter(f => f.endsWith(".mjs"));
          for (const f of extFiles) {
            const registered = registry.some(e => e.file === f);
            if (!registered) {
              checks.push({ name: `unregistered:${f}`, passed: false, detail: "file exists but not registered" });
              console.log(`  ${C.yellow}${I.warn}${C.reset} ${f} ${C.yellow}— file exists but not in registry${C.reset}`);
            }
          }
        }
      }
    } catch {
      checks.push({ name: "registry.json", passed: false, detail: "PARSE ERROR" });
      console.log(`  ${C.red}${I.fail}${C.reset} registry.json ${C.red}— parse error${C.reset}`);
    }
  } else {
    console.log(`  ${C.gray}${I.dot} No registry file (no extensions installed)${C.reset}`);
  }
  console.log("");

  // 5. File permissions check
  console.log(`${C.blue}  ${I.shield} Scope Check${C.reset}`);
  const allFiles = [];
  function walkDir(dir, prefix = "") {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) { walkDir(fullPath, prefix + item.name + "/"); }
      else { allFiles.push(prefix + item.name); }
    }
  }
  walkDir(archDir);
  const unexpectedFiles = allFiles.filter(f => {
    if (f.endsWith(".md") || f.endsWith(".graph") || f.endsWith(".skill") || f.endsWith(".api") || f.endsWith(".mjs") || f.endsWith(".json")) return false;
    return true;
  });

  if (unexpectedFiles.length > 0) {
    console.log(`  ${C.yellow}${I.warn}${C.reset} Unexpected file types in .arch/:`);
    unexpectedFiles.forEach(f => console.log(`    ${C.yellow}${f}${C.reset}`));
    checks.push({ name: "unexpected_files", passed: false, detail: `${unexpectedFiles.length} unexpected files` });
  } else {
    console.log(`  ${C.green}${I.pass}${C.reset} All files are expected types (.md, .graph, .skill, .api, .mjs, .json)`);
    checks.push({ name: "file_types", passed: true });
  }
  console.log("");

  // Summary
  divider();
  console.log("");
  const totalPassed = checks.filter(c => c.passed).length;
  const totalFailed = checks.filter(c => !c.passed).length;

  if (totalFailed === 0) {
    console.log(`  ${C.green}${C.bold}${I.shield} AUDIT PASSED — ${totalPassed}/${checks.length} checks clean${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}${I.lock} AUDIT FAILED — ${totalFailed} issue${totalFailed > 1 ? "s" : ""} found${C.reset}`);
    console.log(`  ${C.gray}${totalPassed} passed | ${totalFailed} failed${C.reset}`);
  }
  console.log("");

  return totalFailed === 0;
}

async function cmdEnforce(archDir) {
  console.log(`${C.yellow}${C.bold}  Enforcement Mode${C.reset}`);
  console.log(`${C.gray}  Re-validating all extensions. Failures will be deregistered.${C.reset}`);
  console.log("");

  const regPath = path.join(archDir, "extensions", "registry.json");
  if (!fs.existsSync(regPath)) {
    console.log(`${C.gray}  No registry found. Nothing to enforce.${C.reset}\n`);
    return;
  }

  const registry = JSON.parse(fs.readFileSync(regPath, "utf8"));
  const extDir = path.join(archDir, "extensions");
  const surviving = [];
  const removed = [];

  for (const entry of registry) {
    const filepath = path.join(extDir, entry.file);
    if (!fs.existsSync(filepath)) {
      removed.push({ name: entry.name, reason: "file missing" });
      continue;
    }

    const result = await validateExtension(filepath);
    if (result.passed) {
      surviving.push(entry);
      console.log(`  ${C.green}${I.pass}${C.reset} ${entry.name} — compliant`);
    } else {
      removed.push({ name: entry.name, reason: "failed validation" });
      console.log(`  ${C.red}${I.fail}${C.reset} ${entry.name} — ${C.red}DEREGISTERED${C.reset}`);
    }
  }

  // Save updated registry
  fs.writeFileSync(regPath, JSON.stringify(surviving, null, 2));

  console.log("");
  if (removed.length > 0) {
    console.log(`  ${C.yellow}${removed.length} extension${removed.length > 1 ? "s" : ""} removed from registry:${C.reset}`);
    removed.forEach(r => console.log(`    ${C.red}${I.fail}${C.reset} ${r.name} (${r.reason})`));
    console.log("");
    console.log(`  ${C.gray}Extension files are kept on disk but deregistered.${C.reset}`);
    console.log(`  ${C.gray}Fix the violations and re-register with: archkit extend create${C.reset}`);
  } else {
    console.log(`  ${C.green}${I.shield} All ${surviving.length} extensions are compliant. No changes.${C.reset}`);
  }
  console.log("");
}

function cmdPolicy() {
  console.log(`${C.cyan}${C.bold}  ${I.shield} Extension Policy${C.reset}`);
  console.log(`${C.gray}  All rules an extension must pass before registration.${C.reset}`);
  console.log("");

  for (const [groupKey, group] of Object.entries(POLICY)) {
    console.log(`${C.blue}${C.bold}  ${group.name}${C.reset}`);
    console.log(`${C.dim}  ${group.description}${C.reset}`);
    console.log("");

    for (const rule of group.rules) {
      const sev = rule.severity === "FAIL" ? `${C.red}FAIL${C.reset}` : `${C.yellow}WARN${C.reset}`;
      console.log(`  ${C.dim}${rule.id}${C.reset} [${sev}] ${rule.name}`);
    }
    console.log("");
  }

  console.log(`${C.gray}  Allowed imports: ${ALLOWED_IMPORTS.filter(a => !a.startsWith("node:")).join(", ")}${C.reset}`);
  console.log(`${C.gray}  Valid categories: ${VALID_CATEGORIES.join(", ")}${C.reset}`);
  console.log("");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    banner();
    console.log(`${C.yellow}  Commands:${C.reset}`);
    console.log(`${C.gray}    validate <file.mjs>     Validate a single extension (hard pass/fail)${C.reset}`);
    console.log(`${C.gray}    validate-all            Validate all registered extensions${C.reset}`);
    console.log(`${C.gray}    audit                   Full security audit of .arch/ system${C.reset}`);
    console.log(`${C.gray}    enforce                 Re-validate all, deregister failures${C.reset}`);
    console.log(`${C.gray}    policy                  Show all policy rules${C.reset}`);
    console.log("");
    console.log(`${C.yellow}  Policy groups:${C.reset}`);
    for (const [k, g] of Object.entries(POLICY)) {
      console.log(`${C.gray}    ${g.name.padEnd(24)} ${g.rules.length} rules — ${g.description}${C.reset}`);
    }
    console.log("");
    return;
  }

  const archDir = findArchDir();

  switch (cmd) {
    case "validate": {
      if (!args[1]) { console.log(`${C.red}  Provide a file path: archkit guard validate <file.mjs>${C.reset}\n`); return; }
      banner();
      const passed = await cmdValidate(archDir, args[1]);
      console.log("");
      process.exit(passed ? 0 : 1);
      break;
    }
    case "validate-all": {
      if (!archDir) { console.log(`${C.red}  No .arch/ found.${C.reset}\n`); return; }
      banner();
      const allPassed = await cmdValidateAll(archDir);
      process.exit(allPassed ? 0 : 1);
      break;
    }
    case "audit": {
      if (!archDir) { console.log(`${C.red}  No .arch/ found.${C.reset}\n`); return; }
      banner();
      const auditPassed = await cmdAudit(archDir);
      process.exit(auditPassed ? 0 : 1);
      break;
    }
    case "enforce": {
      if (!archDir) { console.log(`${C.red}  No .arch/ found.${C.reset}\n`); return; }
      banner();
      await cmdEnforce(archDir);
      break;
    }
    case "policy": {
      banner();
      cmdPolicy();
      break;
    }
    default:
      banner();
      console.log(`${C.red}  Unknown command: ${cmd}${C.reset}`);
      console.log(`${C.gray}  Run: archkit guard --help${C.reset}\n`);
  }
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main().catch(err => {
    console.error(`${C.red}  Error: ${err.message}${C.reset}`);
    process.exit(1);
  });
}
