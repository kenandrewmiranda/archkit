#!/usr/bin/env node

/**
 * arch-resolve — Agent-callable context resolution and pre-flight checks
 * 
 * Designed for AI agents to call via tool use. Returns structured JSON
 * so the agent doesn't waste tokens reasoning about file paths, dependencies,
 * or next steps it can look up deterministically.
 * 
 * Commands:
 *   archkit resolve context "<prompt text>"     Resolve keywords → nodes + skills + files
 *   archkit resolve preflight <feature> <layer>  Verify target before generating code
 *   archkit resolve scaffold <featureId>         Return checklist for new feature scaffolding
 *   archkit resolve lookup <nodeOrSkillId>       Look up a single node or skill details
 * 
 * All commands output JSON to stdout. Human-readable with --pretty flag.
 */

import fs from "fs";
import path from "path";
import { findArchDir as _findArchDir } from "../lib/shared.mjs";
import { archkitError } from "../lib/errors.mjs";
import { loadFile, parseSystem, parseIndex, loadGraphCluster, loadSkillGotchas, loadApiDigest } from "../lib/parsers.mjs";
import { cmdWarmup } from "./resolve/warmup.mjs";
import { cmdPlan } from "./resolve/plan.mjs";
import { cmdVerifyWiring } from "./resolve/verify-wiring.mjs";
import { cmdPreflight } from "./resolve/preflight.mjs";
import { cmdScaffold } from "./resolve/scaffold.mjs";
import { expandWithSynonyms } from "../data/synonyms.mjs";
import * as log from "../lib/logger.mjs";
import { parseRequirements, checkCoverage, formatCoverageReport } from "../lib/spec-tracker.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function emitDeprecation(commandName, migration) {
  if (process.argv.includes("--no-deprecation-warning")) return;
  process.stderr.write(`[DEPRECATED] \`archkit resolve ${commandName}\` will be removed in v2.0.0.\n`);
  process.stderr.write(`  Migration: ${migration}\n`);
  process.stderr.write(`  See: https://github.com/kenandrewmiranda/archkit/issues/20\n`);
}

function findArchDir() {
  return _findArchDir({ requireFile: "SYSTEM.md" });
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

function cmdContext(archDir, promptText) {
  log.resolve(`Resolving context for: "${promptText}"`);
  const indexContent = loadFile(archDir, "INDEX.md");
  const systemContent = loadFile(archDir, "SYSTEM.md");
  const index = parseIndex(indexContent);
  const system = parseSystem(systemContent);

  // Tokenize prompt into words, then expand with synonyms
  const rawWords = promptText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const words = expandWithSynonyms(rawWords);

  // Match keywords to nodes and skills
  const matchedNodes = new Set();
  const matchedSkills = new Set();

  for (const word of words) {
    if (index.keywordNodes[word]) matchedNodes.add(index.keywordNodes[word].replace("@", ""));
    if (index.keywordSkills[word]) matchedSkills.add(index.keywordSkills[word].replace("$", ""));
  }

  // Also try bigrams (two-word phrases)
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (index.keywordNodes[bigram]) matchedNodes.add(index.keywordNodes[bigram].replace("@", ""));
    if (index.keywordSkills[bigram]) matchedSkills.add(index.keywordSkills[bigram].replace("$", ""));
  }

  log.resolve(`Matched ${matchedNodes.size} nodes, ${matchedSkills.size} skills`);

  // Resolve cross-references
  const crossRefNodes = new Set();
  for (const node of matchedNodes) {
    for (const ref of index.crossRefs) {
      if (ref.from === node) crossRefNodes.add(ref.to);
      if (ref.to === node) crossRefNodes.add(ref.from);
    }
  }

  // Load matched clusters
  const clusters = {};
  for (const node of [...matchedNodes, ...crossRefNodes]) {
    const info = index.nodeCluster[node];
    const clusterId = info?.cluster || node;
    if (!clusters[clusterId]) {
      clusters[clusterId] = loadGraphCluster(archDir, clusterId);
    }
  }

  // Load matched skills
  const skills = {};
  for (const skillId of matchedSkills) {
    skills[skillId] = loadSkillGotchas(archDir, skillId);
  }

  // Load matched APIs
  const apis = {};
  for (const skillId of matchedSkills) {
    const api = loadApiDigest(archDir, skillId);
    if (api && api.endpoints.length > 0) apis[skillId] = api;
  }

  // Build file paths from matched nodes
  const filePaths = {};
  for (const node of matchedNodes) {
    const info = index.nodeCluster[node];
    if (info) filePaths[node] = info.basePath;
  }

  // Relevant reserved words
  const relevantReserved = system.reservedWords;

  return {
    prompt: promptText,
    matched: {
      nodes: [...matchedNodes],
      skills: [...matchedSkills],
      crossRefs: [...crossRefNodes].filter(n => !matchedNodes.has(n)),
    },
    filePaths,
    clusters: Object.fromEntries(
      Object.entries(clusters).filter(([, v]) => v).map(([k, v]) => [k, { nodes: v.nodes }])
    ),
    skills: Object.fromEntries(
      Object.entries(skills).filter(([, v]) => v).map(([k, v]) => [k, { gotchas: v.gotchas }])
    ),
    apis: Object.fromEntries(
      Object.entries(apis).map(([k, v]) => [k, { endpoints: v.endpoints }])
    ),
    rules: (() => {
      // Always include rules containing $reserved word references or universal patterns
      const always = system.rules.filter(r =>
        /\$\w+/.test(r) ||
        /naming|convention|file|import|test|max complexity|controller|service|repo/i.test(r)
      );
      // Include contextual rules only if they mention matched features or skills
      const contextual = system.rules.filter(r => {
        if (always.includes(r)) return false;
        const rl = r.toLowerCase();
        for (const node of matchedNodes) { if (rl.includes(node)) return true; }
        for (const skill of matchedSkills) { if (rl.includes(skill)) return true; }
        return false;
      });
      // If nothing matched (broad query), return all rules
      return matchedNodes.size === 0 && matchedSkills.size === 0
        ? system.rules
        : [...new Set([...always, ...contextual])];
    })(),
    totalRules: system.rules.length,
    reservedWords: relevantReserved,
    suggestedLens: promptText.match(/review|check|audit|find issues/i) ? "review"
      : promptText.match(/plan|research|explore|evaluate|compare/i) ? "research"
      : "implement",
  };
}


function cmdLookup(archDir, id) {
  log.resolve(`Looking up: ${id}`);
  // Try as node (from graph)
  const indexContent = loadFile(archDir, "INDEX.md");
  const index = parseIndex(indexContent);

  const nodeInfo = index.nodeCluster[id];
  if (nodeInfo) {
    const cluster = loadGraphCluster(archDir, nodeInfo.cluster);
    return {
      type: "node",
      id,
      cluster: nodeInfo.cluster,
      basePath: nodeInfo.basePath,
      graph: cluster ? { nodes: cluster.nodes } : null,
    };
  }

  // Try as skill
  const skill = loadSkillGotchas(archDir, id);
  if (skill) {
    const api = loadApiDigest(archDir, id);
    return {
      type: "skill",
      id,
      gotchas: skill.gotchas,
      hasApi: !!api,
      apiEndpoints: api ? api.endpoints.length : 0,
    };
  }

  // Try as graph cluster directly
  const cluster = loadGraphCluster(archDir, id);
  if (cluster) {
    return { type: "cluster", id, nodes: cluster.nodes };
  }

  return { type: "not_found", id, suggestion: "Check INDEX.md for available nodes and skills." };
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP-REUSABLE PURE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function runLookupJson({ archDir, id }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  if (!id || typeof id !== "string") throw archkitError("invalid_input", "id is required (string)", { suggestion: "Pass a node, skill, or cluster id." });

  // Search cluster files for a matching cluster id or node id
  const clustersDir = path.join(archDir, "clusters");
  if (fs.existsSync(clustersDir)) {
    for (const file of fs.readdirSync(clustersDir).filter(f => f.endsWith(".graph"))) {
      const clusterId = file.replace(".graph", "");
      const cluster = loadGraphCluster(archDir, clusterId);
      if (!cluster) continue;

      // Match as cluster id
      if (clusterId === id) {
        return { type: "cluster", id: clusterId, nodes: cluster.nodes, raw: cluster.raw };
      }

      // Match as a structured node (parsed by loadGraphCluster)
      const structuredNode = cluster.nodes.find(n => n.id === id);
      if (structuredNode) {
        return { type: "node", id, cluster: clusterId, ...structuredNode };
      }
    }
  }

  // Search skills
  const skillsDir = path.join(archDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))) {
      const skillId = file.replace(".skill", "");
      if (skillId === id) {
        const skill = loadSkillGotchas(archDir, skillId);
        return { type: "skill", id: skillId, gotchas: skill ? skill.gotchas : [] };
      }
    }
  }

  throw archkitError("node_not_found", `No node, skill, or cluster found with id: ${id}`, {
    suggestion: "Run `archkit stats --json` to see available ids.",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

function output(data, pretty) {
  if (pretty) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(JSON.stringify(data));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  const args = process.argv.slice(2);
  const pretty = args.includes("--pretty");
  const cleanArgs = args.filter(a => a !== "--pretty");
  const cmd = cleanArgs[0];
  log.resolve(`Command: ${cmd}`);

  const archDir = findArchDir();
  if (!archDir) {
    output({ error: "No .arch/ directory found. Run archkit first." }, pretty);
    process.exit(1);
  }

  switch (cmd) {
    case "context": {
      emitDeprecation("context", "read .arch/INDEX.md directly for keyword routing.");
      const prompt = cleanArgs.slice(1).join(" ");
      if (!prompt) { output({ error: "Usage: resolve.mjs context \"<prompt text>\"" }, pretty); process.exit(1); }
      output(cmdContext(archDir, prompt), pretty);
      break;
    }
    case "preflight": {
      const feature = cleanArgs[1];
      const layer = cleanArgs[2];
      if (!feature || !layer) { output({ error: "Usage: resolve.mjs preflight <feature> <layer>" }, pretty); process.exit(1); }
      const result = cmdPreflight(archDir, feature, layer);
      output(result, pretty);
      // v1.3: preflight returns passWithoutAction (informational), not pass
      // (which would block). Agents check passWithoutAction themselves.
      break;
    }
    case "scaffold": {
      const featureId = cleanArgs[1];
      if (!featureId) { output({ error: "Usage: resolve.mjs scaffold <featureId> [--apply] [--overwrite]" }, pretty); process.exit(1); }
      const opts = {
        apply: args.includes("--apply"),
        overwrite: args.includes("--overwrite"),
      };
      output(cmdScaffold(archDir, featureId, opts), pretty);
      break;
    }
    case "lookup": {
      const id = cleanArgs[1];
      if (!id) { output({ error: "Usage: resolve.mjs lookup <nodeOrSkillId>" }, pretty); process.exit(1); }
      output(cmdLookup(archDir, id), pretty);
      break;
    }
    case "plan": {
      emitDeprecation("plan", "read .arch/CONTEXT.compact.md directly, or use `archkit resolve preflight <feature> <layer>` for live data.");
      const prompt = cleanArgs.slice(1).join(" ");
      if (!prompt) { output({ error: "Usage: archkit resolve plan \"<prompt text>\"" }, pretty); process.exit(1); }
      output(cmdPlan(archDir, prompt), pretty);
      break;
    }
    case "warmup": {
      const deep = cleanArgs.includes("--deep");
      output(cmdWarmup(archDir, deep), pretty);
      break;
    }
    case "verify-wiring": {
      const srcDir = cleanArgs[1] || "src";
      output(cmdVerifyWiring(path.resolve(srcDir)), pretty);
      break;
    }
    case "audit-spec": {
      const specFile = cleanArgs[1];
      const srcDir = cleanArgs[2] || "src";
      if (!specFile) { output({ error: "Usage: archkit resolve audit-spec <spec-file> [src-dir]" }, pretty); process.exit(1); }
      log.resolve(`Auditing spec: ${specFile} against ${srcDir}`);
      const reqs = parseRequirements(path.resolve(specFile));
      if (reqs.length === 0) { output({ error: "No requirements found. Use format: - [ ] REQ-001: Description" }, pretty); process.exit(1); }
      log.resolve(`Found ${reqs.length} requirements`);
      const results = checkCoverage(reqs, path.resolve(srcDir));
      output(formatCoverageReport(results), pretty);
      break;
    }
    default: {
      output({
        error: "Unknown command",
        usage: {
          warmup: "resolve.mjs warmup [--deep] — Pre-session readiness check (MUST RUN FIRST)",
          context: "resolve.mjs context \"<prompt>\" — Resolve keywords to nodes, skills, files",
          preflight: "resolve.mjs preflight <feature> <layer> — Verify target before generating code",
          scaffold: "resolve.mjs scaffold <featureId> — Get checklist for new feature",
          lookup: "resolve.mjs lookup <id> — Look up a node, skill, or cluster",
          plan: "archkit resolve plan \"<prompt>\" — Get structured implementation plan",
          "audit-spec": "archkit resolve audit-spec <spec.md> [src-dir] — Check spec requirement coverage",
          "verify-wiring": "archkit resolve verify-wiring [src-dir] — Scan for unwired/dead components",
        },
        flags: { "--pretty": "Pretty-print JSON output", "--deep": "Full validation (warmup only)" },
      }, pretty);
      process.exit(1);
    }
  }
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main();
}
