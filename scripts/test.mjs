#!/usr/bin/env node
// Run every tests/<suite>/run.mjs as a child process and aggregate results.
// archkit's suites are standalone scripts (no test framework); this is the
// `npm test` entry point and what CI runs. Exits non-zero if any suite fails.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const testsDir = path.join(root, "tests");

const suites = fs
  .readdirSync(testsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(testsDir, d.name, "run.mjs")))
  .map((d) => d.name)
  .sort();

const failed = [];
for (const suite of suites) {
  const res = spawnSync(process.execPath, [path.join(testsDir, suite, "run.mjs")], { stdio: "inherit" });
  if (res.status !== 0) failed.push(suite);
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed.`);
if (failed.length) {
  console.error(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
