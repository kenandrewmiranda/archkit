import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { C, ICONS, divider } from "../lib/shared.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";
import { heading, subheading, info, success, warn, tip, tree } from "./helpers.mjs";
import { loadPreset, findPresets } from "./preset.mjs";

async function stepAppName(state) {
  heading(ICONS.rocket, `Step 1/7 — Project Identity`);
  info("What are we building? This name appears in generated files.");
  console.log("");

  // Offer preset loading option
  const presets = findPresets();
  const choices = [
    { name: `${C.green}${ICONS.arrow}${C.reset} Enter project name manually`, value: "__manual", short: "Manual" },
  ];

  if (presets.length > 0) {
    choices.push(new inquirer.Separator(`${C.gray} ── Load from preset ──${C.reset}`));
    presets.forEach(p => {
      choices.push({ name: `${C.cyan}${ICONS.file}${C.reset} ${p.name}`, value: p.path, short: p.name });
    });
  }

  choices.push({ name: `${C.dim}${ICONS.folder} Load from custom path...${C.reset}`, value: "__custom", short: "Custom path" });

  const { startChoice } = await inquirer.prompt([{
    type: "list",
    name: "startChoice",
    message: "How would you like to start?",
    prefix: `  ${ICONS.arch}`,
    choices,
  }]);

  // Load preset from file
  if (startChoice !== "__manual") {
    let presetPath = startChoice;

    if (startChoice === "__custom") {
      const { customPath } = await inquirer.prompt([{
        type: "input",
        name: "customPath",
        message: "Path to preset JSON:",
        prefix: `  ${ICONS.arch}`,
      }]);
      presetPath = customPath;
    }

    const preset = loadPreset(presetPath);
    if (preset) {
      success(`Preset loaded: ${path.basename(presetPath)}`);
      return { _preset: preset, _presetPath: presetPath, appName: preset.appName };
    }
    // If preset failed, fall through to manual entry
    console.log("");
    info("Falling back to manual entry.");
    console.log("");
  }

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
  heading(ICONS.mag, `Step 2/7 — Application Type`);
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
  heading(ICONS.package, `Step 3/7 — Technology Stack`);
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
  heading("\uD83C\uDFD7", `Step 4/7 — Define Your Features`);
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
  if (features.length === 0 && at.suggestedFeatures.length > 0) {
    info("Or type 'suggested' to add all suggested features at once.");
  }
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
        warn("At least one feature is required — 'done' only works after you've added one.");
        info("Enter a feature ID (e.g. 'auth', 'chat'), or type 'suggested' to use the suggested list.");
        continue;
      }
      adding = false;
      continue;
    }

    if (featureId === "suggested") {
      if (at.suggestedFeatures.length === 0) {
        warn("No suggested features available for this app type.");
        continue;
      }
      const suggestedIds = new Set(features.map(f => f.id));
      const toAdd = at.suggestedFeatures.filter(f => !suggestedIds.has(f.id));
      if (toAdd.length === 0) {
        warn("All suggested features are already added.");
        continue;
      }
      features.push(...toAdd);
      toAdd.forEach(f => success(`Added: ${f.id} — ${f.name}`));
      console.log("");
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

  // Cross-references
  if (features.length > 1) {
    console.log("");
    info("Define relationships between features (helps AI understand dependencies).");
    console.log("");

    const { refMode } = await inquirer.prompt([{
      type: "list",
      name: "refMode",
      message: "How do you want to define dependencies?",
      prefix: `  ${ICONS.arch}`,
      choices: [
        { name: `${C.cyan}${ICONS.gear}${C.reset} Let AI decide during code generation`, value: "ai", short: "AI decides" },
        { name: `${C.green}${ICONS.arrow}${C.reset} Define them manually now`, value: "manual", short: "Manual" },
        { name: `${C.dim}Skip — no dependencies${C.reset}`, value: "skip", short: "Skip" },
      ],
    }]);

    if (refMode === "ai") {
      console.log("");
      success("Dependencies will be inferred by AI during code generation.");
      info("  The AI agent will analyze your features and determine relationships.");
      return { features, crossRefs: "ai" };
    }

    if (refMode === "skip") {
      return { features, crossRefs: [] };
    }

    // Manual mode
    console.log("");
    info("Type 'done' when finished.");
    console.log("");

    const crossRefs = [];
    let addingRefs = true;
    while (addingRefs) {
      const { refChoice } = await inquirer.prompt([{
        type: "list",
        name: "refChoice",
        message: "Add a dependency?",
        prefix: `  ${ICONS.arch}`,
        choices: [
          ...features.map(f => ({ name: `${f.id} depends on...`, value: f.id })),
          { name: `${C.dim}Done — no more dependencies${C.reset}`, value: "__done" },
        ],
        pageSize: 12,
      }]);

      if (refChoice === "__done") { addingRefs = false; continue; }

      const targets = features.filter(f => f.id !== refChoice);
      const { refTarget } = await inquirer.prompt([{
        type: "list",
        name: "refTarget",
        message: `  ${refChoice} depends on:`,
        prefix: `  ${ICONS.pipe}`,
        choices: targets.map(f => ({ name: f.id, value: f.id })),
      }]);

      const { refReason } = await inquirer.prompt([{
        type: "input",
        name: "refReason",
        message: "  Why?",
        default: `${refChoice} uses ${refTarget} services`,
        prefix: `  ${ICONS.corner}`,
      }]);

      crossRefs.push({ from: refChoice, to: refTarget, reason: refReason });
      success(`${refChoice} → ${refTarget} (${refReason})`);
    }

    return { features, crossRefs };
  }

  return { features, crossRefs: [] };
}

async function stepSkills(state) {
  const appType = state.appType;
  const stack = state.stack;

  divider();
  heading(ICONS.shield, `Step 5/7 — Package Skills`);
  info("Skills teach the AI your team's gotchas and patterns for each package.");
  info("We'll auto-detect relevant packages from your stack and suggest them.");
  console.log("");

  const stackStr = JSON.stringify(stack).toLowerCase() + " " + appType;
  const autoDetected = SKILL_CATALOG.filter(s => {
    // Match skill keywords against stack + appType
    const terms = s.keywords.split(",").map(k => k.trim().toLowerCase());
    return terms.some(term => stackStr.includes(term)) || s.id === "docker";
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
  heading(ICONS.folder, `Step 6/7 — Output & Options`);

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

  // Issue reporting opt-in
  let reportIssues = state.reportIssues || false;
  console.log("");
  info("Help improve archkit: opt in to report gotchas and session findings");
  info("as GitHub issues on the archkit repo. Requires gh CLI.");

  const { wantReporting } = await inquirer.prompt([{
    type: "confirm",
    name: "wantReporting",
    message: "Report gotchas/findings as GitHub issues?",
    default: reportIssues,
    prefix: `  ${ICONS.arch}`,
  }]);
  reportIssues = wantReporting;

  if (reportIssues) {
    const { isGhAvailable, saveConfig } = await import("../lib/issue-reporter.mjs");
    if (isGhAvailable()) {
      saveConfig({ reportIssues: true });
      success("Issue reporting enabled. Gotchas and debrief findings will be offered as GitHub issues.");
    } else {
      warn("gh CLI not found or not authenticated. Install with: brew install gh && gh auth login");
      reportIssues = false;
    }
  }

  return { outDir, claudeMode, reportIssues };
}

async function stepPreview(state) {
  const at = APP_TYPES[state.appType];
  const { appName, appType, stack, features, skills, outDir, claudeMode } = state;

  divider();
  heading(ICONS.mag, `Step 7/7 — Preview & Generate`);
  console.log("");

  const cfg = { appName, appType, stack, features, skills };

  // Show tree preview
  console.log(`  ${C.bold}${outDir}/${C.reset}`);
  tree(`${C.bold}SYSTEM.md${C.reset} ${C.dim}— rules + ${Object.keys(at.reservedWords).length} reserved words${C.reset}`);
  tree(`${C.bold}INDEX.md${C.reset} ${C.dim}— ${features.length} features + ${skills.length} skills routing${C.reset}`);
  tree(`${C.bold}README.md${C.reset} ${C.dim}— usage instructions${C.reset}`);
  tree(`${C.bold}BOUNDARIES.md${C.reset} ${C.dim}— hard prohibitions (NEVER rules)${C.reset}`);
  tree(`${C.bold}CONTEXT.compact.md${C.reset} ${C.dim}— ~500 token summary for cheap-model calls${C.reset}`);
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

  // Show cross-refs status
  console.log("");
  if (state.crossRefs === "ai") {
    info(`${C.cyan}${ICONS.gear}${C.reset} Cross-refs: AI-inferred during code generation`);
  } else if (state.crossRefs && state.crossRefs.length > 0) {
    info(`Cross-refs: ${state.crossRefs.length} dependencies defined`);
  } else {
    info(`${C.dim}Cross-refs: none${C.reset}`);
  }

  console.log("");
  const fileCount = 5 + features.length + 1 + (at.reservedWords["$bus"] ? 1 : 0) + skills.length + apiSkills.length;
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

export { stepAppName, stepAppType, stepStack, stepFeatures, stepSkills, stepOutput, stepPreview };
