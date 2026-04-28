#!/usr/bin/env node

/**
 * arch-gotcha — Capture bad AI-generated patterns into .skill files
 *
 * Usage:
 *   archkit gotcha <skill> "<wrong>" "<right>" "<why>"
 *   archkit gotcha --interactive
 *   archkit gotcha --propose --skill <pkg> --wrong "..." --right "..." --why "..."
 *   archkit gotcha --review
 *   archkit gotcha --list-proposals [--json]
 *
 * Examples:
 *   archkit gotcha stripe "req.body" "req.rawBody" "Express parses JSON. Stripe needs raw bytes."
 *   archkit gotcha --propose --skill prisma --wrong "new PrismaClient()" --right "globalThis.prisma ??= new PrismaClient()" --why "Serverless exhausts connections"
 *   archkit gotcha --interactive
 */

import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { C, ICONS as I, findArchDir as _findArchDir } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import * as log from "../lib/logger.mjs";
import { archkitError } from "../lib/errors.mjs";

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

function proposalHash(skill, wrong, right) {
  return createHash("sha1").update(`${skill}\x1f${wrong}\x1f${right}`).digest("hex").slice(0, 12);
}
function proposalsDir(archDir) { return path.join(archDir, "gotcha-proposals"); }
function rejectedDir(archDir) { return path.join(archDir, "gotcha-proposals", "rejected"); }

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

  log.gotcha(`Adding gotcha to ${skillId}.skill`);
  const ok = appendGotcha(archDir, skillId, wrong, right, why);
  if (ok) {
    log.ok(`Gotcha saved to ${skillId}.skill`);
    const total = countGotchas(archDir, skillId);
    console.log("");
    console.log(`${C.green}  ${I.check} Gotcha added to ${skillId}.skill${C.reset}`);
    console.log(`${C.gray}  ${skillId} now has ${total} gotcha${total !== 1 ? "s" : ""}. The AI will avoid this pattern on next generation.${C.reset}`);
    console.log("");

    // Offer to report as GitHub issue
    const { isReportingEnabled, createGotchaIssue } = await import("../lib/issue-reporter.mjs");
    if (isReportingEnabled()) {
      const { report } = await inquirer.prompt([{
        type: "confirm",
        name: "report",
        message: "Report this gotcha as a GitHub issue on archkit?",
        default: true,
        prefix: `  ${I.arch}`,
      }]);
      if (report) {
        createGotchaIssue({ skillId, wrong, right, why });
      }
    }

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
  log.gotcha("Starting session debrief...");
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
          log.ok(`Gotcha saved to ${skillId}.skill`);
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

  // Offer to report debrief as GitHub issue
  const { isReportingEnabled, createDebriefIssue } = await import("../lib/issue-reporter.mjs");
  if (isReportingEnabled()) {
    const findings = [];
    if (hadBadCode) findings.push({ type: "bad-pattern", detail: "Bad code pattern captured as gotcha" });
    if (hadPlacement) findings.push({ type: "architecture", detail: "Code placement issue noted in SYSTEM.md" });
    if (hadApiSurprise) findings.push({ type: "api-surprise", detail: "Unexpected API/SDK behavior noted" });
    if (hadGoodPattern) findings.push({ type: "positive-pattern", detail: "Good pattern captured for preservation" });

    if (findings.length > 0) {
      const { report } = await inquirer.prompt([{
        type: "confirm",
        name: "report",
        message: "Report this debrief as a GitHub issue on archkit?",
        default: false,
        prefix: `  ${I.arch}`,
      }]);
      if (report) createDebriefIssue({ findings });
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
  const jsonMode = args.includes("--json");
  const archDir = findArchDir();
  if (!archDir) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: "Cannot find .arch/ directory" }));
    } else {
      console.log(`${C.red}  ${I.warn} Cannot find .arch/ directory.${C.reset}`);
      console.log(`${C.gray}  Run this from your project root, or run archkit first.${C.reset}\n`);
    }
    process.exit(1);
  }

  // Agent-friendly: list all skills and gotcha counts as JSON
  if (args.includes("--list")) {
    const skills = listSkills(archDir);
    const result = skills.map(id => ({ id, gotchas: countGotchas(archDir, id) }));
    console.log(JSON.stringify({ skills: result }));
    return;
  }

  // Queue a gotcha proposal without immediately writing to a .skill file
  if (args.includes("--propose")) {
    function getFlag(name) {
      const idx = args.indexOf(name);
      if (idx === -1) return undefined;
      return args[idx + 1];
    }
    const skill = getFlag("--skill");
    const wrong = getFlag("--wrong");
    const right = getFlag("--right");
    const why = getFlag("--why");

    for (const [name, val] of [["skill", skill], ["wrong", wrong], ["right", right], ["why", why]]) {
      if (!val || val.startsWith("--")) {
        console.log(JSON.stringify({ error: "missing_field", field: name }));
        process.exit(2);
      }
    }

    const hash = proposalHash(skill, wrong, right);
    const pDir = proposalsDir(archDir);
    const proposalFile = path.join(pDir, `${hash}.json`);
    const rejFile = path.join(rejectedDir(archDir), `${hash}.json`);

    if (fs.existsSync(proposalFile)) {
      console.log(JSON.stringify({ status: "duplicate", hash }));
      return;
    }

    if (fs.existsSync(rejFile)) {
      console.log(JSON.stringify({ status: "previously-rejected", hash }));
      return;
    }

    fs.mkdirSync(pDir, { recursive: true });
    const proposal = { skill, wrong, right, why, source: "cli", created_at: new Date().toISOString() };
    fs.writeFileSync(proposalFile, JSON.stringify(proposal, null, 2));

    const relPath = path.relative(process.cwd(), proposalFile);
    if (jsonMode) {
      console.log(JSON.stringify({ status: "queued", hash, path: relPath }));
    } else {
      log.gotcha(`Proposal queued for ${skill}`);
      console.log(`${C.green}  ${I.check} Proposal saved (${hash})${C.reset}`);
      console.log(`${C.gray}  Review with: archkit gotcha --review${C.reset}`);
    }
    return;
  }

  // ── List proposals mode ───────────────────────────────────────────────
  if (args.includes("--list-proposals")) {
    const pDir = proposalsDir(archDir);
    const proposals = [];
    if (fs.existsSync(pDir)) {
      for (const file of fs.readdirSync(pDir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = JSON.parse(fs.readFileSync(path.join(pDir, file), "utf8"));
          content._hash = file.replace(".json", "");
          proposals.push(content);
        } catch {
          log.warn(`Skipping corrupt proposal file: ${file}`);
        }
      }
    }
    if (jsonMode) {
      console.log(JSON.stringify(proposals));
    } else {
      if (proposals.length === 0) {
        console.log(`${C.gray}  No pending proposals.${C.reset}`);
        console.log(`${C.gray}  Agents can emit proposals via: archkit gotcha --propose --skill <pkg> ...${C.reset}`);
      } else {
        console.log(`${C.blue}${C.bold}  ${proposals.length} pending proposal${proposals.length !== 1 ? "s" : ""}:${C.reset}`);
        for (const p of proposals) {
          console.log(`${C.gray}  ${I.dot} ${p.skill}: ${p.wrong.substring(0, 60)}${C.reset}`);
        }
        console.log(`${C.gray}\n  Run archkit gotcha --review to process them.${C.reset}`);
      }
    }
    return;
  }

  // ── Review mode (interactive, human-only) ─────────────────────────────
  if (args.includes("--review")) {
    const pDir = proposalsDir(archDir);
    if (!fs.existsSync(pDir)) {
      console.log(`${C.gray}  No pending proposals.${C.reset}`);
      console.log(`${C.gray}  Agents can emit proposals via: archkit gotcha --propose --skill <pkg> ...${C.reset}`);
      console.log(`${C.gray}  Or drop JSON files in .arch/gotcha-proposals/${C.reset}`);
      return;
    }

    const files = fs.readdirSync(pDir).filter(f => f.endsWith(".json"));
    if (files.length === 0) {
      console.log(`${C.gray}  No pending proposals.${C.reset}`);
      return;
    }

    banner();
    console.log(`${C.blue}${C.bold}  ${I.brain} Gotcha Proposal Review${C.reset}`);
    console.log(`${C.gray}  ${files.length} proposal${files.length !== 1 ? "s" : ""} to review${C.reset}\n`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join(pDir, file);
      let proposal;
      try {
        proposal = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        log.warn(`Skipping corrupt file: ${file}`);
        continue;
      }

      const hash = file.replace(".json", "");
      console.log(`${C.gray}  ${"─".repeat(50)}${C.reset}`);
      console.log(`${C.blue}${C.bold}  Proposal ${i + 1} of ${files.length}${C.reset}`);
      console.log(`${C.gray}  Skill:  ${C.reset}${C.bold}${proposal.skill}${C.reset}`);
      if (proposal.source) console.log(`${C.gray}  Source: ${proposal.source}  (${proposal.created_at || "unknown date"})${C.reset}`);
      console.log("");
      console.log(`${C.red}  WRONG: ${C.reset}${proposal.wrong}`);
      console.log(`${C.green}  RIGHT: ${C.reset}${proposal.right}`);
      console.log(`${C.yellow}  WHY:   ${C.reset}${proposal.why}`);
      console.log("");

      const { action } = await inquirer.prompt([{
        type: "list",
        name: "action",
        message: "What do you want to do?",
        prefix: `  ${I.arch}`,
        choices: [
          { name: `${C.green}Accept${C.reset} (append to ${proposal.skill}.skill)`, value: "accept" },
          { name: `${C.blue}Edit${C.reset}   (modify in $EDITOR, then accept)`, value: "edit" },
          { name: `${C.red}Reject${C.reset} (move to rejected/)`, value: "reject" },
          { name: `${C.gray}Skip${C.reset}   (leave in queue)`, value: "skip" },
          { name: `${C.gray}Quit${C.reset}   (stop reviewing)`, value: "quit" },
        ],
      }]);

      if (action === "quit") {
        console.log(`${C.gray}  Stopped. ${files.length - i} proposal${files.length - i !== 1 ? "s" : ""} remaining.${C.reset}\n`);
        return;
      }
      if (action === "skip") { console.log(`${C.gray}  Skipped.${C.reset}\n`); continue; }
      if (action === "reject") {
        const rDir = rejectedDir(archDir);
        fs.mkdirSync(rDir, { recursive: true });
        fs.renameSync(filePath, path.join(rDir, file));
        console.log(`${C.red}  ${I.cross} Rejected and archived.${C.reset}\n`);
        continue;
      }

      let finalProposal = proposal;
      if (action === "edit") {
        const { edited } = await inquirer.prompt([{
          type: "editor",
          name: "edited",
          message: "Edit the proposal JSON:",
          default: JSON.stringify(proposal, null, 2),
        }]);
        try {
          finalProposal = JSON.parse(edited);
          if (!finalProposal.skill || !finalProposal.wrong || !finalProposal.right || !finalProposal.why) {
            console.log(`${C.red}  ${I.warn} Edited proposal is missing required fields. Skipping.${C.reset}\n`);
            continue;
          }
        } catch (err) {
          console.log(`${C.red}  ${I.warn} Invalid JSON: ${err.message}. Skipping.${C.reset}\n`);
          continue;
        }
      }

      // Accept: append to skill file
      const skillPath = path.join(archDir, "skills", `${finalProposal.skill}.skill`);
      if (!fs.existsSync(skillPath)) {
        const { create } = await inquirer.prompt([{
          type: "confirm",
          name: "create",
          message: `${finalProposal.skill}.skill doesn't exist. Create it?`,
          default: true,
          prefix: `  ${I.arch}`,
        }]);
        if (!create) { console.log(`${C.gray}  Skipped — skill file not created.${C.reset}\n`); continue; }
        fs.mkdirSync(path.dirname(skillPath), { recursive: true });
        fs.writeFileSync(skillPath, `# ${finalProposal.skill}\n\n## Gotchas\n`);
        log.generate(`Created ${finalProposal.skill}.skill`);
      }

      const ok = appendGotcha(archDir, finalProposal.skill, finalProposal.wrong, finalProposal.right, finalProposal.why);
      if (ok) {
        fs.unlinkSync(filePath);
        const total = countGotchas(archDir, finalProposal.skill);
        console.log(`${C.green}  ${I.check} Accepted — added to ${finalProposal.skill}.skill (${total} total)${C.reset}\n`);
      }
    }
    console.log(`${C.green}  ${I.check} Review complete.${C.reset}\n`);
    return;
  }

  // Non-interactive debrief for AI agents
  if ((args.includes("--debrief") || args.includes("-d")) && args.includes("--json")) {
    const jsonArg = args.filter(a => !a.startsWith("-")).join(" ");
    let input;
    try {
      input = JSON.parse(jsonArg);
    } catch {
      console.log(JSON.stringify({ error: "Invalid JSON. Expected: {\"gotchas\":[{\"skill\":\"x\",\"wrong\":\"x\",\"right\":\"x\",\"why\":\"x\"}],\"placement\":\"optional note\",\"apiSurprise\":{\"skill\":\"x\",\"note\":\"x\"},\"goodPattern\":{\"skill\":\"x\",\"pattern\":\"x\"}}" }));
      process.exit(1);
    }

    const results = [];

    // Process gotchas
    if (input.gotchas && Array.isArray(input.gotchas)) {
      for (const g of input.gotchas) {
        if (g.skill && g.wrong && g.right && g.why) {
          const ok = appendGotcha(archDir, g.skill, g.wrong, g.right, g.why);
          results.push({ type: "gotcha", skill: g.skill, success: ok });
        }
      }
    }

    // Process placement note
    if (input.placement) {
      const sysPath = path.join(archDir, "SYSTEM.md");
      if (fs.existsSync(sysPath)) {
        let sys = fs.readFileSync(sysPath, "utf8");
        const rulesIdx = sys.indexOf("## Rules");
        if (rulesIdx !== -1) {
          const nextSection = sys.indexOf("\n## ", rulesIdx + 8);
          const insertAt = nextSection !== -1 ? nextSection : sys.length;
          sys = sys.slice(0, insertAt) + `- LEARNED: ${input.placement}\n` + sys.slice(insertAt);
          fs.writeFileSync(sysPath, sys);
          results.push({ type: "placement", success: true });
        }
      }
    }

    // Process API surprise
    if (input.apiSurprise && input.apiSurprise.skill && input.apiSurprise.note) {
      const skillPath = path.join(archDir, "skills", `${input.apiSurprise.skill}.skill`);
      if (fs.existsSync(skillPath)) {
        let content = fs.readFileSync(skillPath, "utf8");
        const gotchaIdx = content.indexOf("## Gotchas");
        if (gotchaIdx !== -1) {
          const afterGotcha = content.indexOf("## ", gotchaIdx + 10);
          const entry = `\n# TODO-GOTCHA: ${input.apiSurprise.note}\n# Convert to WRONG/RIGHT/WHY when pattern is clear.\n`;
          if (afterGotcha !== -1) {
            content = content.slice(0, afterGotcha) + entry + content.slice(afterGotcha);
          } else {
            content += entry;
          }
          fs.writeFileSync(skillPath, content);
          results.push({ type: "api-surprise", skill: input.apiSurprise.skill, success: true });
        }
      }
    }

    // Process good pattern
    if (input.goodPattern && input.goodPattern.skill && input.goodPattern.pattern) {
      const skillPath = path.join(archDir, "skills", `${input.goodPattern.skill}.skill`);
      if (fs.existsSync(skillPath)) {
        let content = fs.readFileSync(skillPath, "utf8");
        const patternsIdx = content.indexOf("## Patterns");
        if (patternsIdx !== -1) {
          const afterPatterns = content.indexOf("## ", patternsIdx + 11);
          const entry = `\n# LEARNED: ${input.goodPattern.pattern}\n`;
          if (afterPatterns !== -1) {
            content = content.slice(0, afterPatterns) + entry + content.slice(afterPatterns);
          } else {
            content += entry;
          }
          fs.writeFileSync(skillPath, content);
          results.push({ type: "good-pattern", skill: input.goodPattern.skill, success: true });
        }
      }
    }

    console.log(JSON.stringify({ success: true, results }));
    return;
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
    if (jsonMode) {
      console.log(JSON.stringify({ error: "Usage: archkit gotcha <skill> \"<wrong>\" \"<right>\" \"<why>\"" }));
      process.exit(1);
    }
    banner();
    console.log(`${C.yellow}  Usage:${C.reset}`);
    console.log(`${C.gray}    archkit gotcha <skill> "<wrong>" "<right>" "<why>"${C.reset}`);
    console.log(`${C.gray}    archkit gotcha --interactive${C.reset}`);
    console.log(`${C.gray}    archkit gotcha --list              ${C.dim}List skills + gotcha counts (JSON)${C.reset}`);
    console.log(`${C.gray}    archkit gotcha --json <skill> ...  ${C.dim}Direct mode with JSON output${C.reset}`);
    console.log("");
    console.log(`${C.yellow}  Examples:${C.reset}`);
    console.log(`${C.gray}    archkit gotcha stripe "req.body" "req.rawBody" "Express parses. Stripe needs raw."${C.reset}`);
    console.log(`${C.gray}    archkit gotcha prisma "new PrismaClient()" "globalThis.prisma ??= new PrismaClient()" "Serverless connection exhaustion"${C.reset}`);
    console.log("");
    process.exit(1);
  }

  // Check if skill file exists — warn and offer to create
  const skillPath = path.join(archDir, "skills", `${skillId}.skill`);
  if (!fs.existsSync(skillPath)) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Skill file not found: ${skillId}.skill`, available: listSkills(archDir), hint: `Create it first or use a different skill. Available: ${listSkills(archDir).join(", ")}` }));
      process.exit(1);
    }
    console.log(`${C.red}  ${I.warn} Skill file not found: ${skillId}.skill${C.reset}`);
    console.log(`${C.gray}  Available skills: ${listSkills(archDir).join(", ")}${C.reset}`);
    console.log(`${C.gray}  To create a new skill: archkit extend create --from-preset add-skill${C.reset}`);
    console.log("");
    process.exit(1);
  }

  const ok = appendGotcha(archDir, skillId, wrong, right, why);
  if (jsonMode) {
    console.log(JSON.stringify({ success: ok, skill: skillId, total: ok ? countGotchas(archDir, skillId) : 0 }));
  } else if (ok) {
    const total = countGotchas(archDir, skillId);
    console.log(`${C.green}  ${I.check} Gotcha added to ${skillId}.skill (${total} total)${C.reset}`);
  }
}

// ── MCP-friendly runner exports ───────────────────────────────────────────

export async function runGotchaListJson({ archDir }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  const skillsDir = path.join(archDir, "skills");
  if (!fs.existsSync(skillsDir)) return { skills: [] };
  const skills = [];
  for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))) {
    const id = file.replace(".skill", "");
    const content = fs.readFileSync(path.join(skillsDir, file), "utf8");
    const gotchas = (content.match(/^WRONG:/gm) || []).length;
    skills.push({ id, gotchas });
  }
  return { skills };
}

export async function runGotchaProposeJson({ archDir, skill, wrong, right, why, appType }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  for (const [key, val] of Object.entries({ skill, wrong, right, why })) {
    if (!val || typeof val !== "string") {
      throw archkitError("proposal_invalid", `Missing required field: ${key}`, {
        suggestion: "Provide all of: skill, wrong, right, why.",
      });
    }
  }
  const hash = proposalHash(skill, wrong, right);
  const pDir = proposalsDir(archDir);
  const proposalFile = path.join(pDir, `${hash}.json`);
  fs.mkdirSync(pDir, { recursive: true });
  const proposal = { skill, wrong, right, why, ...(appType ? { appType } : {}), source: "mcp", created_at: new Date().toISOString() };
  fs.writeFileSync(proposalFile, JSON.stringify(proposal, null, 2));
  return { queued: true, proposalPath: proposalFile };
}

export { cliMode as main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  const args = process.argv.slice(2);
  cliMode(args).catch(err => {
    console.error(`${C.red}  Error: ${err.message}${C.reset}`);
    process.exit(1);
  });
}
