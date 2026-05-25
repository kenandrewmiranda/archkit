#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const plugin = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin/plugin.json"), "utf8"));

if (pkg.version !== plugin.version) {
  console.error(
    `version drift: package.json=${pkg.version}, .claude-plugin/plugin.json=${plugin.version}`
  );
  console.error(
    `bump both together — they ship as one unit (npm + Claude Code plugin)`
  );
  process.exit(1);
}

console.log(`versions in sync: ${pkg.version}`);
