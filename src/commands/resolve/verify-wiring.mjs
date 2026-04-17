// Scans the codebase for exported functions/classes that are never imported
// outside their own directory. Catches dead code from unwired components.

import fs from "fs";
import path from "path";
import * as log from "../../lib/logger.mjs";

// File extensions this scanner can analyze. Adding new languages requires
// import/export pattern parsing — see issue tracker for polyglot scanner.
const SUPPORTED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

export function cmdVerifyWiring(srcDir) {
  log.resolve("Scanning for unwired components...");

  if (!fs.existsSync(srcDir)) {
    return { error: `Source directory not found: ${srcDir}`, unwired: [] };
  }

  // Collect all .ts/.js/.mjs files
  const files = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules" && item.name !== "dist") {
        walk(path.join(dir, item.name));
      } else if (item.isFile() && /\.(ts|tsx|js|mjs)$/.test(item.name) && !item.name.includes(".test.") && !item.name.includes(".spec.")) {
        files.push(path.join(dir, item.name));
      }
    }
  }
  walk(srcDir);

  log.resolve(`Found ${files.length} source files`);

  // Detect probable non-JS project: 0 supported files but other source files present
  if (files.length === 0) {
    const otherFiles = countNonJsSourceFiles(srcDir);
    const warning = otherFiles > 0
      ? `0 files scanned in ${srcDir} — found ${otherFiles} non-JS/TS source file(s). verify-wiring currently supports ${SUPPORTED_EXTENSIONS.join(", ")} only.`
      : `0 files scanned in ${srcDir} — no source files of supported types (${SUPPORTED_EXTENSIONS.join(", ")}) found.`;
    log.warn(warning);
    return { files: 0, exports: 0, unwired: [], warning };
  }

  // Build export map: file -> exported names
  const exports = new Map();
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    const names = [];
    // export function/class/const
    const matches = code.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g);
    for (const m of matches) names.push(m[1]);
    // export { name }
    const reexports = code.matchAll(/export\s*\{([^}]+)\}/g);
    for (const m of reexports) {
      m[1].split(",").forEach(n => {
        const name = n.trim().split(/\s+as\s+/).pop().trim();
        if (name) names.push(name);
      });
    }
    // export default
    if (/export\s+default/.test(code)) names.push("default");

    if (names.length > 0) exports.set(file, names);
  }

  // Build import map: which files import from which
  const importedFrom = new Map(); // file -> Set of files that import from it
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    const importPaths = code.matchAll(/(?:import|from)\s+['"](\.[^'"]+)['"]/g);
    for (const m of importPaths) {
      const importPath = m[1];
      // Resolve relative to current file
      const resolved = resolveImport(path.dirname(file), importPath);
      if (resolved) {
        if (!importedFrom.has(resolved)) importedFrom.set(resolved, new Set());
        importedFrom.get(resolved).add(file);
      }
    }
  }

  // Find unwired: files with exports that are never imported from outside their directory
  const unwired = [];
  for (const [file, names] of exports) {
    const importers = importedFrom.get(file) || new Set();
    const dir = path.dirname(file);
    const externalImporters = [...importers].filter(f => !f.startsWith(dir + "/") && f !== file);

    if (externalImporters.length === 0 && names.length > 0) {
      // Check if it's a route/controller/middleware (these should be mounted, not imported by feature code)
      const isEntryPoint = /\.(controller|route|router|middleware|handler)\./i.test(file) ||
                           /app\.(ts|js)$/i.test(file) ||
                           /index\.(ts|js)$/i.test(file);

      if (!isEntryPoint) {
        log.warn(`Unwired: ${path.relative(srcDir, file)} — exports [${names.join(", ")}] but no external imports`);
        unwired.push({
          file: path.relative(srcDir, file),
          exports: names,
          internalImporters: [...importers].map(f => path.relative(srcDir, f)),
          status: importers.size > 0 ? "INTERNAL_ONLY" : "DEAD_CODE",
        });
      }
    }
  }

  log.resolve(`Found ${unwired.length} potentially unwired components`);
  return { files: files.length, exports: exports.size, unwired };
}

// Quick pass to detect if the project has source files this scanner can't read.
// Used to give a more informative warning when 0 supported files are found.
function countNonJsSourceFiles(srcDir) {
  const otherSourceExts = [".py", ".go", ".rs", ".rb", ".java", ".kt", ".swift", ".php", ".cs"];
  let count = 0;
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules" && item.name !== "dist" && item.name !== "__pycache__") {
        walk(path.join(dir, item.name));
      } else if (item.isFile()) {
        const ext = path.extname(item.name);
        if (otherSourceExts.includes(ext)) count++;
      }
    }
  }
  try { walk(srcDir); } catch {}
  return count;
}

function resolveImport(fromDir, importPath) {
  const extensions = [".ts", ".tsx", ".js", ".mjs", ""];
  // Strip existing extension for re-resolution (handles .js → .ts in ESM TypeScript)
  const stripped = importPath.replace(/\.(js|mjs|ts|tsx)$/, "");
  const candidates = [
    importPath,          // exact match first
    stripped,            // without extension (try all)
    importPath + "/index",
    stripped + "/index",
  ];
  for (const candidate of candidates) {
    for (const ext of extensions) {
      const full = path.resolve(fromDir, candidate + ext);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}
