#!/usr/bin/env node

/**
 * arch-gotcha — Capture bad AI-generated patterns into .skill files
 * 
 * Usage:
 *   archkit gotcha <skill> "<wrong>" "<right>" "<why>"
 *   archkit gotcha --interactive
 *   archkit gotcha --from-diff <file>
 * 
 * Examples:
 *   archkit gotcha stripe "req.body" "req.rawBody" "Express parses JSON. Stripe needs raw bytes."
 *   archkit gotcha prisma "new PrismaClient()" "globalThis.prisma ??= new PrismaClient()" "Serverless creates new instance per request. Exhausts connections."
 *   archkit gotcha --interactive
 */

import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { C, ICONS as I, findArchDir as _findArchDir } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";

function banner() {
  commandBanner("arch-gotcha", "Capture bad AI patterns into .skill files");
  console.log(`${C.gray}  Every fix makes the system permanently smarter${C.reset}`);
  console.log("");
}

function findArchDir() {
  return _findArchDir({ requireFile: "skills" });
}

function listSkills(archDir) {
  const skillsDir = path.join(archDir, "skills");
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir)
    .filter(f => f.endsWith(".skill"))
    .map(f => f.replace(".skill", ""));
}

function countGotchas(archDir, skillId) {
  const filepath = path.join(archDir, "skills", `${skillId}.skill`);
  if (!fs.existsSync(filepath)) return 0;
  const content = fs.readFileSync(filepath, "utf8");
  return (content.match(/^WRONG:/gm) || []).length;
}

function appendGotcha(archDir, skillId, wrong, right, why) {
  const filepath = path.join(archDir, "skills", `${skillId}.skill`);
  if (!fs.existsSync(filepath)) {
    console.log(`${C.red}  ${I.warn} Skill file not found: ${filepath}${C.reset}`);
    console.log(`${C.gray}  Run archkit first, or create the file manually.${C.reset}`);
    return false;
  }

  let content = fs.readFileSync(filepath, "utf8");

  // Find the Gotchas section
  const gotchaIdx = content.indexOf("## Gotchas");
  if (gotchaIdx === -1) {
    // Add Gotchas section if missing
    content += `\n## Gotchas\n`;
  }

  // Find the next section after Gotchas to insert before it
  const afterGotcha = content.indexOf("## ", gotchaIdx + 10);
  const entry = `\nWRONG: ${wrong}\nRIGHT: ${right}\nWHY: ${why}\n`;

  if (afterGotcha !== -1) {
    content = content.slice(0, afterGotcha) + entry + "\n" + content.slice(afterGotcha);
  } else {
    content += entry;
  }

  fs.writeFileSync(filepath, content);
  return true;
}

async function interactiveMode(archDir) {
  const skills = listSkills(archDir);
  if (skills.length === 0) {
    console.log(`${C.red}  ${I.warn} No .skill files found in ${archDir}/skills/${C.reset}`);
    console.log(`${C.gray}  Run archkit first to generate skill skeletons.${C.reset}`);
    return;
  }

  console.log(`${C.blue}${C.bold}  What happened?${C.reset}`);
  console.log(`${C.gray}  Describe the bad code the AI generated so we can prevent it next time.${C.reset}`);
  console.log("");

  // Select skill
  const { skillId } = await inquirer.prompt([{
    type: "list",
    name: "skillId",
    message: "Which package had the bad pattern?",
    prefix: `  ${I.arch}`,
    choices: skills.map(s => {
      const count = countGotchas(archDir, s);
      return {
        name: `${s} ${C.dim}(${count} gotcha${count !== 1 ? "s" : ""})${C.reset}`,
        value: s,
        short: s,
      };
    }),
    pageSize: 15,
  }]);

  console.log("");
  console.log(`${C.blue}${C.bold}  The bad pattern${C.reset}`);
  console.log(`${C.gray}  Paste the code the AI generated incorrectly.${C.reset}`);
  console.log(`${C.gray}  Can be a single line or a short snippet.${C.reset}`);
  console.log("");

  const { wrong } = await inquirer.prompt([{
    type: "input",
    name: "wrong",
    message: `${C.red}WRONG:${C.reset}`,
    prefix: `  ${I.arch}`,
    validate: v => v.length > 0 || "Cannot be empty",
  }]);

  console.log("");
  console.log(`${C.blue}${C.bold}  The correct pattern${C.reset}`);
  console.log(`${C.gray}  What should the AI have generated instead?${C.reset}`);
  console.log("");

  const { right } = await inquirer.prompt([{
    type: "input",
    name: "right",
    message: `${C.green}RIGHT:${C.reset}`,
    prefix: `  ${I.arch}`,
    validate: v => v.length > 0 || "Cannot be empty",
  }]);

  console.log("");
  console.log(`${C.blue}${C.bold}  Why it matters${C.reset}`);
  console.log(`${C.gray}  One line: what breaks if you use the wrong pattern?${C.reset}`);
  console.log("");

  const { why } = await inquirer.prompt([{
    type: "input",
    name: "why",
    message: `${C.yellow}WHY:${C.reset}`,
    prefix: `  ${I.arch}`,
    validate: v => v.length > 0 || "Cannot be empty",
  }]);

  // Preview
  console.log("");
  console.log(`${C.gray}  ┌────────────────────────────────────────────────────────────┐${C.reset}`);
  console.log(`${C.gray}  │ ${C.reset}${C.bold}New gotcha for ${skillId}.skill${C.reset}${C.gray}${" ".repeat(Math.max(0, 42 - skillId.length - 6))}│${C.reset}`);
  console.log(`${C.gray}  │                                                            │${C.reset}`);
  console.log(`${C.gray}  │ ${C.red}WRONG:${C.reset} ${wrong.substring(0, 52).padEnd(52)}${C.gray}│${C.reset}`);
  console.log(`${C.gray}  │ ${C.green}RIGHT:${C.reset} ${right.substring(0, 52).padEnd(52)}${C.gray}│${C.reset}`);
  console.log(`${C.gray}  │ ${C.yellow}WHY:${C.reset}   ${why.substring(0, 52).padEnd(52)}${C.gray}│${C.reset}`);
  console.log(`${C.gray}  └────────────────────────────────────────────────────────────┘${C.reset}`);
  console.log("");

  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: "Add this gotcha?",
    default: true,
    prefix: `  ${I.arch}`,
  }]);

  if (!confirmed) {
    console.log(`${C.gray}  Cancelled.${C.reset}\n`);
    return;
  }

  const ok = appendGotcha(archDir, skillId, wrong, right, why);
  if (ok) {
    const total = countGotchas(archDir, skillId);
    console.log("");
    console.log(`${C.green}  ${I.check} Gotcha added to ${skillId}.skill${C.reset}`);
    console.log(`${C.gray}  ${skillId} now has ${total} gotcha${total !== 1 ? "s" : ""}. The AI will avoid this pattern on next generation.${C.reset}`);
    console.log("");

    // Offer to add another
    const { another } = await inquirer.prompt([{
      type: "confirm",
      name: "another",
      message: "Add another gotcha?",
      default: false,
      prefix: `  ${I.arch}`,
    }]);

    if (another) {
      console.log("");
      await interactiveMode(archDir);
    }
  }
}

async function debriefMode(archDir) {
  const skills = listSkills(archDir);
  if (skills.length === 0) {
    console.log(`${C.red}  ${I.warn} No .skill files found.${C.reset}`);
    return;
  }

  console.log(`${C.blue}${C.bold}  Session Debrief${C.reset}`);
  console.log(`${C.gray}  Reflect on this session. Each answer becomes a permanent improvement.${C.reset}`);
  console.log(`${C.gray}  Press Enter to skip any question.${C.reset}`);
  console.log("");

  // Question 1: Bad code
  console.log(`${C.yellow}  1/4 ${C.bold}Bad patterns${C.reset}`);
  console.log(`${C.gray}  Did the AI generate any code you had to fix?${C.reset}`);
  console.log("");

  const { hadBadCode } = await inquirer.prompt([{
    type: "confirm", name: "hadBadCode",
    message: "Any code you had to fix?",
    default: false, prefix: `  ${I.arch}`,
  }]);

  if (hadBadCode) {
    const { skillId } = await inquirer.prompt([{
      type: "list", name: "skillId",
      message: "Which package?",
      prefix: `  ${I.arch}`,
      choices: [...skills.map(s => ({ name: s, value: s })), { name: `${C.dim}(other / architecture)${C.reset}`, value: "__skip" }],
      pageSize: 12,
    }]);

    if (skillId !== "__skip") {
      const { wrong } = await inquirer.prompt([{ type: "input", name: "wrong", message: `${C.red}WRONG:${C.reset}`, prefix: `  ${I.arch}` }]);
      if (wrong) {
        const { right } = await inquirer.prompt([{ type: "input", name: "right", message: `${C.green}RIGHT:${C.reset}`, prefix: `  ${I.arch}` }]);
        const { why } = await inquirer.prompt([{ type: "input", name: "why", message: `${C.yellow}WHY:${C.reset}`, prefix: `  ${I.arch}` }]);
        if (right && why) {
          appendGotcha(archDir, skillId, wrong, right, why);
          console.log(`${C.green}  ${I.check} Gotcha saved to ${skillId}.skill${C.reset}`);
        }
      }
    }
  }

  console.log("");

  // Question 2: Wrong placement
  console.log(`${C.yellow}  2/4 ${C.bold}Architecture${C.reset}`);
  console.log(`${C.gray}  Did the AI put code in the wrong file or layer?${C.reset}`);
  console.log("");

  const { hadPlacement } = await inquirer.prompt([{
    type: "confirm", name: "hadPlacement",
    message: "Any misplaced code?",
    default: false, prefix: `  ${I.arch}`,
  }]);

  if (hadPlacement) {
    const { placementNote } = await inquirer.prompt([{
      type: "input", name: "placementNote",
      message: "What happened? (e.g. 'DB call in controller, should be in repo'):",
      prefix: `  ${I.arch}`,
    }]);
    if (placementNote) {
      // Append as a comment to SYSTEM.md rules
      const sysPath = path.join(archDir, "SYSTEM.md");
      if (fs.existsSync(sysPath)) {
        let sys = fs.readFileSync(sysPath, "utf8");
        const rulesIdx = sys.indexOf("## Rules");
        if (rulesIdx !== -1) {
          const nextSection = sys.indexOf("\n## ", rulesIdx + 8);
          const insertAt = nextSection !== -1 ? nextSection : sys.length;
          sys = sys.slice(0, insertAt) + `- LEARNED: ${placementNote}\n` + sys.slice(insertAt);
          fs.writeFileSync(sysPath, sys);
          console.log(`${C.green}  ${I.check} Rule added to SYSTEM.md${C.reset}`);
        }
      }
    }
  }

  console.log("");

  // Question 3: API surprise
  console.log(`${C.yellow}  3/4 ${C.bold}API/SDK surprises${C.reset}`);
  console.log(`${C.gray}  Any package behavior that was unexpected?${C.reset}`);
  console.log("");

  const { hadApiSurprise } = await inquirer.prompt([{
    type: "confirm", name: "hadApiSurprise",
    message: "Any API/SDK surprises?",
    default: false, prefix: `  ${I.arch}`,
  }]);

  if (hadApiSurprise) {
    const { skillId2 } = await inquirer.prompt([{
      type: "list", name: "skillId2",
      message: "Which package?",
      prefix: `  ${I.arch}`,
      choices: skills.map(s => ({ name: s, value: s })),
      pageSize: 12,
    }]);
    const { surprise } = await inquirer.prompt([{
      type: "input", name: "surprise",
      message: "What was unexpected?:",
      prefix: `  ${I.arch}`,
    }]);
    if (surprise) {
      const skillPath = path.join(archDir, "skills", `${skillId2}.skill`);
      if (fs.existsSync(skillPath)) {
        let content = fs.readFileSync(skillPath, "utf8");
        const gotchaIdx = content.indexOf("## Gotchas");
        if (gotchaIdx !== -1) {
          const afterGotcha = content.indexOf("## ", gotchaIdx + 10);
          const entry = `\n# TODO-GOTCHA: ${surprise}\n# Convert to WRONG/RIGHT/WHY when pattern is clear.\n`;
          if (afterGotcha !== -1) {
            content = content.slice(0, afterGotcha) + entry + content.slice(afterGotcha);
          } else {
            content += entry;
          }
          fs.writeFileSync(skillPath, content);
          console.log(`${C.green}  ${I.check} Note added to ${skillId2}.skill (mark as TODO-GOTCHA)${C.reset}`);
        }
      }
    }
  }

  console.log("");

  // Question 4: Positive pattern
  console.log(`${C.yellow}  4/4 ${C.bold}What worked well?${C.reset}`);
  console.log(`${C.gray}  Any pattern the AI got right that's worth preserving?${C.reset}`);
  console.log("");

  const { hadGoodPattern } = await inquirer.prompt([{
    type: "confirm", name: "hadGoodPattern",
    message: "Any pattern worth preserving?",
    default: false, prefix: `  ${I.arch}`,
  }]);

  if (hadGoodPattern) {
    const { patternSkill } = await inquirer.prompt([{
      type: "list", name: "patternSkill",
      message: "Which package?",
      prefix: `  ${I.arch}`,
      choices: skills.map(s => ({ name: s, value: s })),
      pageSize: 12,
    }]);
    const { pattern } = await inquirer.prompt([{
      type: "input", name: "pattern",
      message: "Describe the pattern:",
      prefix: `  ${I.arch}`,
    }]);
    if (pattern) {
      const skillPath = path.join(archDir, "skills", `${patternSkill}.skill`);
      if (fs.existsSync(skillPath)) {
        let content = fs.readFileSync(skillPath, "utf8");
        const patternsIdx = content.indexOf("## Patterns");
        if (patternsIdx !== -1) {
          const afterPatterns = content.indexOf("## ", patternsIdx + 11);
          const entry = `\n# LEARNED: ${pattern}\n`;
          if (afterPatterns !== -1) {
            content = content.slice(0, afterPatterns) + entry + content.slice(afterPatterns);
          } else {
            content += entry;
          }
          fs.writeFileSync(skillPath, content);
          console.log(`${C.green}  ${I.check} Pattern noted in ${patternSkill}.skill${C.reset}`);
        }
      }
    }
  }

  // Summary
  console.log("");
  console.log(`${C.gray}  ${"─".repeat(50)}${C.reset}`);
  console.log(`${C.green}  ${I.check} Debrief complete.${C.reset}`);
  console.log(`${C.dim}  Run ${C.cyan}archkit stats${C.dim} to see updated health score.${C.reset}`);
  console.log("");
}

async function cliMode(args) {
  const archDir = findArchDir();
  if (!archDir) {
    console.log(`${C.red}  ${I.warn} Cannot find .arch/ directory.${C.reset}`);
    console.log(`${C.gray}  Run this from your project root, or run archkit first.${C.reset}\n`);
    process.exit(1);
  }

  if (args.includes("--debrief") || args.includes("-d")) {
    banner();
    console.log(`${C.cyan}${C.bold}  ${I.brain} Session Debrief Mode${C.reset}`);
    console.log(`${C.gray}  4 quick questions to capture what you learned this session.${C.reset}`);
    console.log("");
    await debriefMode(archDir);
    return;
  }

  if (args.includes("--interactive") || args.includes("-i") || args.length === 0) {
    banner();
    await interactiveMode(archDir);
    return;
  }

  // Direct mode: arch-gotcha <skill> "<wrong>" "<right>" "<why>"
  const [skillId, wrong, right, why] = args.filter(a => !a.startsWith("-"));

  if (!skillId || !wrong || !right || !why) {
    banner();
    console.log(`${C.yellow}  Usage:${C.reset}`);
    console.log(`${C.gray}    archkit gotcha <skill> "<wrong>" "<right>" "<why>"${C.reset}`);
    console.log(`${C.gray}    archkit gotcha --interactive${C.reset}`);
    console.log("");
    console.log(`${C.yellow}  Examples:${C.reset}`);
    console.log(`${C.gray}    archkit gotcha stripe "req.body" "req.rawBody" "Express parses. Stripe needs raw."${C.reset}`);
    console.log(`${C.gray}    archkit gotcha prisma "new PrismaClient()" "globalThis.prisma ??= new PrismaClient()" "Serverless connection exhaustion"${C.reset}`);
    console.log("");
    process.exit(1);
  }

  const ok = appendGotcha(archDir, skillId, wrong, right, why);
  if (ok) {
    const total = countGotchas(archDir, skillId);
    console.log(`${C.green}  ${I.check} Gotcha added to ${skillId}.skill (${total} total)${C.reset}`);
  }
}

export { cliMode as main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  const args = process.argv.slice(2);
  cliMode(args).catch(err => {
    console.error(`${C.red}  Error: ${err.message}${C.reset}`);
    process.exit(1);
  });
}
