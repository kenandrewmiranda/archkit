#!/usr/bin/env node

/**
 * arch-decisions — Append ADR-style decision records to .arch/decisions/
 *
 * Usage (CLI):
 *   archkit decisions log --json '{"title":"Use Postgres","context":"...","decision":"...","consequences":"..."}'
 *
 * Usage (MCP): archkit_log_decision tool with the same input shape.
 *
 * The wizard creates `.arch/decisions/0001-foundation.md` to set the precedent;
 * this command is how every subsequent decision gets recorded in the same format.
 */

import fs from "node:fs";
import path from "node:path";
import { archkitError } from "../lib/errors.mjs";
import { C, ICONS as I } from "../lib/shared.mjs";

const VALID_STATUS = new Set(["proposed", "accepted", "superseded", "deprecated"]);

function slugify(title) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function nextDecisionNumber(decisionsDir) {
  if (!fs.existsSync(decisionsDir)) return 1;
  let maxN = 0;
  for (const file of fs.readdirSync(decisionsDir)) {
    const m = file.match(/^(\d{4})-/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    }
  }
  return maxN + 1;
}

function pad4(n) {
  return String(n).padStart(4, "0");
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function renderAdr({ number, title, date, status, tags, context, decision, consequences }) {
  const header = [
    `# ${number}. ${title}`,
    "",
    `- **Date**: ${date}`,
    `- **Status**: ${capitalize(status)}`,
  ];
  if (tags && tags.length) header.push(`- **Tags**: ${tags.join(", ")}`);

  return [
    ...header,
    "",
    "## Context",
    "",
    context.trim(),
    "",
    "## Decision",
    "",
    decision.trim(),
    "",
    "## Consequences",
    "",
    consequences.trim(),
    "",
  ].join("\n");
}

// ── MCP-friendly runner ───────────────────────────────────────────────────

export async function runLogDecisionJson({ archDir, title, context, decision, consequences, status, tags }) {
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init` (or `/archkit-init` in Claude Code) to create one.",
    });
  }

  for (const [key, val] of Object.entries({ title, context, decision, consequences })) {
    if (!val || typeof val !== "string" || !val.trim()) {
      throw archkitError("decision_invalid", `Missing required field: ${key}`, {
        suggestion: "Provide all of: title, context, decision, consequences (each a non-empty string).",
      });
    }
  }

  const resolvedStatus = (status || "accepted").toLowerCase();
  if (!VALID_STATUS.has(resolvedStatus)) {
    throw archkitError("decision_invalid", `Invalid status: ${status}`, {
      suggestion: `Status must be one of: ${[...VALID_STATUS].join(", ")}.`,
    });
  }

  if (tags !== undefined) {
    if (!Array.isArray(tags) || !tags.every(t => typeof t === "string" && t.trim())) {
      throw archkitError("decision_invalid", "tags must be an array of non-empty strings", {
        suggestion: 'e.g. ["database", "stack"].',
      });
    }
  }

  const decisionsDir = path.join(archDir, "decisions");
  fs.mkdirSync(decisionsDir, { recursive: true });

  const number = pad4(nextDecisionNumber(decisionsDir));
  const slug = slugify(title) || "untitled";
  const filename = `${number}-${slug}.md`;
  const filepath = path.join(decisionsDir, filename);

  if (fs.existsSync(filepath)) {
    throw archkitError("decision_collision", `Decision file already exists: ${filename}`, {
      suggestion: "Re-run; numbering scans existing files and should not collide on retry.",
    });
  }

  const date = new Date().toISOString().slice(0, 10);
  const body = renderAdr({
    number,
    title: title.trim(),
    date,
    status: resolvedStatus,
    tags,
    context,
    decision,
    consequences,
  });

  fs.writeFileSync(filepath, body);

  return {
    number,
    filename,
    path: filepath,
    relativePath: path.relative(process.cwd(), filepath),
    status: resolvedStatus,
    title: title.trim(),
    nextStep: `Decision ${number} logged at ${path.relative(process.cwd(), filepath)}. Reference this ADR in the PR/commit; call archkit_log_decision again for any follow-on choice.`,
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

  if (sub !== "log") {
    if (jsonMode) {
      console.log(JSON.stringify({ error: "Usage: archkit decisions log --json '<input>'" }));
    } else {
      console.log(`${C.yellow}  Usage:${C.reset}`);
      console.log(`${C.gray}    archkit decisions log --json '<input>'${C.reset}`);
      console.log("");
      console.log(`${C.yellow}  Input shape (JSON):${C.reset}`);
      console.log(`${C.gray}    {${C.reset}`);
      console.log(`${C.gray}      "title": "Use Postgres as primary database",${C.reset}`);
      console.log(`${C.gray}      "context": "We need a relational store ...",${C.reset}`);
      console.log(`${C.gray}      "decision": "Postgres on Neon (managed) ...",${C.reset}`);
      console.log(`${C.gray}      "consequences": "Single source of truth ...",${C.reset}`);
      console.log(`${C.gray}      "status": "accepted",        // optional, default "accepted"${C.reset}`);
      console.log(`${C.gray}      "tags": ["database", "stack"] // optional${C.reset}`);
      console.log(`${C.gray}    }${C.reset}`);
      console.log("");
    }
    process.exit(sub ? 1 : 0);
  }

  const archDir = findArchDir(process.cwd());
  if (!archDir) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: "No .arch/ directory found" }));
    } else {
      console.log(`${C.red}  ${I.warn} No .arch/ directory found.${C.reset}`);
      console.log(`${C.gray}  Run from your project root, or initialize archkit first.${C.reset}`);
    }
    process.exit(1);
  }

  const jsonArg = args.filter(a => a !== "log" && !a.startsWith("--")).join(" ");
  if (!jsonArg) {
    console.log(JSON.stringify({ error: "Missing JSON input. Pass the decision payload as a positional argument." }));
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(jsonArg);
  } catch (err) {
    console.log(JSON.stringify({ error: `Invalid JSON: ${err.message}` }));
    process.exit(1);
  }

  try {
    const result = await runLogDecisionJson({ archDir, ...input });
    if (jsonMode) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`${C.green}  ${I.check} Logged decision ${result.number}: ${result.title}${C.reset}`);
      console.log(`${C.gray}  → ${result.relativePath}${C.reset}`);
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

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  const args = process.argv.slice(2);
  cliMode(args).catch(err => {
    console.error(`${C.red}  Error: ${err.message}${C.reset}`);
    process.exit(1);
  });
}
