import fs from "fs";
import path from "path";
import { loadFile, parseSystem, parseIndex, loadSkillGotchas, loadGraphCluster } from "../../lib/parsers.mjs";
import { expandWithSynonyms } from "../../data/synonyms.mjs";

export function cmdPlan(archDir, promptText) {
  const indexContent = loadFile(archDir, "INDEX.md");
  const systemContent = loadFile(archDir, "SYSTEM.md");
  const index = parseIndex(indexContent);
  const system = parseSystem(systemContent);

  // Resolve context (same as cmdContext but produces a plan)
  const rawWords = promptText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const words = expandWithSynonyms(rawWords);

  const matchedNodes = new Set();
  const matchedSkills = new Set();

  for (const word of words) {
    if (index.keywordNodes[word]) matchedNodes.add(index.keywordNodes[word].replace("@", ""));
    if (index.keywordSkills[word]) matchedSkills.add(index.keywordSkills[word].replace("$", ""));
  }

  // Determine if this is a new feature or modification
  const isNewFeature = matchedNodes.size === 0;

  // Build ordered plan
  const plan = {
    prompt: promptText,
    type: isNewFeature ? "new_feature" : "modification",
    affectedFeatures: [...matchedNodes],
    requiredSkills: [...matchedSkills],
    steps: [],
  };

  if (isNewFeature) {
    const featureId = rawWords[rawWords.length - 1]; // last word as feature name guess
    plan.steps = [
      { order: 1, action: "scaffold", command: `archkit resolve scaffold ${featureId}`, description: "Generate feature file structure and graph" },
      { order: 2, action: "implement_types", description: "Define TypeScript types and DTOs first" },
      { order: 3, action: "implement_validation", description: "Create Zod validation schemas" },
      { order: 4, action: "implement_repository", description: "Implement database access layer" },
      { order: 5, action: "implement_service", description: "Implement business logic in service layer" },
      { order: 6, action: "implement_controller", description: "Wire up HTTP routes (thin — validate, delegate, respond)" },
      { order: 7, action: "write_tests", description: "Write unit tests for service, integration tests for controller" },
      { order: 8, action: "review", command: "archkit review --staged", description: "Run architecture compliance check" },
    ];
  } else {
    // Modification plan
    const steps = [];
    let order = 1;

    for (const node of matchedNodes) {
      const nodeInfo = index.nodeCluster[node];
      if (nodeInfo) {
        steps.push({
          order: order++,
          action: "preflight",
          command: `archkit resolve preflight ${node} service`,
          description: `Verify ${node} feature target before modifying`,
        });
      }
    }

    steps.push({
      order: order++,
      action: "implement",
      description: `Modify affected files in: ${[...matchedNodes].map(n => index.nodeCluster[n]?.basePath || `src/features/${n}/`).join(", ")}`,
    });

    steps.push({
      order: order++,
      action: "write_tests",
      description: "Update/add tests for changed behavior",
    });

    steps.push({
      order: order++,
      action: "review",
      command: "archkit review --staged",
      description: "Run architecture compliance check",
    });

    plan.steps = steps;
  }

  // Add gotchas for matched skills
  const gotchas = {};
  for (const skillId of matchedSkills) {
    const skill = loadSkillGotchas(archDir, skillId);
    if (skill && skill.gotchas.length > 0) {
      gotchas[skillId] = skill.gotchas;
    }
  }
  plan.gotchas = gotchas;

  // Add applicable rules
  plan.rules = system.rules;
  plan.pattern = system.pattern;

  return plan;
}
