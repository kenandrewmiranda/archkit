#!/usr/bin/env node

import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  resolve:  "../src/commands/resolve.mjs",
  guard:    "../src/commands/guard.mjs",
  extend:   "../src/commands/extend.mjs",
  gotcha:   "../src/commands/gotcha.mjs",
  review:   "../src/commands/review.mjs",
  stats:    "../src/commands/stats.mjs",
  drift:    "../src/commands/drift.mjs",
};

if (command && commands[command]) {
  // Pass remaining args
  process.argv.splice(2, 1);
  await import(path.resolve(__dirname, commands[command]));
} else {
  // Default: run the scaffold wizard
  await import(path.resolve(__dirname, "../src/scaffold.mjs"));
}
