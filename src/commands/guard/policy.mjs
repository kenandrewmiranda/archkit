// ═══════════════════════════════════════════════════════════════════════════
// POLICY DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

export const POLICY = {
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

export const VALID_CATEGORIES = ["scaffold", "api", "skill", "maintenance", "testing", "devops", "data", "other"];

export const ALLOWED_IMPORTS = [
  "fs", "path", "child_process", "os", "url", "util", "crypto",
  "inquirer", "node:fs", "node:path", "node:child_process", "node:os", "node:url", "node:util", "node:crypto",
];
