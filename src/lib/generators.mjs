import { ICONS } from "./shared.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

export function genSystemMd(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `# SYSTEM.md\n\n`;
  o += `## App: ${cfg.appName}\n`;
  o += `## Type: ${at.name}\n`;
  o += `## Stack: ${Object.entries(cfg.stack).map(([k,v]) => `${k}: ${v}`).join(" | ")}\n`;
  o += `## Pattern: ${at.pattern}\n\n`;
  o += `## Rules\n`;
  at.rules.forEach(r => o += `- ${r}\n`);
  o += `\n## Reserved Words\n`;
  for (const [k, v] of Object.entries(at.reservedWords)) o += `${k} = ${v}\n`;
  o += `\n## Naming\n`;
  o += `Files: kebab-case | Types: PascalCase | Funcs: camelCase | Tables: snake_case | Env: SCREAMING_SNAKE\n`;
  o += `\n## On Generate\n`;
  o += `1. State which layer this code belongs to and the file path\n`;
  o += `2. Reference $symbols for all dependencies\n`;
  if (at.reservedWords["$tenant"]) o += `3. Include $tenant in all DB operations\n`;
  o += `${at.reservedWords["$tenant"] ? "4" : "3"}. Throw $err on failure paths\n`;
  o += `${at.reservedWords["$tenant"] ? "5" : "4"}. Write the corresponding test\n`;
  o += `\n## Session Protocol (NON-NEGOTIABLE)\n`;
  o += `- BEFORE any code generation in a new session: run \`archkit resolve warmup\`\n`;
  o += `- If warmup returns blockers: FIX THEM before writing any code. No exceptions.\n`;
  o += `- If warmup returns warnings: ACKNOWLEDGE them and proceed with awareness.\n`;
  o += `- BEFORE generating a new feature: run \`archkit resolve scaffold <featureId>\` for the checklist.\n`;
  o += `- BEFORE generating code for an existing feature: run \`archkit resolve preflight <feature> <layer>\`\n`;
  o += `- When the prompt is ambiguous: run \`archkit resolve context "<prompt>"\` to resolve to specific nodes and files.\n`;
  o += `- AT SESSION END: suggest running \`archkit gotcha --debrief\` to capture learnings.\n`;
  o += `\n## Delegation Principle\n`;
  o += `Delegate everything deterministic to sub-agents and CLI tools first. The main agent finalizes with judgment.\n\n`;
  o += `### Sub-agent first (70-80% of the work, cheap tokens):\n`;
  o += `- Scaffolding files and boilerplate: \`resolve.mjs scaffold\` + sub-agent generates from checklist\n`;
  o += `- Resolving context and dependencies: \`resolve.mjs context\` + \`resolve.mjs preflight\`\n`;
  o += `- Checking code against rules: \`review.mjs --agent\` (sub-agent reads JSON, reports findings)\n`;
  o += `- Looking up patterns and gotchas: \`resolve.mjs lookup\` (sub-agent applies, not re-derives)\n`;
  o += `- Repetitive CRUD: sub-agent clones patterns from existing features, doesn't reason from scratch\n\n`;
  o += `### Main agent finalizes (20-30% of the work, expensive tokens):\n`;
  o += `- Review sub-agent output with TDD approach: write failing test FIRST, then verify the generated code passes\n`;
  o += `- Handle edge cases, error paths, and security concerns that require judgment\n`;
  o += `- Make architectural decisions (should this be a new feature or extend an existing one?)\n`;
  o += `- Resolve ambiguity in requirements\n`;
  o += `- Final code review: does this fit the system, not just work in isolation?\n\n`;
  o += `### The TDD finalization loop:\n`;
  o += `1. Sub-agent generates implementation from scaffold/checklist\n`;
  o += `2. Main agent writes a failing test that captures the REAL requirement\n`;
  o += `3. Main agent verifies sub-agent code passes (or fixes the delta)\n`;
  o += `4. Main agent runs \`review.mjs --agent\` as final gate\n`;
  o += `5. If review passes: done. If not: fix findings, re-run.\n`;
  return o;
}

export function genIndexMd(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `# INDEX.md\n\n`;
  o += `## Conv: ${at.folderConv}\n`;
  o += `## Shared: ${at.sharedConv}\n\n`;
  o += `## Keywords → Nodes\n`;
  cfg.features.forEach(f => o += `${f.keywords} → @${f.id}\n`);
  o += `\n`;
  if (cfg.skills.length > 0) {
    o += `## Keywords → Skills\n`;
    cfg.skills.forEach(sid => {
      const sk = SKILL_CATALOG.find(s => s.id === sid);
      if (sk) o += `${sk.keywords} → $${sk.id}\n`;
    });
    o += `\n`;
  }
  o += `## Nodes → Clusters → Files\n`;
  cfg.features.forEach(f => {
    let base;
    if (["saas","ecommerce","mobile"].includes(cfg.appType)) base = `src/features/${f.id}/`;
    else if (cfg.appType === "data") base = `pipelines/ + api/ + semantic/`;
    else if (cfg.appType === "realtime") base = `src/handlers/ + src/domain/`;
    else if (cfg.appType === "ai") base = `src/chains/ + src/prompts/`;
    else if (cfg.appType === "content") base = `src/pages/ + src/components/`;
    else base = `src/${f.id}/`;
    o += `@${f.id} = [${f.id}] → ${base}\n`;
  });
  o += `\n`;
  if (cfg.skills.length > 0) {
    o += `## Skills → Files\n`;
    cfg.skills.forEach(s => o += `$${s} → .arch/skills/${s}.skill\n`);
    o += `\n`;
  }
  o += `## Cross-Refs\n`;
  o += `# TODO: Map which features depend on which other features\n`;
  cfg.features.forEach((f, i) => {
    if (i < cfg.features.length - 1) o += `# @${f.id} → @${cfg.features[i+1].id} (describe relationship)\n`;
  });
  return o;
}

export function genGraph(feature, cfg) {
  const at = APP_TYPES[cfg.appType];
  const id = feature.id;
  const Id = id.charAt(0).toUpperCase() + id.slice(1);
  let o = `--- ${id} [feature] ---\n`;
  switch (at.graphGen) {
    case "layered":
      o += `${Id}Cont  [C]    : ${feature.name} routes | $auth → THIS → ${Id}Ser\n`;
      o += `${Id}Ser   [S]    : ${feature.name} business logic | ${Id}Cont ← THIS → ${Id}Repo ⇒ Evt${Id}Changed\n`;
      o += `${Id}Repo  [R]    : ${id} tables${at.reservedWords["$rls"]?", RLS $tenant":""} | ${Id}Ser ← THIS → $db\n`;
      o += `${Id}Type  [T]    : ${Id}, Create${Id}Dto, Update${Id}Dto\n`;
      o += `${Id}Val   [V]    : Zod schemas for ${id} input | ${Id}Cont ← THIS\n`;
      o += `${Id}Test  [X]    : unit + integration tests\n`;
      break;
    case "realtime":
      o += `Hnd${Id}   [H]    : ${feature.name} message handler | GateConn ← THIS → Dom${Id},Pers${Id}\n`;
      o += `Dom${Id}   [D]    : ${feature.name} pure logic (no I/O) | Hnd${Id} ← THIS\n`;
      o += `Pers${Id}  [R~]   : ${feature.name} async persistence | Hnd${Id} ← THIS → $db\n`;
      break;
    case "data":
      o += `Pipe${Id}  [P]    : ${feature.name} pipeline | Upstream ← THIS → $ch\n`;
      o += `Sem${Id}   [U]    : ${feature.name} Cube metric/dim | $ch → THIS → APIQuery\n`;
      break;
    case "ai":
      o += `Chain${Id} [L]    : ${feature.name} chain | API ← THIS → $llm,$vec,$guard\n`;
      o += `Prompt${Id}Sys [T] : ${feature.name} system prompt | Chain${Id} ← THIS\n`;
      o += `Eval${Id}  [X]    : ${feature.name} eval suite | Chain${Id} ← THIS\n`;
      break;
    case "mobile":
      o += `Scr${Id}   [D]    : ${feature.name} screen (thin) | $nav ← THIS → Hook${Id}\n`;
      o += `Hook${Id}  [U]    : ${feature.name} hook | Scr${Id} ← THIS → Ser${Id}\n`;
      o += `Ser${Id}   [S]    : ${feature.name} service | Hook${Id} ← THIS → $api,DB${Id}\n`;
      o += `DB${Id}    [R]    : ${feature.name} local model | Ser${Id} ← THIS → $sync\n`;
      break;
    case "content":
      o += `Pg${Id}    [D]    : ${feature.name} page (static) | $cms → THIS → $seo,$img\n`;
      break;
    case "internal":
      o += `Pg${Id}    [C]    : ${feature.name} page | $auth → THIS → $replica/$primary → $audit\n`;
      break;
    default:
      o += `${Id}      [S]    : ${feature.name} | THIS → $db\n`;
  }
  o += `---\n`;
  return o;
}

export function genInfraGraph(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `--- infra [shared,critical] ---\n`;
  if (at.reservedWords["$db"]) o += `DB        [R#*]  : ${at.reservedWords["$db"].split("—")[0].trim()} | AllRepos → THIS\n`;
  if (at.reservedWords["$cache"]) o += `Cache     [R#*]  : ${at.reservedWords["$cache"].split("—")[0].trim()} | Sers → THIS\n`;
  if (at.reservedWords["$err"]) o += `Err       [U*]   : ${at.reservedWords["$err"].split("—")[0].trim()} | AllSers ← THIS\n`;
  if (at.reservedWords["$bus"]) o += `EvtBus    [U*~]  : ${at.reservedWords["$bus"].split("—")[0].trim()} | AllSers ↔ THIS\n`;
  o += `---\n`;
  if (["saas","ecommerce","mobile","data","ai","content"].includes(cfg.appType)) {
    o += `\n--- middleware [shared] ---\n`;
    o += `MidAuth   [M*$]  : JWT validate, attach user+perms | AllConts → THIS\n`;
    if (at.reservedWords["$tenant"]) o += `MidTen    [M*$]  : Extract tenant_id, set RLS var | AllConts → THIS → MidAuth\n`;
    o += `MidErr    [M*]   : Catch typed errors, return JSON | App → THIS → Err\n`;
    o += `---\n`;
  }
  if (cfg.appType === "realtime") {
    o += `\n--- gateway [connection-lifecycle] ---\n`;
    o += `GateConn     [G#!$] : WS handshake, JWT auth, heartbeat | Clients ↔ THIS\n`;
    o += `GateRooms    [G#]   : Join/leave, member tracking, broadcast | GateConn ← THIS ↔ $pubsub\n`;
    o += `GatePresence [G#~]  : Online/offline/typing (ephemeral) | GateConn ← THIS ↔ $cache\n`;
    o += `---\n`;
  }
  return o;
}

export function genEventsGraph(cfg) {
  const at = APP_TYPES[cfg.appType];
  if (!at.reservedWords["$bus"]) return null;
  let o = `--- events ---\n`;
  cfg.features.forEach(f => {
    const Id = f.id.charAt(0).toUpperCase() + f.id.slice(1);
    o += `Evt${Id}Changed [E~] : {${f.id}Id,...} | @${f.id} ⇒ THIS ⇒ [subscribers]\n`;
  });
  o += `---\n`;
  return o;
}

export function genSkillFile(skillId) {
  const sk = SKILL_CATALOG.find(s => s.id === skillId);
  if (!sk) return "";
  return `# ${sk.name}.skill

## Meta
pkg: [PACKAGE_NAME]@[VERSION]
docs: [OFFICIAL_DOCS_URL]
updated: [YYYY-MM-DD]

## Use
[How YOUR project uses ${sk.name}. 2-3 lines max.]
[Not what it does generally — how YOUR app uses it specifically.]

## Patterns
[The specific import paths, function signatures, and conventions you follow.]
[List the 5-10 methods/endpoints your app actually calls.]

## Gotchas
WRONG: [the code the AI will generate by default]
RIGHT: [the code it should generate instead]
WHY: [one-line explanation of the failure mode]

[Add more WRONG/RIGHT/WHY blocks as you discover them.]

## Boundaries
[What ${sk.name} does NOT do in your project.]
[Prevents the AI from overreaching with this package.]

## Snippets
[2-3 code blocks showing the correct pattern in YOUR project.]
[These are the patterns the AI will clone.]
`;
}

export function genApiStub(skillId) {
  const sk = SKILL_CATALOG.find(s => s.id === skillId);
  if (!sk) return null;
  const apiSkills = ["stripe","killbill","meilisearch","opensearch","saleor","langfuse","llm_sdk"];
  if (!apiSkills.includes(skillId)) return null;
  return `# ${sk.name}.api
# v[VERSION] | base: [BASE_URL] | auth: [AUTH_METHOD]
# generated: [YYYY-MM-DD] | source: [openapi|graphql|sdk|manual]

## Types
# [TypeName] = { field: type, field?: type, field: type|type }

## Endpoints
# [METHOD] [PATH] (param: type, param?: type) → [ReturnType]
# Only include endpoints YOUR app actually calls.

## Enums
# [EnumName] = 'value1' | 'value2' | 'value3'

## Webhooks
# [EVENT_NAME] → { field: type, field: type }
`;
}

export function genReadme(cfg) {
  const at = APP_TYPES[cfg.appType];
  return `# .arch/ — Context Engineering for ${cfg.appName}

> ${at.name} — ${at.pattern}

This directory contains architecture context files for AI-assisted development.
The AI reads these files to generate code that fits your system's architecture,
follows your patterns, avoids known gotchas, and calls APIs correctly.

## How to Use

### Claude Projects
1. Copy \`SYSTEM.md\` into your Project instructions
2. Upload \`INDEX.md\` and all \`.graph\` files as project knowledge
3. Upload relevant \`.skill\` and \`.api\` files as project knowledge

### Cursor / Windsurf
1. Copy \`SYSTEM.md\` into \`.cursorrules\`
2. Add rule: "Read .arch/INDEX.md to resolve context for each prompt"

### Claude Code
1. Add \`SYSTEM.md\` content to your \`CLAUDE.md\` instructions
2. Claude Code reads \`.arch/\` files automatically as needed

## File Map

| File | Purpose | Update When |
|------|---------|-------------|
| SYSTEM.md | Rules + $reserved words | New convention or rule |
| INDEX.md | Keyword → node/skill routing | New feature or dependency |
| clusters/*.graph | Architecture structure (v2 notation) | Feature added/changed |
| skills/*.skill | Package gotchas + patterns | Dependency upgrade or new gotcha |
| apis/*.api | API contracts (endpoints + types) | Dependency version bump |

## Maintenance

- **Monthly**: Check .skill freshness. Update for dependency upgrades.
- **Per feature**: Add .graph cluster. Update INDEX.md keywords.
- **Per gotcha**: When AI-generated code needs a fix, add WRONG/RIGHT/WHY to the .skill.
- **Per deploy**: Regenerate .api files from your latest API specs.
`;
}
