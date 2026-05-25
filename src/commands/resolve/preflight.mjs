import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { loadFile, parseIndex } from "../../lib/parsers.mjs";
import * as log from "../../lib/logger.mjs";
import { archkitError } from "../../lib/errors.mjs";

// arch-poly dogfood: .arch/skills/<x>.skill files capture API quirks
// (e.g. Kalshi switching `yes_bid` to `yes_bid_dollars`) but never reach
// the agent's context unless something surfaces them. Preflight is the
// natural surface — it runs before any code change on a known feature.
//
// Match a skill to a feature when any of:
//   1. skill id == feature id (e.g. feature "kalshi" + skill "kalshi")
//   2. skill id appears as `$skill` in the feature's cluster graph
//   3. the skill's INDEX.md keywords match the feature id (loose substring)
function findRequiredSkills({ archDir, featureId, clusterId, index }) {
  const matches = new Set();
  const skillIds = Object.keys(index.skillFiles || {});

  // (1) direct id match
  if (skillIds.includes(featureId)) matches.add(featureId);

  // (2) cluster graph mentions
  if (clusterId) {
    const graphPath = path.join(archDir, "clusters", `${clusterId}.graph`);
    if (fs.existsSync(graphPath)) {
      const graph = fs.readFileSync(graphPath, "utf8");
      for (const sid of skillIds) {
        if (graph.includes(`$${sid}`)) matches.add(sid);
      }
    }
  }

  // (3) keyword → skill table mentions the feature id
  for (const [kw, sid] of Object.entries(index.keywordSkills || {})) {
    if (kw.includes(featureId) || featureId.includes(kw)) {
      if (skillIds.includes(sid)) matches.add(sid);
    }
  }

  // Resolve to paths relative to project root.
  // index.skillFiles values are typically already `.arch/skills/x.skill`.
  return [...matches].map((sid) => {
    const declared = index.skillFiles[sid];
    if (declared && declared.includes(".skill")) return declared;
    return `.arch/skills/${sid}.skill`;
  });
}

export function cmdPreflight(archDir, featureId, layer, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  log.resolve(`Preflight check: ${featureId}.${layer}`);
  const indexContent = loadFile(archDir, "INDEX.md");
  const index = parseIndex(indexContent);

  // 1. Look up feature in INDEX.md
  const nodeInfo = index.nodeCluster[featureId];
  if (!nodeInfo) {
    const valid = Object.keys(index.nodeCluster);
    return {
      error: "unknown_feature",
      feature: featureId,
      valid,
      nextStep: valid.length > 0
        ? `Re-call with one of the known feature ids: ${valid.slice(0, 5).join(", ")}${valid.length > 5 ? "…" : ""}.`
        : `INDEX.md has no node→cluster entries yet. Add the feature to .arch/INDEX.md under '## Nodes', or call archkit_resolve_scaffold to bootstrap.`,
    };
  }

  const basePath = nodeInfo.basePath || `src/features/${featureId}/`;
  const basePathNoTrailingSlash = basePath.replace(/\/+$/, "");

  // 2. Git data
  let gitAvailable = false;
  let recentCommits = [];
  let lastTouched = null;

  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "pipe" });
    gitAvailable = true;

    try {
      const logOutput = execFileSync(
        "git",
        ["log", "-5", "--format=%H%x09%ad%x09%an%x09%s", "--date=short", "--", basePathNoTrailingSlash],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      );

      const lines = logOutput.trim().split("\n").filter(Boolean);
      recentCommits = lines.map((line) => {
        const parts = line.split("\t");
        const hash = (parts[0] || "").slice(0, 7);
        const date = parts[1] || "";
        const author = parts[2] || "";
        const subject = parts[3] || "";
        return { hash, date, author, subject };
      });

      if (recentCommits.length > 0) {
        const first = recentCommits[0];
        const daysAgo = Math.floor((Date.now() - new Date(first.date).getTime()) / 86400000);
        lastTouched = {
          commit: first.hash,
          author: first.author,
          date: first.date,
          daysAgo,
        };
      }
    } catch (_) {
      // git log failed — leave recentCommits as empty array
    }
  } catch (_) {
    // Not a git repo — gitAvailable stays false
  }

  // 3. Pending gotchas
  const pendingGotchas = [];
  const proposalsDir = path.join(archDir, "gotcha-proposals");

  if (fs.existsSync(proposalsDir)) {
    const featureSkills = new Set(Object.keys(index.skillFiles));

    let files = [];
    try {
      files = fs.readdirSync(proposalsDir).filter((f) => f.endsWith(".json"));
    } catch (_) {}

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(proposalsDir, file), "utf8");
        const proposal = JSON.parse(raw);
        // Include if featureSkills is empty (no skills defined) OR skill matches
        if (featureSkills.size === 0 || featureSkills.has(proposal.skill)) {
          const hash = file.replace(/\.json$/, "");
          pendingGotchas.push({ hash, ...proposal });
        }
      } catch (_) {
        // skip malformed proposals
      }
    }
  }

  // 4. Drift findings scoped to basePath
  const driftFindings = [];

  for (const [nodeId, info] of Object.entries(index.nodeCluster)) {
    const nodePath = info.basePath || `src/features/${nodeId}/`;
    const paths = nodePath.split(",").map((p) => p.trim());
    const isMultiPath = paths.length > 1;

    // Only include nodes whose path(s) start with the requested basePath
    const relevantPaths = paths.filter((p) => {
      const normalized = p.replace(/\/+$/, "");
      return normalized.startsWith(basePathNoTrailingSlash) || nodeId === featureId;
    });

    if (relevantPaths.length === 0) continue;

    for (const p of relevantPaths) {
      const fullPath = path.resolve(cwd, p);
      if (!fs.existsSync(fullPath)) {
        driftFindings.push({
          type: isMultiPath ? "missing-file" : "missing-source",
          id: nodeId,
          detail: `INDEX.md says @${nodeId} → ${p} but it doesn't exist on disk`,
        });
      }
    }
  }

  // 5. Required reading — surface relevant skill files (arch-poly fix).
  // Differentiate "no skills exist in the project" from "skills exist but none
  // matched this feature" — silent-success was a v1.7 dead-end pattern.
  const skillCatalogSize = Object.keys(index.skillFiles || {}).length;
  const requiredReading = findRequiredSkills({
    archDir,
    featureId,
    clusterId: nodeInfo.cluster,
    index,
  });
  const requiredReadingNote =
    requiredReading.length > 0
      ? `Read the listed skill file(s) before generating code.`
      : skillCatalogSize === 0
        ? `No skill files in .arch/skills/ yet — consider adding ${featureId}.skill to capture API quirks and WRONG/RIGHT patterns for this feature.`
        : `Checked ${skillCatalogSize} skill file(s); none matched this feature by id, cluster-graph reference, or keyword. If a skill is relevant, link it by adding $${featureId} to .arch/clusters/${nodeInfo.cluster}.graph or a keyword entry to INDEX.md.`;

  // 6. Compute pass + next-step guidance
  const passWithoutAction = pendingGotchas.length === 0 && driftFindings.length === 0;
  const nextStep = !passWithoutAction
    ? `Resolve pending gotchas and drift findings before generating code. Drift first (structural), then triage gotcha proposals.`
    : requiredReading.length > 0
      ? `Read required-reading skill(s), then write code following their WRONG/RIGHT patterns.`
      : `Proceed with the change. Run \`archkit review --staged\` before committing.`;

  return {
    feature: featureId,
    layer,
    basePath,
    requiredReading,
    requiredReadingNote,
    skillCatalogSize,
    lastTouched,
    recentCommits,
    pendingGotchas,
    driftFindings,
    passWithoutAction,
    nextStep,
    gitAvailable,
  };
}

export async function runPreflightJson({ archDir, cwd = process.cwd(), feature, layer }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  if (!feature) throw archkitError("invalid_input", "feature is required", { suggestion: "Pass a feature name (e.g. 'auth')." });
  if (!layer) throw archkitError("invalid_input", "layer is required", { suggestion: "Pass a layer (controller/service/repo)." });

  return cmdPreflight(archDir, feature, layer, { cwd });
}
