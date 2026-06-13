#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { isMainModule, findArchDir } from "../lib/shared.mjs";
import { createArchReader } from "../lib/parsers.mjs";
import { collectDeps, resolveWorkspaceGlobs } from "../lib/workspace-deps.mjs";
import * as log from "../lib/logger.mjs";
import { commandBanner } from "../lib/banner.mjs";
import { archkitError } from "../lib/errors.mjs";

function banner() {
  commandBanner("arch-drift", "Detect stale .arch/ files and architectural drift");
}

function detectFindings(archDir, cwd, arch = createArchReader(archDir)) {
  const findings = [];

  // 1. Check INDEX.md nodes against actual .graph files
  const index = arch.index();

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

  // Union root + workspace-member deps so a skill whose package is declared in
  // a workspace package.json (apps/*, packages/*) isn't flagged as orphaned in
  // pnpm/npm/yarn monorepos.
  const pkgDeps = collectDeps(cwd);

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
  // basePath may be a single path or comma-separated list of paths.
  // Check each path independently so one missing file doesn't mask others.
  for (const [nodeId, info] of Object.entries(index.nodeCluster)) {
    const basePath = info.basePath;
    if (!basePath || basePath.includes("*")) continue;

    const paths = basePath.split(",").map(p => p.trim()).filter(Boolean);
    const isMultiPath = paths.length > 1;

    for (const p of paths) {
      // Paths into .arch/ (graph/skill/api artifacts) are validated by the
      // orphaned-* checks against actual directory contents — don't double-flag
      // them as missing source files.
      if (p.startsWith(".arch/") || /\.(graph|skill|api)$/.test(p)) continue;

      const fullPath = path.join(cwd, p);
      if (!fs.existsSync(fullPath)) {
        const type = isMultiPath ? "missing-file" : "missing-source";
        findings.push({
          type,
          id: nodeId,
          detail: `INDEX.md says @${nodeId} → ${p} but it doesn't exist on disk`,
        });
      }
    }
  }

  // 4. Check SYSTEM.md app name against package.json
  //    SYSTEM.md app names commonly carry a parenthetical description
  //    ("arch-infographs (LinkedIn AI Content Pipeline)") — strip those before
  //    comparison so the parenthetical doesn't break the substring check.
  //    Also strip an npm scope from package.json (@scope/foo → foo) so a
  //    scoped package matches an unscoped SYSTEM.md name.
  const systemContent = arch.read("SYSTEM.md");
  if (systemContent) {
    const appNameMatch = systemContent.match(/^## App:\s*(.+)$/m);
    try {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
      if (appNameMatch && pkgJson.name) {
        const rawAppName = appNameMatch[1].trim();
        const normalized = rawAppName
          .replace(/\([^)]*\)/g, "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-");
        const pkgUnscoped = pkgJson.name.replace(/^@[^/]+\//, "");
        if (normalized && !pkgUnscoped.includes(normalized) && !pkgJson.name.includes(normalized)) {
          findings.push({ type: "name-mismatch", detail: `SYSTEM.md says "${rawAppName}" but package.json name is "${pkgJson.name}"` });
        }
      }
    } catch {}
  }

  // Confidence tagging — workspace/monorepo precision.
  // Workspace layouts split dependencies across member package.jsons (apps/*,
  // packages/*) and resolve source paths through path aliases, so the checks
  // that compare .arch/ against the dependency manifest or the source tree are
  // inherently less certain there: a "missing" dep may live in a member that
  // collectDeps couldn't enumerate (nested/recursive globs, catalogs), and a
  // "missing" source path may resolve via a tsconfig/jsconfig alias. In a
  // workspace we downgrade those three finding types to "low" confidence so
  // they read as hints rather than hard errors — and so CI gates and doctor's
  // blocker escalation don't false-fire on monorepo layouts. The .arch/-internal
  // consistency checks (orphaned-graph, orphaned-index-node, name-mismatch) do
  // not depend on monorepo layout, so they stay "high".
  const isWorkspace = resolveWorkspaceGlobs(cwd).length > 0;
  const WORKSPACE_SENSITIVE = new Set(["orphaned-skill", "missing-source", "missing-file"]);
  for (const f of findings) {
    f.confidence = isWorkspace && WORKSPACE_SENSITIVE.has(f.type) ? "low" : "high";
  }

  return findings;
}

export async function runDriftJson({ archDir, cwd = process.cwd() }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });

  // One request-scoped reader for the whole invocation: detectFindings and the
  // silent-success scan below share the same memoized INDEX.md parse (ADR 0002 —
  // call-scoped, so successive calls still see on-disk changes).
  const arch = createArchReader(archDir);
  const stale = detectFindings(archDir, cwd, arch);
  const summary = {
    total: stale.length,
    byType: stale.reduce((acc, s) => { acc[s.type] = (acc[s.type] || 0) + 1; return acc; }, {}),
    byConfidence: stale.reduce((acc, s) => { const c = s.confidence || "high"; acc[c] = (acc[c] || 0) + 1; return acc; }, {}),
  };
  const lowOnly = stale.length > 0 && stale.every(s => s.confidence === "low");

  // Silent-success indicator: name what was scanned even when no drift is found.
  // Reuses the reader's memoized INDEX.md parse — no second parse this call.
  const index = arch.index();
  const clustersDir = path.join(archDir, "clusters");
  const skillsDir = path.join(archDir, "skills");
  const scanned = {
    indexNodes: Object.keys(index.nodeCluster).length,
    graphFiles: fs.existsSync(clustersDir) ? fs.readdirSync(clustersDir).filter(f => f.endsWith(".graph")).length : 0,
    skillFiles: fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill")).length : 0,
  };
  const staleNote = stale.length === 0
    ? `Checked ${scanned.indexNodes} index node(s), ${scanned.graphFiles} graph(s), ${scanned.skillFiles} skill(s) — all consistent with the source tree.`
    : undefined;
  const nextStep = stale.length === 0
    ? `No drift to fix. Re-run after refactors or dependency removals.`
    : lowOnly
      ? `All ${stale.length} finding(s) are low-confidence (workspace/monorepo layout) — review only. They false-fire when a dep lives in a workspace member archkit couldn't enumerate, or a source path resolves via a path alias. Safe to ignore if so.`
      : `Resolve drift: missing-source/missing-file → restore the file or update INDEX.md basePath; orphaned-index-node → add the .graph or remove the INDEX.md entry; orphaned-skill → remove the .skill or re-add the dep. Low-confidence findings (workspace layouts) are hints, not hard errors.`;

  return { stale, summary, scanned, staleNote, nextStep };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");

  const archDir = findArchDir({ requireFile: "SYSTEM.md" });
  if (!archDir) {
    if (jsonMode) { console.log(JSON.stringify({ error: "No .arch/ directory found" })); }
    else { banner(); console.log("  No .arch/ directory found.\n"); }
    process.exit(1);
  }

  if (jsonMode) {
    try {
      const result = await runDriftJson({ archDir, cwd: process.cwd() });
      console.log(JSON.stringify(result));
      process.exit(0);
    } catch (err) {
      console.log(JSON.stringify({
        error: err.code || "internal_error",
        message: err.message,
        suggestion: err.suggestion,
        docsUrl: err.docsUrl,
      }));
      process.exit(1);
    }
  }

  if (!jsonMode) banner();
  log.resolve("Scanning for architectural drift...");

  const findings = detectFindings(archDir, process.cwd());
  const high = findings.filter(f => f.confidence !== "low");
  const low = findings.filter(f => f.confidence === "low");

  if (findings.length === 0) {
    log.ok("No drift detected — .arch/ files are consistent");
  } else {
    high.forEach(f => log.warn(`${f.type}: ${f.detail}`));
    // Low-confidence findings (workspace/monorepo layouts) are surfaced as hints,
    // not warnings, and don't drive the exit code so CI gates don't false-fire.
    low.forEach(f => log.system(`${f.type} (low confidence — workspace layout): ${f.detail}`));
    if (high.length > 0) {
      log.error(`${high.length} drift issue${high.length > 1 ? "s" : ""} detected`);
    } else {
      log.ok(`No high-confidence drift — ${low.length} low-confidence finding${low.length > 1 ? "s" : ""} in a workspace layout (review only)`);
    }
  }
  console.log("");

  process.exit(high.length > 0 ? 1 : 0);
}

export { main };

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
