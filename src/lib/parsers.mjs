import fs from "fs";
import path from "path";
import { readPlaybook } from "./playbooks.mjs";

/**
 * Load a file from the .arch/ directory. Returns null if not found.
 */
export function loadFile(archDir, ...segments) {
  const fp = path.join(archDir, ...segments);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf8");
}

/**
 * Create a request-scoped reader over an .arch/ directory.
 *
 * Memoizes file reads and the SYSTEM.md / INDEX.md parses for the lifetime of a
 * SINGLE warmup/drift invocation, so redundant re-parsing within one call is
 * eliminated (e.g. drift previously parsed INDEX.md twice per call).
 *
 * Per ADR 0002 the cache MUST be call-scoped, NEVER module-global: callers
 * create a fresh reader per command invocation so that successive calls in the
 * long-running MCP process always reflect current on-disk .arch/ state. This is
 * the contract pinned by tests/cgr-context-refresh/ — a module-level singleton
 * here would reintroduce cross-goal staleness.
 */
export function createArchReader(archDir) {
  const files = new Map();
  const parses = new Map();

  const read = (...segments) => {
    const key = segments.join("/");
    if (!files.has(key)) files.set(key, loadFile(archDir, ...segments));
    return files.get(key);
  };

  const memoParse = (key, fn) => {
    if (!parses.has(key)) parses.set(key, fn());
    return parses.get(key);
  };

  return {
    archDir,
    read,
    system: () => memoParse("SYSTEM.md", () => parseSystem(read("SYSTEM.md"))),
    index: () => memoParse("INDEX.md", () => parseIndex(read("INDEX.md"))),
  };
}

/**
 * Parse SYSTEM.md content into structured data.
 * Returns { rules, reservedWords, pattern, convention }.
 */
export function parseSystem(content) {
  if (!content) return { rules: [], reservedWords: {}, pattern: "", convention: "", type: "", stack: "" };
  const rules = [];
  const reservedWords = {};
  let pattern = "";
  let convention = "";
  let type = "";
  let stack = "";

  const lines = content.split("\n");
  let section = "";
  for (const line of lines) {
    if (line.startsWith("## Pattern:")) { pattern = line.replace("## Pattern:", "").trim(); continue; }
    if (line.startsWith("## Conv:")) { convention = line.replace("## Conv:", "").trim(); continue; }
    if (line.startsWith("## Type:")) { type = line.replace("## Type:", "").trim(); continue; }
    if (line.startsWith("## Stack:")) { stack = line.replace("## Stack:", "").trim(); continue; }
    if (line.startsWith("## Rules")) { section = "rules"; continue; }
    if (line.startsWith("## Reserved")) { section = "rw"; continue; }
    if (line.startsWith("## ")) { section = ""; continue; }

    if (section === "rules" && line.startsWith("- ")) {
      rules.push(line.replace(/^- /, "").trim());
    }
    if (section === "rw" && line.includes(" = ")) {
      const [k, ...rest] = line.split(" = ");
      reservedWords[k.trim()] = rest.join(" = ").trim();
    }
  }
  return { rules, reservedWords, pattern, convention, type, stack };
}

/**
 * Parse INDEX.md content into structured routing data.
 * Returns { keywordNodes, keywordSkills, nodeCluster, skillFiles, crossRefs }.
 */
export function parseIndex(content) {
  if (!content) return { keywordNodes: {}, keywordSkills: {}, nodeCluster: {}, skillFiles: {}, crossRefs: [] };

  const keywordNodes = {};
  const keywordSkills = {};
  const nodeCluster = {};
  const skillFiles = {};
  const crossRefs = [];

  const lines = content.split("\n");
  let section = "";

  for (const line of lines) {
    if (line.startsWith("## Keywords") && line.includes("Nodes")) { section = "kn"; continue; }
    // "Playbooks" is the current vocabulary (ADR 0016); "Skills" stays recognized
    // for back-compat with INDEX.md files written before the rename.
    if (line.startsWith("## Keywords") && (line.includes("Playbooks") || line.includes("Skills"))) { section = "ks"; continue; }
    if (line.startsWith("## Nodes")) { section = "nc"; continue; }
    if ((line.startsWith("## Playbooks") || line.startsWith("## Skills")) && line.includes("Files")) { section = "sf"; continue; }
    if (line.startsWith("## Cross")) { section = "cr"; continue; }
    if (line.startsWith("## ")) { section = ""; continue; }
    if (line.startsWith("#") || !line.trim()) continue;

    const arrowMatch = line.match(/^(.+?)\s*(?:→|->)+\s*(.+)$/);
    if (!arrowMatch) continue;

    const [, left, right] = arrowMatch;

    if (section === "kn") {
      const keywords = left.split(",").map(k => k.trim().toLowerCase());
      const node = right.trim();
      keywords.forEach(k => { keywordNodes[k] = node; });
    } else if (section === "ks") {
      const keywords = left.split(",").map(k => k.trim().toLowerCase());
      const skill = right.trim();
      keywords.forEach(k => { keywordSkills[k] = skill; });
    } else if (section === "nc") {
      // Supported formats for "## Nodes → Clusters → Files":
      //   A) @node = [cluster] → base/path/                              (scaffold default)
      //   A-list) @node = [cluster] → file1, file2                        (multi-file)
      //   B) @A @B @C → @cluster → clusters/cluster.graph                 (multi-node)
      //   C) @node → path                                                  (no cluster declared)
      // Splitting on → arrows gives us the segments to identify nodes, cluster, and path.
      const segments = line.split(/\s*(?:→|->)+\s*/).map(s => s.trim()).filter(Boolean);
      if (segments.length < 2) continue;

      const nodeIds = [...segments[0].matchAll(/@(\w+)/g)].map(m => m[1]);
      if (nodeIds.length === 0) continue;

      const bracketMatch = line.match(/\[(\w+)\]/);
      let clusterId;
      let basePath;

      if (bracketMatch) {
        clusterId = bracketMatch[1];
        basePath = segments[segments.length - 1].replace(/\[\w+\]\s*/g, "").trim();
      } else if (segments.length >= 3 && /^@\w+$/.test(segments[1])) {
        clusterId = segments[1].slice(1);
        basePath = segments.slice(2).join(" → ").trim();
      } else {
        clusterId = nodeIds[0];
        basePath = segments.slice(1).join(" → ").trim();
      }

      for (const nodeId of nodeIds) {
        nodeCluster[nodeId] = {
          cluster: clusterId,
          basePath: basePath || `src/features/${nodeId}/`,
        };
      }
    } else if (section === "sf") {
      const skillMatch = left.match(/\$(\w+)/);
      if (skillMatch) {
        skillFiles[skillMatch[1]] = right.trim();
      }
    } else if (section === "cr" && !line.startsWith("#")) {
      // Parenthesized reason is optional — stats counts bare `@A → @B` lines too.
      const refMatch = line.match(/@(\w+)\s*(?:→|->)+\s*@(\w+)(?:\s*\(([^)]+)\))?/);
      if (refMatch) {
        crossRefs.push({ from: refMatch[1], to: refMatch[2], reason: refMatch[3] || "" });
      }
    }
  }

  return { keywordNodes, keywordSkills, nodeCluster, skillFiles, crossRefs };
}

/**
 * Extract WRONG/RIGHT/WHY gotcha blocks from skill file content.
 */
export function parseGotchas(content) {
  const gotchas = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("WRONG:")) {
      const wrong = lines[i].replace("WRONG:", "").trim();
      const right = (lines[i + 1] || "").replace("RIGHT:", "").trim();
      const why = (lines[i + 2] || "").replace("WHY:", "").trim();
      if (wrong && !wrong.startsWith("[")) gotchas.push({ wrong, right, why });
    }
  }
  return gotchas;
}

/**
 * Load and parse a graph cluster file.
 * Returns { clusterId, nodes, raw } or null if not found.
 */
export function loadGraphCluster(archDir, clusterId) {
  const content = loadFile(archDir, "clusters", `${clusterId}.graph`);
  if (!content) return null;
  const nodes = [];
  for (const line of content.split("\n")) {
    const nodeMatch = line.match(/^(\w+)\s+\[([^\]]+)\]\s+:\s+(.+)$/);
    if (nodeMatch) {
      const [, id, tags, rest] = nodeMatch;
      const [summary, flow] = rest.split("|").map(s => s?.trim());
      nodes.push({ id, tags, summary, flow: flow || "" });
    }
  }
  return { clusterId, nodes, raw: content };
}

/**
 * Load a playbook file (formerly "skill") and extract its gotchas.
 * Reads the canonical .arch/playbooks/<id>.playbook, falling back to the
 * legacy .arch/skills/<id>.skill (back-compat alias, ADR 0016).
 * Returns { skillId, gotchas, raw } or null if not found.
 */
export function loadSkillGotchas(archDir, skillId) {
  const content = readPlaybook(archDir, skillId);
  if (!content) return null;
  const gotchas = parseGotchas(content);
  return { skillId, gotchas, raw: content };
}

/**
 * Load and parse an API digest file.
 * Returns { apiId, endpoints, raw } or null if not found.
 */
export function loadApiDigest(archDir, apiId) {
  const content = loadFile(archDir, "apis", `${apiId}.api`);
  if (!content) return null;
  const endpoints = [];
  for (const line of content.split("\n")) {
    const epMatch = line.match(/^(GET|POST|PUT|PATCH|DEL|DELETE)\s+(.+)/);
    if (epMatch) endpoints.push(line.trim());
  }
  return { apiId, endpoints, raw: content };
}
