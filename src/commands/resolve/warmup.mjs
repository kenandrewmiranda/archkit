import fs from "fs";
import path from "path";
import { loadFile, parseSystem, parseIndex } from "../../lib/parsers.mjs";
import * as log from "../../lib/logger.mjs";

export function cmdWarmup(archDir, deep) {
  log.resolve("Running warmup checks...");
  const checks = [];
  let pass = true;
  const blockers = [];
  const warnings = [];
  const actions = [];

  // ── HARD GATES (fail = cannot proceed) ────────────────────────────────

  log.resolve("Checking core files...");
  // 1. Core files exist
  const systemContent = loadFile(archDir, "SYSTEM.md");
  if (systemContent) {
    checks.push({ id: "W001", check: "SYSTEM.md exists", status: "pass" });
  } else {
    checks.push({ id: "W001", check: "SYSTEM.md exists", status: "fail", detail: "Run archkit to scaffold" });
    blockers.push("SYSTEM.md missing — no rules loaded. Run archkit");
    pass = false;
  }

  const indexContent = loadFile(archDir, "INDEX.md");
  if (indexContent) {
    checks.push({ id: "W002", check: "INDEX.md exists", status: "pass" });
  } else {
    checks.push({ id: "W002", check: "INDEX.md exists", status: "fail", detail: "Run archkit to scaffold" });
    blockers.push("INDEX.md missing — no context routing. Run archkit");
    pass = false;
  }

  // 2. At least one graph cluster exists
  const clustersDir = path.join(archDir, "clusters");
  const graphFiles = fs.existsSync(clustersDir)
    ? fs.readdirSync(clustersDir).filter(f => f.endsWith(".graph"))
    : [];
  if (graphFiles.length > 0) {
    checks.push({ id: "W003", check: "Graph clusters exist", status: "pass", detail: `${graphFiles.length} clusters` });
  } else {
    checks.push({ id: "W003", check: "Graph clusters exist", status: "fail", detail: "No .graph files. Architecture unknown." });
    blockers.push("No graph clusters — architecture context missing. Run archkit");
    pass = false;
  }

  // 3. SYSTEM.md has rules (not just a skeleton)
  if (systemContent) {
    const system = parseSystem(systemContent);
    if (system.rules.length > 0) {
      checks.push({ id: "W004", check: "SYSTEM.md has rules", status: "pass", detail: `${system.rules.length} rules` });
    } else {
      checks.push({ id: "W004", check: "SYSTEM.md has rules", status: "fail", detail: "SYSTEM.md exists but has no rules" });
      blockers.push("SYSTEM.md has no rules — the agent has no constraints. Add rules before coding.");
      pass = false;
    }

    if (Object.keys(system.reservedWords).length > 0) {
      checks.push({ id: "W005", check: "Reserved words defined", status: "pass", detail: `${Object.keys(system.reservedWords).length} words` });
    } else {
      checks.push({ id: "W005", check: "Reserved words defined", status: "warn", detail: "No reserved words — agent may use inconsistent terminology" });
      warnings.push("No reserved words defined. Consider adding $db, $auth, $err etc.");
    }
  }

  // ── QUALITY CHECKS (warn = proceed with caution) ──────────────────────

  log.resolve("Checking skill freshness...");
  // 4. Skill freshness
  const skillsDir = path.join(archDir, "skills");
  const skillFiles = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))
    : [];

  let staleSkills = [];
  let emptySkills = [];
  let pendingGotchas = [];
  let totalGotchas = 0;

  for (const file of skillFiles) {
    const content = fs.readFileSync(path.join(skillsDir, file), "utf8");
    const id = file.replace(".skill", "");

    // Check staleness
    const updatedMatch = content.match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m);
    if (updatedMatch && !updatedMatch[1].includes("[")) {
      const updatedDate = new Date(updatedMatch[1]);
      const daysSince = Math.floor((Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince > 90) staleSkills.push({ id, daysSince });
    }

    // Check emptiness (still a skeleton)
    const hasRealGotchas = (content.match(/^WRONG:/gm) || []).length - (content.match(/^WRONG: \[/gm) || []).length;
    if (hasRealGotchas > 0) {
      totalGotchas += hasRealGotchas;
    }
    const isPlaceholder = content.includes("[PACKAGE_NAME]") || content.includes("[How YOUR");
    if (isPlaceholder) emptySkills.push(id);

    // Check for TODO-GOTCHAs
    const todoCount = (content.match(/^# TODO-GOTCHA:/gm) || []).length;
    if (todoCount > 0) pendingGotchas.push({ id, count: todoCount });
  }

  if (skillFiles.length > 0) {
    checks.push({ id: "W006", check: "Skills present", status: "pass", detail: `${skillFiles.length} skills, ${totalGotchas} gotchas` });
  } else {
    checks.push({ id: "W006", check: "Skills present", status: "warn", detail: "No skill files — AI will use training data defaults" });
    warnings.push("No skills loaded. AI will guess at package patterns. Run archkit to generate skill skeletons.");
  }

  if (emptySkills.length > 0) {
    checks.push({ id: "W007", check: "Empty/skeleton skills", status: "warn", detail: `${emptySkills.length}: ${emptySkills.slice(0, 5).join(", ")}${emptySkills.length > 5 ? "..." : ""}` });
    warnings.push(`${emptySkills.length} skill(s) are still skeletons. Fill with WRONG/RIGHT/WHY as you discover gotchas: ${emptySkills.slice(0, 3).join(", ")}`);
    actions.push(`Fill empty skills: archkit gotcha --interactive`);
  }

  if (staleSkills.length > 0) {
    checks.push({ id: "W008", check: "Stale skills (>90 days)", status: "warn", detail: staleSkills.map(s => `${s.id}(${s.daysSince}d)`).join(", ") });
    warnings.push(`${staleSkills.length} skill(s) haven't been updated in 90+ days: ${staleSkills.map(s => s.id).join(", ")}. Check for package updates.`);
    actions.push(`Review stale skills: ${staleSkills.map(s => s.id).join(", ")}`);
  }

  if (pendingGotchas.length > 0) {
    checks.push({ id: "W009", check: "Pending TODO-GOTCHAs", status: "warn", detail: pendingGotchas.map(p => `${p.id}(${p.count})`).join(", ") });
    warnings.push(`${pendingGotchas.reduce((s, p) => s + p.count, 0)} unresolved TODO-GOTCHA(s) in: ${pendingGotchas.map(p => p.id).join(", ")}. Convert to WRONG/RIGHT/WHY format.`);
    actions.push("Run archkit gotcha -i to convert TODO-GOTCHAs to real gotchas");
  }

  // 5. INDEX.md cross-references
  if (indexContent) {
    const index = parseIndex(indexContent);
    if (index.crossRefs.length === 0 && Object.keys(index.nodeCluster).length > 1) {
      checks.push({ id: "W010", check: "INDEX.md cross-references", status: "warn", detail: "No cross-refs defined between features" });
      warnings.push("INDEX.md has no cross-references. Feature dependencies are unmapped.");
    } else if (index.crossRefs.length > 0) {
      checks.push({ id: "W010", check: "INDEX.md cross-references", status: "pass", detail: `${index.crossRefs.length} refs` });
    }
  }

  // ── DEEP MODE CHECKS (--deep flag) ────────────────────────────────────

  if (deep) {
    log.resolve("Running deep validation...");
    // 6. Check package.json deps against skills
    const pkgJsonPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        const allDeps = Object.keys({ ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) });
        const skillIds = skillFiles.map(f => f.replace(".skill", ""));

        // Major packages that should have skills
        const importantPkgs = allDeps.filter(d => {
          const name = d.toLowerCase();
          return ["prisma", "stripe", "keycloak", "redis", "ioredis", "bullmq", "meilisearch",
            "opensearch", "clickhouse", "pg", "drizzle", "next", "express", "hono", "fastify",
            "openai", "anthropic", "@langchain"].some(p => name.includes(p));
        });

        const uncoveredPkgs = importantPkgs.filter(pkg => {
          const pkgName = pkg.toLowerCase().replace("@", "").replace("/", "-");
          return !skillIds.some(s => pkgName.includes(s) || s.includes(pkgName.split("-")[0]));
        });

        if (uncoveredPkgs.length > 0) {
          checks.push({ id: "W011", check: "Dependencies without skills", status: "warn", detail: uncoveredPkgs.join(", ") });
          warnings.push(`${uncoveredPkgs.length} important package(s) have no .skill file: ${uncoveredPkgs.join(", ")}`);
          actions.push(`Create skills for: ${uncoveredPkgs.join(", ")} using archkit extend run add-skill <name>`);
        } else {
          checks.push({ id: "W011", check: "Dependencies covered by skills", status: "pass", detail: `${importantPkgs.length} major deps all have skills` });
        }
      } catch {
        checks.push({ id: "W011", check: "package.json readable", status: "warn", detail: "Could not parse package.json" });
      }
    }

    // 7. API file staleness
    const apisDir = path.join(archDir, "apis");
    if (fs.existsSync(apisDir)) {
      const apiFiles = fs.readdirSync(apisDir).filter(f => f.endsWith(".api"));
      const stubApis = [];
      for (const file of apiFiles) {
        const content = fs.readFileSync(path.join(apisDir, file), "utf8");
        if (content.includes("[VERSION]") || content.includes("[BASE_URL]")) {
          stubApis.push(file.replace(".api", ""));
        }
      }
      if (stubApis.length > 0) {
        checks.push({ id: "W012", check: "API contract stubs", status: "warn", detail: `${stubApis.length} unpopulated: ${stubApis.join(", ")}` });
        warnings.push(`${stubApis.length} .api file(s) are still stubs. AI will use training data for these APIs instead of actual contracts.`);
        actions.push(`Populate API contracts: ${stubApis.join(", ")}. Generate from OpenAPI specs or SDK types.`);
      } else if (apiFiles.length > 0) {
        checks.push({ id: "W012", check: "API contracts populated", status: "pass", detail: `${apiFiles.length} contracts` });
      }
    }

    // 8. Extension validation
    const extDir = path.join(archDir, "extensions");
    if (fs.existsSync(extDir)) {
      const regPath = path.join(extDir, "registry.json");
      if (fs.existsSync(regPath)) {
        try {
          const registry = JSON.parse(fs.readFileSync(regPath, "utf8"));
          const orphaned = registry.filter(e => !fs.existsSync(path.join(extDir, e.file)));
          if (orphaned.length > 0) {
            checks.push({ id: "W013", check: "Extension registry integrity", status: "warn", detail: `${orphaned.length} orphaned entries` });
            warnings.push(`${orphaned.length} extension(s) registered but file missing. Run archkit guard enforce`);
          } else {
            checks.push({ id: "W013", check: "Extension registry integrity", status: "pass", detail: `${registry.length} extensions valid` });
          }
        } catch {
          checks.push({ id: "W013", check: "Extension registry", status: "warn", detail: "Could not parse registry.json" });
        }
      }
    }
  }

  // ── ASSEMBLE RESULT ───────────────────────────────────────────────────

  // Summary stats for the agent
  const graphCount = graphFiles.length;
  const nodeCount = graphFiles.reduce((sum, f) => {
    const content = fs.readFileSync(path.join(clustersDir, f), "utf8");
    return sum + (content.match(/\[.+\]\s+:/g) || []).length;
  }, 0);

  if (pass) {
    log.ok("Warmup passed — ready for code generation");
  } else {
    log.error("Warmup FAILED — fix blockers before proceeding");
  }

  return {
    pass,
    mode: deep ? "deep" : "quick",
    timestamp: new Date().toISOString(),
    summary: {
      graphs: graphCount,
      nodes: nodeCount,
      skills: skillFiles.length,
      gotchas: totalGotchas,
      emptySkills: emptySkills.length,
      staleSkills: staleSkills.length,
      pendingTodoGotchas: pendingGotchas.reduce((s, p) => s + p.count, 0),
    },
    blockers,
    warnings,
    actions,
    checks,
    instruction: pass
      ? "Warmup PASSED. You may proceed with code generation. Load the appropriate lens (research/implement/review) for your current task."
      : "Warmup FAILED. DO NOT generate code. Fix the blockers listed above first.",
    marketplace: {
      hint: emptySkills.length > 0 || totalGotchas < 20
        ? `Enhance your setup: archkit search "<relevant-package>" — community skill packs with 106+ gotchas at market.thearchkit.com`
        : null,
      emptySkillPacks: emptySkills.map(id => `archkit install archkit-${id}-gotchas`),
    },
  };
}
