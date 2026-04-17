import fs from "fs";
import path from "path";
import { loadFile, parseIndex, loadSkillGotchas, loadGraphCluster } from "../../lib/parsers.mjs";
import * as log from "../../lib/logger.mjs";

export function cmdPreflight(archDir, featureId, layer) {
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
