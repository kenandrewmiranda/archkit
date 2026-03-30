import fs from "fs";
import path from "path";
import { POLICY, VALID_CATEGORIES, ALLOWED_IMPORTS } from "./policy.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION CHECKS
// ═══════════════════════════════════════════════════════════════════════════

export function runCheck(checkId, code, filename, meta) {
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

export async function validateExtension(filepath) {
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
