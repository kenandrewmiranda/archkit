import fs from "fs";
import path from "path";
import { C, ICONS, divider } from "../lib/shared.mjs";
import { genSystemMd, genIndexMd, genGraph, genBoundariesMd } from "../lib/generators.mjs";
import { generateScaffold } from "./scaffold-core.mjs";
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

// Thin interactive wrapper over the pure generateScaffold() core. The wizard
// answers (state) are passed straight through; this layer only renders
// progress, previews, token budget, and the post-generate clipboard/cleanup
// prompts — all the actual file writing lives in src/wizard/scaffold-core.mjs.
async function generateFiles(state) {
  divider();
  heading(ICONS.gear, "Generating...");
  log.generate("Creating directory structure...");

  // claudeMode is opt-in for the interactive wizard (the wizard's output step
  // sets state.claudeMode); the core defaults it on, so pass it explicitly.
  const claudeMode = !!state.claudeMode;

  const onWrite = (relPath, size, meta) => {
    if (meta && meta.note) {
      console.log(`  ${C.yellow}${ICONS.warn}${C.reset} ${meta.note}`);
    }
    log.generate(`Writing ${relPath}`);
    console.log(`  ${C.green}${ICONS.check}${C.reset} ${relPath} ${C.dim}(${size} bytes)${C.reset}`);
  };

  const { written, cfg } = generateScaffold({ ...state, claudeMode }, {
    projectRoot: path.resolve("."),
    onWrite,
  });

  // ── File previews ─────────────────────────────────────────────────────
  divider();
  heading(ICONS.file, "File Previews");

  const sysContent = genSystemMd(cfg);
  const idxContent = genIndexMd(cfg);
  filePreview("SYSTEM.md", sysContent);
  filePreview("INDEX.md", idxContent);

  if (cfg.features.length > 0) {
    filePreview(`clusters/${cfg.features[0].id}.graph`, genGraph(cfg.features[0], cfg));
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
  console.log(`  ${C.cyan}${ICONS.arch}${C.reset} ${C.dim}Enhance your setup with community skill packs:${C.reset} ${C.cyan}archkit search "${cfg.appType}"${C.reset}`);
  console.log(`  ${C.dim}  106+ gotchas, boundary packs, and presets at${C.reset} ${C.cyan}market.thearchkit.com${C.reset}`);
  console.log("");

  // Clean up archkit CLI folder if it was cloned into the project
  await promptCleanup();

  // Launch command prompt
  await promptLaunchCommand(state);
}

export { generateFiles };
