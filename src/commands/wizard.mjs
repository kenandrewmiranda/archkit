#!/usr/bin/env node

/**
 * archkit wizard — print the absolute path to the /archkit-init SKILL.md and
 * the copy-pasteable instruction for invoking it inside Claude Code.
 *
 * The actual wizard is a Claude Code skill at skills/archkit-init/SKILL.md.
 * Without plugin marketplace install, that skill isn't auto-discovered as a
 * slash command — but Claude Code can still execute it when you tell it the
 * path. This subcommand exists so `archkit --help` exposes the discovery
 * path explicitly; without it, agents find the legacy CLI scaffolder first
 * and never realize the new wizard exists.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, ICONS as I } from "../lib/shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveSkillPath() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return path.join(process.env.CLAUDE_PLUGIN_ROOT, "skills", "archkit-init", "SKILL.md");
  }
  // src/commands/wizard.mjs → ../../skills/archkit-init/SKILL.md
  return path.resolve(__dirname, "..", "..", "skills", "archkit-init", "SKILL.md");
}

async function cliMode(args) {
  const jsonMode = args.includes("--json");
  const skillPath = resolveSkillPath();
  const exists = fs.existsSync(skillPath);

  if (jsonMode) {
    console.log(JSON.stringify({
      skillPath,
      exists,
      instruction: exists
        ? `Read and execute the skill at ${skillPath}`
        : `SKILL.md not found at ${skillPath} — archkit install may be incomplete.`,
    }));
    return;
  }

  console.log(`${C.cyan}${C.bold}  /archkit-init wizard${C.reset}`);
  console.log(`${C.gray}  The wizard runs as a Claude Code skill, not a CLI command.${C.reset}`);
  console.log("");

  if (!exists) {
    console.log(`${C.red}  ${I.warn} SKILL.md not found at expected path:${C.reset}`);
    console.log(`${C.gray}    ${skillPath}${C.reset}`);
    console.log(`${C.gray}  Your archkit install may be incomplete. Try reinstalling:${C.reset}`);
    console.log(`${C.gray}    npm install -g archkit${C.reset}`);
    console.log("");
    process.exit(1);
  }

  console.log(`${C.yellow}  In Claude Code, ask Claude:${C.reset}`);
  console.log("");
  console.log(`${C.green}    Read and execute the skill at ${skillPath}${C.reset}`);
  console.log("");
  console.log(`${C.gray}  The skill will:${C.reset}`);
  console.log(`${C.gray}    1. Call archkit_prd_check to detect any PRD/BRIEF/SPEC.${C.reset}`);
  console.log(`${C.gray}    2. Walk you through archetype (saas/internal/content/ecommerce/ai/mobile/realtime/data) + deployment mode.${C.reset}`);
  console.log(`${C.gray}    3. Resolve current package versions via WebSearch.${C.reset}`);
  console.log(`${C.gray}    4. Write the .arch/ seed (SYSTEM.md, BOUNDARIES.md, INDEX.md, decisions/0001-foundation.md).${C.reset}`);
  console.log("");
  console.log(`${C.gray}  If you're not in Claude Code (Cursor, Continue, plain CLI), the legacy interactive scaffolder is still available:${C.reset}`);
  console.log(`${C.gray}    archkit${C.reset}`);
  console.log("");
}

export { cliMode as main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  const args = process.argv.slice(2);
  cliMode(args).catch(err => {
    console.error(`${C.red}  Error: ${err.message}${C.reset}`);
    process.exit(1);
  });
}
