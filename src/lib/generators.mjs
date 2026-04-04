import fs from "fs";
import { ICONS } from "./shared.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";
import { genBoundariesMd } from "../data/boundaries.mjs";
import { GOTCHA_DB } from "../data/gotcha-db.mjs";
import { PACKAGE_DOCS } from "../data/package-docs.mjs";

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
  o += `\`\`\`\n`;
  o += `IF creating a new file:\n`;
  o += `  1. Verify path matches convention in INDEX.md\n`;
  o += `  2. State: "Target: <file path> | Layer: <layer>"\n`;
  o += `  3. Run: archkit resolve preflight <feature> <layer>\n`;
  o += `\n`;
  o += `IF modifying an existing file:\n`;
  o += `  1. Read the file first — understand before changing\n`;
  o += `  2. Check .skill gotchas for packages used in this file\n`;
  o += `  3. Verify changes respect layer boundaries\n`;
  o += `\n`;
  o += `IF touching multiple features:\n`;
  o += `  1. Check INDEX.md cross-refs for dependencies\n`;
  o += `  2. Modify features in dependency order (depended-on first)\n`;
  o += `\n`;
  o += `ALWAYS:\n`;
  o += `  - Reference $symbols for all dependencies\n`;
  if (at.reservedWords["$tenant"]) o += `  - Include $tenant in all DB operations\n`;
  o += `  - Throw $err on failure paths\n`;
  o += `  - Write or update tests — unit for business logic, integration for API endpoints\n`;
  o += `  - Verify the feature works: API call → correct response + correct status code\n`;
  o += `\`\`\`\n`;
  o += `\n## Definition of Done (Ref: Scrum Guide 2020 — Definition of Done)\n`;
  o += `A feature is NOT complete until:\n`;
  o += `- [ ] Unit tests cover service/domain logic (Ref: Martin Fowler — Test Pyramid)\n`;
  o += `- [ ] Integration test verifies component interaction through the API layer (Ref: Fowler — Integration Testing)\n`;
  o += `- [ ] Error responses use correct HTTP status codes: 400, 401, 403, 404, 409, 422 (Ref: RFC 7231 §6)\n`;
  o += `- [ ] \`archkit review --staged\` passes with zero errors\n`;
  o += `- [ ] Health check endpoint returns 200 when all dependencies are reachable (Ref: Kubernetes — Readiness Probes)\n`;
  o += `\n## Session Management\n`;
  o += `Maintain a running task list. Before starting work:\n`;
  o += `1. Run \`archkit resolve warmup\` — check system health (blockers = stop, warnings = note and proceed)\n`;
  o += `2. Break the task into steps. Write them down.\n`;
  o += `3. Check off each step as you complete it.\n\n`;
  o += `Available tools (use when relevant, not as a mandatory sequence):\n`;
  o += `| Tool | When to Use |\n`;
  o += `|------|-------------|\n`;
  o += `| \`archkit resolve context "<prompt>"\` | Unsure which files/features are involved |\n`;
  o += `| \`archkit resolve preflight <feature> <layer>\` | Before modifying an existing feature |\n`;
  o += `| \`archkit resolve scaffold <feature>\` | Creating a new feature from scratch |\n`;
  o += `| \`archkit resolve plan "<prompt>"\` | Need a structured implementation plan |\n`;
  o += `| \`archkit review --staged\` | Before committing — final quality gate |\n`;
  o += `| \`archkit gotcha --debrief\` | End of session — capture what you learned |\n`;
  o += `\n### External Skill Integration\n`;
  o += `If using external workflow skills (superpowers, custom skills, etc.):\n`;
  o += `- External skills do NOT replace archkit commands\n`;
  o += `- BEFORE any task execution: \`archkit resolve warmup\`\n`;
  o += `- BEFORE each feature task: \`archkit resolve preflight <feature> <layer>\`\n`;
  o += `- BEFORE each commit: \`archkit review --staged\`\n`;
  o += `- AFTER completing a plan: \`archkit resolve verify-wiring src/\`\n`;
  o += `- AT session end: \`archkit gotcha --debrief\` (or report via --json)\n`;
  if (cfg.includeDelegation !== false) {
    o += `\n## Delegation Principle\n`;
    o += `Delegate everything deterministic to sub-agents and CLI tools first. The main agent finalizes with judgment.\n\n`;
    o += `### Sub-agent first (70-80% of the work, cheap tokens):\n`;
    o += `- Scaffolding files and boilerplate: \`archkit resolve scaffold\` + sub-agent generates from checklist\n`;
    o += `- Resolving context and dependencies: \`archkit resolve context\` + \`archkit resolve preflight\`\n`;
    o += `- Checking code against rules: \`archkit review --agent\` (sub-agent reads JSON, reports findings)\n`;
    o += `- Looking up patterns and gotchas: \`archkit resolve lookup\` (sub-agent applies, not re-derives)\n`;
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
    o += `4. Main agent runs \`archkit review --agent\` as final gate\n`;
    o += `5. If review passes: done. If not: fix findings, re-run.\n`;
  }
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
  if (cfg.crossRefs === "ai") {
    o += `# AI-INFERRED: Analyze the features below and determine dependencies during code generation.\n`;
    o += `# The AI agent should map relationships between these features based on their capabilities:\n`;
    cfg.features.forEach(f => o += `# @${f.id} — ${f.name} (${f.keywords})\n`);
    o += `# Output format: @feature_a → @feature_b (reason)\n`;
  } else if (cfg.crossRefs && cfg.crossRefs.length > 0) {
    cfg.crossRefs.forEach(ref => o += `@${ref.from} → @${ref.to} (${ref.reason})\n`);
  } else {
    o += `# TODO: Map which features depend on which other features\n`;
    cfg.features.forEach((f, i) => {
      if (i < cfg.features.length - 1) o += `# @${f.id} → @${cfg.features[i+1].id} (describe relationship)\n`;
    });
  }
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
  let o = `# ${sk.name}.skill\n\n`;

  // Auto-populate Meta from package-docs map and local package.json
  const pkgInfo = PACKAGE_DOCS[skillId] || {};
  let version = null;
  if (pkgInfo.npm) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
      const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      version = allDeps[pkgInfo.npm] || null;
    } catch {}
  }

  o += `## Meta\n`;
  o += `pkg: ${pkgInfo.npm || skillId}@${version || "[VERSION]"}\n`;
  o += `docs: ${pkgInfo.docs || "[DOCS_URL]"}\n`;
  o += `updated: ${new Date().toISOString().split("T")[0]}\n\n`;
  o += `## Use\n[How YOUR project uses ${sk.name}. 2-3 lines max.]\n[Not what it does generally — how YOUR app uses it specifically.]\n\n`;
  o += `## Patterns\n[The specific import paths, function signatures, and conventions you follow.]\n[List the 5-10 methods/endpoints your app actually calls.]\n\n`;
  o += `## Gotchas\n`;
  const builtinGotchas = GOTCHA_DB[skillId] || [];
  if (builtinGotchas.length > 0) {
    builtinGotchas.forEach(g => {
      o += `WRONG: ${g.wrong}\nRIGHT: ${g.right}\nWHY: ${g.why}\n\n`;
    });
    o += `[Add more WRONG/RIGHT/WHY blocks as you discover them.]\n`;
  } else {
    o += `WRONG: [the code the AI will generate by default]\nRIGHT: [the code it should generate instead]\nWHY: [one-line explanation of the failure mode]\n\n[Add more WRONG/RIGHT/WHY blocks as you discover them.]\n`;
  }
  o += `\n## Boundaries\n[What ${sk.name} does NOT do in your project.]\n[Prevents the AI from overreaching with this package.]\n\n`;
  o += `## Snippets\n[2-3 code blocks showing the correct pattern in YOUR project.]\n[These are the patterns the AI will clone.]\n`;
  return o;
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

export function genCompactContext(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `# ${cfg.appName} — Compact Context (~500 tokens)\n\n`;
  o += `## Rules\n`;
  at.rules.forEach(r => o += `- ${r}\n`);
  o += `\n## NEVER\n`;
  // Import boundaries inline
  const UNIVERSAL = [
    "Commit secrets/credentials to code",
    "Use \`any\` type in TypeScript",
    "Catch errors silently",
    "Use string concatenation for SQL",
    "Trust client-side input without validation",
  ];
  UNIVERSAL.forEach(b => o += `- ${b}\n`);
  o += `\n## Reserved Words\n`;
  for (const [k, v] of Object.entries(at.reservedWords)) {
    o += `${k} = ${v.split("—")[0].trim()}\n`;
  }
  o += `\n## Convention\n`;
  o += `${at.folderConv}\n`;
  o += `Files: kebab-case | Types: PascalCase | Funcs: camelCase\n`;
  return o;
}

export { genBoundariesMd } from "../data/boundaries.mjs";
