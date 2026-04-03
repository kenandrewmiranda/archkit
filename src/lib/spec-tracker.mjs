// Parses structured requirements from a spec/brief file
// and checks implementation coverage.

import fs from "fs";
import path from "path";
import * as log from "./logger.mjs";

// Parse requirements from markdown files
// Supports: - [ ] REQ-ID: description  OR  - requirement text
export function parseRequirements(filepath) {
  if (!fs.existsSync(filepath)) return [];
  const content = fs.readFileSync(filepath, "utf8");
  const reqs = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Checkbox format: - [ ] REQ-001: Description
    const checkboxMatch = line.match(/^[-*]\s+\[([ x])\]\s+(REQ-[\w-]+):\s*(.+)/i);
    if (checkboxMatch) {
      reqs.push({
        id: checkboxMatch[2],
        description: checkboxMatch[3].trim(),
        done: checkboxMatch[1] === "x",
        line: i + 1,
      });
      continue;
    }
    // Table row format: | REQ-001 | Description | Status |
    const tableMatch = line.match(/\|\s*(REQ-[\w-]+)\s*\|\s*(.+?)\s*\|/i);
    if (tableMatch) {
      reqs.push({
        id: tableMatch[1],
        description: tableMatch[2].trim(),
        done: false,
        line: i + 1,
      });
      continue;
    }
    // Simple list: - Feature: description (within a ## Requirements section)
    // Only match if we're in a requirements section
  }

  return reqs;
}

// Check which requirements have corresponding code
export function checkCoverage(reqs, srcDir) {
  if (!fs.existsSync(srcDir)) return reqs.map(r => ({ ...r, covered: false }));

  // Collect all source code
  const files = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules" && item.name !== "dist") {
        walk(path.join(dir, item.name));
      } else if (item.isFile() && /\.(ts|tsx|js|mjs|py)$/.test(item.name)) {
        files.push(path.join(dir, item.name));
      }
    }
  }

  // Build a keyword index from file contents
  const codeIndex = new Set();
  try {
    walk(srcDir);
    for (const f of files) {
      const code = fs.readFileSync(f, "utf8").toLowerCase();
      // Extract meaningful tokens
      code.split(/\W+/).filter(w => w.length > 3).forEach(w => codeIndex.add(w));
    }
  } catch {}

  // Check each requirement against the code index
  return reqs.map(req => {
    const keywords = req.description.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const matchCount = keywords.filter(k => codeIndex.has(k)).length;
    const coverage = keywords.length > 0 ? matchCount / keywords.length : 0;
    return {
      ...req,
      covered: coverage > 0.5,
      coverage: Math.round(coverage * 100),
      keywords: keywords.length,
      matched: matchCount,
    };
  });
}

export function formatCoverageReport(results) {
  const covered = results.filter(r => r.covered);
  const uncovered = results.filter(r => !r.covered);

  return {
    total: results.length,
    covered: covered.length,
    uncovered: uncovered.length,
    coveragePercent: results.length > 0 ? Math.round((covered.length / results.length) * 100) : 0,
    items: results,
  };
}
