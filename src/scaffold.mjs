import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { C, ICONS, divider } from "./lib/shared.mjs";
import { showBanner } from "./lib/banner.mjs";
import { stepAppName, stepAppType, stepStack, stepFeatures, stepSkills, stepOutput, stepPreview } from "./wizard/steps.mjs";
import { generateFiles } from "./wizard/generate.mjs";
import { createInitialState, saveProgress, loadProgress, deleteProgressFile, invalidateFrom, promptNavigation, promptGoBack } from "./wizard/navigation.mjs";
import { success, progressStep, info, warn } from "./wizard/helpers.mjs";
import { loadPreset } from "./wizard/preset.mjs";

// ═══════════════════════════════════════════════════════════════════════════

function banner() {
  showBanner();
}

const STEPS = [
  { id: "appName",  label: "Project Identity",  stateKeys: ["appName"],               dependsOn: [],                       run: stepAppName },
  { id: "appType",  label: "Application Type",   stateKeys: ["appType"],               dependsOn: [],                       run: stepAppType },
  { id: "stack",    label: "Technology Stack",    stateKeys: ["stack"],                 dependsOn: ["appType"],              run: stepStack },
  { id: "features", label: "Define Features",    stateKeys: ["features", "crossRefs"], dependsOn: ["appType"],              run: stepFeatures },
  { id: "skills",   label: "Package Skills",     stateKeys: ["skills"],                dependsOn: ["appType", "stack"],     run: stepSkills },
  { id: "output",   label: "Output & Options",   stateKeys: ["outDir", "claudeMode", "reportIssues"],  dependsOn: [],  run: stepOutput },
  { id: "preview",  label: "Preview & Generate",  stateKeys: [],                        dependsOn: ["appName","appType","stack","features","skills","output"], run: stepPreview },
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  banner();

  let state = createInitialState();
  let currentStep = 0;

  // Check for preset file
  const presetPath = process.env.ARCHKIT_PRESET;
  if (presetPath) {
    const preset = loadPreset(presetPath);
    if (preset) {
      // Apply preset values to state
      const presetKeys = ["appName", "appType", "stack", "features", "crossRefs", "skills", "outDir", "claudeMode", "reportIssues"];
      for (const key of presetKeys) {
        if (preset[key] !== undefined) {
          state[key] = preset[key];
        }
      }

      // Mark fully-answered steps as completed
      for (const step of STEPS) {
        const allFilled = step.stateKeys.every(k => state[k] !== null && state[k] !== undefined);
        if (allFilled && step.id !== "preview") {
          state._completedSteps.push(step.id);
        }
      }

      const skipped = state._completedSteps.length;
      if (skipped > 0) {
        success(`Preset loaded: ${path.basename(presetPath)}`);
        info(`  ${skipped} of ${STEPS.length - 1} steps pre-filled. Remaining steps will prompt for input.`);
        console.log("");

        // Jump to first incomplete step (or preview if all filled)
        currentStep = STEPS.findIndex(s => !state._completedSteps.includes(s.id));
        if (currentStep === -1) currentStep = STEPS.length - 1;
      }
    }
  }

  // Check for saved progress
  const saved = !presetPath ? loadProgress() : null;
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

    // Handle preset loaded from within wizard step
    if (result._preset) {
      const preset = result._preset;
      delete state._preset;
      delete state._presetPath;

      const presetKeys = ["appName", "appType", "stack", "features", "crossRefs", "skills", "outDir", "claudeMode", "reportIssues"];
      for (const key of presetKeys) {
        if (preset[key] !== undefined) {
          state[key] = preset[key];
        }
      }

      // Mark fully-answered steps as completed
      for (const s of STEPS) {
        const allFilled = s.stateKeys.every(k => state[k] !== null && state[k] !== undefined);
        if (allFilled && s.id !== "preview" && !state._completedSteps.includes(s.id)) {
          state._completedSteps.push(s.id);
        }
      }

      const skipped = state._completedSteps.length;
      info(`  ${skipped} of ${STEPS.length - 1} steps pre-filled. Remaining steps will prompt for input.`);
      console.log("");

      // Jump to first incomplete step (or preview)
      currentStep = STEPS.findIndex(s => !state._completedSteps.includes(s.id));
      if (currentStep === -1) currentStep = STEPS.length - 1;
      continue;
    }

    // Preview step handles its own navigation
    if (step.id === "preview") {
      const previewAction = state._previewAction;
      delete state._previewAction;

      if (previewAction === "generate") {
        state._completedSteps.push(step.id);
        await generateFiles(state);
        deleteProgressFile();
        break;
      } else if (previewAction === "back") {
        const targetId = await promptGoBack(state._completedSteps, STEPS);
        invalidateFrom(targetId, state, STEPS);
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
        const targetId = await promptGoBack(state._completedSteps, STEPS);
        invalidateFrom(targetId, state, STEPS);
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
