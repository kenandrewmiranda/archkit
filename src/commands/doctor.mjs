#!/usr/bin/env node
// archkit doctor — workflow logistic gauge (v1.8 work item C).
//
// Aggregates warmup + drift findings AND adds new "intent" checks that ask:
// is the rich content of .arch/ actually load-bearing, or are there dead-ends
// (skills with no gotchas, BAN rules that match nothing, goals with vacuous
// exit-criteria) that train callers to ignore the system?
//
// Different cadence from warmup: warmup runs at session start and is
// structural ("can I trust .arch/ at all?"). doctor runs on demand and is
// intent-checking ("does the configured surface actually fire?").
//
// Exposed as both CLI (`archkit doctor`) and MCP (`archkit_doctor`).

import fs from "node:fs";
import path from "node:path";
import { C, ICONS as I, findArchDir as _findArchDir, toPosixPath } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import { archkitError } from "../lib/errors.mjs";
import { parseBoundaries } from "../lib/boundary-parser.mjs";
import { listGoals } from "../lib/goals.mjs";
import { gatherHooksStatus } from "../lib/hooks-status.mjs";
import { cmdWarmup } from "./resolve/warmup.mjs";

// drift.mjs auto-fires main() when process.env.ARCHKIT_RUN is set (CLI
// dispatch convention). We dynamic-import it after clearing that env so the
// drift module body doesn't think it's the entry point of this run.
async function loadDrift() {
  const prev = process.env.ARCHKIT_RUN;
  delete process.env.ARCHKIT_RUN;
  try {
    return await import("./drift.mjs");
  } finally {
    if (prev !== undefined) process.env.ARCHKIT_RUN = prev;
  }
}

const VACUOUS_EXIT_PATTERNS = [
  /^ship( it)?$/i,
  /^done$/i,
  /^do it$/i,
  /^make it work$/i,
  /^fix( it)?$/i,
  /^complete$/i,
  /^finish$/i,
  /^build( it)?$/i,
  /^implement$/i,
  /^works?$/i,
];

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".arch", "dist", "build", ".next", ".turbo",
  "coverage", ".cache", "out", "target", "venv", ".venv", "__pycache__",
  ".vscode", ".idea",
]);

const CODE_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".swift",
  ".rb", ".php", ".cs", ".m", ".mm", ".c", ".h", ".cpp", ".hpp",
  ".vue", ".svelte", ".astro",
]);

function walkRepo(cwd, maxFiles = 5000) {
  const out = [];
  function visit(dir) {
    if (out.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      if (out.length >= maxFiles) return;
      if (ent.name.startsWith(".") && ent.name !== ".env.example") {
        if (ent.name !== ".github") continue;
      }
      if (SKIP_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        visit(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (CODE_EXTS.has(ext)) out.push(path.relative(cwd, full));
      }
    }
  }
  visit(cwd);
  return out;
}

// ─── Intent checks ──────────────────────────────────────────────────────

function checkEmptySkills(archDir) {
  const dir = path.join(archDir, "skills");
  if (!fs.existsSync(dir)) return { skills: [], total: 0 };
  const empty = [];
  let total = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".skill")) continue;
    total++;
    const id = file.replace(/\.skill$/, "");
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    const wrong = (content.match(/^WRONG:/gm) || []).length;
    const placeholder = (content.match(/^WRONG: \[/gm) || []).length;
    const real = wrong - placeholder;
    if (real <= 0) empty.push(id);
  }
  return { skills: empty, total };
}

function checkUnappliedBans(archDir, cwd) {
  const file = path.join(archDir, "BOUNDARIES.md");
  if (!fs.existsSync(file)) return { rules: [], unapplied: [], scannedFiles: 0 };
  const { rules } = parseBoundaries(fs.readFileSync(file, "utf8"));
  if (rules.length === 0) return { rules, unapplied: [], scannedFiles: 0 };
  const repoFiles = walkRepo(cwd);
  const unapplied = [];
  for (const rule of rules) {
    const matched = repoFiles.some(rel => rule.sourceRe.test(toPosixPath(rel)));
    if (!matched) {
      unapplied.push({
        source: rule.source,
        target: rule.target,
        definedAt: `BOUNDARIES.md:${rule.line}`,
      });
    }
  }
  return { rules, unapplied, scannedFiles: repoFiles.length };
}

function isVacuousCriterion(s) {
  if (!s) return true;
  const t = String(s).trim();
  if (t.length < 8) return true;
  for (const re of VACUOUS_EXIT_PATTERNS) if (re.test(t)) return true;
  return false;
}

function checkWeakGoals(archDir) {
  const goals = listGoals(archDir);
  const weak = [];
  for (const g of goals) {
    const exit = Array.isArray(g.meta["exit-criteria"]) ? g.meta["exit-criteria"] : [];
    const reading = Array.isArray(g.meta["required-reading"]) ? g.meta["required-reading"] : [];
    const reasons = [];
    if (exit.length === 0) {
      reasons.push("no exit-criteria");
    } else {
      const vacuous = exit.filter(isVacuousCriterion);
      if (vacuous.length === exit.length) reasons.push("all exit-criteria vacuous (<8 chars or generic)");
      else if (vacuous.length > 0) reasons.push(`${vacuous.length}/${exit.length} exit-criteria vacuous`);
    }
    if (reading.length === 0) reasons.push("no required-reading");
    if (reasons.length > 0) {
      weak.push({ slug: g.slug, title: g.meta.title || g.slug, reasons });
    }
  }
  return { weak, total: goals.length };
}

// ─── Aggregation ────────────────────────────────────────────────────────

export async function runDoctorJson({ archDir, cwd }) {
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init` in your project root.",
    });
  }

  // Structural warmup (quick mode) — produces blockers + warnings + checks.
  const warmup = cmdWarmup(archDir, false);
  // Drift findings — INDEX/skill/source mismatches.
  const driftMod = await loadDrift();
  const drift = await driftMod.runDriftJson({ archDir, cwd });

  // Intent checks.
  const emptySkills = checkEmptySkills(archDir);
  const bans = checkUnappliedBans(archDir, cwd);
  const goals = checkWeakGoals(archDir);

  const checks = [];
  const blockers = [...warmup.blockers];
  const warnings = [];

  // Roll warmup non-blocker warnings into doctor's warning list — but with
  // the warmup source attribution preserved so the user knows which check fired.
  for (const w of warmup.warnings) warnings.push(`[warmup] ${w}`);

  // Drift: surface aggregated count. Severity is warning unless drift has
  // missing-source findings, which block real work.
  // Only high-confidence missing-source findings block. In a workspace/monorepo
  // layout drift downgrades source-path findings to low confidence (the path may
  // resolve via a member dir or a path alias), so those stay warnings, not blockers.
  const driftFatal = drift.stale.filter(s => s.type === "missing-source" && s.confidence !== "low");
  if (drift.stale.length > 0) {
    const detail = Object.entries(drift.summary.byType)
      .map(([t, n]) => `${t}:${n}`).join(", ");
    checks.push({
      id: "D-DRIFT",
      name: "Drift between .arch/ and source tree",
      status: driftFatal.length > 0 ? "fail" : "warn",
      detail: `${drift.stale.length} finding(s) — ${detail}`,
    });
    if (driftFatal.length > 0) {
      blockers.push(
        `${driftFatal.length} missing-source finding(s) in INDEX.md — basePath(s) don't exist on disk. Run \`archkit drift\` for the list.`
      );
    } else {
      warnings.push(`[drift] ${drift.stale.length} finding(s): ${detail}. Run \`archkit drift\` for the list.`);
    }
  } else {
    checks.push({
      id: "D-DRIFT",
      name: "Drift between .arch/ and source tree",
      status: "pass",
      detail: drift.staleNote || `Checked ${drift.scanned.indexNodes} index node(s), ${drift.scanned.graphFiles} graph(s), ${drift.scanned.skillFiles} skill(s).`,
    });
  }

  // Intent C1: empty skills.
  if (emptySkills.total === 0) {
    checks.push({
      id: "D-INTENT-1",
      name: "Skill gotcha coverage",
      status: "warn",
      detail: "No .skill files present — review has no project-specific patterns to enforce.",
    });
    warnings.push(
      "[intent] No .skill files in .arch/skills/. Without gotchas, archkit review can't catch project-specific footguns. Run `archkit extend run add-skill <name>`."
    );
  } else if (emptySkills.skills.length === 0) {
    checks.push({
      id: "D-INTENT-1",
      name: "Skill gotcha coverage",
      status: "pass",
      detail: `${emptySkills.total} skill(s), all carry at least one real WRONG/RIGHT/WHY.`,
    });
  } else {
    const sample = emptySkills.skills.slice(0, 5).join(", ");
    const more = emptySkills.skills.length > 5 ? `, +${emptySkills.skills.length - 5} more` : "";
    checks.push({
      id: "D-INTENT-1",
      name: "Skill gotcha coverage",
      status: "warn",
      detail: `${emptySkills.skills.length}/${emptySkills.total} skill(s) have zero real gotchas: ${sample}${more}`,
    });
    warnings.push(
      `[intent] ${emptySkills.skills.length} skill(s) with no real WRONG/RIGHT/WHY — they exist on disk but contribute nothing to review. Fill via \`archkit gotcha -i\`: ${sample}${more}`
    );
  }

  // Intent C2: unapplied BAN rules.
  if (bans.rules.length === 0) {
    checks.push({
      id: "D-INTENT-2",
      name: "BOUNDARIES.md BAN coverage",
      status: "warn",
      detail: "No machine-enforceable BAN directives found in BOUNDARIES.md (prose-only rules can't be lint-checked).",
    });
    warnings.push(
      "[intent] BOUNDARIES.md has no `BAN: source -> target` directives. Prose NEVER rules can't be enforced — add at least one BAN to enable archkit boundary-check."
    );
  } else if (bans.unapplied.length === 0) {
    checks.push({
      id: "D-INTENT-2",
      name: "BOUNDARIES.md BAN coverage",
      status: "pass",
      detail: `${bans.rules.length} BAN rule(s), all match at least one file in the working tree (scanned ${bans.scannedFiles} file(s)).`,
    });
  } else {
    const sample = bans.unapplied.slice(0, 3).map(u => `${u.source} -> ${u.target}`).join("; ");
    const more = bans.unapplied.length > 3 ? `, +${bans.unapplied.length - 3} more` : "";
    checks.push({
      id: "D-INTENT-2",
      name: "BOUNDARIES.md BAN coverage",
      status: "warn",
      detail: `${bans.unapplied.length}/${bans.rules.length} BAN rule(s) match no file in repo: ${sample}${more}`,
    });
    warnings.push(
      `[intent] ${bans.unapplied.length} BAN rule(s) reference paths that don't exist in the repo — could be future-protecting, could be stale. Verify in BOUNDARIES.md: ${sample}${more}`
    );
  }

  // Intent C3: weak goals.
  if (goals.total === 0) {
    checks.push({
      id: "D-INTENT-3",
      name: "Goal quality (CGR)",
      status: "pass",
      detail: "No active goals — CGR not in flight.",
    });
  } else if (goals.weak.length === 0) {
    checks.push({
      id: "D-INTENT-3",
      name: "Goal quality (CGR)",
      status: "pass",
      detail: `${goals.total} active goal(s), all carry meaningful exit-criteria + required-reading.`,
    });
  } else {
    const sample = goals.weak.slice(0, 3).map(g => `${g.slug} (${g.reasons.join(", ")})`).join("; ");
    const more = goals.weak.length > 3 ? `, +${goals.weak.length - 3} more` : "";
    checks.push({
      id: "D-INTENT-3",
      name: "Goal quality (CGR)",
      status: "warn",
      detail: `${goals.weak.length}/${goals.total} active goal(s) are weak: ${sample}${more}`,
    });
    warnings.push(
      `[intent] ${goals.weak.length} active CGR goal(s) have vacuous exit-criteria or no required-reading. Edit in .arch/goals/<slug>.md so the next /clear'd session has a concrete target. ${sample}${more}`
    );
  }

  // Intent C4: are the guardrail hooks even installed? Without them the
  // SessionStart digest, the CGR Stop-guard, and review-on-edit never fire —
  // .arch/ can be perfect and still do nothing. The MCP layer is the only
  // surface that can detect this (it's connected regardless of hook wiring).
  const hooks = gatherHooksStatus(cwd);
  if (hooks.installed) {
    checks.push({
      id: "D-HOOKS",
      name: "Guardrail hooks installed",
      status: "pass",
      detail: hooks.via === "plugin"
        ? "Provided by the enabled archkit plugin."
        : "All guardrail hooks wired in settings.json.",
    });
  } else {
    checks.push({
      id: "D-HOOKS",
      name: "Guardrail hooks installed",
      status: "warn",
      detail: `${hooks.missing.length}/${hooks.required.length} guardrail hook(s) not wired: ${hooks.missing.join(", ")}.`,
    });
    warnings.push(
      `[hooks] ${hooks.missing.length} guardrail hook(s) not installed (${hooks.missing.join(", ")}) — the SessionStart digest, CGR Stop-guard${hooks.missing.includes("Stop") ? "" : ""}, and review-on-edit won't fire. Call archkit_install_hooks to wire the full set into .claude/settings.json.`
    );
  }

  // Structural warmup top-line check so the user sees one row.
  checks.unshift({
    id: "D-WARMUP",
    name: "Structural warmup (.arch/ core files)",
    status: warmup.pass ? "pass" : "fail",
    detail: warmup.pass
      ? `SYSTEM.md + INDEX.md + ${warmup.summary.graphs} cluster(s), ${warmup.summary.skills} skill(s).`
      : `${warmup.blockers.length} blocker(s). Run \`archkit resolve warmup\` for details.`,
  });

  const pass = blockers.length === 0;
  const totalChecks = checks.length;
  const passing = checks.filter(c => c.status === "pass").length;
  const warningCount = checks.filter(c => c.status === "warn").length;
  const failing = checks.filter(c => c.status === "fail").length;

  const warningsNote = warnings.length === 0
    ? `Ran ${totalChecks} aggregated check(s): structural warmup, drift, and 4 surface checks (skill gotcha coverage, BOUNDARIES.md BAN coverage, CGR goal quality, guardrail-hook install). All clean.`
    : undefined;

  const nextStep = (() => {
    if (!pass) {
      const first = blockers[0];
      return `Resolve blocker(s) before continuing: ${first.length > 100 ? first.slice(0, 97) + "…" : first}`;
    }
    if (warnings.length === 0) {
      return `Doctor clean (${passing}/${totalChecks}). Re-run after dependency changes, BOUNDARIES.md edits, or new goal intake.`;
    }
    const top = warnings[0];
    const trimmed = top.length > 110 ? top.slice(0, 107) + "…" : top;
    return `Address: ${trimmed}`;
  })();

  return {
    pass,
    checks,
    blockers,
    warnings,
    warningsNote,
    summary: {
      total: totalChecks,
      passing,
      warnings: warningCount,
      failing,
      driftFindings: drift.stale.length,
      emptySkills: emptySkills.skills.length,
      skillsTotal: emptySkills.total,
      unappliedBans: bans.unapplied.length,
      banRules: bans.rules.length,
      weakGoals: goals.weak.length,
      goalsTotal: goals.total,
    },
    intent: {
      emptySkills: emptySkills.skills,
      unappliedBans: bans.unapplied,
      weakGoals: goals.weak,
    },
    sources: {
      warmup: { pass: warmup.pass, blockers: warmup.blockers, summary: warmup.summary },
      drift: { stale: drift.stale.length, scanned: drift.scanned, byType: drift.summary.byType },
    },
    nextStep,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────

function statusGlyph(status) {
  if (status === "pass") return `${C.green}${I.check}${C.reset}`;
  if (status === "warn") return `${C.yellow}${I.warn}${C.reset}`;
  if (status === "fail") return `${C.red}${I.cross}${C.reset}`;
  return ` `;
}

function printPretty(result) {
  console.log("");
  console.log(`  ${C.bold}Aggregated checks${C.reset} ${C.dim}(${result.summary.passing} pass / ${result.summary.warnings} warn / ${result.summary.failing} fail)${C.reset}`);
  for (const ch of result.checks) {
    console.log(`  ${statusGlyph(ch.status)} ${C.bold}${ch.name}${C.reset}`);
    if (ch.detail) console.log(`     ${C.dim}${ch.detail}${C.reset}`);
  }
  if (result.blockers.length > 0) {
    console.log(`\n  ${C.red}${C.bold}Blockers${C.reset}`);
    for (const b of result.blockers) console.log(`  ${C.red}${I.cross}${C.reset} ${b}`);
  }
  if (result.warnings.length > 0) {
    console.log(`\n  ${C.yellow}${C.bold}Warnings${C.reset}`);
    for (const w of result.warnings) console.log(`  ${C.yellow}${I.warn}${C.reset} ${w}`);
  } else if (result.warningsNote) {
    console.log(`\n  ${C.green}${I.check}${C.reset} ${C.dim}${result.warningsNote}${C.reset}`);
  }
  console.log(`\n  ${C.cyan}Next:${C.reset} ${result.nextStep}\n`);
}

function findArchDir() {
  return _findArchDir({ requireFile: "SYSTEM.md" });
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json") || args.includes("--agent");

  if (args.includes("--help") || args.includes("-h")) {
    commandBanner("archkit doctor", "Workflow logistic gauge — aggregates warmup + drift + intent checks");
    console.log(`${C.yellow}  Usage:${C.reset}`);
    console.log(`${C.gray}    archkit doctor          Run all checks (pretty output)${C.reset}`);
    console.log(`${C.gray}    archkit doctor --json   Machine-readable envelope${C.reset}\n`);
    console.log(`${C.dim}  Different from warmup: warmup asks "can I trust .arch/ at all?";${C.reset}`);
    console.log(`${C.dim}  doctor asks "is the rich content of .arch/ actually load-bearing?"${C.reset}\n`);
    process.exit(0);
  }

  const archDir = findArchDir();
  if (!archDir) {
    if (isJson) {
      console.log(JSON.stringify({
        error: "no_arch_dir",
        message: "No .arch/ directory found.",
        suggestion: "Run `archkit init` in your project root.",
        nextStep: "Run `archkit init` to scaffold .arch/, then re-run `archkit doctor`.",
      }));
    } else {
      console.log(`${C.red}  ${I.cross} No .arch/ directory found.${C.reset}`);
      console.log(`  ${C.dim}Run \`archkit init\` first.${C.reset}\n`);
    }
    process.exit(1);
  }

  try {
    const result = await runDoctorJson({ archDir, cwd: process.cwd() });
    if (isJson) {
      console.log(JSON.stringify(result));
    } else {
      commandBanner("archkit doctor", "Workflow logistic gauge");
      printPretty(result);
    }
    process.exit(result.pass ? 0 : 1);
  } catch (err) {
    if (isJson) {
      console.log(JSON.stringify({
        error: err.code || "internal_error",
        message: err.message,
        suggestion: err.suggestion,
      }));
    } else {
      console.error(`${C.red}  ${I.cross} ${err.message}${C.reset}`);
      if (err.suggestion) console.error(`  ${C.dim}${err.suggestion}${C.reset}`);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main();
}
