import fs from "fs";
import path from "path";

/**
 * Load a file from the .arch/ directory. Returns null if not found.
 */
export function loadFile(archDir, ...segments) {
  const fp = path.join(archDir, ...segments);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf8");
}

/**
 * Parse SYSTEM.md content into structured data.
 * Returns { rules, reservedWords, pattern, convention }.
 */
export function parseSystem(content) {
  if (!content) return { rules: [], reservedWords: {}, pattern: "", convention: "" };
  const rules = [];
  const reservedWords = {};
  let pattern = "";
  let convention = "";

  const lines = content.split("\n");
  let section = "";
  for (const line of lines) {
    if (line.startsWith("## Pattern:")) { pattern = line.replace("## Pattern:", "").trim(); continue; }
    if (line.startsWith("## Conv:")) { convention = line.replace("## Conv:", "").trim(); continue; }
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
  return { rules, reservedWords, pattern, convention };
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
    if (line.startsWith("## Keywords") && line.includes("Skills")) { section = "ks"; continue; }
    if (line.startsWith("## Nodes")) { section = "nc"; continue; }
    if (line.startsWith("## Skills") && line.includes("Files")) { section = "sf"; continue; }
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
      const nodeMatch = left.match(/@(\w+)/);
      const clusterMatch = right.match(/\[(\w+)\]/);
      const pathMatch = right.match(/\]\s*(?:→|->)+\s*(.+)/);
      if (nodeMatch) {
        nodeCluster[nodeMatch[1]] = {
          cluster: clusterMatch ? clusterMatch[1] : nodeMatch[1],
          basePath: pathMatch ? pathMatch[1].trim() : `src/features/${nodeMatch[1]}/`,
        };
      }
    } else if (section === "sf") {
      const skillMatch = left.match(/\$(\w+)/);
      if (skillMatch) {
        skillFiles[skillMatch[1]] = right.trim();
      }
    } else if (section === "cr" && !line.startsWith("#")) {
      const refMatch = line.match(/@(\w+)\s*(?:→|->)+\s*@(\w+)\s*\(([^)]+)\)/);
      if (refMatch) {
        crossRefs.push({ from: refMatch[1], to: refMatch[2], reason: refMatch[3] });
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
 * Load a skill file and extract its gotchas.
 * Returns { skillId, gotchas, raw } or null if not found.
 */
export function loadSkillGotchas(archDir, skillId) {
  const content = loadFile(archDir, "skills", `${skillId}.skill`);
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
