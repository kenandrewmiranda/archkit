#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import() of an ABSOLUTE filesystem path fails on Windows
// (ERR_UNSUPPORTED_ESM_URL_SCHEME: "d:\..." is not a valid URL scheme) — the
// ESM loader requires a file:// URL there. pathToFileURL is a no-op-shaped
// wrapper that is correct on every OS. Always route absolute-path imports
// through this.
const importPath = (p) => import(pathToFileURL(p).href);

// Signal to command modules that they should self-execute
process.env.ARCHKIT_RUN = "1";

// Handle --preset flag: extract preset path before routing
const presetIdx = process.argv.indexOf("--preset");
if (presetIdx !== -1 && process.argv[presetIdx + 1]) {
  process.env.ARCHKIT_PRESET = process.argv[presetIdx + 1];
  process.argv.splice(presetIdx, 2);
}

// Route to the correct command
const command = process.argv[2];

const commands = {
  init:     "../src/commands/init.mjs",
  resolve:  "../src/commands/resolve.mjs",
  gotcha:   "../src/commands/gotcha.mjs",
  review:   "../src/commands/review.mjs",
  stats:    "../src/commands/stats.mjs",
  drift:    "../src/commands/drift.mjs",
  decisions: "../src/commands/decisions.mjs",
  prd:      "../src/commands/prd.mjs",
  wizard:   "../src/commands/wizard.mjs",
  export:   "../src/commands/export.mjs",
  sync:     "../src/commands/sync.mjs",
  update:   "../src/commands/update.mjs",
  migrate:  "../src/commands/migrate.mjs",
  market:   "../src/commands/market.mjs",
  "boundary-check": "../src/commands/boundary.mjs",
  goal:     "../src/commands/goal.mjs",
  worklog:  "../src/commands/worklog.mjs",
  doctor:   "../src/commands/doctor.mjs",
};

// Synonyms for real commands. `upgrade` is the word users reach for when they
// mean the self-update command (which is named `update`).
const commandAliases = { upgrade: "update" };

// Marketplace convenience aliases — route e.g. `archkit install X` to `archkit market install X`
const marketAliases = { login: true, logout: true, search: true, install: true, info: true };

const HELP_FLAGS = new Set(["help", "--help", "-h"]);
const VERSION_FLAGS = new Set(["version", "--version", "-v"]);

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

// Resolve a command token to a real command-map key, tolerating dash-prefixed
// command typos (e.g. `--upgrade`, `-update`) and synonyms (`upgrade` → `update`).
// Returns the matched key, or null if the token isn't a command. Note: a bare
// wizard flag like `--claude` de-dashes to `claude`, which is not a command, so
// it correctly falls through to the wizard rather than erroring.
function resolveCommandKey(arg) {
  if (typeof arg !== "string") return null;
  for (const candidate of [arg, arg.replace(/^-+/, "")]) {
    const key = commandAliases[candidate] || candidate;
    if (commands[key]) return key;
  }
  return null;
}

// Levenshtein distance for did-you-mean suggestions on a mistyped command.
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function suggestCommand(arg) {
  const bare = arg.replace(/^-+/, "").toLowerCase();
  const names = [...Object.keys(commands), ...Object.keys(commandAliases), ...Object.keys(marketAliases)];
  let best = null;
  let bestDist = Infinity;
  for (const name of names) {
    const d = editDistance(bare, name);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return bestDist <= 2 ? best : null;
}

function printVersion() {
  console.log(`archkit v${readVersion()}`);
}

function printHelp() {
  console.log(`archkit v${readVersion()} — Context Engineering Scaffolder for AI-Assisted Development

Usage: archkit <command> [options]

Setup
  init               Scaffold .arch/ from an existing codebase
  wizard             Interactive setup wizard
  migrate            Upgrade an existing .arch/ to the latest layout
  update (upgrade)   Update archkit itself to the latest version

Context
  resolve <sub>      warmup / preflight / lookup / scaffold / context / plan
  review             Check code against your .arch/ rules and playbooks
  drift              Detect stale .arch/ vs the source tree
  sync               Find .arch/ files that need updating
  stats              .arch/ coverage + health dashboard
  doctor             Is .arch/ actually load-bearing?

Knowledge
  gotcha             Capture WRONG/RIGHT/WHY patterns into playbooks
  decisions          Read/search ADRs
  prd                Check a PRD/BRIEF/SPEC against SYSTEM.md

Goals / output
  goal               CGR goal relay
  worklog            Session worklog
  export             Emit AGENTS.md / editor-native context files
  market <sub>       Community playbook packs (login/search/install/info)
  boundary-check     Enforce BAN rules
  mcp                Run the stdio MCP server

Run with no command to launch the interactive wizard.
  --version, -v      Print the archkit version
  --help, -h         Show this help`);
}

if (command === "mcp") {
  // archkit mcp  →  archkit-mcp (stdio MCP server)
  await importPath(path.resolve(__dirname, "../bin/archkit-mcp.mjs"));
} else if (VERSION_FLAGS.has(command)) {
  printVersion();
} else if (HELP_FLAGS.has(command)) {
  printHelp();
} else if (command && marketAliases[command]) {
  // Rewrite argv so market.mjs sees the subcommand: [node, script, subcommand, ...rest]
  // No splice needed — market.mjs reads process.argv.slice(2) which already starts with the subcommand
  await importPath(path.resolve(__dirname, "../src/commands/market.mjs"));
} else if (resolveCommandKey(command)) {
  const key = resolveCommandKey(command);
  // Tell the user the canonical command when they used a synonym or dash-typo.
  if (command !== key) console.error(`archkit: '${command}' → running '${key}'`);
  // Drop the command token so the module sees only its own args (it reads argv.slice(2)).
  process.argv.splice(2, 1);
  await importPath(path.resolve(__dirname, commands[key]));
} else if (command === undefined || command.startsWith("-")) {
  // No command, or a wizard flag we didn't recognize as a command (e.g. --claude).
  // The interactive scaffold wizard reads its own flags.
  await importPath(path.resolve(__dirname, "../src/scaffold.mjs"));
} else {
  // An unknown WORD — a mistyped command. Do NOT silently launch the wizard
  // (a surprising, hard-to-undo default). Point the user at the right command.
  const suggestion = suggestCommand(command);
  console.error(`archkit: unknown command '${command}'.`);
  if (suggestion) console.error(`Did you mean 'archkit ${suggestion}'?`);
  console.error(`Run 'archkit --help' to see available commands.`);
  process.exit(1);
}
