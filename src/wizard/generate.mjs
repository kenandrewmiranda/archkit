import fs from "fs";
import path from "path";
import { C, ICONS, divider } from "../lib/shared.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";
import { genSystemMd, genIndexMd, genGraph, genInfraGraph, genEventsGraph, genSkillFile, genApiStub, genReadme, genBoundariesMd, genCompactContext } from "../lib/generators.mjs";
import { heading, subheading, info, success, tip, tree, filePreview } from "./helpers.mjs";
import * as log from "../lib/logger.mjs";
import { estimateTokens, tokenBudgetWarning } from "../lib/tokens.mjs";
import inquirer from "inquirer";
import { execFileSync } from "child_process";

function copyToClipboard(text) {
  try {
    if (process.platform === "darwin") {
      execFileSync("pbcopy", [], { input: text });
    } else if (process.platform === "linux") {
      execFileSync("xclip", ["-selection", "clipboard"], { input: text });
    } else if (process.platform === "win32") {
      execFileSync("clip", [], { input: text });
    }
    return true;
  } catch { return false; }
}

async function promptLaunchCommand(state) {
  const cwd = path.resolve(".");

  const cliOptions = [
    { name: `${C.cyan}claude${C.reset} --dangerously-skip-permissions`, value: `cd "${cwd}" && claude --dangerously-skip-permissions`, short: "Claude (skip perms)" },
    { name: `${C.cyan}claude${C.reset}`, value: `cd "${cwd}" && claude`, short: "Claude" },
    { name: `${C.cyan}claude${C.reset} with prompt`, value: `cd "${cwd}" && claude "Read CLAUDE.md and .arch/SYSTEM.md, then run archkit resolve warmup"`, short: "Claude + warmup" },
    new inquirer.Separator(`${C.gray} ── Other tools ──${C.reset}`),
    { name: `${C.cyan}cursor${C.reset} .`, value: `cd "${cwd}" && cursor .`, short: "Cursor" },
    { name: `${C.cyan}code${C.reset} .`, value: `cd "${cwd}" && code .`, short: "VS Code" },
    { name: `${C.cyan}windsurf${C.reset} .`, value: `cd "${cwd}" && windsurf .`, short: "Windsurf" },
    new inquirer.Separator(`${C.gray} ──────────────────${C.reset}`),
    { name: `${C.dim}Skip — I'll launch manually${C.reset}`, value: "__skip", short: "Skip" },
  ];

  console.log("");
  const { cliChoice } = await inquirer.prompt([{
    type: "list",
    name: "cliChoice",
    message: "Copy a launch command to clipboard?",
    prefix: `  ${ICONS.rocket}`,
    choices: cliOptions,
    pageSize: 12,
  }]);

  if (cliChoice === "__skip") return;

  if (copyToClipboard(cliChoice)) {
    success("Copied to clipboard! Paste in your terminal to launch.");
    console.log(`  ${C.dim}${cliChoice}${C.reset}`);
  } else {
    info("Couldn't access clipboard. Here's the command:");
    console.log("");
    console.log(`  ${C.bold}${cliChoice}${C.reset}`);
  }
  console.log("");
}

async function promptCleanup() {
  // Detect if we're running from a cloned archkit directory inside a parent project
  const archkitDir = path.resolve(".");
  const archkitPkg = path.join(archkitDir, "package.json");

  if (!fs.existsSync(archkitPkg)) return;

  try {
    const pkg = JSON.parse(fs.readFileSync(archkitPkg, "utf8"));
    if (pkg.name !== "archkit") return;
  } catch { return; }

  // We're inside the archkit folder — check if parent has the generated files
  const parentDir = path.dirname(archkitDir);
  const hasArchDir = fs.existsSync(path.join(parentDir, ".arch")) || fs.existsSync(path.join(archkitDir, ".arch"));

  if (!hasArchDir) return;

  console.log("");
  const { cleanup } = await inquirer.prompt([{
    type: "confirm",
    name: "cleanup",
    message: `Remove the archkit CLI folder? (${path.basename(archkitDir)}/) — it's no longer needed after scaffolding.`,
    default: true,
    prefix: `  ${ICONS.arch}`,
  }]);

  if (cleanup) {
    // Schedule self-deletion after process exits
    const folderToRemove = archkitDir;
    process.on("exit", () => {
      try {
        fs.rmSync(folderToRemove, { recursive: true, force: true });
      } catch {}
    });
    success(`archkit folder will be removed on exit.`);
    info(`  Generated files in .arch/ and .claude/ are safe — they live in the parent project.`);
  }
}

async function generateFiles(state) {
  const { appName, appType, stack, features, skills, crossRefs, outDir, claudeMode } = state;
  const at = APP_TYPES[appType];
  const cfg = { appName, appType, stack, features, skills, crossRefs: crossRefs || [] }; // "ai" string or array

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
    archRule += `## archkit Protocol (NON-NEGOTIABLE)\nBefore ANY code generation, invoke the \`archkit-protocol\` skill.\nThis applies even when using superpowers or other workflow skills.\n\n`;
    archRule += `## Architecture Rules\n`;
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

    // Superpowers integration rule — tells each superpowers phase how to use archkit
    const superpowersRule = `---
description: "archkit integration with superpowers workflow skills"
alwaysApply: true
---

## archkit + Superpowers Integration

When using superpowers skills (brainstorming, writing-plans, executing-plans, code-reviewer, etc.), archkit commands MUST be run at these integration points. This is not optional.

### During brainstorming

Before exploring approaches, load architecture context:
\`\`\`bash
archkit resolve context "<the topic being brainstormed>" --pretty
\`\`\`
Use the returned nodes, skills, rules, and cross-refs to constrain the brainstorm. Don't propose approaches that violate the architecture rules or boundaries.

Also read:
- \`.arch/BOUNDARIES.md\` — hard prohibitions (NEVER rules)
- \`.arch/SYSTEM.md\` — architecture pattern, reserved words, Definition of Done

### During writing-plans

Before writing any plan, run:
\`\`\`bash
archkit resolve scaffold <featureId> --pretty   # for new features
archkit resolve plan "<prompt>" --pretty         # for structured plan
\`\`\`

Plans MUST follow these constraints:
- File paths must match the convention in INDEX.md
- Each plan task must produce a vertically-sliced increment (not horizontal layers)
- Every task that creates implementation code must also create its test
- The last task in every plan must be: \`archkit review --staged\` + \`archkit resolve verify-wiring src/\`
- Include the Definition of Done checklist from SYSTEM.md in the plan's acceptance criteria

### During executing-plans

Before each task:
\`\`\`bash
archkit resolve preflight <feature> <layer> --pretty
\`\`\`

After each task that modifies code:
\`\`\`bash
archkit review --staged --agent
\`\`\`
If review returns errors, fix them before marking the task complete.

After the final task:
\`\`\`bash
archkit resolve verify-wiring src/        # catch unwired components
archkit review --dir src/ --agent         # full project review
\`\`\`

### During code review (requesting-code-review / receiving-code-review)

Load the review criteria:
\`\`\`bash
archkit review --staged --agent           # get JSON findings
archkit gotcha --list                     # check available gotchas
\`\`\`

Review MUST check against:
- .arch/BOUNDARIES.md — are any NEVER rules violated?
- .arch/skills/*.skill — are any known gotcha patterns present?
- Definition of Done — are tests, error paths, and health checks present?
- Frontend wiring — are pages actually connected to the API?

### During verification-before-completion

Before claiming any work is complete:
\`\`\`bash
archkit review --staged --agent           # zero errors required
archkit resolve verify-wiring src/        # zero unwired components
archkit drift --json                      # zero drift findings
archkit stats --compact                   # health check
\`\`\`

ALL four must pass. If any fails, the work is not complete.
`;

    fs.writeFileSync(path.join(claudeRulesDir, "superpowers-integration.md"), superpowersRule);
    written.push({ path: ".claude/rules/superpowers-integration.md", size: superpowersRule.length });
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/rules/superpowers-integration.md ${C.dim}(alwaysApply — superpowers hooks)${C.reset}`);

    // Exploration rule — use archkit before raw file scanning
    const exploreRule = `---
description: "Use archkit context before raw file exploration"
alwaysApply: true
---

## Codebase Exploration — Use archkit First

This project has an \`.arch/\` directory with pre-mapped architecture context. Before exploring the codebase with Glob, Grep, or Read, check archkit first — it's faster and more accurate.

### Instead of scanning files to understand the architecture:
\`\`\`bash
# Get the full architecture map in one call:
archkit resolve warmup --pretty          # system health + stats
archkit resolve context "<question>" --pretty   # relevant files, nodes, skills, rules
archkit resolve lookup <feature> --pretty       # single feature details
\`\`\`

### Instead of searching for where something is defined:
\`\`\`bash
# archkit knows the file paths:
archkit resolve preflight <feature> <layer> --pretty  # exact file path + dependencies
\`\`\`

### Instead of guessing the project structure:
Read these files in order (most useful first):
1. \`.arch/SYSTEM.md\` — rules, reserved words, architecture pattern
2. \`.arch/BOUNDARIES.md\` — hard prohibitions (NEVER rules)
3. \`.arch/INDEX.md\` — keyword → feature/file routing
4. \`.arch/CONTEXT.compact.md\` — 500-token summary of the whole system

### Instead of reading package.json to understand the stack:
\`\`\`bash
archkit resolve warmup --pretty  # returns stack, feature count, skill count, health score
\`\`\`

### When exploring a specific feature:
\`\`\`bash
# Get the graph (nodes, layers, dependencies, data flow):
cat .arch/clusters/<feature>.graph

# Get package gotchas relevant to this feature:
archkit gotcha --list                    # all skills + gotcha counts
cat .arch/skills/<package>.skill         # specific gotchas for a package
\`\`\`

### Key principle
archkit's \`.arch/\` files are the map. Raw file scanning is the territory. Read the map first — only scan files when the map doesn't have the answer.
`;

    fs.writeFileSync(path.join(claudeRulesDir, "explore-with-archkit.md"), exploreRule);
    written.push({ path: ".claude/rules/explore-with-archkit.md", size: exploreRule.length });
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/rules/explore-with-archkit.md ${C.dim}(alwaysApply — explore via archkit)${C.reset}`);

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

    // 5. archkit-protocol skill — unified workflow integration for AI agents
    log.generate("Generating archkit-protocol skill...");
    const protocolDir = path.join(claudeSkillsDir, "archkit-protocol");
    fs.mkdirSync(protocolDir, { recursive: true });

    const protocolSkill = `---
name: archkit-protocol
description: "Architecture-first development workflow using archkit CLI tools"
trigger: "When starting any coding task, implementing a feature, before committing, at session end, or when asked about architecture"
---

# archkit Protocol

This skill maps your development workflow to archkit commands. All commands return JSON on stdout (logs go to stderr).

## Before Starting Work
\`\`\`bash
archkit resolve warmup          # Check system health (blockers = stop)
\`\`\`

## Before Implementing a Feature
\`\`\`bash
# New feature:
archkit resolve scaffold <featureId> --pretty

# Existing feature:
archkit resolve preflight <feature> <layer> --pretty

# Unsure what's affected:
archkit resolve context "<prompt>" --pretty

# Need a full plan:
archkit resolve plan "<prompt>" --pretty
\`\`\`

## While Coding
\`\`\`bash
# Look up a node, skill, or cluster:
archkit resolve lookup <id> --pretty

# Check for gotchas on a package:
archkit gotcha --list
\`\`\`

## Before Committing
\`\`\`bash
# Review staged files against architecture rules:
archkit review --staged --agent

# Check for unwired/dead components:
archkit resolve verify-wiring src/
\`\`\`

## After Completing a Feature
\`\`\`bash
# Check requirement coverage:
archkit resolve audit-spec docs/spec.md src/

# Check for architectural drift:
archkit drift --json
\`\`\`

## At Session End
\`\`\`bash
# Capture a gotcha:
archkit gotcha <skill> "<wrong>" "<right>" "<why>" --json

# Non-interactive debrief:
archkit gotcha --debrief --json '{"gotchas":[{"skill":"x","wrong":"x","right":"x","why":"x"}]}'

# Check health score:
archkit stats --compact
\`\`\`

## Key Rules
- ALL archkit commands return JSON on stdout — safe to pipe and parse
- Log output goes to stderr — won't corrupt JSON parsing
- Run warmup at least once per session before generating code
- Run review --staged before every commit
- Capture gotchas when you discover bad patterns — the system gets smarter
`;

    fs.writeFileSync(path.join(protocolDir, "SKILL.md"), protocolSkill);
    written.push({ path: ".claude/skills/archkit-protocol/SKILL.md", size: protocolSkill.length });
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/skills/archkit-protocol/SKILL.md ${C.dim}(workflow integration)${C.reset}`);

    // 4. .claude/settings.json — hooks that enforce archkit in every session
    log.generate("Generating Claude Code hooks...");
    const settingsPath = path.join(projectRoot, ".claude", "settings.json");
    let existingSettings = {};
    if (fs.existsSync(settingsPath)) {
      try { existingSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
    }

    const archkitHooks = {
      hooks: {
        ...(existingSettings.hooks || {}),
        // Before any Bash command that looks like git commit, run review
        PreToolUse: [
          ...((existingSettings.hooks || {}).PreToolUse || []),
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "if echo \"$TOOL_INPUT\" | grep -q 'git commit'; then archkit review --staged --agent 2>/dev/null | head -5; fi",
              }
            ]
          }
        ],
        // After session starts (first tool use), nudge warmup
        PostToolUse: [
          ...((existingSettings.hooks || {}).PostToolUse || []),
          {
            matcher: "Read",
            hooks: [
              {
                type: "command",
                command: "if [ ! -f /tmp/.archkit-warmup-done-$$ ]; then echo '[ARCHKIT] Run: archkit resolve warmup'; touch /tmp/.archkit-warmup-done-$$; fi",
              }
            ]
          }
        ],
      },
    };

    // Merge with existing settings (preserve non-hook settings)
    const mergedSettings = { ...existingSettings, ...archkitHooks };
    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
    written.push({ path: ".claude/settings.json", size: JSON.stringify(mergedSettings).length });
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/settings.json ${C.dim}(hooks: pre-commit review, warmup nudge)${C.reset}`);
  }

  // ── Git pre-commit hook (always, not just --claude) ──────────────────
  const hooksDir = path.join(projectRoot, ".git", "hooks");
  if (fs.existsSync(path.join(projectRoot, ".git"))) {
    log.generate("Setting up git pre-commit hook...");
    fs.mkdirSync(hooksDir, { recursive: true });

    const preCommitPath = path.join(hooksDir, "pre-commit");
    const hookScript = `#!/bin/sh
# archkit pre-commit hook — runs review on staged files before every commit.
# This is a hard gate: if review finds errors, the commit is blocked.
# Generated by archkit. Remove this file to disable.

# Find archkit (check common locations)
ARCHKIT=""
if command -v archkit >/dev/null 2>&1; then
  ARCHKIT="archkit"
elif [ -f "./node_modules/.bin/archkit" ]; then
  ARCHKIT="./node_modules/.bin/archkit"
elif [ -f "./archkit/bin/archkit.mjs" ]; then
  ARCHKIT="node ./archkit/bin/archkit.mjs"
fi

if [ -z "$ARCHKIT" ]; then
  echo "[ARCHKIT] archkit not found — skipping pre-commit review"
  exit 0
fi

echo "[ARCHKIT] Running review on staged files..."
RESULT=$($ARCHKIT review --staged --agent 2>/dev/null)

# Extract error count from JSON
ERRORS=$(echo "$RESULT" | grep -o '"errors":[0-9]*' | grep -o '[0-9]*')

if [ "$ERRORS" != "" ] && [ "$ERRORS" != "0" ]; then
  echo "[ARCHKIT] Review found $ERRORS error(s). Commit blocked."
  echo "[ARCHKIT] Run: archkit review --staged  to see details."
  exit 1
fi

echo "[ARCHKIT] Review passed."
exit 0
`;

    // Only write if no pre-commit hook exists (don't overwrite user's hook)
    if (!fs.existsSync(preCommitPath)) {
      fs.writeFileSync(preCommitPath, hookScript, { mode: 0o755 });
      written.push({ path: ".git/hooks/pre-commit", size: hookScript.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} .git/hooks/pre-commit ${C.dim}(blocks commits with review errors)${C.reset}`);
    } else {
      log.warn("pre-commit hook already exists — not overwriting. Add archkit review --staged manually if desired.");
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

  // Clean up archkit CLI folder if it was cloned into the project
  await promptCleanup();

  // Launch command prompt
  await promptLaunchCommand(state);
}

export { generateFiles };
