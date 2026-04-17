import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { loadFile, parseIndex } from "../../lib/parsers.mjs";
import * as log from "../../lib/logger.mjs";

export function cmdPreflight(archDir, featureId, layer) {
  log.resolve(`Preflight check: ${featureId}.${layer}`);
  const indexContent = loadFile(archDir, "INDEX.md");
  const index = parseIndex(indexContent);

  // 1. Look up feature in INDEX.md
  const nodeInfo = index.nodeCluster[featureId];
  if (!nodeInfo) {
    return {
      error: "unknown_feature",
      feature: featureId,
      valid: Object.keys(index.nodeCluster),
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
      const fullPath = path.resolve(process.cwd(), p);
      if (!fs.existsSync(fullPath)) {
        driftFindings.push({
          type: isMultiPath ? "missing-file" : "missing-source",
          id: nodeId,
          detail: `INDEX.md says @${nodeId} → ${p} but it doesn't exist on disk`,
        });
      }
    }
  }

  // 5. Compute pass
  const passWithoutAction = pendingGotchas.length === 0 && driftFindings.length === 0;

  return {
    feature: featureId,
    layer,
    basePath,
    lastTouched,
    recentCommits,
    pendingGotchas,
    driftFindings,
    passWithoutAction,
    gitAvailable,
  };
}
