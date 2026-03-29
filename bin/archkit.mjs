#!/usr/bin/env node

import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Route to the correct command
const command = process.argv[2];

const commands = {
  resolve:  "../src/commands/resolve.mjs",
  guard:    "../src/commands/guard.mjs",
  extend:   "../src/commands/extend.mjs",
  gotcha:   "../src/commands/gotcha.mjs",
  review:   "../src/commands/review.mjs",
  stats:    "../src/commands/stats.mjs",
};

if (command && commands[command]) {
  // Pass remaining args
  process.argv.splice(2, 1);
  await import(path.resolve(__dirname, commands[command]));
} else {
  // Default: run the scaffold wizard
  await import(path.resolve(__dirname, "../src/scaffold.mjs"));
}
