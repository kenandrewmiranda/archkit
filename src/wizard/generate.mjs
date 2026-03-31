import fs from "fs";
import path from "path";
import { C, ICONS, divider } from "../lib/shared.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";
import { genSystemMd, genIndexMd, genGraph, genInfraGraph, genEventsGraph, genSkillFile, genApiStub, genReadme, genBoundariesMd, genCompactContext } from "../lib/generators.mjs";
import { heading, subheading, info, success, tip, tree, filePreview } from "./helpers.mjs";
import * as log from "../lib/logger.mjs";
import { estimateTokens, tokenBudgetWarning } from "../lib/tokens.mjs";

function generateFiles(state) {
  const { appName, appType, stack, features, skills, crossRefs, outDir, claudeMode } = state;
  const at = APP_TYPES[appType];
  const cfg = { appName, appType, stack, features, skills, crossRefs: crossRefs || [] };

  divider();
  heading(ICONS.gear, "Generating...");

  log.generate("Creating directory structure...");

  const base = path.resolve(outDir);
  fs.mkdirSync(path.join(base, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(base, "skills"), { recursive: true });
  fs.mkdirSync(path.join(base, "apis"), { recursive: true });

  const written = [];

  function writeFile(relPath, content) {
    const fullPath = path.join(base, relPath);
    fs.writeFileSync(fullPath, content);
    written.push({ path: relPath, size: content.length });
    log.generate(`Writing ${relPath}`);
    console.log(`  ${C.green}${ICONS.check}${C.reset} ${relPath} ${C.dim}(${content.length} bytes)${C.reset}`);
  }

  const sysContent = genSystemMd(cfg);
  writeFile("SYSTEM.md", sysContent);

  const idxContent = genIndexMd(cfg);
  writeFile("INDEX.md", idxContent);

  writeFile("README.md", genReadme(cfg));
  writeFile("BOUNDARIES.md", genBoundariesMd(cfg.appType));

  const compactContent = genCompactContext(cfg);
  writeFile("CONTEXT.compact.md", compactContent);
  log.generate(`CONTEXT.compact.md: ~${Math.ceil(compactContent.length / 4)} tokens (for lightweight/cheap-model calls)`);

  writeFile("clusters/infra.graph", genInfraGraph(cfg));

  log.generate("Generating cluster graphs...");
  for (const f of features) {
    writeFile(`clusters/${f.id}.graph`, genGraph(f, cfg));
  }

  const evtContent = genEventsGraph(cfg);
  if (evtContent) writeFile("clusters/events.graph", evtContent);

  log.generate("Generating skill files...");
  for (const s of skills) {
    writeFile(`skills/${s}.skill`, genSkillFile(s));
  }

  const apiSkills = skills.filter(s => ["stripe","killbill","meilisearch","opensearch","saleor","langfuse","llm_sdk"].includes(s));
  for (const s of apiSkills) {
    const stub = genApiStub(s);
    if (stub) writeFile(`apis/${s}.api`, stub);
  }

  // Generate lenses
  log.generate("Generating lens overlays...");
  fs.mkdirSync(path.join(base, "lenses"), { recursive: true });

  writeFile("lenses/lens-research.md", `# Lens: Research

> Append to SYSTEM.md or paste into prompt when exploring approaches.

## Active Lens: Research Mode

- Prioritize exploration over implementation. Do NOT generate implementation code yet.
- Suggest 2-3 alternative approaches before committing to one.
- Ask clarifying questions about requirements and constraints.
- Reference existing .graph files to identify what's already built and what's missing.
- When recommending a package, check if a .skill file exists. If not, flag it.
- Output format: analysis and tradeoffs, not code.
`);

  writeFile("lenses/lens-implement.md", `# Lens: Implement

> Append to SYSTEM.md or paste into prompt when writing code.

## Active Lens: Implementation Mode

- Follow all architecture rules strictly. No shortcuts.
- Reference the .graph cluster for this feature before generating any file. Verify the node, layer, and file path.
- Reference the .skill file for every package used. Apply gotchas. Follow patterns.
- Reference the .api file for every external API call. Use exact endpoint signatures and types.
- Generate tests alongside implementation code. Not after.
- Use $reserved words from SYSTEM.md in all generated code.
- State the file path and layer at the top of every code block.
`);

  writeFile("lenses/lens-review.md", `# Lens: Review

> Append to SYSTEM.md or paste into prompt when reviewing code.

## Active Lens: Review Mode

- Do NOT fix code. Only report findings with severity (error/warning/info).
- Check against: .skill gotchas, SYSTEM.md rules, .graph boundaries.
- For each finding, state: what's wrong, which rule it violates, and the correct pattern.
- Flag cross-feature imports that bypass shared interfaces.
- Flag missing $tenant scoping, missing error handling, incorrect API usage.
- Flag any code that matches a WRONG pattern from a .skill file.
- End with a summary: X errors, Y warnings, Z info items.
`);

  // ── Claude Code native files ──────────────────────────────────────────
  if (claudeMode) {
    log.generate("Generating Claude Code native files...");
    console.log("");
    console.log(`${C.cyan}${C.bold}  Generating Claude Code native files...${C.reset}`);
    console.log("");

    const projectRoot = path.resolve(".");

    let claudeMd = `# ${cfg.appName}\n\n`;
    claudeMd += `> Generated by archkit. Full context in .arch/ directory.\n\n`;
    claudeMd += `## Stack\n${Object.values(cfg.stack).join(" + ")}\n\n`;
    claudeMd += `## Architecture\n${at.pattern}\n\n`;
    claudeMd += `## Rules\n`;
    at.rules.forEach(r => claudeMd += `- ${r}\n`);
    claudeMd += `\n## Reserved Words\n`;
    for (const [k, v] of Object.entries(at.reservedWords)) claudeMd += `- ${k} = ${v}\n`;
    claudeMd += `\n## Naming\nFiles: kebab-case | Types: PascalCase | Funcs: camelCase | Tables: snake_case | Env: SCREAMING_SNAKE\n`;
    claudeMd += `\n## Session Protocol (NON-NEGOTIABLE)\n`;
    claudeMd += `- BEFORE any code generation: run \`archkit resolve warmup\`\n`;
    claudeMd += `- If warmup returns blockers: FIX THEM. No exceptions.\n`;
    claudeMd += `- BEFORE new feature: run \`archkit resolve scaffold <featureId>\`\n`;
    claudeMd += `- BEFORE editing existing feature: run \`archkit resolve preflight <feature> <layer>\`\n`;
    claudeMd += `- AT SESSION END: suggest \`archkit gotcha --debrief\`\n`;
    claudeMd += `\n## Delegation\nDelegate deterministic work to sub-agents + CLI tools first (70-80%).\n`;
    claudeMd += `Main agent finalizes with TDD: write failing test → verify generated code passes → archkit review --agent as gate.\n`;
    claudeMd += `\n## Context Files\n`;
    claudeMd += `- Architecture graphs: @.arch/clusters/ (Key-Rel-Dep v2 notation)\n`;
    claudeMd += `- Package skills: @.arch/skills/ (WRONG/RIGHT/WHY gotchas)\n`;
    claudeMd += `- API contracts: @.arch/apis/ (type-signature digests)\n`;
    claudeMd += `- Full context routing: @.arch/INDEX.md\n`;

    const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
    if (fs.existsSync(claudeMdPath)) {
      console.log(`  ${C.yellow}${ICONS.warn}${C.reset} CLAUDE.md already exists — writing to CLAUDE.archkit.md instead`);
      fs.writeFileSync(path.join(projectRoot, "CLAUDE.archkit.md"), claudeMd);
      written.push({ path: "CLAUDE.archkit.md (project root)", size: claudeMd.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} CLAUDE.archkit.md ${C.dim}(${claudeMd.length} bytes — merge into your CLAUDE.md)${C.reset}`);
    } else {
      fs.writeFileSync(claudeMdPath, claudeMd);
      written.push({ path: "CLAUDE.md (project root)", size: claudeMd.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} CLAUDE.md ${C.dim}(${claudeMd.length} bytes)${C.reset}`);
    }

    const claudeRulesDir = path.join(projectRoot, ".claude", "rules");
    fs.mkdirSync(claudeRulesDir, { recursive: true });

    let archRule = `---\ndescription: "Architecture rules from archkit"\nalwaysApply: true\n---\n\n`;
    at.rules.forEach(r => archRule += `- ${r}\n`);
    fs.writeFileSync(path.join(claudeRulesDir, "architecture.md"), archRule);
    written.push({ path: ".claude/rules/architecture.md", size: archRule.length });
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/rules/architecture.md ${C.dim}(alwaysApply)${C.reset}`);

    for (const f of features) {
      let featureRule = `---\ndescription: "${f.name} architecture context"\n`;
      if (["saas", "ecommerce", "mobile"].includes(cfg.appType)) {
        featureRule += `globs: ["src/features/${f.id}/**"]\n`;
      } else if (cfg.appType === "realtime") {
        featureRule += `globs: ["src/handlers/${f.id}*", "src/domain/${f.id}*"]\n`;
      } else if (cfg.appType === "ai") {
        featureRule += `globs: ["src/chains/${f.id}*", "src/prompts/**/${f.id}*"]\n`;
      } else {
        featureRule += `globs: ["src/**/${f.id}*"]\n`;
      }
      featureRule += `alwaysApply: false\n---\n\n`;
      featureRule += `# ${f.name}\n\n`;
      featureRule += `Architecture graph: @.arch/clusters/${f.id}.graph\n\n`;
      const graphContent = genGraph(f, cfg);
      featureRule += `\`\`\`\n${graphContent}\`\`\`\n`;

      fs.writeFileSync(path.join(claudeRulesDir, `${f.id}.md`), featureRule);
      written.push({ path: `.claude/rules/${f.id}.md`, size: featureRule.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/rules/${f.id}.md ${C.dim}(path-targeted: src/features/${f.id}/**)${C.reset}`);
    }

    const claudeSkillsDir = path.join(projectRoot, ".claude", "skills");
    fs.mkdirSync(claudeSkillsDir, { recursive: true });

    for (const s of skills) {
      const sk = SKILL_CATALOG.find(c => c.id === s);
      if (!sk) continue;
      const skillDir = path.join(claudeSkillsDir, s);
      fs.mkdirSync(skillDir, { recursive: true });

      let skillMd = `---\nname: ${s}\ndescription: "${sk.name} patterns and gotchas for this project"\ntrigger: "When working with ${sk.name} (keywords: ${sk.keywords})"\n---\n\n`;
      skillMd += `# ${sk.name} Skill\n\n`;
      skillMd += `Full skill file: @.arch/skills/${s}.skill\n\n`;
      skillMd += `Load the skill file above for:\n`;
      skillMd += `- Package version and docs URL\n`;
      skillMd += `- Project-specific usage patterns\n`;
      skillMd += `- WRONG → RIGHT → WHY gotchas\n`;
      skillMd += `- Boundary definitions (what NOT to use this package for)\n`;
      skillMd += `- Reference code snippets\n`;

      fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd);
      written.push({ path: `.claude/skills/${s}/SKILL.md`, size: skillMd.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/skills/${s}/SKILL.md`);
    }
  }

  // ── File previews ─────────────────────────────────────────────────────
  divider();
  heading(ICONS.file, "File Previews");

  filePreview("SYSTEM.md", sysContent);
  filePreview("INDEX.md", idxContent);

  if (features.length > 0) {
    const firstGraph = genGraph(features[0], cfg);
    filePreview(`clusters/${features[0].id}.graph`, firstGraph);
  }

  // ── Token Budget Report ─────────────────────────────────────────────
  divider();
  heading(ICONS.chart || "📊", "Token Budget");

  const alwaysLoaded = [
    { name: "SYSTEM.md", content: sysContent },
    { name: "BOUNDARIES.md", content: genBoundariesMd(cfg.appType) },
  ];

  let totalAlways = 0;
  for (const { name, content } of alwaysLoaded) {
    const tokens = estimateTokens(content);
    totalAlways += tokens;
    log.system(`${name}: ~${tokens} tokens`);
  }

  log.system(`Always-loaded total: ~${totalAlways} tokens`);
  const warning = tokenBudgetWarning(totalAlways);
  if (totalAlways > 2000) {
    log.warn(`Token budget: ${warning}`);
  } else {
    log.ok(`Token budget: ${warning}`);
  }
  console.log("");

  // ── Summary ───────────────────────────────────────────────────────────
  divider();
  heading(ICONS.star, "Done!");

  const totalBytes = written.reduce((s, f) => s + f.size, 0);
  console.log(`  ${C.bold}${written.length} files${C.reset} generated (${totalBytes.toLocaleString()} bytes total)`);
  console.log("");

  if (claudeMode) {
    subheading("Claude Code integration:");
    console.log("");
    console.log(`  ${C.green}${ICONS.check}${C.reset} CLAUDE.md at project root ${C.dim}— auto-loaded every session${C.reset}`);
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/rules/ ${C.dim}— path-targeted architecture rules, auto-loaded${C.reset}`);
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/skills/ ${C.dim}— on-demand package knowledge${C.reset}`);
    console.log(`  ${C.green}${ICONS.check}${C.reset} .arch/ ${C.dim}— full context system (graphs, skills, APIs, lenses)${C.reset}`);
    console.log("");
  }

  subheading("Next steps:");
  console.log("");
  console.log(`  ${C.yellow}1.${C.reset} ${C.bold}Fill in .arch/skills/*.skill files with your team's gotchas${C.reset}`);
  info("     WRONG → RIGHT → WHY. Add them as you discover them.");
  console.log("");
  console.log(`  ${C.yellow}2.${C.reset} ${C.bold}Generate .arch/apis/*.api from your API specs${C.reset}`);
  info("     OpenAPI → .api conversion, or use MCP servers for live contracts.");
  console.log("");
  console.log(`  ${C.yellow}3.${C.reset} ${C.bold}Update .arch/INDEX.md cross-refs${C.reset}`);
  info("     Map which features depend on which other features.");
  console.log("");
  if (claudeMode) {
    console.log(`  ${C.yellow}4.${C.reset} ${C.bold}Start Claude Code — it will auto-load CLAUDE.md + rules.${C.reset} ${ICONS.rocket}`);
  } else {
    console.log(`  ${C.yellow}4.${C.reset} ${C.bold}Start coding with full context.${C.reset} ${ICONS.rocket}`);
    console.log("");
    tip("Run with --claude flag to also generate Claude Code native files (CLAUDE.md + .claude/rules/ + .claude/skills/)");
  }

  console.log("");
  divider();
  tip("Every time the AI generates wrong code, add a gotcha to the relevant .skill file.");
  tip("The system gets smarter as your team accumulates knowledge.");
  console.log("");
}

export { generateFiles };
