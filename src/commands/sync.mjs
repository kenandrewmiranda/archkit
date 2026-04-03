#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { findArchDir } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import * as log from "../lib/logger.mjs";
import { loadFile, parseIndex, parseSystem } from "../lib/parsers.mjs";
import { PACKAGE_DOCS } from "../data/package-docs.mjs";
import { SKILL_CATALOG } from "../data/app-types.mjs";

function banner() {
  commandBanner("arch-sync", "Detect .arch/ files that need updating");
}

function main() {
  const args = process.argv.slice(2);
  const srcDir = args.find(a => !a.startsWith("-")) || "src";
  const jsonMode = args.includes("--json");

  const archDir = findArchDir({ requireFile: "SYSTEM.md" });
  if (!archDir) {
    if (jsonMode) console.log(JSON.stringify({ error: "No .arch/ directory found" }));
    else { banner(); log.error("No .arch/ directory found."); }
    process.exit(1);
  }

  if (!jsonMode) banner();
  log.resolve("Comparing codebase against .arch/ files...");

  const suggestions = [];

  // 1. Detect new feature directories not in INDEX.md
  const indexContent = loadFile(archDir, "INDEX.md");
  const index = indexContent ? parseIndex(indexContent) : { nodeCluster: {} };
  const indexedFeatures = new Set(Object.keys(index.nodeCluster));

  const featureDirs = [
    path.join(srcDir, "features"),
    path.join(srcDir, "modules"),
    path.join(srcDir, "domains"),
  ];

  for (const dir of featureDirs) {
    const fullDir = path.resolve(dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const item of fs.readdirSync(fullDir, { withFileTypes: true })) {
      if (item.isDirectory() && !item.name.startsWith(".") && !item.name.startsWith("_")) {
        const featureId = item.name.toLowerCase();
        if (!indexedFeatures.has(featureId)) {
          suggestions.push({
            type: "new-feature",
            id: featureId,
            action: `Add @${featureId} to INDEX.md and create clusters/${featureId}.graph`,
            command: `archkit resolve scaffold ${featureId}`,
          });
        }
      }
    }
  }

  // Also check handlers (realtime) and chains (AI)
  for (const [dir, pattern] of [["handlers", /\.handler\.(ts|js)$/], ["chains", /\.chain\.(ts|py)$/]]) {
    const fullDir = path.resolve(srcDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const item of fs.readdirSync(fullDir)) {
      if (pattern.test(item)) {
        const featureId = item.replace(/\.(handler|chain)\.(ts|js|py)$/, "").toLowerCase();
        if (!indexedFeatures.has(featureId)) {
          suggestions.push({
            type: "new-feature",
            id: featureId,
            action: `Add @${featureId} to INDEX.md and create clusters/${featureId}.graph`,
            command: `archkit resolve scaffold ${featureId}`,
          });
        }
      }
    }
  }

  // 2. Detect new packages in package.json without .skill files
  const skillsDir = path.join(archDir, "skills");
  const existingSkills = fs.existsSync(skillsDir)
    ? new Set(fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill")).map(f => f.replace(".skill", "")))
    : new Set();

  try {
    const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

    // Check SKILL_CATALOG entries against installed deps
    for (const skill of SKILL_CATALOG) {
      if (existingSkills.has(skill.id)) continue;
      const terms = skill.keywords.split(",").map(k => k.trim().toLowerCase());
      const depNames = Object.keys(allDeps).map(d => d.toLowerCase());
      if (terms.some(term => depNames.some(dep => dep.includes(term)))) {
        suggestions.push({
          type: "new-skill",
          id: skill.id,
          package: skill.name,
          action: `Create skills/${skill.id}.skill for ${skill.name}`,
          command: `archkit extend create --from-preset add-skill`,
        });
      }
    }
  } catch {}

  // 3. Detect removed features (in INDEX.md but directory gone)
  for (const [nodeId, info] of Object.entries(index.nodeCluster)) {
    const basePath = info.basePath;
    if (basePath && !basePath.includes("*")) {
      const fullPath = path.resolve(basePath);
      if (!fs.existsSync(fullPath)) {
        suggestions.push({
          type: "removed-feature",
          id: nodeId,
          action: `Remove @${nodeId} from INDEX.md and delete clusters/${info.cluster}.graph`,
        });
      }
    }
  }

  // 4. Detect skill version drift
  try {
    const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

    for (const skillId of existingSkills) {
      const skillContent = loadFile(archDir, "skills", `${skillId}.skill`);
      if (!skillContent) continue;
      const pkgMatch = skillContent.match(/^pkg:\s*(.+)@(.+)$/m);
      if (!pkgMatch || pkgMatch[2].includes("[")) continue;

      const npmName = pkgMatch[1].trim();
      const skillVersion = pkgMatch[2].trim();
      const installedVersion = allDeps[npmName];

      if (installedVersion && !installedVersion.includes(skillVersion.replace("^", "").replace("~", ""))) {
        suggestions.push({
          type: "version-drift",
          id: skillId,
          skillVersion,
          installedVersion,
          action: `Update skills/${skillId}.skill Meta section — version changed from ${skillVersion} to ${installedVersion}`,
        });
      }
    }
  } catch {}

  // Output
  const result = {
    archDir,
    suggestions,
    syncNeeded: suggestions.length > 0,
  };

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (suggestions.length === 0) {
      log.ok(".arch/ is in sync with the codebase — no updates needed");
    } else {
      console.error("");
      for (const s of suggestions) {
        log.warn(`[${s.type}] ${s.action}`);
        if (s.command) log.agent(`  Fix: ${s.command}`);
      }
      console.error("");
      log.resolve(`${suggestions.length} sync suggestion${suggestions.length > 1 ? "s" : ""}`);
    }
  }

  process.exit(suggestions.length > 0 ? 1 : 0);
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main();
}
