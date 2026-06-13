#!/usr/bin/env node

/**
 * arch-prd — Detect, parse, and check Product Requirements Documents.
 *
 * Usage (CLI):
 *   archkit prd check [--path <prd-path>] [--json]
 *
 * Usage (MCP): archkit_prd_check tool with optional `prdPath`.
 *
 * Behavior:
 *   - Locates a PRD at common paths (PRD.md, docs/PRD.md, BRIEF.md, SPEC.md, etc.)
 *     unless `prdPath` is explicitly provided.
 *   - Runs a keyword heuristic to score archetype signals from the PRD body.
 *   - If `.arch/SYSTEM.md` exists, diffs the PRD's archetype signal against
 *     the system's declared archetype and surfaces mismatches as findings.
 *   - Returns the raw PRD content (path + relativePath only — body is read on
 *     demand by the calling agent) so the model can do deeper reasoning.
 *
 * Designed to be the first call inside `/archkit-init`: if a PRD exists, the
 * wizard uses its signals to pre-fill the archetype pick instead of asking
 * the user to describe their product from scratch.
 */

import fs from "node:fs";
import path from "node:path";
import { archkitError } from "../lib/errors.mjs";
import { isMainModule, C, ICONS as I } from "../lib/shared.mjs";

const PRD_CANDIDATES = [
  "PRD.md", "prd.md",
  "docs/PRD.md", "docs/prd.md",
  "docs/product-requirements.md",
  "BRIEF.md", "brief.md",
  "docs/BRIEF.md", "docs/brief.md",
  "SPEC.md", "spec.md",
  "docs/SPEC.md", "docs/spec.md",
  "REQUIREMENTS.md", "requirements.md",
  "docs/REQUIREMENTS.md", "docs/requirements.md",
];

// Keyword → archetype scoring table. Each entry is a regex (matched
// case-insensitive against the PRD body) plus the archetypes it counts toward.
// Multiple archetypes per keyword is fine — the score reflects density of
// signals, not exclusivity. A "dashboard" hit boosts saas, internal, AND data
// because the right answer is context-dependent.
const KEYWORD_TABLE = [
  // saas
  { kw: /\bmulti-?tenan(t|cy)\b/i, archetypes: ["saas"] },
  { kw: /\bsubscription(s)?\b/i, archetypes: ["saas"] },
  { kw: /\bsign[- ]?up\b/i, archetypes: ["saas"] },
  { kw: /\blog[- ]?in\b/i, archetypes: ["saas", "internal"] },
  { kw: /\bbilling\b/i, archetypes: ["saas", "ecommerce"] },
  { kw: /\bworkspace(s)?\b/i, archetypes: ["saas"] },
  { kw: /\borganization(s)?\b/i, archetypes: ["saas", "internal"] },
  { kw: /\bstripe\b/i, archetypes: ["saas", "ecommerce"] },
  { kw: /\bdashboard(s)?\b/i, archetypes: ["saas", "internal", "data"] },
  { kw: /\b(b2b|b2c)\b/i, archetypes: ["saas"] },

  // internal
  { kw: /\binternal tool(s)?\b/i, archetypes: ["internal"] },
  { kw: /\badmin( console| panel| tool| dashboard)?\b/i, archetypes: ["internal"] },
  { kw: /\b(ops|operations) (tool|console|dashboard)\b/i, archetypes: ["internal"] },
  { kw: /\bback[- ]?office\b/i, archetypes: ["internal"] },
  { kw: /\bemployee(s)?\b/i, archetypes: ["internal"] },
  { kw: /\b(corporate )?sso\b/i, archetypes: ["internal"] },
  { kw: /\bsaml\b/i, archetypes: ["internal"] },
  { kw: /\baudit log\b/i, archetypes: ["internal"] },

  // content
  { kw: /\bmarketing site\b/i, archetypes: ["content"] },
  { kw: /\bblog\b/i, archetypes: ["content"] },
  { kw: /\b(documentation|docs site)\b/i, archetypes: ["content"] },
  { kw: /\blanding page(s)?\b/i, archetypes: ["content"] },
  { kw: /\bbrochure( site)?\b/i, archetypes: ["content"] },
  { kw: /\b(seo|search engine optimization)\b/i, archetypes: ["content"] },
  { kw: /\bnewsletter\b/i, archetypes: ["content"] },
  { kw: /\bstatic site\b/i, archetypes: ["content"] },

  // ecommerce
  { kw: /\b(storefront|store)\b/i, archetypes: ["ecommerce"] },
  { kw: /\bcart\b/i, archetypes: ["ecommerce"] },
  { kw: /\bcheckout\b/i, archetypes: ["ecommerce"] },
  { kw: /\bproduct catalog\b/i, archetypes: ["ecommerce"] },
  { kw: /\binventory\b/i, archetypes: ["ecommerce"] },
  { kw: /\bshipping\b/i, archetypes: ["ecommerce"] },
  { kw: /\bfulfillment\b/i, archetypes: ["ecommerce"] },
  { kw: /\bshopify\b/i, archetypes: ["ecommerce"] },
  { kw: /\border(s)?\b/i, archetypes: ["ecommerce"] },

  // ai
  { kw: /\b(llm|large language model)\b/i, archetypes: ["ai"] },
  { kw: /\b(agent|agents|agentic)\b/i, archetypes: ["ai"] },
  { kw: /\bchatbot\b/i, archetypes: ["ai"] },
  { kw: /\brag\b/i, archetypes: ["ai"] },
  { kw: /\bretrieval[- ]augmented\b/i, archetypes: ["ai"] },
  { kw: /\bai[- ]powered\b/i, archetypes: ["ai"] },
  { kw: /\bgenerative ai\b/i, archetypes: ["ai"] },
  { kw: /\bembedding(s)?\b/i, archetypes: ["ai"] },
  { kw: /\b(openai|anthropic|claude|gemini|gpt-?4|gpt-?5)\b/i, archetypes: ["ai"] },
  { kw: /\bprompt engineering\b/i, archetypes: ["ai"] },

  // mobile
  { kw: /\b(ios|iphone|ipad)\b/i, archetypes: ["mobile"] },
  { kw: /\bandroid\b/i, archetypes: ["mobile"] },
  { kw: /\bapp store\b/i, archetypes: ["mobile"] },
  { kw: /\bplay store\b/i, archetypes: ["mobile"] },
  { kw: /\bmobile app\b/i, archetypes: ["mobile"] },
  { kw: /\b(react native|expo)\b/i, archetypes: ["mobile"] },
  { kw: /\bswift(ui)?\b/i, archetypes: ["mobile"] },
  { kw: /\bkotlin\b/i, archetypes: ["mobile"] },

  // realtime
  { kw: /\breal[- ]?time\b/i, archetypes: ["realtime"] },
  { kw: /\bcollaborative( editing)?\b/i, archetypes: ["realtime"] },
  { kw: /\bwebsocket(s)?\b/i, archetypes: ["realtime"] },
  { kw: /\b(live|presence)( cursor| indicator)?s?\b/i, archetypes: ["realtime"] },
  { kw: /\bmultiplayer\b/i, archetypes: ["realtime"] },
  { kw: /\b(chat|messaging) app\b/i, archetypes: ["realtime"] },
  { kw: /\bcrdt(s)?\b/i, archetypes: ["realtime"] },
  { kw: /\b(yjs|liveblocks|partykit|ably|pusher)\b/i, archetypes: ["realtime"] },

  // data
  { kw: /\b(data )?warehouse\b/i, archetypes: ["data"] },
  { kw: /\b(etl|elt)\b/i, archetypes: ["data"] },
  { kw: /\bpipeline(s)?\b/i, archetypes: ["data"] },
  { kw: /\b(business intelligence|bi)\b/i, archetypes: ["data"] },
  { kw: /\b(snowflake|bigquery|databricks)\b/i, archetypes: ["data"] },
  { kw: /\bdbt\b/i, archetypes: ["data"] },
  { kw: /\b(airflow|dagster|prefect)\b/i, archetypes: ["data"] },
  { kw: /\b(metabase|superset|looker)\b/i, archetypes: ["data"] },
  { kw: /\banalytics product\b/i, archetypes: ["data"] },
];

// Deployment-mode signals — looser than archetype, just looks for explicit
// language pointing one way or the other. Many PRDs say nothing about this.
const MODE_TABLE = [
  { kw: /\bself[- ]?host(ed|ing)?\b/i, mode: "selfHosted" },
  { kw: /\bon[- ]?prem(ise)?(s)?\b/i, mode: "selfHosted" },
  { kw: /\bdata residency\b/i, mode: "selfHosted" },
  { kw: /\bdata sovereignty\b/i, mode: "selfHosted" },
  { kw: /\bk(ubernete)?(8s|s)\b/i, mode: "selfHosted" },
  { kw: /\bhetzner\b/i, mode: "selfHosted" },

  { kw: /\bvercel\b/i, mode: "managed" },
  { kw: /\bnetlify\b/i, mode: "managed" },
  { kw: /\bsupabase\b/i, mode: "managed" },
  { kw: /\bneon\b/i, mode: "managed" },
  { kw: /\bclerk\b/i, mode: "managed" },
  { kw: /\bcloudflare( pages| workers)?\b/i, mode: "managed" },
];

function findPrd({ cwd, prdPath }) {
  if (prdPath) {
    const abs = path.isAbsolute(prdPath) ? prdPath : path.join(cwd, prdPath);
    return fs.existsSync(abs) ? abs : null;
  }
  for (const candidate of PRD_CANDIDATES) {
    const abs = path.join(cwd, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function scoreSignals(content) {
  const archetypeScores = {};
  const matches = {};

  for (const { kw, archetypes } of KEYWORD_TABLE) {
    const found = content.match(kw);
    if (!found) continue;
    for (const archetype of archetypes) {
      archetypeScores[archetype] = (archetypeScores[archetype] || 0) + 1;
      if (!matches[archetype]) matches[archetype] = new Set();
      matches[archetype].add(found[0].toLowerCase());
    }
  }

  const archetypeRanking = Object.entries(archetypeScores)
    .map(([archetype, score]) => ({
      archetype,
      score,
      matchedKeywords: [...(matches[archetype] || [])].sort(),
    }))
    .sort((a, b) => b.score - a.score);

  let mode = null;
  let modeMatches = [];
  const modeCounts = { managed: 0, selfHosted: 0 };
  for (const { kw, mode: m } of MODE_TABLE) {
    const found = content.match(kw);
    if (!found) continue;
    modeCounts[m] += 1;
    modeMatches.push({ mode: m, keyword: found[0].toLowerCase() });
  }
  if (modeCounts.selfHosted > modeCounts.managed) mode = "selfHosted";
  else if (modeCounts.managed > modeCounts.selfHosted) mode = "managed";

  return {
    archetypeRanking,
    deploymentMode: mode,
    deploymentModeMatches: modeMatches,
  };
}

function extractDeclaredArchetypeFromSystem(systemPath) {
  if (!fs.existsSync(systemPath)) return null;
  const content = fs.readFileSync(systemPath, "utf8");
  // Look for "## Type:" line — matches the wizard's SYSTEM.md template
  const typeMatch = content.match(/^##\s*Type:\s*(.+)$/im);
  if (!typeMatch) return null;
  const typeLine = typeMatch[1].trim().toLowerCase();
  const knownArchetypes = ["saas", "internal", "content", "ecommerce", "ai", "mobile", "realtime", "data"];
  for (const a of knownArchetypes) {
    if (typeLine.includes(a)) return a;
  }
  return null;
}

function extractDeclaredModeFromSystem(systemPath) {
  if (!fs.existsSync(systemPath)) return null;
  const content = fs.readFileSync(systemPath, "utf8");
  const modeMatch = content.match(/^##\s*Mode:\s*(.+)$/im);
  if (!modeMatch) return null;
  const m = modeMatch[1].trim().toLowerCase();
  if (m.includes("self")) return "selfHosted";
  if (m.includes("managed")) return "managed";
  return null;
}

function buildFindings({ signals, declaredArchetype, declaredMode }) {
  const findings = [];

  if (signals.archetypeRanking.length > 0 && declaredArchetype) {
    const top = signals.archetypeRanking[0];
    if (top.archetype !== declaredArchetype) {
      findings.push({
        severity: "warning",
        type: "archetype_mismatch",
        message: `PRD signals point to '${top.archetype}' (${top.score} matches) but SYSTEM.md declares '${declaredArchetype}'.`,
        suggestion: `Re-run /archkit-init with archetype=${top.archetype}, OR clarify the PRD if the system is intentionally different (e.g. you're building tooling for a ${top.archetype} product but the tool itself is ${declaredArchetype}).`,
      });
    }
  }

  if (signals.deploymentMode && declaredMode && signals.deploymentMode !== declaredMode) {
    findings.push({
      severity: "info",
      type: "mode_mismatch",
      message: `PRD signals point to '${signals.deploymentMode}' deployment but SYSTEM.md declares '${declaredMode}'.`,
      suggestion: "If this is intentional (e.g. PRD mentions Vercel as an example, not a requirement), no action needed. Otherwise re-run /archkit-init.",
    });
  }

  if (signals.archetypeRanking.length === 0) {
    findings.push({
      severity: "info",
      type: "low_signal",
      message: "PRD did not match any archetype keywords clearly. The product shape may need to be made more explicit.",
      suggestion: "Add a one-paragraph product summary to the PRD that names the shape (web app, mobile app, content site, ecommerce store, etc.) and the primary user.",
    });
  }

  return findings;
}

// ── MCP-friendly runner ───────────────────────────────────────────────────

export async function runPrdCheckJson({ archDir, cwd, prdPath }) {
  const workingDir = cwd || process.cwd();
  const absPrd = findPrd({ cwd: workingDir, prdPath });

  if (!absPrd) {
    return {
      prdFound: false,
      searchedPaths: prdPath ? [prdPath] : PRD_CANDIDATES,
      suggestion: prdPath
        ? `No PRD found at ${prdPath}.`
        : `No PRD found at any common location. If you have one, point at it: archkit prd check --path <path>. Common locations searched: ${PRD_CANDIDATES.slice(0, 5).join(", ")}, ...`,
      nextStep: prdPath
        ? `Verify the path is correct, or call again without prdPath to scan common locations.`
        : `Ask the user where the PRD lives, then re-call with prdPath. Or proceed without one — archkit_init still works with no PRD.`,
    };
  }

  const content = fs.readFileSync(absPrd, "utf8");
  const signals = scoreSignals(content);

  let declaredArchetype = null;
  let declaredMode = null;
  let findings = [];
  if (archDir) {
    const systemPath = path.join(archDir, "SYSTEM.md");
    declaredArchetype = extractDeclaredArchetypeFromSystem(systemPath);
    declaredMode = extractDeclaredModeFromSystem(systemPath);
    findings = buildFindings({ signals, declaredArchetype, declaredMode });
  }

  const recommendedArchetype = signals.archetypeRanking[0]?.archetype || null;

  const mismatch = findings.find(f => f.type === "archetype_mismatch");
  const nextStep = !archDir
    ? recommendedArchetype
      ? `Call archkit_init to scaffold .arch/; surface '${recommendedArchetype}' as the recommended archetype in step 1.`
      : `Call archkit_init to start the wizard; PRD signal is weak so ask the user to confirm archetype.`
    : mismatch
      ? `Reconcile the archetype mismatch: either re-run /archkit-init with the PRD's recommended archetype, or update PRD wording so signals match the declared system.`
      : `PRD aligns with SYSTEM.md. No action needed.`;

  return {
    prdFound: true,
    prdPath: absPrd,
    prdRelativePath: path.relative(workingDir, absPrd),
    prdByteSize: content.length,
    signals: {
      archetypes: signals.archetypeRanking,
      deploymentMode: signals.deploymentMode,
      deploymentModeMatches: signals.deploymentModeMatches,
    },
    recommendedArchetype,
    declaredArchetype,
    declaredMode,
    findings,
    nextStep,
  };
}

// ── CLI mode ──────────────────────────────────────────────────────────────

function findArchDir(start) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, ".arch");
    if (fs.existsSync(path.join(candidate, "SYSTEM.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function cliMode(args) {
  const sub = args[0];
  const jsonMode = args.includes("--json");

  if (sub !== "check") {
    if (jsonMode) {
      console.log(JSON.stringify({ error: "Usage: archkit prd check [--path <prd-path>] [--json]" }));
    } else {
      console.log(`${C.yellow}  Usage:${C.reset}`);
      console.log(`${C.gray}    archkit prd check [--path <prd-path>] [--json]${C.reset}`);
      console.log("");
      console.log(`${C.yellow}  Behavior:${C.reset}`);
      console.log(`${C.gray}    Detects a PRD at common paths (PRD.md, docs/PRD.md, BRIEF.md, etc.).${C.reset}`);
      console.log(`${C.gray}    Scores archetype signals from the PRD body.${C.reset}`);
      console.log(`${C.gray}    Diffs against .arch/SYSTEM.md if present.${C.reset}`);
      console.log("");
    }
    process.exit(sub ? 1 : 0);
  }

  const cwd = process.cwd();
  const archDir = findArchDir(cwd);

  let prdPath;
  const pathIdx = args.indexOf("--path");
  if (pathIdx !== -1 && args[pathIdx + 1]) prdPath = args[pathIdx + 1];

  try {
    const result = await runPrdCheckJson({ archDir, cwd, prdPath });
    if (jsonMode) {
      console.log(JSON.stringify(result));
      return;
    }

    if (!result.prdFound) {
      console.log(`${C.gray}  No PRD found.${C.reset}`);
      console.log(`${C.gray}  ${result.suggestion}${C.reset}`);
      return;
    }

    console.log(`${C.green}  ${I.check} PRD: ${result.prdRelativePath} (${result.prdByteSize} bytes)${C.reset}`);
    if (result.signals.archetypes.length === 0) {
      console.log(`${C.yellow}  No archetype signals matched.${C.reset}`);
    } else {
      console.log(`${C.cyan}  Archetype ranking:${C.reset}`);
      for (const a of result.signals.archetypes.slice(0, 3)) {
        console.log(`${C.gray}    ${a.archetype.padEnd(10)} score=${a.score}  matches: ${a.matchedKeywords.slice(0, 4).join(", ")}${a.matchedKeywords.length > 4 ? "..." : ""}${C.reset}`);
      }
      console.log(`${C.cyan}  Recommended archetype: ${C.bold}${result.recommendedArchetype}${C.reset}`);
    }
    if (result.signals.deploymentMode) {
      console.log(`${C.cyan}  Deployment mode signal: ${result.signals.deploymentMode}${C.reset}`);
    }
    if (result.findings.length > 0) {
      console.log(`${C.yellow}  ${result.findings.length} finding(s):${C.reset}`);
      for (const f of result.findings) {
        console.log(`${C.gray}    [${f.severity}] ${f.message}${C.reset}`);
        if (f.suggestion) console.log(`${C.gray}      → ${f.suggestion}${C.reset}`);
      }
    }
  } catch (err) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: err.message, code: err.code, suggestion: err.suggestion }));
    } else {
      console.log(`${C.red}  ${I.warn} ${err.message}${C.reset}`);
      if (err.suggestion) console.log(`${C.gray}  ${err.suggestion}${C.reset}`);
    }
    process.exit(1);
  }
}

export { cliMode as main };

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  cliMode(args).catch(err => {
    console.error(`${C.red}  Error: ${err.message}${C.reset}`);
    process.exit(1);
  });
}
