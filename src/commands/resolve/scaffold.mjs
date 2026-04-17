import fs from "fs";
import path from "path";
import { loadFile, parseSystem, loadSkillGotchas } from "../../lib/parsers.mjs";
import * as log from "../../lib/logger.mjs";

export function cmdScaffold(archDir, featureId) {
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
      `Implement types and validation schemas first (contracts before logic)`,
      `Implement ${files[0].layer} layer`,
      `Write unit tests for service/domain logic (Ref: Fowler — Test Pyramid)`,
      `Write integration test verifying API endpoint returns correct status codes (Ref: RFC 7231 §6)`,
      `Test error responses: 400 (validation), 404 (not found), 401/403 (auth) (Ref: RFC 7231 §6.5)`,
      `Run: archkit review --staged (must pass with zero errors)`,
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
