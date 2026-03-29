#!/usr/bin/env node

/**
 * arch-resolve — Agent-callable context resolution and pre-flight checks
 * 
 * Designed for AI agents to call via tool use. Returns structured JSON
 * so the agent doesn't waste tokens reasoning about file paths, dependencies,
 * or next steps it can look up deterministically.
 * 
 * Commands:
 *   node resolve.mjs context "<prompt text>"     Resolve keywords → nodes + skills + files
 *   node resolve.mjs preflight <feature> <layer>  Verify target before generating code
 *   node resolve.mjs scaffold <featureId>         Return checklist for new feature scaffolding
 *   node resolve.mjs lookup <nodeOrSkillId>       Look up a single node or skill details
 * 
 * All commands output JSON to stdout. Human-readable with --pretty flag.
 */

import fs from "fs";
import path from "path";
import { findArchDir as _findArchDir } from "../lib/shared.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function findArchDir() {
  return _findArchDir({ requireFile: "SYSTEM.md" });
}

function loadFile(archDir, ...segments) {
  const fp = path.join(archDir, ...segments);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf8");
}

function parseIndex(content) {
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

function parseSystem(content) {
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

function loadGraphCluster(archDir, clusterId) {
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

function loadSkillGotchas(archDir, skillId) {
  const content = loadFile(archDir, "skills", `${skillId}.skill`);
  if (!content) return null;
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
  return { skillId, gotchas, raw: content };
}

function loadApiDigest(archDir, apiId) {
  const content = loadFile(archDir, "apis", `${apiId}.api`);
  if (!content) return null;
  const endpoints = [];
  for (const line of content.split("\n")) {
    const epMatch = line.match(/^(GET|POST|PUT|PATCH|DEL|DELETE)\s+(.+)/);
    if (epMatch) endpoints.push(line.trim());
  }
  return { apiId, endpoints, raw: content };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

function cmdContext(archDir, promptText) {
  const indexContent = loadFile(archDir, "INDEX.md");
  const systemContent = loadFile(archDir, "SYSTEM.md");
  const index = parseIndex(indexContent);
  const system = parseSystem(systemContent);

  // Tokenize prompt into words
  const words = promptText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

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

  // Relevant rules (from SYSTEM.md)
  const relevantRules = system.rules;

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
    rules: relevantRules,
    reservedWords: relevantReserved,
    suggestedLens: promptText.match(/review|check|audit|find issues/i) ? "review"
      : promptText.match(/plan|research|explore|evaluate|compare/i) ? "research"
      : "implement",
  };
}

function cmdPreflight(archDir, featureId, layer) {
  const indexContent = loadFile(archDir, "INDEX.md");
  const index = parseIndex(indexContent);
  const checks = [];
  let pass = true;

  // 1. Does the feature exist in INDEX.md?
  const nodeInfo = index.nodeCluster[featureId];
  if (nodeInfo) {
    checks.push({ check: "Feature exists in INDEX.md", status: "pass", detail: `@${featureId} → [${nodeInfo.cluster}]` });
  } else {
    checks.push({ check: "Feature exists in INDEX.md", status: "fail", detail: `@${featureId} not found. Run: node extend.mjs run scaffold-feature ${featureId}` });
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
    eventEntry: `Evt${displayName}Changed [E~] : {${featureId}Id,...} | @${featureId} ⇒ THIS ⇒ [subscribers]`,
    steps: [
      `Create ${files.length} files: ${files.map(f => f.path).join(", ")}`,
      `Create .arch/clusters/${featureId}.graph with ${graphNodes.length} nodes`,
      `Add @${featureId} keyword routing to INDEX.md`,
      `Add Evt${displayName}Changed to events.graph`,
      `Implement ${files[0].layer} layer first (${files[0].path})`,
      `Write tests in parallel`,
    ],
  };
}

function cmdLookup(archDir, id) {
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
// WARMUP — Pre-session readiness gate
// ═══════════════════════════════════════════════════════════════════════════

function cmdWarmup(archDir, deep) {
  const checks = [];
  let pass = true;
  const blockers = [];
  const warnings = [];
  const actions = [];

  // ── HARD GATES (fail = cannot proceed) ────────────────────────────────

  // 1. Core files exist
  const systemContent = loadFile(archDir, "SYSTEM.md");
  if (systemContent) {
    checks.push({ id: "W001", check: "SYSTEM.md exists", status: "pass" });
  } else {
    checks.push({ id: "W001", check: "SYSTEM.md exists", status: "fail", detail: "Run node index.mjs to scaffold" });
    blockers.push("SYSTEM.md missing — no rules loaded. Run node index.mjs");
    pass = false;
  }

  const indexContent = loadFile(archDir, "INDEX.md");
  if (indexContent) {
    checks.push({ id: "W002", check: "INDEX.md exists", status: "pass" });
  } else {
    checks.push({ id: "W002", check: "INDEX.md exists", status: "fail", detail: "Run node index.mjs to scaffold" });
    blockers.push("INDEX.md missing — no context routing. Run node index.mjs");
    pass = false;
  }

  // 2. At least one graph cluster exists
  const clustersDir = path.join(archDir, "clusters");
  const graphFiles = fs.existsSync(clustersDir)
    ? fs.readdirSync(clustersDir).filter(f => f.endsWith(".graph"))
    : [];
  if (graphFiles.length > 0) {
    checks.push({ id: "W003", check: "Graph clusters exist", status: "pass", detail: `${graphFiles.length} clusters` });
  } else {
    checks.push({ id: "W003", check: "Graph clusters exist", status: "fail", detail: "No .graph files. Architecture unknown." });
    blockers.push("No graph clusters — architecture context missing. Run node index.mjs");
    pass = false;
  }

  // 3. SYSTEM.md has rules (not just a skeleton)
  if (systemContent) {
    const system = parseSystem(systemContent);
    if (system.rules.length > 0) {
      checks.push({ id: "W004", check: "SYSTEM.md has rules", status: "pass", detail: `${system.rules.length} rules` });
    } else {
      checks.push({ id: "W004", check: "SYSTEM.md has rules", status: "fail", detail: "SYSTEM.md exists but has no rules" });
      blockers.push("SYSTEM.md has no rules — the agent has no constraints. Add rules before coding.");
      pass = false;
    }

    if (Object.keys(system.reservedWords).length > 0) {
      checks.push({ id: "W005", check: "Reserved words defined", status: "pass", detail: `${Object.keys(system.reservedWords).length} words` });
    } else {
      checks.push({ id: "W005", check: "Reserved words defined", status: "warn", detail: "No reserved words — agent may use inconsistent terminology" });
      warnings.push("No reserved words defined. Consider adding $db, $auth, $err etc.");
    }
  }

  // ── QUALITY CHECKS (warn = proceed with caution) ──────────────────────

  // 4. Skill freshness
  const skillsDir = path.join(archDir, "skills");
  const skillFiles = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))
    : [];

  let staleSkills = [];
  let emptySkills = [];
  let pendingGotchas = [];
  let totalGotchas = 0;

  for (const file of skillFiles) {
    const content = fs.readFileSync(path.join(skillsDir, file), "utf8");
    const id = file.replace(".skill", "");

    // Check staleness
    const updatedMatch = content.match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m);
    if (updatedMatch && !updatedMatch[1].includes("[")) {
      const updatedDate = new Date(updatedMatch[1]);
      const daysSince = Math.floor((Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince > 90) staleSkills.push({ id, daysSince });
    }

    // Check emptiness (still a skeleton)
    const hasRealGotchas = (content.match(/^WRONG:/gm) || []).length - (content.match(/^WRONG: \[/gm) || []).length;
    if (hasRealGotchas > 0) {
      totalGotchas += hasRealGotchas;
    }
    const isPlaceholder = content.includes("[PACKAGE_NAME]") || content.includes("[How YOUR");
    if (isPlaceholder) emptySkills.push(id);

    // Check for TODO-GOTCHAs
    const todoCount = (content.match(/^# TODO-GOTCHA:/gm) || []).length;
    if (todoCount > 0) pendingGotchas.push({ id, count: todoCount });
  }

  if (skillFiles.length > 0) {
    checks.push({ id: "W006", check: "Skills present", status: "pass", detail: `${skillFiles.length} skills, ${totalGotchas} gotchas` });
  } else {
    checks.push({ id: "W006", check: "Skills present", status: "warn", detail: "No skill files — AI will use training data defaults" });
    warnings.push("No skills loaded. AI will guess at package patterns. Run node index.mjs to generate skill skeletons.");
  }

  if (emptySkills.length > 0) {
    checks.push({ id: "W007", check: "Empty/skeleton skills", status: "warn", detail: `${emptySkills.length}: ${emptySkills.slice(0, 5).join(", ")}${emptySkills.length > 5 ? "..." : ""}` });
    warnings.push(`${emptySkills.length} skill(s) are still skeletons with no real content: ${emptySkills.slice(0, 3).join(", ")}. Fill these before coding against those packages.`);
  }

  if (staleSkills.length > 0) {
    checks.push({ id: "W008", check: "Stale skills (>90 days)", status: "warn", detail: staleSkills.map(s => `${s.id}(${s.daysSince}d)`).join(", ") });
    warnings.push(`${staleSkills.length} skill(s) haven't been updated in 90+ days: ${staleSkills.map(s => s.id).join(", ")}. Check for package updates.`);
    actions.push(`Review stale skills: ${staleSkills.map(s => s.id).join(", ")}`);
  }

  if (pendingGotchas.length > 0) {
    checks.push({ id: "W009", check: "Pending TODO-GOTCHAs", status: "warn", detail: pendingGotchas.map(p => `${p.id}(${p.count})`).join(", ") });
    warnings.push(`${pendingGotchas.reduce((s, p) => s + p.count, 0)} unresolved TODO-GOTCHA(s) in: ${pendingGotchas.map(p => p.id).join(", ")}. Convert to WRONG/RIGHT/WHY format.`);
    actions.push("Run node gotcha.mjs -i to convert TODO-GOTCHAs to real gotchas");
  }

  // 5. INDEX.md cross-references
  if (indexContent) {
    const index = parseIndex(indexContent);
    if (index.crossRefs.length === 0 && Object.keys(index.nodeCluster).length > 1) {
      checks.push({ id: "W010", check: "INDEX.md cross-references", status: "warn", detail: "No cross-refs defined between features" });
      warnings.push("INDEX.md has no cross-references. Feature dependencies are unmapped.");
    } else if (index.crossRefs.length > 0) {
      checks.push({ id: "W010", check: "INDEX.md cross-references", status: "pass", detail: `${index.crossRefs.length} refs` });
    }
  }

  // ── DEEP MODE CHECKS (--deep flag) ────────────────────────────────────

  if (deep) {
    // 6. Check package.json deps against skills
    const pkgJsonPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        const allDeps = Object.keys({ ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) });
        const skillIds = skillFiles.map(f => f.replace(".skill", ""));

        // Major packages that should have skills
        const importantPkgs = allDeps.filter(d => {
          const name = d.toLowerCase();
          return ["prisma", "stripe", "keycloak", "redis", "ioredis", "bullmq", "meilisearch",
            "opensearch", "clickhouse", "pg", "drizzle", "next", "express", "hono", "fastify",
            "openai", "anthropic", "@langchain"].some(p => name.includes(p));
        });

        const uncoveredPkgs = importantPkgs.filter(pkg => {
          const pkgName = pkg.toLowerCase().replace("@", "").replace("/", "-");
          return !skillIds.some(s => pkgName.includes(s) || s.includes(pkgName.split("-")[0]));
        });

        if (uncoveredPkgs.length > 0) {
          checks.push({ id: "W011", check: "Dependencies without skills", status: "warn", detail: uncoveredPkgs.join(", ") });
          warnings.push(`${uncoveredPkgs.length} important package(s) have no .skill file: ${uncoveredPkgs.join(", ")}`);
          actions.push(`Create skills for: ${uncoveredPkgs.join(", ")} using node extend.mjs run add-skill <name>`);
        } else {
          checks.push({ id: "W011", check: "Dependencies covered by skills", status: "pass", detail: `${importantPkgs.length} major deps all have skills` });
        }
      } catch {
        checks.push({ id: "W011", check: "package.json readable", status: "warn", detail: "Could not parse package.json" });
      }
    }

    // 7. API file staleness
    const apisDir = path.join(archDir, "apis");
    if (fs.existsSync(apisDir)) {
      const apiFiles = fs.readdirSync(apisDir).filter(f => f.endsWith(".api"));
      const stubApis = [];
      for (const file of apiFiles) {
        const content = fs.readFileSync(path.join(apisDir, file), "utf8");
        if (content.includes("[VERSION]") || content.includes("[BASE_URL]")) {
          stubApis.push(file.replace(".api", ""));
        }
      }
      if (stubApis.length > 0) {
        checks.push({ id: "W012", check: "API contract stubs", status: "warn", detail: `${stubApis.length} unpopulated: ${stubApis.join(", ")}` });
        warnings.push(`${stubApis.length} .api file(s) are still stubs. AI will use training data for these APIs instead of actual contracts.`);
        actions.push(`Populate API contracts: ${stubApis.join(", ")}. Generate from OpenAPI specs or SDK types.`);
      } else if (apiFiles.length > 0) {
        checks.push({ id: "W012", check: "API contracts populated", status: "pass", detail: `${apiFiles.length} contracts` });
      }
    }

    // 8. Extension validation
    const extDir = path.join(archDir, "extensions");
    if (fs.existsSync(extDir)) {
      const regPath = path.join(extDir, "registry.json");
      if (fs.existsSync(regPath)) {
        try {
          const registry = JSON.parse(fs.readFileSync(regPath, "utf8"));
          const orphaned = registry.filter(e => !fs.existsSync(path.join(extDir, e.file)));
          if (orphaned.length > 0) {
            checks.push({ id: "W013", check: "Extension registry integrity", status: "warn", detail: `${orphaned.length} orphaned entries` });
            warnings.push(`${orphaned.length} extension(s) registered but file missing. Run node guard.mjs enforce`);
          } else {
            checks.push({ id: "W013", check: "Extension registry integrity", status: "pass", detail: `${registry.length} extensions valid` });
          }
        } catch {
          checks.push({ id: "W013", check: "Extension registry", status: "warn", detail: "Could not parse registry.json" });
        }
      }
    }
  }

  // ── ASSEMBLE RESULT ───────────────────────────────────────────────────

  // Summary stats for the agent
  const graphCount = graphFiles.length;
  const nodeCount = graphFiles.reduce((sum, f) => {
    const content = fs.readFileSync(path.join(clustersDir, f), "utf8");
    return sum + (content.match(/\[.+\]\s+:/g) || []).length;
  }, 0);

  return {
    pass,
    mode: deep ? "deep" : "quick",
    timestamp: new Date().toISOString(),
    summary: {
      graphs: graphCount,
      nodes: nodeCount,
      skills: skillFiles.length,
      gotchas: totalGotchas,
      emptySkills: emptySkills.length,
      staleSkills: staleSkills.length,
      pendingTodoGotchas: pendingGotchas.reduce((s, p) => s + p.count, 0),
    },
    blockers,
    warnings,
    actions,
    checks,
    instruction: pass
      ? "Warmup PASSED. You may proceed with code generation. Load the appropriate lens (research/implement/review) for your current task."
      : "Warmup FAILED. DO NOT generate code. Fix the blockers listed above first.",
  };
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
    case "warmup": {
      const deep = cleanArgs.includes("--deep");
      output(cmdWarmup(archDir, deep), pretty);
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
        },
        flags: { "--pretty": "Pretty-print JSON output", "--deep": "Full validation (warmup only)" },
      }, pretty);
      process.exit(1);
    }
  }
}

main();
