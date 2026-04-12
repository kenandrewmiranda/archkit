#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { findArchDir, C, ICONS } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import * as log from "../lib/logger.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";
import { PACKAGE_DOCS } from "../data/package-docs.mjs";
import { genSystemMd, genIndexMd, genGraph, genInfraGraph, genEventsGraph, genSkillFile, genReadme, genBoundariesMd, genCompactContext } from "../lib/generators.mjs";

function banner() {
  commandBanner("arch-init", "Reverse-engineer .arch/ from existing codebase");
}

// ── Detection ───────────────────────────────────────────────────────

function detectStack(pkgJson) {
  const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const stack = {};

  // Frontend
  if (allDeps["next"]) stack["Frontend"] = `Next.js${allDeps["tailwindcss"] ? " + Tailwind" : ""}${allDeps["@shadcn/ui"] || allDeps["shadcn-ui"] ? " + shadcn/ui" : ""}`;
  else if (allDeps["react"]) stack["Frontend"] = "React";
  else if (allDeps["vue"]) stack["Frontend"] = "Vue";
  else if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) stack["Frontend"] = "SvelteKit";
  else if (allDeps["astro"]) stack["Frontend"] = "Astro";

  // API
  if (allDeps["hono"]) stack["API Framework"] = "Hono";
  else if (allDeps["express"]) stack["API Framework"] = "Express";
  else if (allDeps["fastify"]) stack["API Framework"] = "Fastify";
  else if (allDeps["@nestjs/core"]) stack["API Framework"] = "NestJS";
  else if (allDeps["koa"]) stack["API Framework"] = "Koa";

  // Database
  if (allDeps["@prisma/client"]) stack["ORM"] = "Prisma";
  else if (allDeps["drizzle-orm"]) stack["ORM"] = "Drizzle";
  else if (allDeps["typeorm"]) stack["ORM"] = "TypeORM";
  if (allDeps["pg"] || allDeps["@prisma/client"]) stack["Database"] = "PostgreSQL";
  else if (allDeps["mysql2"]) stack["Database"] = "MySQL";
  else if (allDeps["better-sqlite3"]) stack["Database"] = "SQLite";
  if (allDeps["@clickhouse/client"]) stack["OLAP"] = "ClickHouse";

  // Cache/Queue
  if (allDeps["ioredis"] || allDeps["redis"]) stack["Cache"] = "Valkey / Redis";
  if (allDeps["bullmq"]) stack["Job Queue"] = "BullMQ";

  // Auth
  if (allDeps["keycloak-js"] || allDeps["keycloak-connect"]) stack["Auth"] = "Keycloak";
  else if (allDeps["next-auth"] || allDeps["@auth/core"]) stack["Auth"] = "NextAuth";
  else if (allDeps["passport"]) stack["Auth"] = "Passport";

  // Search
  if (allDeps["meilisearch"]) stack["Search"] = "Meilisearch";
  else if (allDeps["@opensearch-project/opensearch"]) stack["Search"] = "OpenSearch";

  // AI/ML
  if (allDeps["@anthropic-ai/sdk"]) stack["LLM"] = "Anthropic Claude";
  else if (allDeps["openai"]) stack["LLM"] = "OpenAI";
  if (allDeps["langfuse"]) stack["LLM Observability"] = "Langfuse";
  if (allDeps["pgvector"]) stack["Vector DB"] = "pgvector";

  // Payments
  if (allDeps["stripe"]) stack["Payments"] = "Stripe";

  // Realtime
  if (allDeps["ws"]) stack["Realtime"] = "WebSocket (ws)";
  else if (allDeps["socket.io"]) stack["Realtime"] = "Socket.IO";

  // Testing
  if (allDeps["vitest"]) stack["Testing"] = "Vitest";
  else if (allDeps["jest"]) stack["Testing"] = "Jest";

  // CLI tools
  if (allDeps["inquirer"]) stack["CLI"] = "Inquirer (interactive prompts)";
  else if (allDeps["commander"]) stack["CLI"] = "Commander";
  else if (allDeps["yargs"]) stack["CLI"] = "Yargs";
  else if (allDeps["meow"]) stack["CLI"] = "Meow";

  return stack;
}

function detectAppType(stack, dirStructure, pkgJson) {
  // Heuristic detection based on stack + directory patterns
  if (stack["LLM"] || stack["Vector DB"]) return "ai";
  if (stack["Realtime"] && !stack["ORM"]) return "realtime";
  if (dirStructure.some(d => d.includes("screens") || d.includes("Screen"))) return "mobile";
  if (dirStructure.some(d => d.includes("pipelines") || d.includes("dagster"))) return "data";
  if (stack["Frontend"] && stack["Frontend"].includes("Astro")) return "content";
  if (stack["Payments"]) return "ecommerce";
  // CLI tool detection — has bin field or CLI framework dependency
  if (pkgJson.bin || stack["CLI"]) return "internal"; // closest match — simple layered
  // Library detection — has main/exports but no frontend/API framework
  if ((pkgJson.main || pkgJson.exports) && !stack["Frontend"] && !stack["API Framework"]) return "internal";
  if (stack["Frontend"] || stack["API Framework"]) return "saas";
  return "internal"; // default to simple layered instead of assuming SaaS
}

function detectFeatures(srcDir) {
  const features = [];

  // Check common feature directory patterns
  const featureDirs = [
    path.join(srcDir, "features"),
    path.join(srcDir, "modules"),
    path.join(srcDir, "domains"),
    path.join(srcDir, "apps"),
    path.join(srcDir, "commands"),
    path.join(srcDir, "plugins"),
    path.join(srcDir, "packages"),
  ];

  for (const dir of featureDirs) {
    if (fs.existsSync(dir)) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.isDirectory() && !item.name.startsWith(".") && !item.name.startsWith("_")) {
          features.push({
            id: item.name.toLowerCase(),
            name: item.name.charAt(0).toUpperCase() + item.name.slice(1) + " management",
            keywords: item.name.toLowerCase(),
          });
        }
      }
    }
  }

  // Also check for route-based features (src/routes/, src/pages/, src/api/)
  const routeDirs = [
    path.join(srcDir, "routes"),
    path.join(srcDir, "api", "routes"),
    path.join(srcDir, "pages", "api"),
    path.join(srcDir, "app", "api"),
  ];

  const existingIds = new Set(features.map(f => f.id));
  for (const dir of routeDirs) {
    if (fs.existsSync(dir)) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.isDirectory() && !item.name.startsWith(".") && !item.name.startsWith("_") && !item.name.startsWith("(")) {
          const id = item.name.toLowerCase();
          if (!existingIds.has(id)) {
            features.push({ id, name: item.name.charAt(0).toUpperCase() + item.name.slice(1), keywords: id });
            existingIds.add(id);
          }
        }
      }
    }
  }

  // Check handlers directory (realtime apps)
  const handlersDir = path.join(srcDir, "handlers");
  if (fs.existsSync(handlersDir)) {
    for (const item of fs.readdirSync(handlersDir)) {
      if (item.endsWith(".handler.ts") || item.endsWith(".handler.js")) {
        const id = item.replace(/\.handler\.(ts|js)$/, "").toLowerCase();
        if (!existingIds.has(id)) {
          features.push({ id, name: id.charAt(0).toUpperCase() + id.slice(1), keywords: id });
          existingIds.add(id);
        }
      }
    }
  }

  // Check chains directory (AI apps)
  const chainsDir = path.join(srcDir, "chains");
  if (fs.existsSync(chainsDir)) {
    for (const item of fs.readdirSync(chainsDir)) {
      if (item.endsWith(".chain.ts") || item.endsWith(".chain.py")) {
        const id = item.replace(/\.chain\.(ts|py)$/, "").toLowerCase();
        if (!existingIds.has(id)) {
          features.push({ id, name: id.charAt(0).toUpperCase() + id.slice(1), keywords: id });
          existingIds.add(id);
        }
      }
    }
  }

  return features;
}

function detectSkills(pkgJson) {
  const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const skills = [];

  for (const skill of SKILL_CATALOG) {
    const terms = skill.keywords.split(",").map(k => k.trim().toLowerCase());
    const depNames = Object.keys(allDeps).map(d => d.toLowerCase());
    if (terms.some(term => depNames.some(dep => dep.includes(term)))) {
      skills.push(skill.id);
    }
  }

  // Always include docker if Dockerfile exists
  if (fs.existsSync("Dockerfile") || fs.existsSync("docker-compose.yml") || fs.existsSync("docker-compose.yaml")) {
    if (!skills.includes("docker")) skills.push("docker");
  }

  return skills;
}

function getDirStructure(srcDir, maxDepth = 3) {
  const dirs = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules" && item.name !== "dist" && item.name !== ".next") {
        const full = path.join(dir, item.name);
        dirs.push(path.relative(srcDir, full));
        walk(full, depth + 1);
      }
    }
  }
  walk(srcDir, 0);
  return dirs;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const srcDir = args.find(a => !a.startsWith("-")) || "src";
  const jsonMode = args.includes("--json");
  const overwrite = args.includes("--overwrite");

  if (!jsonMode) banner();

  // ── Agent Scaffold Mode ────────────────────────────────────────────────────
  if (args.includes("--agent-scaffold")) {
    const { TEMPLATES } = await import("../data/agent-scaffold-templates.mjs");
    const base = path.resolve(".arch");
    const created = [];
    const skipped = [];

    const files = [
      { rel: path.join(".arch", "BOUNDARIES.md"), abs: path.join(base, "BOUNDARIES.md"), content: TEMPLATES.BOUNDARIES },
      { rel: path.join(".arch", "SYSTEM.md"), abs: path.join(base, "SYSTEM.md"), content: TEMPLATES.SYSTEM },
      { rel: path.join(".arch", "skills", "README.md"), abs: path.join(base, "skills", "README.md"), content: TEMPLATES.SKILLS_README },
      { rel: "CLAUDE.md", abs: path.resolve("CLAUDE.md"), content: TEMPLATES.CLAUDE_MD },
    ];

    for (const f of files) {
      if (fs.existsSync(f.abs)) {
        skipped.push(f.rel);
        if (!jsonMode) log.resolve(`Skipped ${f.rel} (already exists)`);
      } else {
        fs.mkdirSync(path.dirname(f.abs), { recursive: true });
        fs.writeFileSync(f.abs, f.content);
        created.push(f.rel);
        if (!jsonMode) log.generate(`Created ${f.rel}`);
      }
    }

    if (jsonMode) {
      console.log(JSON.stringify({ created, skipped }));
    } else {
      if (created.length > 0) {
        log.ok(`Scaffolded ${created.length} file${created.length !== 1 ? "s" : ""} — an AI agent can now populate them`);
      } else {
        log.ok("All files already exist — nothing to do");
      }
      console.error("");
      console.error("  Next: Ask your AI agent to fill in .arch/BOUNDARIES.md and .arch/SYSTEM.md");
      console.error("  Or fill them in manually using the AGENT-INSTRUCTIONS as a guide.");
      console.error("");
    }
    return;
  }

  // Check if .arch/ already exists
  if (fs.existsSync(".arch") && !overwrite) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: ".arch/ already exists. Use --overwrite to regenerate." }));
    } else {
      log.warn(".arch/ already exists. Use --overwrite to regenerate.");
    }
    process.exit(1);
  }

  // Read package.json
  let pkgJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  } catch {
    if (jsonMode) {
      console.log(JSON.stringify({ error: "No package.json found in current directory." }));
    } else {
      log.error("No package.json found. Run this from your project root.");
    }
    process.exit(1);
  }

  const appName = pkgJson.name || path.basename(process.cwd());
  log.resolve(`Project: ${appName}`);

  // Detect everything
  log.resolve("Detecting stack from package.json...");
  const stack = detectStack(pkgJson);
  log.resolve(`Stack: ${Object.entries(stack).map(([k,v]) => `${k}: ${v}`).join(" | ") || "unknown"}`);

  log.resolve("Scanning directory structure...");
  const dirStructure = getDirStructure(process.cwd());

  log.resolve("Detecting app type...");
  const appType = detectAppType(stack, dirStructure, pkgJson);
  log.resolve(`App type: ${APP_TYPES[appType]?.name || appType}`);

  log.resolve(`Scanning ${srcDir}/ for features...`);
  const features = detectFeatures(path.resolve(srcDir));
  log.resolve(`Found ${features.length} features: ${features.map(f => f.id).join(", ") || "none"}`);

  log.resolve("Detecting skills from dependencies...");
  const skills = detectSkills(pkgJson);
  log.resolve(`Found ${skills.length} skills: ${skills.join(", ") || "none"}`);

  // Build config
  const cfg = { appName, appType, stack, features, skills, crossRefs: [] };

  if (jsonMode) {
    // Just output what was detected, don't generate files
    console.log(JSON.stringify({
      appName, appType,
      appTypeName: APP_TYPES[appType]?.name,
      stack, features, skills,
      dirStructure: dirStructure.slice(0, 50),
    }, null, 2));
    return;
  }

  // Generate .arch/ files
  log.generate("Creating .arch/ directory...");
  const base = path.resolve(".arch");
  fs.mkdirSync(path.join(base, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(base, "skills"), { recursive: true });
  fs.mkdirSync(path.join(base, "apis"), { recursive: true });
  fs.mkdirSync(path.join(base, "lenses"), { recursive: true });

  const written = [];
  function writeFile(relPath, content) {
    const fullPath = path.join(base, relPath);
    fs.writeFileSync(fullPath, content);
    written.push({ path: relPath, size: content.length });
    log.generate(`Writing ${relPath}`);
  }

  writeFile("SYSTEM.md", genSystemMd(cfg));
  writeFile("INDEX.md", genIndexMd(cfg));
  writeFile("README.md", genReadme(cfg));
  writeFile("BOUNDARIES.md", genBoundariesMd(appType));
  writeFile("CONTEXT.compact.md", genCompactContext(cfg));
  writeFile("clusters/infra.graph", genInfraGraph(cfg));

  for (const f of features) {
    writeFile(`clusters/${f.id}.graph`, genGraph(f, cfg));
  }

  const events = genEventsGraph(cfg);
  if (events) writeFile("clusters/events.graph", events);

  for (const s of skills) {
    writeFile(`skills/${s}.skill`, genSkillFile(s));
  }

  log.ok(`Generated ${written.length} files in .arch/`);
  log.ok(`App: ${appName} | Type: ${APP_TYPES[appType]?.name} | ${features.length} features | ${skills.length} skills`);
  console.error("");
  console.error(`  Next: Review .arch/SYSTEM.md and fill in .arch/skills/*.skill with your team's gotchas.`);
  console.error(`  Run: archkit resolve warmup to verify the generated context.`);
  console.error("");
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main();
}
