// Per-language import extraction. Returns an array of { line, spec } for each
// import statement on its own line. Used by boundary-check to map staged-diff
// hunks to module dependencies.
//
// Languages: JS/TS family (ES modules + CommonJS) and Python. Other languages
// fall through to empty — boundary-check returns no findings on them rather
// than producing false positives from naive regex.

export function extractImports(filepath, content) {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filepath)) return extractJsTs(content);
  if (/\.py$/.test(filepath)) return extractPython(content);
  return [];
}

function extractJsTs(code) {
  const out = [];
  const lines = code.split("\n");
  const importFromRe = /\bimport\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/;
  const requireRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*\/\//.test(ln)) continue; // skip line comments
    let m = ln.match(importFromRe) || ln.match(requireRe);
    if (m) out.push({ line: i + 1, spec: m[1] });
  }
  return out;
}

function extractPython(code) {
  const out = [];
  const lines = code.split("\n");
  // from X import Y  |  from X import (Y)  |  import X[, Z as Q]
  const fromRe = /^\s*from\s+(\S+)\s+import\b/;
  const impRe = /^\s*import\s+(.+?)(?:\s*#.*)?$/;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let m = ln.match(fromRe);
    if (m) { out.push({ line: i + 1, spec: m[1] }); continue; }
    m = ln.match(impRe);
    if (m) {
      for (let piece of m[1].split(",")) {
        piece = piece.trim().split(/\s+as\s+/i)[0].trim();
        if (piece) out.push({ line: i + 1, spec: piece });
      }
    }
  }
  return out;
}
