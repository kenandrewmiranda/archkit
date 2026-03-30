// Validates that import statements respect the architecture layer hierarchy.
// Uses regex-based import extraction — no AST parser needed.

const LAYER_PATTERNS = {
  controller: /\.(controller|cont|route|router)\./,
  service: /\.(service|svc|use-case)\./,
  repository: /\.(repository|repo|dal)\./,
  types: /\.(types|dto|model|entity)\./,
  validation: /\.(validation|schema|validator)\./,
  test: /\.(test|spec)\./,
};

// What each layer is allowed to import (by layer)
const ALLOWED_IMPORTS = {
  controller: ["service", "types", "validation"],
  service: ["repository", "types"],
  repository: ["types"],
  types: [],
  validation: ["types"],
  test: ["controller", "service", "repository", "types", "validation"], // tests can import anything
};

function detectLayer(filepath) {
  for (const [layer, pattern] of Object.entries(LAYER_PATTERNS)) {
    if (pattern.test(filepath)) return layer;
  }
  return null;
}

function detectFeature(filepath) {
  // Extract feature ID from paths like src/features/auth/auth.service.ts
  const match = filepath.match(/features\/([^/]+)\//);
  return match ? match[1] : null;
}

function extractImports(code) {
  const imports = [];
  // ES module imports: import ... from "..."
  const esImports = code.matchAll(/import\s+.*?\s+from\s+['"](\..*?)['"]/g);
  for (const m of esImports) imports.push(m[1]);
  // Dynamic imports: import("...")
  const dynImports = code.matchAll(/import\(\s*['"](\..*?)['"]\s*\)/g);
  for (const m of dynImports) imports.push(m[1]);
  // CommonJS: require("...")
  const cjsImports = code.matchAll(/require\(\s*['"](\..*?)['"]\s*\)/g);
  for (const m of cjsImports) imports.push(m[1]);
  return imports;
}

export function checkImportHierarchy(code, filepath) {
  const findings = [];
  const sourceLayer = detectLayer(filepath);
  const sourceFeature = detectFeature(filepath);

  // Only check files we can identify a layer for
  if (!sourceLayer || sourceLayer === "test") return findings;

  const allowed = ALLOWED_IMPORTS[sourceLayer] || [];
  const imports = extractImports(code);

  for (const imp of imports) {
    // Check cross-feature imports
    const importFeature = detectFeature(imp) || (() => {
      // Also detect from relative paths like ../billing/billing.repo
      const m = imp.match(/\.\.\/([^/]+)\//);
      return m ? m[1] : null;
    })();

    if (importFeature && sourceFeature && importFeature !== sourceFeature) {
      // Find line number
      const lines = code.split("\n");
      let line = undefined;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(imp)) { line = i + 1; break; }
      }
      findings.push({
        severity: "error",
        type: "import-boundary",
        line,
        message: `Cross-feature import: ${sourceFeature} → ${importFeature} (${imp})`,
        fix: "Use a shared interface or event bus instead of direct cross-feature imports.",
        reason: "Features must not import from each other's internal modules.",
      });
      continue;
    }

    // Check layer hierarchy
    const importLayer = detectLayer(imp);
    if (importLayer && !allowed.includes(importLayer)) {
      const lines = code.split("\n");
      let line = undefined;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(imp)) { line = i + 1; break; }
      }
      findings.push({
        severity: "error",
        type: "import-hierarchy",
        line,
        message: `${sourceLayer} imports ${importLayer} (${imp}) — violates layer hierarchy`,
        fix: `${sourceLayer} can only import: ${allowed.join(", ") || "nothing from the feature"}.`,
        reason: `Architecture rule: ${sourceLayer} → ${allowed.join("/")} only.`,
      });
    }
  }

  return findings;
}
