// src/mcp/tools.mjs
// Tool registry for archkit MCP server. Each entry has:
//   - description: prose used at tool-pick time (CRITICAL — iterate post-dogfood)
//   - inputSchema: Zod schema for validation
//   - handler: (validatedInput) => Promise<resultObject> (throws ArchkitError on failure)

import { z } from "zod";
import path from "node:path";
import fs from "node:fs";

import { runReviewJson } from "../commands/review.mjs";
import { runWarmupJson } from "../commands/resolve/warmup.mjs";
import { runPreflightJson } from "../commands/resolve/preflight.mjs";
import { runScaffoldJson } from "../commands/resolve/scaffold.mjs";
import { runLookupJson } from "../commands/resolve.mjs";
import { runGotchaListJson, runGotchaProposeJson } from "../commands/gotcha.mjs";
import { runStatsJson } from "../commands/stats.mjs";
import { runDriftJson } from "../commands/drift.mjs";
import { archkitError } from "../lib/errors.mjs";

function findArchDir(cwd) {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, ".arch");
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "SYSTEM.md"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function requireArchDir(cwd) {
  const archDir = findArchDir(cwd);
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init` in your project root.",
      docsUrl: "https://github.com/kenandrewmiranda/archkit#getting-started",
    });
  }
  return archDir;
}

export const tools = {
  archkit_review: {
    description: "Review one or more files against archkit rules and gotchas, returning structured findings with severities. When to use: AFTER editing code, BEFORE committing.",
    inputSchema: z.object({
      files: z.array(z.string().min(1)).min(1),
    }),
    handler: async ({ files }) => {
      const cwd = process.cwd();
      return runReviewJson({ files, archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_review_staged: {
    description: "Review all git-staged files against archkit rules. When to use: as a pre-commit safety net, or when the user mentions staging.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runReviewJson({ files: [], archDir: requireArchDir(cwd), cwd, staged: true });
    },
  },

  archkit_resolve_warmup: {
    description: "Run pre-session health checks on the .arch/ context system. Returns blockers, warnings, and actions. When to use: at the START of a coding session, or whenever context drift is suspected.",
    inputSchema: z.object({
      deep: z.boolean().optional(),
    }),
    handler: async ({ deep }) => {
      const cwd = process.cwd();
      return runWarmupJson({ archDir: requireArchDir(cwd), deep });
    },
  },

  archkit_resolve_preflight: {
    description: "Verify a feature/layer combination exists and is correctly wired before generating code. When to use: BEFORE writing or modifying code in a feature path.",
    inputSchema: z.object({
      feature: z.string().min(1),
      layer: z.string().min(1),
    }),
    handler: async ({ feature, layer }) => {
      const cwd = process.cwd();
      return runPreflightJson({ archDir: requireArchDir(cwd), cwd, feature, layer });
    },
  },

  archkit_resolve_scaffold: {
    description: "Return the scaffolding checklist for a new feature: which files to create, in what order, with what naming conventions. When to use: when starting a new feature, BEFORE creating files.",
    inputSchema: z.object({
      feature: z.string().min(1),
    }),
    handler: async ({ feature }) => {
      const cwd = process.cwd();
      return runScaffoldJson({ archDir: requireArchDir(cwd), cwd, feature });
    },
  },

  archkit_resolve_lookup: {
    description: "Look up a single node, skill, or cluster by id and return its details. When to use: when you need to know what a referenced symbol or package is for.",
    inputSchema: z.object({
      id: z.string().min(1),
    }),
    handler: async ({ id }) => {
      const cwd = process.cwd();
      return runLookupJson({ archDir: requireArchDir(cwd), id });
    },
  },

  archkit_gotcha_propose: {
    description: "Queue a new gotcha proposal capturing a wrong/right pattern with a why explanation. When to use: when you discover a pattern that should be enforced or warned about in future sessions.",
    inputSchema: z.object({
      skill: z.string().min(1),
      wrong: z.string().min(1),
      right: z.string().min(1),
      why: z.string().min(1),
      appType: z.string().optional(),
    }),
    handler: async (input) => {
      const cwd = process.cwd();
      return runGotchaProposeJson({ archDir: requireArchDir(cwd), ...input });
    },
  },

  archkit_gotcha_list: {
    description: "List all skills with their gotcha counts. When to use: to see what gotchas already exist before proposing a new one, or to identify skills with weak coverage.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGotchaListJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_stats: {
    description: "Get a health dashboard for the .arch/ context system: SYSTEM/INDEX coverage, skills, graphs, APIs, and prioritized recommendations. When to use: to assess archkit setup completeness or pick what to improve next.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runStatsJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_drift: {
    description: "Detect stale .arch/ files (e.g. skills referencing removed packages, missing imports). When to use: as a periodic maintenance check or when the codebase has changed significantly.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runDriftJson({ archDir: requireArchDir(cwd), cwd });
    },
  },
};
