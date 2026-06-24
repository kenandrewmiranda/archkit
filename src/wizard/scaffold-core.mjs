// src/wizard/scaffold-core.mjs
//
// Pure scaffold-generation core — decoupled from the inquirer TTY.
//
// `generateScaffold(answers, opts)` accepts a structured answer object
// (archetype, stack, app name, features, skills, …) and WRITES the .arch/
// scaffold (plus optional Claude Code native files + git pre-commit hook),
// returning the list of files written. It performs no console output, no
// inquirer prompts, no clipboard access, and no process.on("exit") side
// effects — everything that needs a human at a terminal lives in the thin
// interactive wrapper (src/wizard/generate.mjs::generateFiles) and the MCP
// runner (src/commands/init-generate.mjs).
//
// This is the shared core the wizard and the archkit_init_generate MCP tool
// both call. The interactive wizard is now a thin presentation layer over it
// (ADR: expose interactive wizard as MCP tooling).

import fs from "fs";
import path from "path";
import {
  genSystemMd, genIndexMd, genGraph, genInfraGraph, genEventsGraph,
  genSkillFile, genApiStub, genReadme, genBoundariesMd, genCompactContext,
  namingLine, genHetznerArtifacts, genSelfHostArtifacts, resolveHostingChoice,
} from "../lib/generators.mjs";
import { hasJsTsStack } from "../lib/stack-detect.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";

// Skills that ship an API contract stub alongside the .skill file.
const API_STUB_SKILLS = ["stripe", "killbill", "meilisearch", "opensearch", "saleor", "langfuse", "llm_sdk"];

// arch-poly dogfood (Python-only): `archkit resolve verify-wiring src/` returns
// "0 files scanned, found N non-JS/TS source files" — dead weight when mandated
// in CLAUDE.md / skill rules. On non-JS stacks, strip verify-wiring references
// from generated guidance entirely.
function stripVerifyWiring(text) {
  return text
    .replace(/`archkit review --staged` \+ `archkit resolve verify-wiring src\/`/g, "`archkit review --staged`")
    .replace(/\n# (?:catch|zero|Check for) [^\n]*\narchkit resolve verify-wiring src\/[^\n]*\n?/g, "")
    .replace(/\narchkit resolve verify-wiring src\/[^\n]*\n?/g, "")
    .replace(/ALL four must pass/g, "ALL three must pass");
}

/**
 * Normalize a raw answer object into a complete config, applying archetype
 * defaults. Throws an Error (with a `.code` for the MCP envelope) on invalid
 * input rather than prompting.
 *
 * @param {object} answers
 * @returns {{ cfg: object, outDir: string, claudeMode: boolean }}
 */
export function normalizeAnswers(answers = {}) {
  const appType = answers.appType;
  if (!appType || !APP_TYPES[appType]) {
    const err = new Error(
      `Unknown or missing appType: ${JSON.stringify(appType)}. Valid: ${Object.keys(APP_TYPES).join(", ")}`
    );
    err.code = "invalid_app_type";
    err.valid = Object.keys(APP_TYPES);
    throw err;
  }
  const at = APP_TYPES[appType];

  const appName = (answers.appName || "").trim();
  if (!appName) {
    const err = new Error("appName is required (the project/app name that appears in generated files).");
    err.code = "missing_app_name";
    throw err;
  }

  // Stack: explicit object wins, else archetype default.
  const explicitStack = answers.stack && typeof answers.stack === "object" && Object.keys(answers.stack).length > 0;
  const stack = explicitStack ? answers.stack : { ...at.defaultStack };

  // Decision-aware archetypes (e.g. ios-swift) carry annotated server/storage
  // option sets instead of a single hardcoded backend. A recorded stackDecision
  // (from the wizard or archkit_init_generate) selects an option per group and
  // its chosen label flows into the fallback stack map (unless the caller passed
  // an explicit stack). The rationale + AI-weighted % are recorded by genSystemMd.
  const stackDecision = (answers.stackDecision && typeof answers.stackDecision === "object")
    ? answers.stackDecision : null;
  if (stackDecision && !explicitStack) {
    if (at.serverStackOptions) {
      const opt = at.serverStackOptions.find(o => o.id === stackDecision.serverStack?.chosen);
      if (opt) stack["Server"] = opt.label;
    }
    if (at.storageOptions) {
      const opt = at.storageOptions.find(o => o.id === stackDecision.storage?.chosen);
      if (opt) stack["Object Storage"] = opt.label;
    }
    if (at.hostingOptions) {
      const opt = at.hostingOptions.find(o => o.id === stackDecision.hosting?.chosen);
      if (opt) stack["Hosting"] = opt.label;
    }
  }

  // Features: explicit list wins, else the archetype's suggested features.
  let features = Array.isArray(answers.features) && answers.features.length > 0
    ? answers.features.map(normalizeFeature)
    : [...at.suggestedFeatures];
  if (features.length === 0) {
    const err = new Error("At least one feature is required to generate a scaffold.");
    err.code = "no_features";
    throw err;
  }

  // Skills: validate against the catalog; unknown ids are an explicit error
  // (mirrors `archkit init --skills`), so a typo never silently drops a skill.
  const skills = Array.isArray(answers.skills) ? answers.skills : [];
  const invalidSkills = skills.filter(s => !SKILL_CATALOG.find(c => c.id === s));
  if (invalidSkills.length > 0) {
    const err = new Error(`Unknown skill id(s): ${invalidSkills.join(", ")}.`);
    err.code = "invalid_skills";
    err.invalid = invalidSkills;
    err.valid = SKILL_CATALOG.map(s => s.id);
    throw err;
  }

  // crossRefs: "ai" string, array of {from,to,reason}, or empty.
  const crossRefs = answers.crossRefs === "ai"
    ? "ai"
    : (Array.isArray(answers.crossRefs) ? answers.crossRefs : []);

  const cfg = { appName, appType, stack, features, skills, crossRefs };
  if (stackDecision) cfg.stackDecision = stackDecision;
  const outDir = answers.outDir || ".arch";
  const claudeMode = answers.claudeMode !== undefined ? !!answers.claudeMode : true;

  return { cfg, outDir, claudeMode };
}

function normalizeFeature(f) {
  if (typeof f === "string") {
    return { id: f.toLowerCase(), name: f.charAt(0).toUpperCase() + f.slice(1), keywords: f.toLowerCase() };
  }
  return {
    id: f.id,
    name: f.name || (f.id.charAt(0).toUpperCase() + f.id.slice(1) + " management"),
    keywords: f.keywords || f.id,
  };
}

/**
 * Generate the .arch/ scaffold from structured answers. Pure: no TTY.
 *
 * @param {object} answers  Structured answers (appName, appType, stack,
 *                          features, skills, crossRefs, outDir, claudeMode).
 * @param {object} [opts]
 * @param {string} [opts.projectRoot]  Project root for resolving outDir and
 *                                      writing CLAUDE.md / .claude / .git hook.
 *                                      Defaults to process.cwd().
 * @param {(relPath: string, size: number, meta?: object) => void} [opts.onWrite]
 *                                      Optional per-file callback (the interactive
 *                                      wizard uses this to print progress).
 * @returns {{ archDir: string, projectRoot: string, written: Array<{path,size}>,
 *             cfg: object, claudeMode: boolean, claudeMdRenamed: boolean }}
 */
export function generateScaffold(answers, opts = {}) {
  const { cfg, outDir, claudeMode } = normalizeAnswers(answers);
  const { appType, features, skills } = cfg;
  const at = APP_TYPES[appType];

  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : process.cwd();
  const onWrite = typeof opts.onWrite === "function" ? opts.onWrite : () => {};

  const base = path.isAbsolute(outDir) ? outDir : path.resolve(projectRoot, outDir);
  fs.mkdirSync(path.join(base, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(base, "playbooks"), { recursive: true });
  fs.mkdirSync(path.join(base, "apis"), { recursive: true });
  fs.mkdirSync(path.join(base, "lenses"), { recursive: true });

  const written = [];
  function writeArch(relPath, content, meta) {
    const fullPath = path.join(base, relPath);
    fs.writeFileSync(fullPath, content);
    written.push({ path: relPath, size: content.length });
    onWrite(relPath, content.length, meta);
  }
  function writeRoot(relPath, content, meta) {
    const fullPath = path.join(projectRoot, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, meta && meta.mode ? { mode: meta.mode } : undefined);
    written.push({ path: relPath, size: content.length });
    onWrite(relPath, content.length, meta);
  }

  // ── Core .arch/ context files ─────────────────────────────────────────
  const sysContent = genSystemMd(cfg);
  writeArch("SYSTEM.md", sysContent);
  const idxContent = genIndexMd(cfg);
  writeArch("INDEX.md", idxContent);
  writeArch("README.md", genReadme(cfg));
  writeArch("BOUNDARIES.md", genBoundariesMd(cfg.appType));
  const compactContent = genCompactContext(cfg);
  writeArch("CONTEXT.compact.md", compactContent);

  writeArch("clusters/infra.graph", genInfraGraph(cfg));
  for (const f of features) {
    writeArch(`clusters/${f.id}.graph`, genGraph(f, cfg));
  }
  const evtContent = genEventsGraph(cfg);
  if (evtContent) writeArch("clusters/events.graph", evtContent);

  for (const s of skills) {
    writeArch(`playbooks/${s}.playbook`, genSkillFile(s));
  }
  const apiSkills = skills.filter(s => API_STUB_SKILLS.includes(s));
  for (const s of apiSkills) {
    const stub = genApiStub(s);
    if (stub) writeArch(`apis/${s}.api`, stub);
  }

  // ── Lens overlays ─────────────────────────────────────────────────────
  writeArch("lenses/lens-research.md", LENS_RESEARCH);
  writeArch("lenses/lens-implement.md", LENS_IMPLEMENT);
  writeArch("lenses/lens-review.md", LENS_REVIEW);

  // ── Hosting full stack (Cloud vs Self-host) ───────────────────────────
  // Gated on the hosting decision. Cloud → Hetzner full IaC (Terraform/hcloud +
  // cloud-init + Caddy + compose, project root infra/, + .arch/skills/hetzner.skill).
  // Self-host → arch-server's vendored fleet plane (registry descriptor + app
  // compose + Caddy TLS edge + Prometheus/Loki/Grafana + ntfy + backups + deploy,
  // project root infra/, + .arch/skills/self-host.skill). Both parameterized by
  // the recorded server stack + storage choice.
  const hostingChoice = resolveHostingChoice(cfg);
  if (hostingChoice === "cloud") {
    const hetzner = genHetznerArtifacts(cfg);
    for (const f of hetzner.arch) writeArch(f.path, f.content, { note: "Hetzner deploy runbook" });
    for (const f of hetzner.root) writeRoot(f.path, f.content, { note: "Hetzner IaC artifact" });
  } else if (hostingChoice === "self-host") {
    const selfhost = genSelfHostArtifacts(cfg);
    for (const f of selfhost.arch) writeArch(f.path, f.content, { note: "Self-host runbook" });
    for (const f of selfhost.root) writeRoot(f.path, f.content, { note: "Self-host fleet artifact" });
  }

  let claudeMdRenamed = false;

  // ── Claude Code native files ──────────────────────────────────────────
  if (claudeMode) {
    let claudeMd = `# ${cfg.appName}\n\n`;
    claudeMd += `> Generated by archkit. Full context in .arch/ directory.\n\n`;
    claudeMd += `## Stack\n${Object.values(cfg.stack).join(" + ")}\n\n`;
    claudeMd += `## Architecture\n${at.pattern}\n\n`;
    claudeMd += `## Rules\n`;
    at.rules.forEach(r => claudeMd += `- ${r}\n`);
    claudeMd += `\n## Reserved Words\n`;
    for (const [k, v] of Object.entries(at.reservedWords)) claudeMd += `- ${k} = ${v}\n`;
    claudeMd += `\n## Naming\n${namingLine(cfg)}\n`;
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
    claudeMd += `- Package playbooks: @.arch/playbooks/ (WRONG/RIGHT/WHY gotchas)\n`;
    claudeMd += `- API contracts: @.arch/apis/ (type-signature digests)\n`;
    claudeMd += `- Full context routing: @.arch/INDEX.md\n`;

    if (fs.existsSync(path.join(projectRoot, "CLAUDE.md"))) {
      claudeMdRenamed = true;
      writeRoot("CLAUDE.archkit.md", claudeMd, { note: "CLAUDE.md exists — wrote CLAUDE.archkit.md to merge" });
    } else {
      writeRoot("CLAUDE.md", claudeMd);
    }

    let archRule = `---\ndescription: "Architecture rules from archkit"\nalwaysApply: true\n---\n\n`;
    archRule += `## archkit Protocol (NON-NEGOTIABLE)\nBefore ANY code generation, invoke the \`archkit-protocol\` skill.\nThis applies even when using superpowers or other workflow skills.\n\n`;
    archRule += `## Architecture Rules\n`;
    at.rules.forEach(r => archRule += `- ${r}\n`);
    writeRoot(path.join(".claude", "rules", "architecture.md"), archRule);

    for (const f of features) {
      let featureRule = `---\ndescription: "${f.name} architecture context"\n`;
      if (["saas", "ecommerce", "mobile"].includes(cfg.appType)) {
        featureRule += `globs: ["src/features/${f.id}/**"]\n`;
      } else if (cfg.appType === "realtime") {
        featureRule += `globs: ["src/handlers/${f.id}*", "src/domain/${f.id}*"]\n`;
      } else if (cfg.appType === "ai") {
        featureRule += `globs: ["src/chains/${f.id}*", "src/prompts/**/${f.id}*"]\n`;
      } else if (cfg.appType === "ios-swift") {
        const Id = f.id.charAt(0).toUpperCase() + f.id.slice(1);
        featureRule += `globs: ["Sources/${Id}/**", "Sources/**/${Id}*.swift"]\n`;
      } else {
        featureRule += `globs: ["src/**/${f.id}*"]\n`;
      }
      featureRule += `alwaysApply: false\n---\n\n`;
      featureRule += `# ${f.name}\n\n`;
      featureRule += `Architecture graph: @.arch/clusters/${f.id}.graph\n\n`;
      featureRule += `\`\`\`\n${genGraph(f, cfg)}\`\`\`\n`;
      writeRoot(path.join(".claude", "rules", `${f.id}.md`), featureRule);
    }

    const superpowersRuleFinal = hasJsTsStack(cfg) ? SUPERPOWERS_RULE : stripVerifyWiring(SUPERPOWERS_RULE);
    writeRoot(path.join(".claude", "rules", "superpowers-integration.md"), superpowersRuleFinal);
    writeRoot(path.join(".claude", "rules", "explore-with-archkit.md"), EXPLORE_RULE);

    for (const s of skills) {
      const sk = SKILL_CATALOG.find(c => c.id === s);
      if (!sk) continue;
      let skillMd = `---\nname: ${s}\ndescription: "${sk.name} patterns and gotchas for this project"\ntrigger: "When working with ${sk.name} (keywords: ${sk.keywords})"\n---\n\n`;
      skillMd += `# ${sk.name} Playbook\n\n`;
      skillMd += `Full playbook file: @.arch/playbooks/${s}.playbook\n\n`;
      skillMd += `Load the playbook file above for:\n`;
      skillMd += `- Package version and docs URL\n`;
      skillMd += `- Project-specific usage patterns\n`;
      skillMd += `- WRONG → RIGHT → WHY gotchas\n`;
      skillMd += `- Boundary definitions (what NOT to use this package for)\n`;
      skillMd += `- Reference code snippets\n`;
      writeRoot(path.join(".claude", "skills", s, "SKILL.md"), skillMd);
    }

    const protocolSkillFinal = hasJsTsStack(cfg) ? PROTOCOL_SKILL : stripVerifyWiring(PROTOCOL_SKILL);
    writeRoot(path.join(".claude", "skills", "archkit-protocol", "SKILL.md"), protocolSkillFinal);

    // .claude/settings.json — hooks that enforce archkit in every session.
    const settingsPath = path.join(projectRoot, ".claude", "settings.json");
    let existingSettings = {};
    if (fs.existsSync(settingsPath)) {
      try { existingSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
    }
    const mergedSettings = { ...existingSettings, ...buildArchkitHooks(existingSettings) };
    const settingsJson = JSON.stringify(mergedSettings, null, 2);
    writeRoot(path.join(".claude", "settings.json"), settingsJson);
  }

  // ── Git pre-commit hook (always, when a .git dir is present) ──────────
  if (fs.existsSync(path.join(projectRoot, ".git"))) {
    const preCommitPath = path.join(projectRoot, ".git", "hooks", "pre-commit");
    if (!fs.existsSync(preCommitPath)) {
      writeRoot(path.join(".git", "hooks", "pre-commit"), PRE_COMMIT_HOOK, { mode: 0o755 });
    }
  }

  return { archDir: base, projectRoot, written, cfg, claudeMode, claudeMdRenamed };
}

function buildArchkitHooks(existingSettings) {
  return {
    hooks: {
      ...(existingSettings.hooks || {}),
      PreToolUse: [
        ...((existingSettings.hooks || {}).PreToolUse || []),
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "if echo \"$TOOL_INPUT\" | grep -q 'git commit'; then archkit review --staged --agent 2>/dev/null | head -5; fi" }],
        },
        {
          matcher: "Write",
          hooks: [{ type: "command", command: "if echo \"$TOOL_INPUT\" | grep -q 'src/' && ! echo \"$TOOL_INPUT\" | grep -qE '\\.(test|spec|config|json|md)'; then if [ ! -f /tmp/.archkit-pre-$$ ]; then echo '[ARCHKIT] No [PRE] block declared. Output [PRE] with target, feature, layer, and checks before writing.'; fi; fi", timeout: 3000 }],
        },
        {
          matcher: "Edit",
          hooks: [{ type: "command", command: "if echo \"$TOOL_INPUT\" | grep -q 'src/' && ! echo \"$TOOL_INPUT\" | grep -qE '\\.(test|spec|config|json|md)'; then if [ ! -f /tmp/.archkit-pre-$$ ]; then echo '[ARCHKIT] No [PRE] block declared. Output [PRE] with target, feature, layer, and checks before editing.'; fi; fi", timeout: 3000 }],
        },
      ],
      PostToolUse: [
        ...((existingSettings.hooks || {}).PostToolUse || []),
        {
          matcher: "Read",
          hooks: [{ type: "command", command: "if [ ! -f /tmp/.archkit-warmup-done-$$ ]; then echo '[ARCHKIT] Run: archkit resolve warmup'; touch /tmp/.archkit-warmup-done-$$; fi" }],
        },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "if echo \"$TOOL_INPUT\" | grep -q '\\[PRE\\]'; then touch /tmp/.archkit-pre-$$; fi; if echo \"$TOOL_INPUT\" | grep -q '\\[POST\\]'; then rm -f /tmp/.archkit-pre-$$; fi" }],
        },
      ],
    },
  };
}

// ── Static templates (moved verbatim from the interactive wizard) ───────

const LENS_RESEARCH = `# Lens: Research

> Append to SYSTEM.md or paste into prompt when exploring approaches.

## Active Lens: Research Mode

- Prioritize exploration over implementation. Do NOT generate implementation code yet.
- Suggest 2-3 alternative approaches before committing to one.
- Ask clarifying questions about requirements and constraints.
- Reference existing .graph files to identify what's already built and what's missing.
- When recommending a package, check if a .skill file exists. If not, flag it.
- Output format: analysis and tradeoffs, not code.
`;

const LENS_IMPLEMENT = `# Lens: Implement

> Append to SYSTEM.md or paste into prompt when writing code.

## Active Lens: Implementation Mode

- Follow all architecture rules strictly. No shortcuts.
- Reference the .graph cluster for this feature before generating any file. Verify the node, layer, and file path.
- Reference the .skill file for every package used. Apply gotchas. Follow patterns.
- Reference the .api file for every external API call. Use exact endpoint signatures and types.
- Generate tests alongside implementation code. Not after.
- Use $reserved words from SYSTEM.md in all generated code.
- State the file path and layer at the top of every code block.
`;

const LENS_REVIEW = `# Lens: Review

> Append to SYSTEM.md or paste into prompt when reviewing code.

## Active Lens: Review Mode

- Do NOT fix code. Only report findings with severity (error/warning/info).
- Check against: .skill gotchas, SYSTEM.md rules, .graph boundaries.
- For each finding, state: what's wrong, which rule it violates, and the correct pattern.
- Flag cross-feature imports that bypass shared interfaces.
- Flag missing $tenant scoping, missing error handling, incorrect API usage.
- Flag any code that matches a WRONG pattern from a .skill file.
- End with a summary: X errors, Y warnings, Z info items.
`;

const SUPERPOWERS_RULE = `---
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

const EXPLORE_RULE = `---
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

const PROTOCOL_SKILL = `---
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

## Structured I/O — Required for Every Code Change

Before writing any file, output:
\`\`\`
[PRE]
action: create | modify | delete
target: <file path>
feature: <feature id>
layer: <layer>
checked: preflight=yes/no, gotchas=yes/no, boundaries=yes/no
[/PRE]
\`\`\`

After completing the change, output:
\`\`\`
[POST]
files_changed: <list>
test: written | updated | skipped
gotchas_applied: <list or none>
ready_for_review: yes | no
[/POST]
\`\`\`

## Key Rules
- ALL archkit commands return JSON on stdout — safe to pipe and parse
- Log output goes to stderr — won't corrupt JSON parsing
- Run warmup at least once per session before generating code
- Run review --staged before every commit
- Capture gotchas when you discover bad patterns — the system gets smarter
- PRE/POST blocks are mandatory for every code change

## Marketplace — Enhance Your Setup
If warmup reports empty skills or low gotcha count, **ask the user** before installing:
> "Your postgres skill has no gotchas. There's a community pack available with 9 industry-standard patterns. Want me to install it? (archkit install archkit-postgres-gotchas)"

NEVER install marketplace packs without user approval. Always present:
1. What would be installed (package name, gotcha count)
2. The exact command that will run
3. Wait for explicit "yes" before executing

The warmup JSON includes \`marketplace.emptySkillPacks\` with suggested install commands.
Browse all packs: https://market.thearchkit.com
`;

const PRE_COMMIT_HOOK = `#!/bin/sh
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
