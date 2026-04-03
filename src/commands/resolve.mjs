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
import { loadFile, parseSystem, parseIndex, loadGraphCluster, loadSkillGotchas, loadApiDigest } from "../lib/parsers.mjs";
import { cmdWarmup } from "./resolve/warmup.mjs";
import { cmdPlan } from "./resolve/plan.mjs";
import { cmdVerifyWiring } from "./resolve/verify-wiring.mjs";
import { expandWithSynonyms } from "../data/synonyms.mjs";
import * as log from "../lib/logger.mjs";
import { parseRequirements, checkCoverage, formatCoverageReport } from "../lib/spec-tracker.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

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

function cmdPreflight(archDir, featureId, layer) {
  log.resolve(`Preflight check: ${featureId}.${layer}`);
  const indexContent = loadFile(archDir, "INDEX.md");
  const index = parseIndex(indexContent);
  const checks = [];
  let pass = true;

  // 1. Does the feature exist in INDEX.md?
  const nodeInfo = index.nodeCluster[featureId];
  if (nodeInfo) {
    checks.push({ check: "Feature exists in INDEX.md", status: "pass", detail: `@${featureId} → [${nodeInfo.cluster}]` });
  } else {
    checks.push({ check: "Feature exists in INDEX.md", status: "fail", detail: `@${featureId} not found. Run: archkit extend run scaffold-feature ${featureId}` });
    pass = false;
  }

  // 2. Does the .graph file exist?
  const clusterId = nodeInfo?.cluster || featureId;
  const graphContent = loadFile(archDir, "clusters", `${clusterId}.graph`);
  if (graphContent) {
    checks.push({ check: "Graph cluster exists", status: "pass", detail: `clusters/${clusterId}.graph` });

    // 3. Does the specific layer node exist in the graph?
    const layerSuffix = { controller: "Cont", service: "Ser", repository: "Repo", type: "Type", validation: "Val", test: "Test" };
    const suffix = layerSuffix[layer] || layer;
    const Id = featureId.charAt(0).toUpperCase() + featureId.slice(1);
    const expectedNode = `${Id}${suffix}`;

    if (graphContent.includes(expectedNode)) {
      checks.push({ check: `Node ${expectedNode} exists in graph`, status: "pass" });
    } else {
      checks.push({ check: `Node ${expectedNode} exists in graph`, status: "warn", detail: `Not found in ${clusterId}.graph. Add it before generating code.` });
    }
  } else {
    checks.push({ check: "Graph cluster exists", status: "fail", detail: `clusters/${clusterId}.graph not found` });
    pass = false;
  }

  // 4. Resolve the target file path
  const basePath = nodeInfo?.basePath || `src/features/${featureId}/`;
  const fileExtensions = { controller: "controller.ts", service: "service.ts", repository: "repository.ts", type: "types.ts", validation: "validation.ts", test: "test.ts" };
  const targetFile = `${basePath}${featureId}.${fileExtensions[layer] || `${layer}.ts`}`;
  checks.push({ check: "Target file path", status: "info", detail: targetFile });

  // 5. Check if file already exists on disk
  const fullPath = path.join(process.cwd(), targetFile);
  if (fs.existsSync(fullPath)) {
    checks.push({ check: "File exists on disk", status: "info", detail: "File already exists. This is a modification, not creation." });
  } else {
    checks.push({ check: "File exists on disk", status: "info", detail: "File does not exist. This is a new file." });
  }

  // 6. Identify dependencies from the graph
  const graph = loadGraphCluster(archDir, clusterId);
  if (graph) {
    const Id = featureId.charAt(0).toUpperCase() + featureId.slice(1);
    const layerSuffix = { controller: "Cont", service: "Ser", repository: "Repo" };
    const nodeId = `${Id}${layerSuffix[layer] || ""}`;
    const node = graph.nodes.find(n => n.id === nodeId);
    if (node && node.flow) {
      checks.push({ check: "Dependencies from graph", status: "info", detail: node.flow });
    }
  }

  // 7. Check for relevant skills
  const relevantSkills = [];
  for (const [skillId, skillPath] of Object.entries(index.skillFiles)) {
    const skill = loadSkillGotchas(archDir, skillId);
    if (skill && skill.gotchas.length > 0) {
      relevantSkills.push({ id: skillId, gotchaCount: skill.gotchas.length });
    }
  }
  if (relevantSkills.length > 0) {
    checks.push({ check: "Skills with gotchas available", status: "info", detail: relevantSkills.map(s => `${s.id}(${s.gotchaCount})`).join(", ") });
  }

  return {
    feature: featureId,
    layer,
    targetFile,
    pass,
    checks,
  };
}

function cmdScaffold(archDir, featureId) {
  log.resolve(`Scaffolding feature: ${featureId}`);
  const displayName = featureId.charAt(0).toUpperCase() + featureId.slice(1);
  const systemContent = loadFile(archDir, "SYSTEM.md");
  const system = parseSystem(systemContent);

  // Determine file structure based on pattern
  const isLayered = system.pattern.toLowerCase().includes("layered") || system.pattern.toLowerCase().includes("cont");
  const isRealtime = system.pattern.toLowerCase().includes("gateway") || system.pattern.toLowerCase().includes("event-driven");
  const isAI = system.pattern.toLowerCase().includes("hexagonal") || system.pattern.toLowerCase().includes("pipeline");
  const isMobile = system.pattern.toLowerCase().includes("mvvm") || system.pattern.toLowerCase().includes("screen");

  let files, graphNodes;

  if (isLayered) {
    files = [
      { path: `src/features/${featureId}/${featureId}.controller.ts`, layer: "controller", description: `${displayName} HTTP routes — validate, delegate, respond` },
      { path: `src/features/${featureId}/${featureId}.service.ts`, layer: "service", description: `${displayName} business logic — all domain rules here` },
      { path: `src/features/${featureId}/${featureId}.repository.ts`, layer: "repository", description: `${displayName} database access — returns typed objects` },
      { path: `src/features/${featureId}/${featureId}.types.ts`, layer: "types", description: `${displayName} types, DTOs, interfaces` },
      { path: `src/features/${featureId}/${featureId}.validation.ts`, layer: "validation", description: `${displayName} Zod schemas for input validation` },
      { path: `src/features/${featureId}/${featureId}.test.ts`, layer: "test", description: `${displayName} unit and integration tests` },
    ];
    graphNodes = [
      `${displayName}Cont  [C]    : ${displayName} routes | $auth → THIS → ${displayName}Ser`,
      `${displayName}Ser   [S]    : ${displayName} business logic | ${displayName}Cont ← THIS → ${displayName}Repo ⇒ Evt${displayName}Changed`,
      `${displayName}Repo  [R]    : ${featureId} tables | ${displayName}Ser ← THIS → $db`,
      `${displayName}Type  [T]    : ${displayName}, Create${displayName}Dto, Update${displayName}Dto`,
      `${displayName}Val   [V]    : Zod schemas | ${displayName}Cont ← THIS`,
      `${displayName}Test  [X]    : unit + integration tests`,
    ];
  } else if (isRealtime) {
    files = [
      { path: `src/handlers/${featureId}.handler.ts`, layer: "handler", description: `${displayName} message handler` },
      { path: `src/domain/${featureId}.ts`, layer: "domain", description: `${displayName} pure logic (no I/O)` },
      { path: `src/persistence/${featureId}.repo.ts`, layer: "persistence", description: `${displayName} async database writes` },
    ];
    graphNodes = [
      `Hnd${displayName}  [H]    : ${displayName} handler | GateConn ← THIS → Dom${displayName}`,
      `Dom${displayName}  [D]    : ${displayName} pure logic | Hnd${displayName} ← THIS`,
      `Pers${displayName} [R~]   : ${displayName} persistence | Hnd${displayName} ← THIS → $db`,
    ];
  } else if (isAI) {
    files = [
      { path: `src/chains/${featureId}.chain.py`, layer: "chain", description: `${displayName} LLM orchestration pipeline` },
      { path: `src/prompts/system/${featureId}_system.md`, layer: "prompt", description: `${displayName} system prompt template` },
      { path: `src/eval/${featureId}.eval.yaml`, layer: "eval", description: `${displayName} Promptfoo test suite` },
    ];
    graphNodes = [
      `Chain${displayName} [L]    : ${displayName} chain | API ← THIS → $llm,$vec,$guard`,
      `Prompt${displayName}Sys [T] : ${displayName} system prompt | Chain${displayName} ← THIS`,
      `Eval${displayName}  [X]    : ${displayName} eval suite | Chain${displayName} ← THIS`,
    ];
  } else if (isMobile) {
    files = [
      { path: `src/screens/${displayName}Screen.tsx`, layer: "screen", description: `${displayName} screen (thin, no logic)` },
      { path: `src/features/${featureId}/use${displayName}.ts`, layer: "hook", description: `${displayName} custom hook` },
      { path: `src/features/${featureId}/${featureId}.service.ts`, layer: "service", description: `${displayName} data service` },
      { path: `src/features/${featureId}/${featureId}.model.ts`, layer: "model", description: `${displayName} WatermelonDB model` },
    ];
    graphNodes = [
      `Scr${displayName}  [D]    : ${displayName} screen | $nav ← THIS → Hook${displayName}`,
      `Hook${displayName} [U]    : ${displayName} hook | Scr${displayName} ← THIS → Ser${displayName}`,
      `Ser${displayName}  [S]    : ${displayName} service | Hook${displayName} ← THIS → $api,DB${displayName}`,
      `DB${displayName}   [R]    : ${displayName} local model | Ser${displayName} ← THIS → $sync`,
    ];
  } else {
    // Generic fallback
    files = [
      { path: `src/features/${featureId}/${featureId}.ts`, layer: "module", description: `${displayName} module` },
      { path: `src/features/${featureId}/${featureId}.test.ts`, layer: "test", description: `${displayName} tests` },
    ];
    graphNodes = [`${displayName} [S] : ${displayName} | THIS → $db`];
  }

  return {
    feature: featureId,
    displayName,
    pattern: system.pattern,
    files,
    graph: {
      file: `.arch/clusters/${featureId}.graph`,
      content: `--- ${featureId} [feature] ---\n${graphNodes.join("\n")}\n---`,
    },
    indexUpdate: {
      keywordEntry: `${featureId} → @${featureId}`,
      clusterEntry: `@${featureId} = [${featureId}] → ${files[0].path.split(featureId)[0]}`,
    },
    eventEntry: system.pattern.toLowerCase().includes("event") || system.reservedWords["$bus"]
      ? `Evt${displayName}Changed [E~] : {${featureId}Id,...} | @${featureId} ⇒ THIS ⇒ [subscribers]`
      : null,
    steps: [
      `Create ${files.length} files: ${files.map(f => f.path).join(", ")}`,
      `Create .arch/clusters/${featureId}.graph with ${graphNodes.length} nodes`,
      `Add @${featureId} keyword routing to INDEX.md`,
      ...(system.pattern.toLowerCase().includes("event") || system.reservedWords["$bus"]
        ? [`Add Evt${displayName}Changed to events.graph`]
        : []),
      `Implement ${files[0].layer} layer first (${files[0].path})`,
      `Write tests in parallel`,
    ],
    relevantGotchas: (() => {
      const allGotchas = {};
      const skillsDir = path.join(archDir, "skills");
      if (fs.existsSync(skillsDir)) {
        for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))) {
          const skillId = file.replace(".skill", "");
          const skill = loadSkillGotchas(archDir, skillId);
          if (skill && skill.gotchas.length > 0) {
            allGotchas[skillId] = skill.gotchas;
          }
        }
      }
      return allGotchas;
    })(),
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
      if (!result.pass) process.exit(1);
      break;
    }
    case "scaffold": {
      const featureId = cleanArgs[1];
      if (!featureId) { output({ error: "Usage: resolve.mjs scaffold <featureId>" }, pretty); process.exit(1); }
      output(cmdScaffold(archDir, featureId), pretty);
      break;
    }
    case "lookup": {
      const id = cleanArgs[1];
      if (!id) { output({ error: "Usage: resolve.mjs lookup <nodeOrSkillId>" }, pretty); process.exit(1); }
      output(cmdLookup(archDir, id), pretty);
      break;
    }
    case "plan": {
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
