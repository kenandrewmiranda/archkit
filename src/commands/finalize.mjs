#!/usr/bin/env node

// arch-finalize — show or configure the CGR finalization goal (cgr.finalize).
//
// The finalization goal is a wrap-up CGR that archkit_goal_intake auto-appends to
// every batch: update the changelog, refresh docs, finalize commits, and the
// opt-in push / release / deploy-to-dev. This command is the human-facing surface
// for the same config the archkit_finalize_config MCP tool writes.
//
// Usage:
//   archkit finalize                     show current config
//   archkit finalize --json              machine-readable
//   archkit finalize --enable            turn the feature on
//   archkit finalize --disable           turn the feature off
//   archkit finalize --on push,release   enable specific steps
//   archkit finalize --off deployDev     disable specific steps
//   archkit finalize --cicd github-actions [--deploy-command "npm run deploy:dev"]

import { isMainModule, C, ICONS as I, findArchDir } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import * as log from "../lib/logger.mjs";
import { FINALIZE_STEPS, runFinalizeConfig } from "../lib/goals.mjs";

function parseList(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1 || !args[i + 1]) return [];
  return args[i + 1].split(",").map((s) => s.trim()).filter(Boolean);
}
function parseValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");

  const archDir = findArchDir({ requireFile: "SYSTEM.md" });
  if (!archDir) {
    if (jsonMode) console.log(JSON.stringify({ error: "No .arch/ directory found" }));
    else { commandBanner("arch-finalize", "Configure the CGR finalization goal"); log.error("No .arch/ found. Run `archkit init` first."); }
    process.exit(1);
  }

  // Build a patch from the flags (read-only when none are present).
  const patch = {};
  if (args.includes("--enable")) patch.enabled = true;
  if (args.includes("--disable")) patch.enabled = false;

  const validKeys = new Set(FINALIZE_STEPS.map((s) => s.key));
  const on = parseList(args, "--on");
  const off = parseList(args, "--off");
  const steps = {};
  for (const k of on) if (validKeys.has(k)) steps[k] = true;
  for (const k of off) if (validKeys.has(k)) steps[k] = false;
  if (Object.keys(steps).length) patch.steps = steps;

  const cicd = parseValue(args, "--cicd");
  if (cicd !== undefined) patch.ciCd = cicd;
  const deployCommand = parseValue(args, "--deploy-command");
  if (deployCommand !== undefined) patch.deployCommand = deployCommand;

  const mutating = Object.keys(patch).length > 0;
  const result = runFinalizeConfig({ archDir, show: !mutating, ...patch });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const cfg = result.config;
  commandBanner("arch-finalize", "Configure the CGR finalization goal");
  if (result.saved) log.ok("Saved to .arch/config.json → cgr.finalize");
  console.log(`  ${C.bold}Finalization:${C.reset} ${cfg.enabled ? `${C.green}ON${C.reset}` : `${C.gray}OFF${C.reset}`}${cfg.configured ? "" : `  ${C.yellow}(not configured — defaults active)${C.reset}`}`);
  console.log("");
  for (const s of FINALIZE_STEPS) {
    const onMark = cfg.steps[s.key];
    console.log(`    ${onMark ? `${C.green}${I.check}${C.reset}` : `${C.gray}${I.circle}${C.reset}`} ${onMark ? "" : C.gray}${s.key.padEnd(10)}${C.reset} ${C.dim}${s.label}${C.reset}`);
  }
  console.log("");
  console.log(`  ${C.dim}CI/CD:${C.reset} ${cfg.ciCd}${cfg.deployCommand ? `  ${C.dim}deploy:${C.reset} ${cfg.deployCommand}` : ""}`);
  console.log("");
  console.log(`  ${C.gray}${result.nextStep}${C.reset}`);
  console.log("");
}

export { main };

if (isMainModule(import.meta.url)) {
  main();
}
