import fs from "fs";
import inquirer from "inquirer";
import { C, ICONS } from "../lib/shared.mjs";
import { success, info } from "./helpers.mjs";

const PROGRESS_FILE = ".archkit-progress.json";

function createInitialState() {
  return { appName: null, appType: null, stack: null, features: null, crossRefs: null, skills: null, outDir: null, claudeMode: null, reportIssues: null, _completedSteps: [] };
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

function invalidateFrom(stepId, state, STEPS) {
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

async function promptGoBack(completedSteps, STEPS) {
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

export { PROGRESS_FILE, createInitialState, saveProgress, loadProgress, deleteProgressFile, invalidateFrom, promptNavigation, promptGoBack };
