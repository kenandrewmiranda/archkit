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
// POLICY DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const POLICY = {
  structure: {
    name: "Structure Compliance",
    description: "Extension must follow standard interface",
    rules: [
      { id: "S001", name: "Has meta export", severity: "FAIL", check: "meta_export" },
      { id: "S002", name: "Has run export", severity: "FAIL", check: "run_export" },
      { id: "S003", name: "Meta has required fields (name, description, category, trigger)", severity: "FAIL", check: "meta_fields" },
      { id: "S004", name: "Meta.name matches filename", severity: "FAIL", check: "name_match" },
      { id: "S005", name: "Meta.category is a known category", severity: "FAIL", check: "valid_category" },
      { id: "S006", name: "Meta.args is an array with valid entries", severity: "FAIL", check: "valid_args" },
      { id: "S007", name: "Run function accepts (args, context) parameters", severity: "FAIL", check: "run_signature" },
    ],
  },
  boundaries: {
    name: "Boundary Enforcement",
    description: "Extension must stay within allowed scope",
    rules: [
      { id: "B001", name: "No writes outside project directory", severity: "FAIL", check: "no_escape_writes" },
      { id: "B002", name: "No deletion of .arch/SYSTEM.md or INDEX.md", severity: "FAIL", check: "no_delete_core" },
      { id: "B003", name: "No modification of other extensions", severity: "FAIL", check: "no_modify_extensions" },
      { id: "B004", name: "No direct process.exit() calls", severity: "FAIL", check: "no_process_exit" },
      { id: "B005", name: "No execution of shell commands with user input unsanitized", severity: "FAIL", check: "no_unsafe_exec" },
      { id: "B006", name: "File operations only within project root or .arch/", severity: "FAIL", check: "scoped_file_ops" },
    ],
  },
  safety: {
    name: "Execution Safety",
    description: "Extension must not perform dangerous operations",
    rules: [
      { id: "X001", name: "No rm -rf or recursive deletion patterns", severity: "FAIL", check: "no_recursive_delete" },
      { id: "X002", name: "No network requests to hardcoded external URLs", severity: "FAIL", check: "no_hardcoded_urls" },
      { id: "X003", name: "No eval() or Function() constructor", severity: "FAIL", check: "no_eval" },
      { id: "X004", name: "No require() of non-standard modules", severity: "FAIL", check: "no_unsafe_require" },
      { id: "X005", name: "No environment variable writes", severity: "FAIL", check: "no_env_write" },
      { id: "X006", name: "No credential/secret patterns in code", severity: "FAIL", check: "no_secrets" },
    ],
  },
  conventions: {
    name: "Convention Compliance",
    description: "Extension must follow naming and style conventions",
    rules: [
      { id: "C001", name: "Filename is kebab-case with .mjs extension", severity: "FAIL", check: "kebab_filename" },
      { id: "C002", name: "Has JSDoc header comment", severity: "FAIL", check: "has_jsdoc" },
      { id: "C003", name: "Has error handling in run function", severity: "FAIL", check: "has_error_handling" },
      { id: "C004", name: "Uses console.log for output (not process.stdout directly)", severity: "WARN", check: "uses_console" },
    ],
  },
};

const VALID_CATEGORIES = ["scaffold", "api", "skill", "maintenance", "testing", "devops", "data", "other"];

const ALLOWED_IMPORTS = [
  "fs", "path", "child_process", "os", "url", "util", "crypto",
  "inquirer", "node:fs", "node:path", "node:child_process", "node:os", "node:url", "node:util", "node:crypto",
];

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION CHECKS
// ═══════════════════════════════════════════════════════════════════════════

function runCheck(checkId, code, filename, meta) {
  switch (checkId) {
    // ── Structure ──
    case "meta_export":
      return code.includes("export const meta") || code.includes("export let meta");

    case "run_export":
      return code.includes("export async function run") || code.includes("export function run");

    case "meta_fields": {
      if (!meta) return false;
      const required = ["name", "description", "category", "trigger"];
      return required.every(f => meta[f] && typeof meta[f] === "string" && meta[f].length > 0);
    }

    case "name_match": {
      if (!meta?.name) return false;
      const expected = filename.replace(".mjs", "");
      return meta.name === expected;
    }

    case "valid_category":
      return meta?.category && VALID_CATEGORIES.includes(meta.category);

    case "valid_args": {
      if (!meta?.args) return false;
      if (!Array.isArray(meta.args)) return false;
      return meta.args.every(a =>
        a && typeof a.name === "string" && typeof a.description === "string" && typeof a.required === "boolean"
      );
    }

    case "run_signature": {
      const match = code.match(/export\s+(?:async\s+)?function\s+run\s*\(([^)]*)\)/);
      if (!match) return false;
      const params = match[1].split(",").map(p => p.trim());
      return params.length >= 2; // (args, context)
    }

    // ── Boundaries ──
    case "no_escape_writes": {
      // Check for writes to absolute paths outside project
      const dangerousPaths = ["/etc/", "/usr/", "/var/", "/tmp/", "/root/", "/home/", "~", "C:\\", "D:\\"];
      return !dangerousPaths.some(p => code.includes(`"${p}`) || code.includes(`'${p}`));
    }

    case "no_delete_core": {
      const coreFiles = ["SYSTEM.md", "INDEX.md"];
      const hasUnlink = code.includes("unlinkSync") || code.includes("unlink(") || code.includes("rmSync") || code.includes(".rm(");
      if (!hasUnlink) return true;
      return !coreFiles.some(f => code.includes(f) && (code.includes("unlink") || code.includes("rmSync")));
    }

    case "no_modify_extensions": {
      // Extension should not write to other .mjs files in extensions/
      const writesExtensions = /writeFileSync.*extensions\/.*\.mjs|writeFile.*extensions\/.*\.mjs/;
      // Allow writing to own file or new files
      const writesToOtherExt = writesExtensions.test(code);
      return !writesToOtherExt;
    }

    case "no_process_exit":
      return !code.includes("process.exit");

    case "no_unsafe_exec": {
      // Check for execSync/exec with string concatenation from args
      const hasExec = code.includes("execSync") || code.includes("exec(") || code.includes("spawn(");
      if (!hasExec) return true;
      // Flag if args are interpolated into exec calls without sanitization
      const unsafeExec = /exec(?:Sync)?\s*\(\s*`[^`]*\$\{.*args/;
      return !unsafeExec.test(code);
    }

    case "scoped_file_ops": {
      // All file paths should use context.archDir, context.cwd, or relative paths
      // Flag absolute path literals
      const absolutePaths = /(?:writeFileSync|mkdirSync|writeFile)\s*\(\s*["']\//;
      return !absolutePaths.test(code);
    }

    // ── Safety ──
    case "no_recursive_delete": {
      const patterns = ["rm -rf", "rmSync", "rmdirSync", "rm(", "rimraf"];
      const hasPattern = patterns.some(p => code.includes(p));
      if (!hasPattern) return true;
      // Extra dangerous: rm -rf with variable
      return !(/rm\s+-rf\s+[`$"']/.test(code) || /rmSync.*recursive.*true/.test(code));
    }

    case "no_hardcoded_urls": {
      // Allow known safe domains
      const safeHosts = ["localhost", "127.0.0.1", "0.0.0.0"];
      const urlMatches = code.match(/https?:\/\/[^\s"'`]+/g) || [];
      const unsafeUrls = urlMatches.filter(u => !safeHosts.some(h => u.includes(h)));
      return unsafeUrls.length === 0;
    }

    case "no_eval":
      return !code.includes("eval(") && !code.includes("new Function(") && !code.includes("Function(");

    case "no_unsafe_require": {
      const imports = code.match(/(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g) || [];
      const importPaths = imports.map(i => {
        const match = i.match(/['"]([^'"]+)['"]/);
        return match ? match[1] : "";
      }).filter(Boolean);

      return importPaths.every(p => {
        if (p.startsWith(".")) return true; // Relative local paths OK
        const baseModule = p.split("/")[0].replace("@", "");
        return ALLOWED_IMPORTS.some(a => p === a || p.startsWith(a + "/"));
      });
    }

    case "no_env_write":
      return !/process\.env\.\w+\s*=/.test(code) && !/process\.env\[\s*['"].*\]\s*=/.test(code);

    case "no_secrets": {
      const secretPatterns = [
        /(?:api[_-]?key|secret[_-]?key|password|token)\s*[:=]\s*["'][^"']{8,}/i,
        /sk_(?:live|test)_[a-zA-Z0-9]+/,
        /ghp_[a-zA-Z0-9]{36,}/,
        /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
      ];
      return !secretPatterns.some(p => p.test(code));
    }

    // ── Conventions ──
    case "kebab_filename":
      return /^[a-z][a-z0-9-]*\.mjs$/.test(filename);

    case "has_jsdoc":
      return code.trimStart().startsWith("#!/") || code.trimStart().startsWith("/**");

    case "has_error_handling": {
      const runBody = code.match(/export\s+(?:async\s+)?function\s+run\s*\([^)]*\)\s*\{([\s\S]*?)^}/m);
      if (!runBody) return false;
      return runBody[1].includes("try") || runBody[1].includes("catch") || runBody[1].includes("if (!") || runBody[1].includes("if (!");
    }

    case "uses_console":
      return !code.includes("process.stdout.write");

    default:
      return true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

async function validateExtension(filepath) {
  const filename = path.basename(filepath);

  if (!fs.existsSync(filepath)) {
    return { passed: false, filename, results: [{ id: "F000", name: "File exists", severity: "FAIL", passed: false, detail: `File not found: ${filepath}` }] };
  }

  const code = fs.readFileSync(filepath, "utf8");

  // Try to extract meta statically (not by importing — we don't trust the code yet)
  let meta = null;
  try {
    const metaMatch = code.match(/export\s+const\s+meta\s*=\s*(\{[\s\S]*?\n\};)/);
    if (metaMatch) {
      // Safe static parse — extract key-value pairs
      const metaStr = metaMatch[1];
      const nameMatch = metaStr.match(/name:\s*["']([^"']+)["']/);
      const descMatch = metaStr.match(/description:\s*["']([^"']+)["']/);
      const catMatch = metaStr.match(/category:\s*["']([^"']+)["']/);
      const trigMatch = metaStr.match(/trigger:\s*["']([^"']+)["']/);

      // Parse args array
      const argsMatch = metaStr.match(/args:\s*(\[[\s\S]*?\])/);
      let args = [];
      if (argsMatch) {
        try {
          // Safely extract args structure
          const argsStr = argsMatch[1];
          const argEntries = argsStr.match(/\{[^}]+\}/g) || [];
          args = argEntries.map(entry => {
            const n = entry.match(/name:\s*["']([^"']+)["']/);
            const d = entry.match(/description:\s*["']([^"']+)["']/);
            const r = entry.match(/required:\s*(true|false)/);
            return {
              name: n ? n[1] : "",
              description: d ? d[1] : "",
              required: r ? r[1] === "true" : false,
            };
          });
        } catch {}
      }

      meta = {
        name: nameMatch ? nameMatch[1] : null,
        description: descMatch ? descMatch[1] : null,
        category: catMatch ? catMatch[1] : null,
        trigger: trigMatch ? trigMatch[1] : null,
        args,
      };
    }
  } catch {}

  // Run all checks
  const results = [];
  let allPassed = true;

  for (const [groupKey, group] of Object.entries(POLICY)) {
    for (const rule of group.rules) {
      const passed = runCheck(rule.check, code, filename, meta);
      results.push({
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        group: group.name,
        passed,
      });
      if (!passed && rule.severity === "FAIL") allPassed = false;
    }
  }

  return { passed: allPassed, filename, meta, results, filepath };
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
