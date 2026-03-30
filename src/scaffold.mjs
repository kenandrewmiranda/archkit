import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { C, ICONS, divider } from "./lib/shared.mjs";
import { showBanner } from "./lib/banner.mjs";
import { APP_TYPES, SKILL_CATALOG } from "./data/app-types.mjs";
import { genSystemMd, genIndexMd, genGraph, genInfraGraph, genEventsGraph, genSkillFile, genApiStub, genReadme } from "./lib/generators.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// VISUAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function banner() {
  showBanner();
}

function heading(icon, text) {
  console.log("");
  console.log(`${C.cyan}${C.bold}  ${icon} ${text}${C.reset}`);
  console.log("");
}

function subheading(text) {
  console.log(`${C.blue}${C.bold}  ${text}${C.reset}`);
}

function info(text) {
  console.log(`${C.gray}  ${text}${C.reset}`);
}

function success(text) {
  console.log(`${C.green}  ${ICONS.check} ${text}${C.reset}`);
}

function warn(text) {
  console.log(`${C.yellow}  ${ICONS.warn} ${text}${C.reset}`);
}

function tip(text) {
  console.log(`${C.dim}${C.italic}  ${ICONS.light} ${text}${C.reset}`);
}

function bullet(text, indent = 2) {
  console.log(`${" ".repeat(indent)}${C.gray}${ICONS.dot}${C.reset} ${text}`);
}

function tree(label, isLast = false) {
  const prefix = isLast ? ICONS.corner : ICONS.tee;
  console.log(`${C.gray}    ${prefix}── ${C.reset}${label}`);
}

function codeBlock(lines, label) {
  if (label) console.log(`${C.gray}  ${label}:${C.reset}`);
  console.log(`${C.gray}  ┌${"─".repeat(62)}┐${C.reset}`);
  for (const line of lines) {
    const padded = line.padEnd(60);
    console.log(`${C.gray}  │ ${C.reset}${C.dim}${padded}${C.reset}${C.gray} │${C.reset}`);
  }
  console.log(`${C.gray}  └${"─".repeat(62)}┘${C.reset}`);
}

function filePreview(filepath, content) {
  const allLines = content.split("\n");
  const preview = allLines.slice(0, 8);
  console.log(`${C.gray}  ${ICONS.file} ${C.reset}${C.bold}${filepath}${C.reset} ${C.dim}(${content.length} bytes)${C.reset}`);
  for (const line of preview) {
    console.log(`${C.gray}    ${ICONS.pipe} ${C.dim}${line.substring(0, 60)}${C.reset}`);
  }
  if (allLines.length > 8) {
    console.log(`${C.gray}    ${ICONS.pipe} ${C.dim}... (${allLines.length - 8} more lines)${C.reset}`);
  }
  console.log("");
}

function progressStep(step, total, label) {
  const bar = "█".repeat(step) + "░".repeat(total - step);
  console.log(`${C.cyan}  [${bar}] ${step}/${total} ${C.reset}${label}`);
}

// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// WIZARD — Step definitions, navigation, save/load
// ═══════════════════════════════════════════════════════════════════════════

const PROGRESS_FILE = ".archkit-progress.json";

const STEPS = [
  { id: "appName",  label: "Project Identity",  stateKeys: ["appName"],               dependsOn: [],                       run: stepAppName },
  { id: "appType",  label: "Application Type",   stateKeys: ["appType"],               dependsOn: [],                       run: stepAppType },
  { id: "stack",    label: "Technology Stack",    stateKeys: ["stack"],                 dependsOn: ["appType"],              run: stepStack },
  { id: "features", label: "Define Features",    stateKeys: ["features"],              dependsOn: ["appType"],              run: stepFeatures },
  { id: "skills",   label: "Package Skills",     stateKeys: ["skills"],                dependsOn: ["appType", "stack"],     run: stepSkills },
  { id: "output",   label: "Output & Options",   stateKeys: ["outDir", "claudeMode"],  dependsOn: [],                       run: stepOutput },
  { id: "preview",  label: "Preview & Generate",  stateKeys: [],                        dependsOn: ["appName","appType","stack","features","skills","output"], run: stepPreview },
];

function createInitialState() {
  return { appName: null, appType: null, stack: null, features: null, skills: null, outDir: null, claudeMode: null, _completedSteps: [] };
}

// ── Save / Load ─────────────────────────────────────────────────────────

function saveProgress(state) {
  const data = {
    version: 1,
    savedAt: new Date().toISOString(),
    state: { ...state, _completedSteps: undefined },
    completedSteps: state._completedSteps,
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
  console.log("");
  success(`Progress saved to ${PROGRESS_FILE}`);
  info("Run archkit again to resume where you left off.");
  console.log("");
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    if (data.version !== 1) return null;
    return data;
  } catch { return null; }
}

function deleteProgressFile() {
  try { fs.unlinkSync(PROGRESS_FILE); } catch {}
}

// ── Navigation ──────────────────────────────────────────────────────────

function invalidateFrom(stepId, state) {
  const toInvalidate = new Set();
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const step of STEPS) {
      if (step.dependsOn.includes(current) && !toInvalidate.has(step.id)) {
        toInvalidate.add(step.id);
        queue.push(step.id);
      }
    }
  }
  for (const id of toInvalidate) {
    const step = STEPS.find(s => s.id === id);
    if (step) step.stateKeys.forEach(k => { state[k] = null; });
    state._completedSteps = state._completedSteps.filter(s => s !== id);
  }
}

async function promptNavigation(currentIndex) {
  const isFirst = currentIndex === 0;
  const choices = [
    { name: `${C.green}${ICONS.arrow}${C.reset} Continue to next step`, value: "continue", short: "Continue" },
  ];
  if (!isFirst) {
    choices.push({ name: `${C.blue}${ICONS.corner}${C.reset} Go back to a previous step`, value: "back", short: "Back" });
  }
  choices.push(
    { name: `${C.yellow}${ICONS.file}${C.reset} Save progress & exit`, value: "save", short: "Save" },
    { name: `${C.red}${ICONS.cross}${C.reset} Exit without saving`, value: "exit", short: "Exit" },
  );

  console.log("");
  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: "What next?",
    prefix: `  ${ICONS.arch}`,
    choices,
  }]);
  return action;
}

async function promptGoBack(completedSteps) {
  const choices = completedSteps.map(id => {
    const step = STEPS.find(s => s.id === id);
    return { name: step.label, value: id, short: step.label };
  });

  const { targetId } = await inquirer.prompt([{
    type: "list",
    name: "targetId",
    message: "Go back to which step?",
    prefix: `  ${ICONS.arch}`,
    choices,
  }]);
  return targetId;
}

// ── Step functions ──────────────────────────────────────────────────────

async function stepAppName(state) {
  heading(ICONS.rocket, `Step 1/${STEPS.length} — Project Identity`);
  info("What are we building? This name appears in generated files.");
  console.log("");

  const { appName } = await inquirer.prompt([{
    type: "input",
    name: "appName",
    message: "Project name:",
    default: state.appName || "my-app",
    prefix: `  ${ICONS.arch}`,
  }]);

  success(`Project: ${appName}`);
  return { appName };
}

async function stepAppType(state) {
  divider();
  heading(ICONS.mag, `Step 2/${STEPS.length} — Application Type`);
  info("This determines your architecture pattern, folder structure,");
  info("default stack, reserved words, and graph node templates.");
  console.log("");

  const { appType } = await inquirer.prompt([{
    type: "list",
    name: "appType",
    message: "What type of application?",
    prefix: `  ${ICONS.arch}`,
    choices: Object.entries(APP_TYPES).map(([k, v]) => ({
      name: `${v.icon}  ${v.name}  ${C.dim}— ${v.desc}${C.reset}`,
      value: k,
      short: v.name,
    })),
    default: state.appType || undefined,
    pageSize: 10,
  }]);

  const at = APP_TYPES[appType];
  console.log("");
  success(`Type: ${at.name}`);
  console.log("");

  subheading("Architecture pattern:");
  info(`  ${at.pattern}`);
  console.log("");

  subheading("File conventions:");
  info(`  ${at.folderConv}`);
  info(`  ${at.sharedConv}`);
  console.log("");

  subheading("Reserved words the AI will understand:");
  for (const [k, v] of Object.entries(at.reservedWords)) {
    console.log(`  ${C.yellow}${k}${C.reset} ${C.dim}= ${v}${C.reset}`);
  }
  console.log("");

  subheading("Rules that will govern code generation:");
  at.rules.forEach((r, i) => {
    console.log(`  ${C.gray}${i + 1}.${C.reset} ${r}`);
  });

  return { appType };
}

async function stepStack(state) {
  const at = APP_TYPES[state.appType];

  divider();
  heading(ICONS.package, `Step 3/${STEPS.length} — Technology Stack`);
  info("Default stack for this app type. Customize any layer or press Enter to keep defaults.");
  console.log("");

  subheading("Default stack:");
  for (const [layer, tool] of Object.entries(at.defaultStack)) {
    console.log(`  ${C.cyan}${layer.padEnd(20)}${C.reset} ${tool}`);
  }
  console.log("");

  const { wantCustomStack } = await inquirer.prompt([{
    type: "confirm",
    name: "wantCustomStack",
    message: "Customize any stack choices?",
    default: false,
    prefix: `  ${ICONS.arch}`,
  }]);

  let stack = state.stack || { ...at.defaultStack };
  if (wantCustomStack) {
    stack = {};
    console.log("");
    tip("Press Enter to keep the default for each layer.");
    console.log("");
    for (const [layer, defaultTool] of Object.entries(at.defaultStack)) {
      const { tool } = await inquirer.prompt([{
        type: "input",
        name: "tool",
        message: `${layer}:`,
        default: defaultTool,
        prefix: `  ${C.gray}${ICONS.gear}${C.reset}`,
      }]);
      stack[layer] = tool;
    }
  }

  console.log("");
  success("Stack configured.");
  return { stack };
}

async function stepFeatures(state) {
  const at = APP_TYPES[state.appType];

  divider();
  heading("\uD83C\uDFD7", `Step 4/${STEPS.length} — Define Your Features`);
  info("Features become clusters in your architecture graph.");
  info("Each gets its own .graph file with controller, service, repo nodes.");
  console.log("");

  if (at.suggestedFeatures.length > 0) {
    subheading("Suggested features for this app type:");
    at.suggestedFeatures.forEach(f => {
      console.log(`  ${C.gray}${ICONS.dot}${C.reset} ${C.bold}${f.id}${C.reset} ${C.dim}— ${f.name} (${f.keywords})${C.reset}`);
    });
    console.log("");
  }

  const { useSuggested } = await inquirer.prompt([{
    type: "confirm",
    name: "useSuggested",
    message: "Start with the suggested features?",
    default: true,
    prefix: `  ${ICONS.arch}`,
  }]);

  let features = useSuggested ? [...at.suggestedFeatures] : [];

  // Restore previously added custom features if resuming
  if (state.features && state.features.length > 0) {
    const suggestedIds = new Set(at.suggestedFeatures.map(f => f.id));
    const customFeatures = state.features.filter(f => !suggestedIds.has(f.id));
    if (customFeatures.length > 0) {
      features.push(...customFeatures);
    }
  }

  if (features.length > 0) {
    console.log("");
    features.forEach(f => success(`${f.id} — ${f.name}`));
  }

  console.log("");
  info("Add your own features. Type 'done' when finished.");
  console.log("");

  let adding = true;
  while (adding) {
    const { featureId } = await inquirer.prompt([{
      type: "input",
      name: "featureId",
      message: "Feature ID (lowercase, or 'done'):",
      prefix: `  ${C.cyan}+${C.reset}`,
    }]);

    if (featureId === "done" || featureId === "") {
      if (features.length === 0) {
        warn("Need at least one feature. Try again.");
        continue;
      }
      adding = false;
      continue;
    }

    if (features.find(f => f.id === featureId)) {
      warn(`${featureId} already exists. Skipping.`);
      continue;
    }

    const { featureName } = await inquirer.prompt([{
      type: "input",
      name: "featureName",
      message: "  Display name:",
      default: featureId.charAt(0).toUpperCase() + featureId.slice(1) + " management",
      prefix: `  ${C.gray}${ICONS.pipe}${C.reset}`,
    }]);

    const { featureKeywords } = await inquirer.prompt([{
      type: "input",
      name: "featureKeywords",
      message: "  Keywords (comma-separated):",
      default: featureId,
      prefix: `  ${C.gray}${ICONS.corner}${C.reset}`,
    }]);

    features.push({ id: featureId, name: featureName, keywords: featureKeywords });
    success(`Added: ${featureId} — ${featureName}`);
    console.log("");
  }

  return { features };
}

async function stepSkills(state) {
  const appType = state.appType;
  const stack = state.stack;

  divider();
  heading(ICONS.shield, `Step 5/${STEPS.length} — Package Skills`);
  info("Skills teach the AI your team's gotchas and patterns for each package.");
  info("We'll auto-detect relevant packages from your stack and suggest them.");
  console.log("");

  const stackStr = JSON.stringify(stack).toLowerCase() + " " + appType;
  const autoDetected = SKILL_CATALOG.filter(s => {
    const n = s.name.toLowerCase();
    if (n.includes("postgres") && stackStr.includes("postgres")) return true;
    if (n.includes("valkey") && (stackStr.includes("valkey") || stackStr.includes("redis"))) return true;
    if (n.includes("keycloak") && stackStr.includes("keycloak")) return true;
    if (n.includes("stripe") && stackStr.includes("stripe")) return true;
    if (n.includes("kill bill") && stackStr.includes("kill bill")) return true;
    if (n.includes("meilisearch") && stackStr.includes("meilisearch")) return true;
    if (n.includes("clickhouse") && stackStr.includes("clickhouse")) return true;
    if (n.includes("docker")) return true;
    if (n.includes("caddy") && stackStr.includes("caddy")) return true;
    if (n.includes("k3s") && stackStr.includes("k3s")) return true;
    if (n.includes("bullmq") && stackStr.includes("bullmq")) return true;
    if (n.includes("saleor") && stackStr.includes("saleor")) return true;
    if (n.includes("dagster") && stackStr.includes("dagster")) return true;
    if (n.includes("dbt") && stackStr.includes("dbt")) return true;
    if (n.includes("cube") && stackStr.includes("cube")) return true;
    if (n.includes("langfuse") && stackStr.includes("langfuse")) return true;
    if (n.includes("pgvector") && stackStr.includes("pgvector")) return true;
    if (n.includes("websocket") && appType === "realtime") return true;
    if (n.includes("yjs") && appType === "realtime") return true;
    if (n.includes("llm") && appType === "ai") return true;
    if (n.includes("opentofu") && stackStr.includes("opentofu")) return true;
    return false;
  });

  const notDetected = SKILL_CATALOG.filter(s => !autoDetected.find(a => a.id === s.id));
  const categories = [...new Set(SKILL_CATALOG.map(s => s.cat))];

  const previousSkills = state.skills || [];
  const choices = [];
  if (autoDetected.length > 0) {
    choices.push(new inquirer.Separator(`${C.green} ── Auto-detected from your stack ──${C.reset}`));
    autoDetected.forEach(s => choices.push({
      name: `${s.name} ${C.dim}(${s.cat})${C.reset}`,
      value: s.id,
      checked: previousSkills.includes(s.id) || (previousSkills.length === 0),
      short: s.name,
    }));
  }
  for (const cat of categories) {
    const catSkills = notDetected.filter(s => s.cat === cat);
    if (catSkills.length > 0) {
      choices.push(new inquirer.Separator(`${C.gray} ── ${cat} ──${C.reset}`));
      catSkills.forEach(s => choices.push({
        name: `${s.name}`,
        value: s.id,
        checked: previousSkills.includes(s.id),
        short: s.name,
      }));
    }
  }

  const { skills } = await inquirer.prompt([{
    type: "checkbox",
    name: "skills",
    message: "Select package skills to generate:",
    prefix: `  ${ICONS.arch}`,
    choices,
    pageSize: 20,
  }]);

  console.log("");
  success(`${skills.length} skill skeletons will be generated.`);
  skills.forEach(s => {
    const sk = SKILL_CATALOG.find(c => c.id === s);
    info(`  ${ICONS.dot} ${sk.name} → .arch/skills/${s}.skill`);
  });

  return { skills };
}

async function stepOutput(state) {
  divider();
  heading(ICONS.folder, `Step 6/${STEPS.length} — Output & Options`);

  const { outDir } = await inquirer.prompt([{
    type: "input",
    name: "outDir",
    message: "Where to generate .arch/ directory:",
    default: state.outDir || ".arch",
    prefix: `  ${ICONS.arch}`,
  }]);

  const cliHasClaude = process.argv.includes("--claude");
  let claudeMode = cliHasClaude;

  if (!cliHasClaude) {
    const { wantClaude } = await inquirer.prompt([{
      type: "confirm",
      name: "wantClaude",
      message: "Also generate Claude Code native files? (CLAUDE.md + .claude/rules/ + .claude/skills/)",
      default: state.claudeMode || false,
      prefix: `  ${ICONS.arch}`,
    }]);
    claudeMode = wantClaude;
  }

  if (claudeMode) {
    console.log("");
    success("Claude Code integration enabled.");
    info("  Will generate: CLAUDE.md (root), .claude/rules/, .claude/skills/");
    info("  Claude Code will auto-load these alongside .arch/ files.");
  }

  return { outDir, claudeMode };
}

async function stepPreview(state) {
  const at = APP_TYPES[state.appType];
  const { appName, appType, stack, features, skills, outDir, claudeMode } = state;

  divider();
  heading(ICONS.mag, `Step 7/${STEPS.length} — Preview & Generate`);
  console.log("");

  const cfg = { appName, appType, stack, features, skills };

  // Show tree preview
  console.log(`  ${C.bold}${outDir}/${C.reset}`);
  tree(`${C.bold}SYSTEM.md${C.reset} ${C.dim}— rules + ${Object.keys(at.reservedWords).length} reserved words${C.reset}`);
  tree(`${C.bold}INDEX.md${C.reset} ${C.dim}— ${features.length} features + ${skills.length} skills routing${C.reset}`);
  tree(`${C.bold}README.md${C.reset} ${C.dim}— usage instructions${C.reset}`);
  tree(`${C.bold}clusters/${C.reset}`);
  console.log(`${C.gray}    ${ICONS.tee}── infra.graph ${C.dim}— shared infrastructure + middleware${C.reset}`);
  features.forEach(f => {
    console.log(`${C.gray}    ${ICONS.tee}── ${f.id}.graph ${C.dim}— ${f.name}${C.reset}`);
  });
  if (at.reservedWords["$bus"]) {
    console.log(`${C.gray}    ${ICONS.corner}── events.graph ${C.dim}— domain event definitions${C.reset}`);
  }
  tree(`${C.bold}skills/${C.reset}`);
  skills.forEach((s, i) => {
    const sk = SKILL_CATALOG.find(c => c.id === s);
    const isLast = i === skills.length - 1;
    console.log(`${C.gray}    ${isLast ? ICONS.corner : ICONS.tee}── ${s}.skill ${C.dim}— ${sk.name} gotchas${C.reset}`);
  });

  const apiSkills = skills.filter(s => ["stripe","killbill","meilisearch","opensearch","saleor","langfuse","llm_sdk"].includes(s));
  if (apiSkills.length > 0) {
    tree(`${C.bold}apis/${C.reset}`, true);
    apiSkills.forEach((s, i) => {
      const sk = SKILL_CATALOG.find(c => c.id === s);
      const isLast = i === apiSkills.length - 1;
      console.log(`${C.gray}    ${isLast ? ICONS.corner : ICONS.tee}── ${s}.api ${C.dim}— ${sk.name} contract stub${C.reset}`);
    });
  }

  console.log("");
  const fileCount = 3 + features.length + 1 + (at.reservedWords["$bus"] ? 1 : 0) + skills.length + apiSkills.length;
  info(`Total: ${fileCount} files`);
  console.log("");

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: "What would you like to do?",
    prefix: `  ${ICONS.arch}`,
    choices: [
      { name: `${C.green}${ICONS.rocket}${C.reset} Generate ${fileCount} files in ${outDir}/`, value: "generate", short: "Generate" },
      { name: `${C.blue}${ICONS.corner}${C.reset} Go back to a previous step`, value: "back", short: "Back" },
      { name: `${C.yellow}${ICONS.file}${C.reset} Save progress & exit`, value: "save", short: "Save" },
      { name: `${C.red}${ICONS.cross}${C.reset} Exit without saving`, value: "exit", short: "Exit" },
    ],
  }]);

  return { _previewAction: action };
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateFiles(state) {
  const { appName, appType, stack, features, skills, outDir, claudeMode } = state;
  const at = APP_TYPES[appType];
  const cfg = { appName, appType, stack, features, skills };

  divider();
  heading(ICONS.gear, "Generating...");

  const base = path.resolve(outDir);
  fs.mkdirSync(path.join(base, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(base, "skills"), { recursive: true });
  fs.mkdirSync(path.join(base, "apis"), { recursive: true });

  const written = [];

  function writeFile(relPath, content) {
    const fullPath = path.join(base, relPath);
    fs.writeFileSync(fullPath, content);
    written.push({ path: relPath, size: content.length });
    console.log(`  ${C.green}${ICONS.check}${C.reset} ${relPath} ${C.dim}(${content.length} bytes)${C.reset}`);
  }

  const sysContent = genSystemMd(cfg);
  writeFile("SYSTEM.md", sysContent);

  const idxContent = genIndexMd(cfg);
  writeFile("INDEX.md", idxContent);

  writeFile("README.md", genReadme(cfg));
  writeFile("clusters/infra.graph", genInfraGraph(cfg));

  for (const f of features) {
    writeFile(`clusters/${f.id}.graph`, genGraph(f, cfg));
  }

  const evtContent = genEventsGraph(cfg);
  if (evtContent) writeFile("clusters/events.graph", evtContent);

  for (const s of skills) {
    writeFile(`skills/${s}.skill`, genSkillFile(s));
  }

  const apiSkills = skills.filter(s => ["stripe","killbill","meilisearch","opensearch","saleor","langfuse","llm_sdk"].includes(s));
  for (const s of apiSkills) {
    const stub = genApiStub(s);
    if (stub) writeFile(`apis/${s}.api`, stub);
  }

  // Generate lenses
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
    claudeMd += `- BEFORE any code generation: run \`node resolve.mjs warmup\` in .arch-tools/\n`;
    claudeMd += `- If warmup returns blockers: FIX THEM. No exceptions.\n`;
    claudeMd += `- BEFORE new feature: run \`node resolve.mjs scaffold <featureId>\`\n`;
    claudeMd += `- BEFORE editing existing feature: run \`node resolve.mjs preflight <feature> <layer>\`\n`;
    claudeMd += `- AT SESSION END: suggest \`node gotcha.mjs --debrief\`\n`;
    claudeMd += `\n## Delegation\nDelegate deterministic work to sub-agents + CLI tools first (70-80%).\n`;
    claudeMd += `Main agent finalizes with TDD: write failing test → verify generated code passes → review.mjs --agent as gate.\n`;
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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  banner();

  let state = createInitialState();
  let currentStep = 0;

  // Check for saved progress
  const saved = loadProgress();
  if (saved) {
    const completedLabels = saved.completedSteps.map(id => STEPS.find(s => s.id === id)?.label).filter(Boolean);
    console.log(`${C.yellow}  ${ICONS.file} Saved progress found${C.reset} ${C.dim}(${new Date(saved.savedAt).toLocaleString()})${C.reset}`);
    info(`  Completed: ${completedLabels.join(", ")}`);
    console.log("");

    const { resumeChoice } = await inquirer.prompt([{
      type: "list",
      name: "resumeChoice",
      message: "Resume or start fresh?",
      prefix: `  ${ICONS.arch}`,
      choices: [
        { name: `${C.green}${ICONS.arrow}${C.reset} Resume from where you left off`, value: "resume", short: "Resume" },
        { name: `${C.red}${ICONS.cross}${C.reset} Start fresh (discard saved progress)`, value: "fresh", short: "Fresh" },
      ],
    }]);

    if (resumeChoice === "resume") {
      Object.assign(state, saved.state);
      state._completedSteps = [...saved.completedSteps];
      // Find first incomplete step
      currentStep = STEPS.findIndex(s => !state._completedSteps.includes(s.id));
      if (currentStep === -1) currentStep = STEPS.length - 1; // all done, go to preview
      console.log("");
      success(`Resuming at: ${STEPS[currentStep].label}`);
    } else {
      deleteProgressFile();
    }
    console.log("");
  }

  // Main wizard loop
  while (currentStep < STEPS.length) {
    const step = STEPS[currentStep];

    // Show progress bar
    const filled = state._completedSteps.length;
    const total = STEPS.length;
    progressStep(filled, total, step.label);

    // Run the step
    const result = await step.run(state);
    Object.assign(state, result);

    // Preview step handles its own navigation
    if (step.id === "preview") {
      const previewAction = state._previewAction;
      delete state._previewAction;

      if (previewAction === "generate") {
        state._completedSteps.push(step.id);
        generateFiles(state);
        deleteProgressFile();
        break;
      } else if (previewAction === "back") {
        const targetId = await promptGoBack(state._completedSteps);
        invalidateFrom(targetId, state);
        state._completedSteps = state._completedSteps.filter(s => s !== targetId);
        currentStep = STEPS.findIndex(s => s.id === targetId);
        continue;
      } else if (previewAction === "save") {
        saveProgress(state);
        process.exit(0);
      } else if (previewAction === "exit") {
        const { confirmExit } = await inquirer.prompt([{
          type: "confirm", name: "confirmExit",
          message: "Are you sure? All progress will be lost.",
          default: false, prefix: `  ${ICONS.arch}`,
        }]);
        if (confirmExit) process.exit(0);
        continue; // re-show preview
      }
    }

    // Mark step complete
    if (!state._completedSteps.includes(step.id)) {
      state._completedSteps.push(step.id);
    }

    // Navigation prompt (not shown for last step — preview handles it)
    const action = await promptNavigation(currentStep);

    switch (action) {
      case "continue":
        currentStep++;
        break;
      case "back": {
        const targetId = await promptGoBack(state._completedSteps);
        invalidateFrom(targetId, state);
        state._completedSteps = state._completedSteps.filter(s => s !== targetId);
        currentStep = STEPS.findIndex(s => s.id === targetId);
        break;
      }
      case "save":
        saveProgress(state);
        process.exit(0);
        break;
      case "exit": {
        const { confirmExit } = await inquirer.prompt([{
          type: "confirm", name: "confirmExit",
          message: "Are you sure? All progress will be lost.",
          default: false, prefix: `  ${ICONS.arch}`,
        }]);
        if (confirmExit) process.exit(0);
        break; // stay on same step, re-show nav
      }
    }
  }
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main().catch(err => {
    console.error(`\n${C.red}  Error: ${err.message}${C.reset}\n`);
    process.exit(1);
  });
}
