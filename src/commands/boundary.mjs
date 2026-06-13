#!/usr/bin/env node
// archkit boundary-check — enforce BAN directives from .arch/BOUNDARIES.md
//
// Reads structured `BAN: source -> target` rules from BOUNDARIES.md, then
// walks either the staged diff (--staged), an unstaged diff (--diff), or a
// list of files and flags imports that violate any rule.
//
// arch-poly fix (item #10): BOUNDARIES.md is the highest-leverage artifact
// but had zero machine enforcement until this command. Catches "copilot/*
// should never import execution/*" classes of bug pre-commit.

import fs from "fs";
import path from "path";
import { execFileSync } from "node:child_process";
import { C, ICONS as I, findArchDir as _findArchDir, toPosixPath } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import { parseBoundaries, normalizeImport } from "../lib/boundary-parser.mjs";
import { extractImports } from "../lib/import-detector.mjs";
import { getDiffHunkLines } from "./review/staged-hunks.mjs";
import { archkitError } from "../lib/errors.mjs";

function findArchDir() {
  return _findArchDir({ requireFile: "BOUNDARIES.md" });
}

function banSlug(s) {
  return String(s).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}

// Queue a proposed `BAN: source -> target` rule for human review — the
// capture-symmetry partner to archkit_gotcha_propose. Human-gated by design:
// archkit NEVER auto-merges into BOUNDARIES.md (a wrong BAN blocks real work),
// so this only writes a pending proposal the human reviews + pastes in.
export function runBoundaryProposeJson({ archDir, source, target, why }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  for (const [k, v] of Object.entries({ source, target })) {
    if (!v || typeof v !== "string" || !v.trim()) {
      throw archkitError("proposal_invalid", `Missing required field: ${k}`, {
        suggestion: "Provide source and target globs, e.g. source='src/web/*', target='src/db/*'.",
      });
    }
  }
  // Validate: the BAN must parse to exactly one rule with no glob warnings.
  const probe = parseBoundaries(`BAN: ${source} -> ${target}`);
  if (probe.rules.length !== 1 || probe.warnings.length > 0) {
    throw archkitError("proposal_invalid", `Unsupported glob in BAN: ${source} -> ${target}`, {
      suggestion: "Globs support `*` (single segment) and a trailing `/*`; the chars []{}?! are not supported.",
    });
  }

  // Skip if already enforced in BOUNDARIES.md.
  const boundariesPath = path.join(archDir, "BOUNDARIES.md");
  if (fs.existsSync(boundariesPath)) {
    const { rules } = parseBoundaries(fs.readFileSync(boundariesPath, "utf8"));
    if (rules.some((r) => r.source === source && r.target === target)) {
      return {
        queued: false,
        alreadyEnforced: true,
        source,
        target,
        nextStep: `BAN ${source} -> ${target} is already in BOUNDARIES.md — nothing to propose.`,
      };
    }
  }

  const pDir = path.join(archDir, "boundary-proposals");
  fs.mkdirSync(pDir, { recursive: true });
  const file = path.join(pDir, `${banSlug(source)}__${banSlug(target)}.json`);
  const banLine = `- BAN: ${source} -> ${target}${why ? `  (${why})` : ""}`;
  const proposal = { source, target, ...(why ? { why } : {}), banLine, origin: "mcp", created_at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(proposal, null, 2));
  return {
    queued: true,
    proposalPath: file,
    banLine,
    nextStep: `BAN proposal queued at ${path.relative(process.cwd(), file)}. A human must review it and paste banLine into .arch/BOUNDARIES.md to enforce — archkit does not auto-merge boundary rules.`,
  };
}

function listFilesFromArgs(args, cwd) {
  if (args.includes("--staged")) {
    try {
      const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
        { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return out.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
  if (args.includes("--diff")) {
    try {
      const out = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACM"],
        { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return out.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
  return args.filter((a) => !a.startsWith("-"));
}

export function checkBoundaries({ archDir, files, cwd, hunkLines }) {
  const boundariesPath = path.join(archDir, "BOUNDARIES.md");
  if (!fs.existsSync(boundariesPath)) {
    throw archkitError("no_boundaries_file", "BOUNDARIES.md not found", {
      suggestion: "Create .arch/BOUNDARIES.md (or run `archkit init` to scaffold).",
    });
  }
  const { rules, warnings } = parseBoundaries(fs.readFileSync(boundariesPath, "utf8"));

  const violations = [];
  const ruleHits = new Map(); // rule index -> # of times it matched a source file
  for (const relFile of files) {
    const absFile = path.isAbsolute(relFile) ? relFile : path.resolve(cwd, relFile);
    if (!fs.existsSync(absFile)) continue;
    // Match against `/`-delimited BAN globs — normalize Windows backslashes
    // so e.g. `bot\copilot\x.py` matches the glob `bot/copilot/*`.
    const fileRel = toPosixPath(path.relative(cwd, absFile));
    const code = fs.readFileSync(absFile, "utf8");
    const imports = extractImports(absFile, code);
    const allowedLines = hunkLines ? hunkLines.get(absFile) : null;

    rules.forEach((rule, idx) => {
      if (rule.sourceRe.test(fileRel)) ruleHits.set(idx, (ruleHits.get(idx) || 0) + 1);
    });

    for (const { line, spec } of imports) {
      if (allowedLines && !allowedLines.has(line)) continue;
      const normalized = normalizeImport(spec);
      for (const rule of rules) {
        if (!rule.sourceRe.test(fileRel)) continue;
        if (!rule.targetRe.test(normalized)) continue;
        violations.push({
          file: fileRel,
          line,
          imported: spec,
          rule: `BAN: ${rule.source} -> ${rule.target}`,
          source: `BOUNDARIES.md:${rule.line}`,
        });
      }
    }
  }

  // Dead-end indicator: BAN rules registered in BOUNDARIES.md whose source-glob
  // matched no file in this scan. Could be legit (rule covers a path you didn't
  // stage) or a stale rule. Either way, surface it instead of silently ignoring.
  const unappliedRules = rules
    .map((rule, idx) => ({ rule, idx }))
    .filter(({ idx }) => !ruleHits.has(idx))
    .map(({ rule }) => ({
      source: rule.source,
      target: rule.target,
      definedAt: `BOUNDARIES.md:${rule.line}`,
    }));

  const hint = rules.length === 0
    ? "BOUNDARIES.md has no machine-enforceable BAN directives. Add lines like `- BAN: src/feature-a/* -> src/feature-b/*` to enable enforcement. Prose-only NEVER rules are still readable by the agent but cannot be lint-checked."
    : undefined;

  const nextStep = violations.length > 0
    ? `Fix the violation(s) by removing the banned import or moving the code to an allowed module, then re-run \`archkit boundary-check --staged\`. If the import is legitimate, narrow the BAN rule in BOUNDARIES.md.`
    : rules.length === 0
      ? `Add BAN directives to .arch/BOUNDARIES.md to enable enforcement.`
      : `No action needed — staged changes respect all BAN rules.`;

  return {
    files: files.length,
    rules: rules.length,
    violations,
    warnings,
    unappliedRules,
    hint,
    nextStep,
    pass: violations.length === 0,
  };
}

export async function runBoundaryCheckJson({ archDir, cwd, args }) {
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init`.",
    });
  }
  const files = listFilesFromArgs(args, cwd);
  const isStaged = args.includes("--staged");
  const isDiff = args.includes("--diff");
  const hunkLines = (isStaged || isDiff)
    ? getDiffHunkLines(cwd, { staged: isStaged })
    : null;
  return checkBoundaries({ archDir, files, cwd, hunkLines });
}

function printPretty(result) {
  console.log(`\n  ${C.bold}BOUNDARIES.md${C.reset} parsed ${result.rules} BAN rule${result.rules === 1 ? "" : "s"} | scanned ${result.files} file${result.files === 1 ? "" : "s"}`);
  if (result.hint) {
    console.log(`\n  ${C.yellow}${I.warn} ${result.hint}${C.reset}`);
  }
  if (result.warnings.length > 0) {
    console.log(`\n  ${C.yellow}Parse warnings:${C.reset}`);
    for (const w of result.warnings) console.log(`    ${I.warn} BOUNDARIES.md:${w.line} ${w.message}`);
  }
  if (result.unappliedRules && result.unappliedRules.length > 0) {
    console.log(`\n  ${C.dim}${result.unappliedRules.length} BAN rule${result.unappliedRules.length === 1 ? "" : "s"} matched no scanned file (could be stale, or covering paths not in this run):${C.reset}`);
    for (const u of result.unappliedRules) {
      console.log(`    ${C.dim}- BAN: ${u.source} -> ${u.target} (${u.definedAt})${C.reset}`);
    }
  }
  if (result.violations.length === 0) {
    console.log(`\n  ${C.green}${I.check} clean — no boundary violations${C.reset}`);
  } else {
    console.log(`\n  ${C.red}${I.cross} ${result.violations.length} boundary violation${result.violations.length === 1 ? "" : "s"}:${C.reset}\n`);
    for (const v of result.violations) {
      console.log(`  ${C.red}${I.cross}${C.reset} ${C.bold}${v.file}:${v.line}${C.reset}`);
      console.log(`    imported: ${C.yellow}${v.imported}${C.reset}`);
      console.log(`    violates: ${v.rule}  ${C.dim}(${v.source})${C.reset}\n`);
    }
  }
  if (result.nextStep) {
    console.log(`\n  ${C.cyan}Next:${C.reset} ${result.nextStep}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    commandBanner("archkit boundary-check", "Enforce BAN directives from .arch/BOUNDARIES.md");
    console.log(`${C.yellow}  Usage:${C.reset}`);
    console.log(`${C.gray}    archkit boundary-check --staged          Check staged files${C.reset}`);
    console.log(`${C.gray}    archkit boundary-check --diff            Check unstaged changes${C.reset}`);
    console.log(`${C.gray}    archkit boundary-check <file1> <file2>   Check explicit files${C.reset}`);
    console.log(`${C.gray}    archkit boundary-check --json            Machine-readable output${C.reset}`);
    console.log("");
    console.log(`${C.yellow}  BOUNDARIES.md syntax:${C.reset}`);
    console.log(`${C.gray}    - BAN: copilot/* -> execution/*${C.reset}`);
    console.log(`${C.gray}    - NEVER skip auth check. (BAN: routes/public/* -> auth/*)${C.reset}`);
    process.exit(0);
  }

  const archDir = findArchDir();
  if (!archDir) {
    if (args.includes("--json")) {
      console.log(JSON.stringify({ error: "no_arch_dir", message: "No .arch/ directory with BOUNDARIES.md found." }));
    } else {
      console.log(`${C.red}  ${I.warn} No .arch/BOUNDARIES.md found.${C.reset}\n`);
    }
    process.exit(1);
  }

  const isJson = args.includes("--json") || args.includes("--agent");
  try {
    const result = await runBoundaryCheckJson({ archDir, cwd: process.cwd(), args });
    if (isJson) {
      console.log(JSON.stringify(result));
    } else {
      commandBanner("archkit boundary-check", "Enforce BAN directives from .arch/BOUNDARIES.md");
      printPretty(result);
    }
    process.exit(result.pass ? 0 : 1);
  } catch (err) {
    if (isJson) {
      console.log(JSON.stringify({ error: err.code || "internal_error", message: err.message, suggestion: err.suggestion }));
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
