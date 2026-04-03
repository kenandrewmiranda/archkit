#!/usr/bin/env node

/**
 * arch-extend — Create, manage, and discover CLI extensions
 * 
 * The AI (or you) builds new CLI commands when a pattern is worth automating.
 * Extensions live in .arch/extensions/ and are discoverable by both humans and AI.
 * 
 * Usage:
 *   archkit extend create            Interactive extension builder
 *   archkit extend list              List all extensions with descriptions
 *   archkit extend run <name> [args] Run an extension
 *   archkit extend describe <name>   Show full extension details
 *   archkit extend remove <name>     Remove an extension
 *   archkit extend registry          Output the registry for AI context injection
 */

import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { C, ICONS as I, findArchDir as _findArchDir, divider } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import { PRESETS, generateExtension } from "./extend/presets.mjs";
import * as log from "../lib/logger.mjs";

function banner() {
  commandBanner("arch-extend", "Self-evolving CLI extension system");
  console.log(`${C.gray}  Build new commands when patterns are worth automating${C.reset}`);
  console.log("");
}

function findArchDir() {
  return _findArchDir();
}

function ensureExtDir(archDir) {
  const extDir = path.join(archDir, "extensions");
  fs.mkdirSync(extDir, { recursive: true });
  return extDir;
}

function loadRegistry(archDir) {
  const regPath = path.join(archDir, "extensions", "registry.json");
  if (!fs.existsSync(regPath)) return [];
  try { return JSON.parse(fs.readFileSync(regPath, "utf8")); } catch { return []; }
}

function saveRegistry(archDir, registry) {
  const regPath = path.join(archDir, "extensions", "registry.json");
  fs.writeFileSync(regPath, JSON.stringify(registry, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

async function cmdCreate(archDir) {
  console.log(`${C.blue}${C.bold}  Create a new extension${C.reset}`);
  console.log(`${C.gray}  Extensions automate repetitive tasks the AI or developer encounters.${C.reset}`);
  console.log(`${C.gray}  Rule of thumb: build on the 3rd occurrence, not the 1st.${C.reset}`);
  console.log("");

  // Ask if they want a preset or custom
  const presetChoices = Object.entries(PRESETS).map(([k, v]) => ({
    name: `${C.bold}${v.name}${C.reset} ${C.dim}— ${v.description}${C.reset}`,
    value: k,
    short: v.name,
  }));

  const { source } = await inquirer.prompt([{
    type: "list",
    name: "source",
    message: "Start from:",
    prefix: `  ${I.arch}`,
    choices: [
      new inquirer.Separator(`${C.green} ── Preset extensions ──${C.reset}`),
      ...presetChoices,
      new inquirer.Separator(`${C.gray} ── Custom ──${C.reset}`),
      { name: `${C.bold}Custom extension${C.reset} ${C.dim}— build from scratch${C.reset}`, value: "__custom", short: "Custom" },
    ],
    pageSize: 12,
  }]);

  let meta;

  if (source !== "__custom") {
    meta = PRESETS[source];
    console.log("");
    console.log(`${C.green}  ${I.check} Using preset: ${meta.name}${C.reset}`);
    console.log(`${C.gray}  ${meta.description}${C.reset}`);
    console.log(`${C.gray}  Trigger: ${meta.trigger}${C.reset}`);
  } else {
    // Custom extension builder
    console.log("");

    const { name } = await inquirer.prompt([{
      type: "input", name: "name",
      message: "Extension name (kebab-case):",
      prefix: `  ${I.arch}`,
      validate: v => /^[a-z][a-z0-9-]*$/.test(v) || "Use lowercase letters, numbers, hyphens",
    }]);

    const { description } = await inquirer.prompt([{
      type: "input", name: "description",
      message: "What does it do? (one line):",
      prefix: `  ${I.arch}`,
    }]);

    const { trigger } = await inquirer.prompt([{
      type: "input", name: "trigger",
      message: "When should the AI suggest using this?:",
      prefix: `  ${I.arch}`,
      default: `When the developer needs to ${description.toLowerCase()}`,
    }]);

    const { category } = await inquirer.prompt([{
      type: "list", name: "category",
      message: "Category:",
      prefix: `  ${I.arch}`,
      choices: ["scaffold", "api", "skill", "maintenance", "testing", "devops", "data", "other"],
    }]);

    // Collect arguments
    console.log("");
    console.log(`${C.gray}  Define the arguments this extension accepts.${C.reset}`);
    console.log(`${C.gray}  Type 'done' when finished.${C.reset}`);
    console.log("");

    const extArgs = [];
    let addingArgs = true;
    while (addingArgs) {
      const { argName } = await inquirer.prompt([{
        type: "input", name: "argName",
        message: "Argument name (or 'done'):",
        prefix: `  ${C.gray}+${C.reset}`,
      }]);
      if (argName === "done" || argName === "") { addingArgs = false; continue; }

      const { argDesc } = await inquirer.prompt([{
        type: "input", name: "argDesc", message: "  Description:",
        prefix: `  ${C.gray}${I.pipe}${C.reset}`,
      }]);
      const { argReq } = await inquirer.prompt([{
        type: "confirm", name: "argReq", message: "  Required?", default: true,
        prefix: `  ${C.gray}${I.corner}${C.reset}`,
      }]);
      extArgs.push({ name: argName, description: argDesc, required: argReq });
    }

    meta = {
      name, description, trigger, category, args: extArgs,
      body: `  // TODO: Implement extension logic
  // Available: args (array), context.archDir, context.cwd, context.system, context.index
  console.log("Extension ${name} executed with args:", args);`,
    };
  }

  // Generate and save
  const code = generateExtension(meta);
  const extDir = ensureExtDir(archDir);
  const extPath = path.join(extDir, `${meta.name}.mjs`);

  // Preview
  console.log("");
  divider();
  console.log("");
  console.log(`${C.blue}${C.bold}  Preview${C.reset}`);
  console.log(`${C.gray}  ${extPath}${C.reset}`);
  console.log("");
  const previewLines = code.split("\n").slice(0, 20);
  previewLines.forEach(l => console.log(`${C.gray}    ${I.pipe} ${C.dim}${l.substring(0, 70)}${C.reset}`));
  if (code.split("\n").length > 20) console.log(`${C.gray}    ${I.pipe} ${C.dim}... (${code.split("\n").length - 20} more lines)${C.reset}`);
  console.log("");

  const { confirmed } = await inquirer.prompt([{
    type: "confirm", name: "confirmed", message: "Save this extension?", default: true,
    prefix: `  ${I.arch}`,
  }]);

  if (!confirmed) { console.log(`${C.gray}  Cancelled.${C.reset}\n`); return; }

  fs.writeFileSync(extPath, code);

  // Update registry
  const registry = loadRegistry(archDir);
  registry.push({
    name: meta.name,
    description: meta.description,
    trigger: meta.trigger,
    category: meta.category,
    file: `${meta.name}.mjs`,
    args: meta.args,
    created: new Date().toISOString().split("T")[0],
  });
  saveRegistry(archDir, registry);

  console.log("");
  console.log(`${C.green}  ${I.check} Extension created: ${meta.name}${C.reset}`);
  console.log(`${C.gray}  File: ${extPath}${C.reset}`);
  console.log(`${C.gray}  Registry updated: ${registry.length} extension${registry.length > 1 ? "s" : ""} total${C.reset}`);
  console.log("");
  console.log(`${C.yellow}  Run it:${C.reset}`);
  console.log(`${C.gray}    archkit extend run ${meta.name} ${meta.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ")}${C.reset}`);
  console.log("");

  if (source === "__custom") {
    console.log(`${C.yellow}  Next: Edit ${extPath} to implement the logic.${C.reset}`);
    console.log("");
  }
}

function cmdList(archDir) {
  const registry = loadRegistry(archDir);
  if (registry.length === 0) {
    console.log(`${C.gray}  No extensions installed.${C.reset}`);
    console.log(`${C.gray}  Run: archkit extend create${C.reset}`);
    console.log("");
    return;
  }

  // Group by category
  const categories = {};
  for (const ext of registry) {
    if (!categories[ext.category]) categories[ext.category] = [];
    categories[ext.category].push(ext);
  }

  console.log(`${C.bold}  ${registry.length} extension${registry.length > 1 ? "s" : ""} installed${C.reset}`);
  console.log("");

  for (const [cat, exts] of Object.entries(categories)) {
    console.log(`${C.cyan}  ${cat}${C.reset}`);
    for (const ext of exts) {
      console.log(`    ${C.bold}${ext.name}${C.reset} ${C.dim}— ${ext.description}${C.reset}`);
      console.log(`    ${C.gray}Trigger: ${ext.trigger}${C.reset}`);
      if (ext.args.length > 0) {
        console.log(`    ${C.gray}Args: ${ext.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ")}${C.reset}`);
      }
      console.log("");
    }
  }
}

function cmdDescribe(archDir, name) {
  const registry = loadRegistry(archDir);
  const ext = registry.find(e => e.name === name);
  if (!ext) {
    console.log(`${C.red}  Extension "${name}" not found.${C.reset}`);
    cmdList(archDir);
    return;
  }

  console.log(`${C.cyan}${C.bold}  ${ext.name}${C.reset}`);
  console.log(`  ${ext.description}`);
  console.log("");
  console.log(`  ${C.gray}Category:${C.reset}  ${ext.category}`);
  console.log(`  ${C.gray}Created:${C.reset}   ${ext.created}`);
  console.log(`  ${C.gray}File:${C.reset}      .arch/extensions/${ext.file}`);
  console.log(`  ${C.gray}Trigger:${C.reset}   ${ext.trigger}`);
  console.log("");

  if (ext.args.length > 0) {
    console.log(`  ${C.gray}Arguments:${C.reset}`);
    for (const arg of ext.args) {
      const req = arg.required ? `${C.red}required${C.reset}` : `${C.gray}optional${C.reset}`;
      console.log(`    ${C.bold}${arg.name}${C.reset} (${req}) — ${arg.description}`);
    }
    console.log("");
  }

  console.log(`  ${C.yellow}Run:${C.reset} archkit extend run ${ext.name} ${ext.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ")}`);
  console.log("");
}

async function cmdRun(archDir, name, args) {
  const extDir = path.join(archDir, "extensions");
  const extPath = path.join(extDir, `${name}.mjs`);

  if (!fs.existsSync(extPath)) {
    console.log(`${C.red}  Extension "${name}" not found at ${extPath}${C.reset}`);
    console.log(`${C.gray}  Run: archkit extend list${C.reset}\n`);
    return;
  }

  // Load context
  const systemPath = path.join(archDir, "SYSTEM.md");
  const indexPath = path.join(archDir, "INDEX.md");
  const context = {
    archDir,
    cwd: process.cwd(),
    args,
    system: fs.existsSync(systemPath) ? fs.readFileSync(systemPath, "utf8") : "",
    index: fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "",
  };

  console.log(`${C.cyan}  ${I.gear} Running extension: ${name}${C.reset}`);
  console.log("");

  try {
    const ext = await import(extPath);
    await ext.run(args, context);
  } catch (err) {
    console.log(`${C.red}  ${I.cross} Extension error: ${err.message}${C.reset}`);
    if (err.stack) console.log(`${C.dim}${err.stack}${C.reset}`);
  }
  console.log("");
}

function cmdRemove(archDir, name) {
  const registry = loadRegistry(archDir);
  const idx = registry.findIndex(e => e.name === name);
  if (idx === -1) {
    console.log(`${C.red}  Extension "${name}" not found.${C.reset}\n`);
    return;
  }

  const ext = registry[idx];
  const extPath = path.join(archDir, "extensions", ext.file);

  registry.splice(idx, 1);
  saveRegistry(archDir, registry);

  if (fs.existsSync(extPath)) fs.unlinkSync(extPath);

  console.log(`${C.green}  ${I.check} Removed extension: ${name}${C.reset}`);
  console.log(`${C.gray}  ${registry.length} extension${registry.length > 1 ? "s" : ""} remaining${C.reset}\n`);
}

function cmdRegistry(archDir) {
  const registry = loadRegistry(archDir);
  if (registry.length === 0) {
    console.log(`${C.gray}  No extensions. Registry is empty.${C.reset}\n`);
    return;
  }

  // Output in a format optimized for AI context injection
  console.log(`${C.bold}  ## Available Extensions${C.reset}`);
  console.log(`${C.gray}  Paste this into your AI prompt or SYSTEM.md for extension discovery.${C.reset}`);
  console.log("");
  console.log(`${C.dim}--- extensions ---${C.reset}`);
  for (const ext of registry) {
    const argStr = ext.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ");
    console.log(`${C.dim}${ext.name.padEnd(22)} : ${ext.description} | run: arch-extend run ${ext.name} ${argStr}${C.reset}`);
  }
  console.log(`${C.dim}---${C.reset}`);
  console.log("");
  console.log(`${C.gray}  Trigger conditions (AI should suggest these automatically):${C.reset}`);
  for (const ext of registry) {
    console.log(`${C.dim}  ${ext.name}: ${ext.trigger}${C.reset}`);
  }
  console.log("");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  const archDir = findArchDir();
  if (!archDir) {
    banner();
    console.log(`${C.red}  ${I.warn} Cannot find .arch/ directory.${C.reset}`);
    console.log(`${C.gray}  Run archkit first, or run this from your project root.${C.reset}\n`);
    process.exit(1);
  }

  if (!cmd || cmd === "--help" || cmd === "-h") {
    banner();
    console.log(`${C.yellow}  Commands:${C.reset}`);
    console.log(`${C.gray}    create              Build a new extension (interactive wizard or from preset)${C.reset}`);
    console.log(`${C.gray}    list                Show all installed extensions${C.reset}`);
    console.log(`${C.gray}    run <name> [args]    Execute an extension${C.reset}`);
    console.log(`${C.gray}    describe <name>      Show full details for an extension${C.reset}`);
    console.log(`${C.gray}    remove <name>        Remove an extension${C.reset}`);
    console.log(`${C.gray}    registry             Output AI-readable extension registry${C.reset}`);
    console.log("");
    console.log(`${C.yellow}  Preset extensions available:${C.reset}`);
    for (const [k, v] of Object.entries(PRESETS)) {
      console.log(`${C.gray}    ${C.bold}${v.name}${C.reset}${C.gray} — ${v.description}${C.reset}`);
    }
    console.log("");
    return;
  }

  switch (cmd) {
    case "create":
      if (args[1] === "--from-preset" && args[2]) {
        // Non-interactive preset creation (agent-callable)
        const presetName = args[2];
        if (!PRESETS[presetName]) {
          console.log(JSON.stringify({ error: `Unknown preset: ${presetName}`, available: Object.keys(PRESETS) }));
          return;
        }
        const meta = PRESETS[presetName];
        const code = generateExtension(meta);
        const extDir = ensureExtDir(archDir);
        const extPath = path.join(extDir, `${meta.name}.mjs`);
        fs.writeFileSync(extPath, code);
        const registry = loadRegistry(archDir);
        registry.push({
          name: meta.name,
          description: meta.description,
          trigger: meta.trigger,
          category: meta.category,
          file: `${meta.name}.mjs`,
          args: meta.args,
          created: new Date().toISOString().split("T")[0],
        });
        saveRegistry(archDir, registry);
        log.extend(`Created extension: ${meta.name}`);
        log.ok(`File: ${extPath}`);
        return;
      }
      banner();
      await cmdCreate(archDir);
      break;
    case "list":
      banner();
      cmdList(archDir);
      break;
    case "run":
      await cmdRun(archDir, args[1], args.slice(2));
      break;
    case "describe":
      banner();
      cmdDescribe(archDir, args[1]);
      break;
    case "remove":
      banner();
      cmdRemove(archDir, args[1]);
      break;
    case "registry":
      banner();
      cmdRegistry(archDir);
      break;
    default:
      banner();
      console.log(`${C.red}  Unknown command: ${cmd}${C.reset}`);
      console.log(`${C.gray}  Run: archkit extend --help${C.reset}\n`);
  }
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main().catch(err => {
    console.error(`${C.red}  Error: ${err.message}${C.reset}`);
    process.exit(1);
  });
}
