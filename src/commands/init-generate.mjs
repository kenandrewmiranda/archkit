// src/commands/init-generate.mjs
//
// Runner for the archkit_init_generate MCP tool — the GENERATE half of the
// greenfield flow. Where archkit_init only INSTRUCTS (returns wizard prose for
// the agent to follow), this tool ACTS: it takes structured answers the LLM has
// chosen (archetype, stack, app name, features, skills) and drives the shared
// scaffold-generation core (src/wizard/scaffold-core.mjs) to write the .arch/
// scaffold — the same core the interactive inquirer wizard now wraps.
//
// Flow: agent calls archkit_init (reads wizardInstructions + archetype
// skeletons + PRD signal) → decides the answers in conversation with the user →
// calls archkit_init_generate with those answers → scaffold is written.

import fs from "node:fs";
import path from "node:path";
import { generateScaffold } from "../wizard/scaffold-core.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";
import { archkitError } from "../lib/errors.mjs";

/**
 * Generate the .arch/ scaffold from structured answers.
 *
 * @param {object} params
 * @param {string} params.cwd                Project root (process.cwd() in the MCP layer).
 * @param {string|null} [params.archDir]     Existing .arch/ dir if any (re-init guard).
 * @param {object} params.answers            Structured wizard answers.
 * @param {boolean} [params.overwrite]       Allow generating over an existing .arch/.
 */
export async function runInitGenerateJson({ cwd, archDir, answers, overwrite } = {}) {
  const workingDir = cwd || process.cwd();

  if (!answers || typeof answers !== "object") {
    throw archkitError("missing_answers", "answers object is required", {
      suggestion: `Call archkit_init first to learn the archetypes, then pass { appName, appType, stack?, features?, skills? } to archkit_init_generate. Valid appType values: ${Object.keys(APP_TYPES).join(", ")}.`,
    });
  }

  // Re-init guard: refuse to clobber an existing .arch/ unless overwrite is set.
  // (archDir is the resolved existing dir from the MCP layer; fall back to a
  // direct check against the working dir's outDir.)
  const outDir = answers.outDir || ".arch";
  const targetArch = path.isAbsolute(outDir) ? outDir : path.resolve(workingDir, outDir);
  const archExists = !!archDir || fs.existsSync(path.join(targetArch, "SYSTEM.md"));
  if (archExists && !overwrite) {
    throw archkitError("arch_dir_exists", `An .arch/ scaffold already exists at ${targetArch}`, {
      suggestion: "This project is already initialized. Pass overwrite:true to regenerate (destructive — overwrites SYSTEM.md/INDEX.md/clusters), or edit the existing .arch/ files instead.",
    });
  }

  let result;
  try {
    result = generateScaffold(answers, { projectRoot: workingDir });
  } catch (err) {
    // normalizeAnswers() throws Errors with a `.code` for invalid input —
    // translate those into structured MCP error envelopes. The envelope only
    // carries `suggestion`, so fold valid/invalid lists into that string.
    if (err && err.code) {
      let suggestion;
      if (err.code === "invalid_app_type") {
        suggestion = `Pass one of: ${Object.keys(APP_TYPES).join(", ")}.`;
      } else if (err.code === "invalid_skills") {
        suggestion = `Unknown skill id(s): ${(err.invalid || []).join(", ")}. Valid skills: ${SKILL_CATALOG.map(s => s.id).join(", ")}.`;
      } else if (err.code === "missing_app_name") {
        suggestion = "Provide answers.appName — the project/app name shown in generated files.";
      } else if (err.code === "no_features") {
        suggestion = "Provide answers.features (array of {id,name,keywords}) or omit it to use the archetype's suggested features.";
      }
      throw archkitError(err.code, err.message, { suggestion });
    }
    throw err;
  }

  const { archDir: writtenArchDir, written, cfg, claudeMode, claudeMdRenamed } = result;
  const relArch = path.relative(workingDir, writtenArchDir) || outDir;

  return {
    ok: true,
    archDir: relArch,
    appName: cfg.appName,
    appType: cfg.appType,
    appTypeName: APP_TYPES[cfg.appType]?.name,
    features: cfg.features.map(f => f.id),
    skills: cfg.skills,
    ...(cfg.skills.length === 0
      ? { skillsNote: "No package skills scaffolded — pass skills:[...] (e.g. \"postgres\", \"stripe\") to generate .skill stubs, or add them later as you adopt packages." }
      : {}),
    claudeMode,
    claudeMdRenamed,
    filesWritten: written.length,
    written: written.map(w => w.path),
    nextStep: `Scaffold generated (${written.length} files) under ${relArch}/. ${claudeMdRenamed ? "CLAUDE.md already existed — wrote CLAUDE.archkit.md to merge by hand. " : ""}Run archkit_resolve_warmup to verify the new context, then archkit_log_decision to record the foundation ADR (archetype, stack, why). Fill in .arch/skills/*.skill with real WRONG/RIGHT/WHY gotchas as you discover them.`,
  };
}
