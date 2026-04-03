#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { findArchDir } from "../lib/shared.mjs";
import { loadFile, parseIndex, parseSystem } from "../lib/parsers.mjs";
import * as log from "../lib/logger.mjs";
import { commandBanner } from "../lib/banner.mjs";

function banner() {
  commandBanner("arch-drift", "Detect stale .arch/ files and architectural drift");
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");

  const archDir = findArchDir({ requireFile: "SYSTEM.md" });
  if (!archDir) {
    if (jsonMode) { console.log(JSON.stringify({ error: "No .arch/ directory found" })); }
    else { banner(); console.log("  No .arch/ directory found.\n"); }
    process.exit(1);
  }

  if (!jsonMode) banner();
  log.resolve("Scanning for architectural drift...");

  const findings = [];

  // 1. Check INDEX.md nodes against actual .graph files
  const indexContent = loadFile(archDir, "INDEX.md");
  const index = indexContent ? parseIndex(indexContent) : { nodeCluster: {}, skillFiles: {} };

  const clustersDir = path.join(archDir, "clusters");
  const graphFiles = fs.existsSync(clustersDir)
    ? fs.readdirSync(clustersDir).filter(f => f.endsWith(".graph")).map(f => f.replace(".graph", ""))
    : [];

  // Nodes in INDEX.md with no .graph file
  for (const [nodeId, info] of Object.entries(index.nodeCluster)) {
    const clusterId = info.cluster || nodeId;
    if (!graphFiles.includes(clusterId)) {
      findings.push({ type: "orphaned-index-node", id: nodeId, detail: `INDEX.md references @${nodeId} → [${clusterId}] but clusters/${clusterId}.graph doesn't exist` });
    }
  }

  // .graph files not referenced in INDEX.md
  const indexedClusters = new Set(Object.values(index.nodeCluster).map(v => v.cluster));
  for (const gf of graphFiles) {
    if (gf === "infra" || gf === "events" || gf === "middleware" || gf === "gateway") continue; // shared graphs
    if (!indexedClusters.has(gf) && !Object.keys(index.nodeCluster).includes(gf)) {
      findings.push({ type: "orphaned-graph", id: gf, detail: `clusters/${gf}.graph exists but no INDEX.md node references it` });
    }
  }

  // 2. Check .skill files against package.json
  const skillsDir = path.join(archDir, "skills");
  const skillFiles = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill")).map(f => f.replace(".skill", ""))
    : [];

  let pkgDeps = {};
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    pkgDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  } catch {}

  // Import the package-docs map to resolve skill → npm name
  // Can't do dynamic import in sync function, so inline a basic check
  const knownMappings = {
    postgres: "pg", prisma: "@prisma/client", valkey: "ioredis",
    bullmq: "bullmq", stripe: "stripe", meilisearch: "meilisearch",
    keycloak: "keycloak-js", websocket: "ws", yjs: "yjs",
    langfuse: "langfuse", pgvector: "pgvector", zod: "zod",
    hono: "hono",
  };

  for (const skillId of skillFiles) {
    const npmName = knownMappings[skillId];
    if (npmName && Object.keys(pkgDeps).length > 0 && !pkgDeps[npmName]) {
      findings.push({ type: "orphaned-skill", id: skillId, detail: `skills/${skillId}.skill exists but ${npmName} is not in package.json` });
    }
  }

  // 3. Check INDEX.md node base paths against disk
  const srcRoot = process.cwd();
  for (const [nodeId, info] of Object.entries(index.nodeCluster)) {
    const basePath = info.basePath;
    if (basePath && !basePath.includes("*")) {
      const fullPath = path.join(srcRoot, basePath);
      if (!fs.existsSync(fullPath)) {
        findings.push({ type: "missing-source", id: nodeId, detail: `INDEX.md says @${nodeId} → ${basePath} but directory doesn't exist on disk` });
      }
    }
  }

  // 4. Check SYSTEM.md app name against package.json
  const systemContent = loadFile(archDir, "SYSTEM.md");
  if (systemContent) {
    const appNameMatch = systemContent.match(/^## App:\s*(.+)$/m);
    try {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
      if (appNameMatch && pkgJson.name && !pkgJson.name.includes(appNameMatch[1].trim().toLowerCase().replace(/\s+/g, "-"))) {
        findings.push({ type: "name-mismatch", detail: `SYSTEM.md says "${appNameMatch[1].trim()}" but package.json name is "${pkgJson.name}"` });
      }
    } catch {}
  }

  // Output
  const result = {
    archDir,
    totalChecks: 4,
    findings,
    driftDetected: findings.length > 0,
  };

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (findings.length === 0) {
      log.ok("No drift detected — .arch/ files are consistent");
    } else {
      findings.forEach(f => log.warn(`${f.type}: ${f.detail}`));
      log.error(`${findings.length} drift issue${findings.length > 1 ? "s" : ""} detected`);
    }
    console.log("");
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main();
}
