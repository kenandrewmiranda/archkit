// src/commands/init-mcp.mjs
//
// Runner for the archkit_init MCP tool — the canonical greenfield setup
// entry point. Returns everything the agent needs to drive the wizard
// conversation in one tool call:
//   - wizardInstructions: full SKILL.md content (the wizard prose)
//   - skeletonsDir + skeletonsIndex: absolute path + parsed frontmatter for all 9 archetypes
//   - prdSignal: result of an internal archkit_prd_check call (if a PRD exists)
//   - hasExistingArchDir: re-init / augment hint
//   - currentDate, archkitVersion: ambient metadata
//
// This tool exists because v1.5.0–v1.5.3 tried to solve wizard discovery
// via SessionStart hook prose and SKILL.md headers — none of which removed
// the underlying problem that there was no MCP entry point matching the
// "set up X" intent. v1.5.4 fixes the architecture: the agent's natural
// instinct ("look for an init tool") now resolves to a real tool.
//
// Note: this file is the MCP runner. The legacy reverse-engineering CLI
// scaffolder lives at src/commands/init.mjs and is a different concern.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archkitError } from "../lib/errors.mjs";
import { runPrdCheckJson } from "./prd.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the archkit package root from this file's location.
// src/commands/init-mcp.mjs → ../../
function pkgRoot() {
  return path.resolve(__dirname, "..", "..");
}

function skillPath() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return path.join(process.env.CLAUDE_PLUGIN_ROOT, "skills", "archkit-init", "SKILL.md");
  }
  return path.join(pkgRoot(), "skills", "archkit-init", "SKILL.md");
}

function skeletonsDir() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return path.join(process.env.CLAUDE_PLUGIN_ROOT, "skills", "archkit-init", "skeletons");
  }
  return path.join(pkgRoot(), "skills", "archkit-init", "skeletons");
}

function archkitVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot(), "package.json"), "utf8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

// Minimal YAML frontmatter extractor — pulls top-level scalars we need for
// the skeleton index (archetype, displayName, description). Sufficient for
// the well-structured frontmatter the skeletons ship with; not a general
// YAML parser.
function parseSkeletonFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];

  const id = yaml.match(/^archetype:\s*(\S+)\s*$/m)?.[1];
  const displayName = yaml.match(/^displayName:\s*(.+)$/m)?.[1]?.trim();
  // description may use a folded scalar (`>` or just be on the same line)
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();

  return { id, displayName, description };
}

function buildSkeletonsIndex(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const filepath = path.join(dir, file);
    const content = fs.readFileSync(filepath, "utf8");
    const fm = parseSkeletonFrontmatter(content);
    if (!fm || !fm.id) continue;
    entries.push({
      id: fm.id,
      file,
      displayName: fm.displayName || fm.id,
      description: fm.description || "",
      absolutePath: filepath,
    });
  }
  // Stable order matching the design doc's authoring sequence
  const order = ["saas", "internal", "content", "ecommerce", "ai", "mobile", "realtime", "data", "_generic"];
  entries.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return entries;
}

export async function runInitJson({ cwd, archDir } = {}) {
  const workingDir = cwd || process.cwd();

  const sp = skillPath();
  if (!fs.existsSync(sp)) {
    throw archkitError("install_incomplete", `Wizard SKILL.md not found at ${sp}`, {
      suggestion: "archkit install may be incomplete. Reinstall via `npm install -g archkit` (npm path) or reinstall the plugin.",
    });
  }

  const wizardInstructions = fs.readFileSync(sp, "utf8");
  const skDir = skeletonsDir();
  const skeletonsIndex = buildSkeletonsIndex(skDir);

  // Run the PRD check internally so the agent gets PRD signal in the same response.
  // archDir is intentionally optional — PRD check works on bare projects.
  let prdSignal;
  try {
    prdSignal = await runPrdCheckJson({ archDir, cwd: workingDir });
  } catch (err) {
    // Don't fail the whole init call on PRD check error — return a stub.
    prdSignal = { prdFound: false, error: err.message };
  }

  const hasExistingArchDir = !!archDir;
  const nextStepHint = hasExistingArchDir
    ? "An .arch/ directory already exists in this project. Before doing anything else, ask the user whether they want to RE-INIT (overwrite, requires explicit confirmation), AUGMENT (skip files that already exist), or CANCEL. Then proceed per the wizardInstructions."
    : (prdSignal.prdFound
      ? `Greenfield setup. A PRD was detected at ${prdSignal.prdRelativePath}. Recommended archetype from PRD scan: ${prdSignal.recommendedArchetype || "(low signal — no clear match)"}. Recommended deployment mode: ${prdSignal.signals?.deploymentMode || "(not specified — ask user)"}. Proceed per the wizardInstructions: surface this PRD recommendation in Step 1 (archetype pick) as the suggested default, then walk the user through the rest of the wizard.`
      : "Greenfield setup, no PRD detected. Proceed per the wizardInstructions starting at Step 0 (PRD check — already done, returned empty) then Step 1 (archetype pick — ask user to describe the product).");

  return {
    archkitVersion: archkitVersion(),
    currentDate: new Date().toISOString().slice(0, 10),
    hasExistingArchDir,
    skeletonsDir: skDir,
    skeletonsIndex,
    prdSignal,
    wizardInstructions,
    nextStep: nextStepHint,
  };
}
