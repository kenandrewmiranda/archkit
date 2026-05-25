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
import { runLogDecisionJson } from "../commands/decisions.mjs";
import { runPrdCheckJson } from "../commands/prd.mjs";
import { runInitJson } from "../commands/init-mcp.mjs";
import { runBoundaryCheckJson } from "../commands/boundary.mjs";
import { runDoctorJson } from "../commands/doctor.mjs";
import { runGoalIntake, runGoalList, runGoalComplete, runGoalPayload } from "../commands/goal.mjs";
import { loadGoal } from "../lib/goals.mjs";
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
    description: "Review one or more named files against archkit rules and gotchas. Returns structured findings (errors / warnings / infos) keyed by filepath, plus a pass:boolean. Each finding has a `type` (rule family) you can disable project-wide via .arch/config.json → review.disable (e.g. \"http-client\", \"db-efficiency\"); architecture families (import-hierarchy, import-boundary, boundary-violation, reserved-word) cannot be disabled. Non-JS files (.swift, .kt, .go, .py, .rs, .rb, ...) skip JS-ecosystem heuristics automatically. When to use: AFTER editing specific code paths, BEFORE committing. For \"check everything I'm about to commit,\" prefer archkit_review_staged.",
    inputSchema: z.object({
      files: z.array(z.string().min(1)).min(1).describe("Paths (relative to cwd or absolute) to review. Must exist on disk."),
    }),
    handler: async ({ files }) => {
      const cwd = process.cwd();
      return runReviewJson({ files, archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_review_staged: {
    description: "Review the git INDEX (files added with `git add` — not unstaged working-tree edits, not the last commit) against archkit rules. Resolves files via `git diff --cached --name-only --diff-filter=ACM`, then keeps any path whose extension is a known code file: JS/TS (.js .jsx .ts .tsx .mjs .cjs .vue .svelte .astro) AND non-JS (.swift .kt .kts .java .scala .go .rs .py .rb .php .ex .exs .cs .fs .vb .c .h .cpp .cc .hpp .m .mm .dart .lua .pl .r .jl .clj .cljs .sh .bash .zsh .ps1). Lockfiles, images, markdown, and binaries are skipped. If files:0 in the result, nothing in that allowlist is currently in the git index — re-run `git add` first. Same .arch/config.json → review.disable rules apply. When to use: as a pre-commit safety net, or when the user mentions staging / committing.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runReviewJson({ files: [], archDir: requireArchDir(cwd), cwd, staged: true });
    },
  },

  archkit_resolve_warmup: {
    description: "Run health checks on the .arch/ context system. Default (deep:false): structural checks only — SYSTEM.md present, INDEX.md parseable, clusters/ and skills/ readable, no obvious file-vs-index mismatches. Fast (<200ms typical) and safe to call repeatedly. deep:true adds: (W011) cross-references package.json deps against skill coverage to flag major packages with no .skill file; (W012) scans .arch/apis/*.api for unpopulated [VERSION]/[BASE_URL] stubs that would force the LLM to fall back on training data; (W013) validates .arch/extensions/registry.json for orphaned entries. Deep mode reads more files and is appropriate at session start or after dependency churn. Returns { pass, mode, checks[], blockers[], warnings[], actions[] }. When to use: at the START of a coding session (default); after `npm install` or major refactors (deep:true); whenever context drift is suspected.",
    inputSchema: z.object({
      deep: z.boolean().optional().describe("If true, also run W011 (package.json↔skills coverage), W012 (.api stub detection), W013 (extension registry integrity). Default false."),
    }),
    handler: async ({ deep }) => {
      const cwd = process.cwd();
      return runWarmupJson({ archDir: requireArchDir(cwd), deep });
    },
  },

  archkit_resolve_preflight: {
    description: "Verify a feature/layer combination exists and is correctly wired in .arch/ before generating code. The set of valid `feature` values is derived from .arch/INDEX.md — specifically the node→cluster mapping under '## Nodes' (each entry like `[feature.layer] : cluster-name` registers the feature). When an unknown `feature` is passed, the response contains `error: \"unknown_feature\"` and a `valid: [...]` array listing every feature id INDEX.md currently knows about — read that array to pick the right name. `layer` is a free-form architecture layer (controller / service / repository / types / validation / test / ui / etc.) matched against the same INDEX.md entries; mismatches are reported but do not error. The handler also returns recent git history for the feature's basePath and pending gotcha proposals. **Important**: the response includes a `requiredReading: [\".arch/skills/<x>.skill\", ...]` array listing skill files relevant to this feature (matched by id, cluster-graph reference, or keyword). When non-empty, READ those skill files before writing code — they capture API quirks and known wrong-patterns that won't show up in the source tree. When to use: BEFORE writing or modifying code in a feature path, to confirm the feature exists, learn its conventions, and pull in any relevant skill context.",
    inputSchema: z.object({
      feature: z.string().min(1).describe("Feature id as it appears in .arch/INDEX.md (e.g. \"auth\", \"billing\"). Unknown ids return the full valid list."),
      layer: z.string().min(1).describe("Architecture layer for the file you're about to touch (e.g. \"controller\", \"service\", \"repository\", \"types\")."),
    }),
    handler: async ({ feature, layer }) => {
      const cwd = process.cwd();
      return runPreflightJson({ archDir: requireArchDir(cwd), cwd, feature, layer });
    },
  },

  archkit_resolve_scaffold: {
    description: "Return the scaffolding checklist for a new feature: which files to create, in what order, with what naming conventions, drawn from .arch/INDEX.md and the matching cluster .graph. The `feature` argument may be either an id that already exists in INDEX.md (returns the wiring for that feature) or a new id (returns a generic scaffold derived from SYSTEM.md conventions). When to use: when starting a new feature, BEFORE creating files — never guess directory layout from training data when this tool can give you the project's actual convention.",
    inputSchema: z.object({
      feature: z.string().min(1).describe("Feature id to scaffold. May be new or existing."),
    }),
    handler: async ({ feature }) => {
      const cwd = process.cwd();
      return runScaffoldJson({ archDir: requireArchDir(cwd), cwd, feature });
    },
  },

  archkit_resolve_lookup: {
    description: "Look up a single id in .arch/ — matches against node ids in INDEX.md, skill ids (filename without .skill), and cluster ids (filename without .graph). Returns the matching record with its source file, basePath, and any related metadata. When to use: when a referenced symbol, package, or cluster name shows up in code or conversation and you need to know what archkit considers it.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Node / skill / cluster id (e.g. \"auth.service\", \"stripe\", \"billing\")."),
    }),
    handler: async ({ id }) => {
      const cwd = process.cwd();
      return runLookupJson({ archDir: requireArchDir(cwd), id });
    },
  },

  archkit_gotcha_propose: {
    description: "Queue a new gotcha — a wrong/right code pattern with a why explanation — onto the named skill's pending proposals. Does NOT write to the .skill file directly; proposals land in .arch/proposals/ and are merged later via `archkit gotcha accept`. The `wrong` and `right` fields are matched as literal substrings by archkit review, so include enough surrounding context to be unique but not so much that minor formatting differences break the match. When to use: when you discover a pattern that should be enforced or warned about in future sessions (a bug you just fixed, a footgun the user pointed out, a convention the codebase enforces but isn't documented).",
    inputSchema: z.object({
      skill: z.string().min(1).describe("Skill id (filename without .skill) this gotcha belongs to. Must exist in .arch/skills/."),
      wrong: z.string().min(1).describe("The bad pattern, as a literal substring review will grep for."),
      right: z.string().min(1).describe("The correct replacement."),
      why: z.string().min(1).describe("One- or two-sentence explanation of the failure mode — why `wrong` is wrong."),
      appType: z.string().optional().describe("Optional archetype scoping (saas, ecommerce, realtime, data, ai, mobile, internal, content) so the gotcha only fires for matching projects."),
    }),
    handler: async (input) => {
      const cwd = process.cwd();
      return runGotchaProposeJson({ archDir: requireArchDir(cwd), ...input });
    },
  },

  archkit_gotcha_list: {
    description: "List every .skill file with its gotcha count and a sample of the wrong patterns. Use this to (a) avoid duplicating a gotcha that already exists before calling archkit_gotcha_propose, and (b) spot skills with zero gotchas — those skills are present but contribute nothing to review's pattern matching.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGotchaListJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_stats: {
    description: "Return a health dashboard for .arch/: counts of skills/clusters/nodes/APIs/decisions, SYSTEM.md and INDEX.md completeness, gotcha density per skill, and a prioritized `recommendations` list for what to improve next. Read-only. When to use: to assess archkit setup completeness, decide which skill to flesh out, or report progress to the user.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runStatsJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_drift: {
    description: "Detect mismatches between .arch/ and the live codebase: skills referencing packages that no longer exist in package.json, INDEX.md entries pointing at deleted basePaths, cluster .graph nodes whose source files are gone, name/scope mismatches. Returns findings with severity and suggested actions; does NOT modify files. When to use: as a periodic maintenance check, after a refactor, after dependency removal, or whenever review starts surfacing rules that feel outdated.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runDriftJson({ archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_log_decision: {
    description: "Append an ADR-style decision record to .arch/decisions/ — auto-numbered, dated, and slugified. When to use: WHENEVER a non-trivial architectural choice is made (stack, pattern, library, tradeoff). The .arch/decisions/ directory is the project's institutional memory across LLM context resets — every load-bearing choice belongs here.",
    inputSchema: z.object({
      title: z.string().min(1).describe("Short imperative summary of the decision, e.g. 'Use Postgres as primary database'."),
      context: z.string().min(1).describe("What forces are at play? What problem are we solving? Multi-line markdown."),
      decision: z.string().min(1).describe("What was decided, in active voice. Multi-line markdown."),
      consequences: z.string().min(1).describe("What becomes easier, harder, or constrained as a result. Multi-line markdown."),
      status: z.enum(["proposed", "accepted", "superseded", "deprecated"]).optional().describe("Default 'accepted'."),
      tags: z.array(z.string().min(1)).optional().describe("Optional categorization, e.g. ['database', 'stack']."),
    }),
    handler: async (input) => {
      const cwd = process.cwd();
      return runLogDecisionJson({ archDir: requireArchDir(cwd), ...input });
    },
  },

  archkit_prd_check: {
    description: "Detect a Product Requirements Document (PRD.md, BRIEF.md, SPEC.md, etc.) at common paths, score archetype signals from its content, and — if .arch/SYSTEM.md exists — surface mismatches between what the PRD asks for and what the system declares. When to use: BEFORE running /archkit-init (the wizard calls this first to pre-fill archetype picks), or whenever the user mentions a PRD / spec / brief / requirements doc, or to audit whether the current architecture still matches the PRD's intent. Does NOT require an .arch/ directory — works on bare projects too.",
    inputSchema: z.object({
      prdPath: z.string().optional().describe("Optional explicit path to the PRD. If omitted, common paths are searched (PRD.md, docs/PRD.md, BRIEF.md, SPEC.md, REQUIREMENTS.md, etc.)."),
    }),
    handler: async ({ prdPath }) => {
      const cwd = process.cwd();
      // archDir is optional for this tool — we want to be useful on bare projects
      let archDir = null;
      try { archDir = requireArchDir(cwd); } catch { /* ok — PRD check works without .arch/ */ }
      return runPrdCheckJson({ archDir, cwd, prdPath });
    },
  },

  archkit_boundary_check: {
    description: "Enforce structured `BAN: source-glob -> target-glob` directives parsed from .arch/BOUNDARIES.md against either the git index (staged: true), the working tree diff (diff: true), or an explicit `files` list. For each import statement on a changed line, the tool checks whether the source file matches any rule's source-glob AND the imported module matches that rule's target-glob — a match is a violation. Languages supported: JS/TS/MJS/CJS/JSX/TSX (import + require) and Python (from-import + bare import). Other languages return zero violations rather than false positives. Response shape: { files, rules, violations: [{file, line, imported, rule, source}], warnings, pass:boolean }. Use case: pre-commit / pre-review enforcement of architectural import boundaries (e.g. `BAN: copilot/* -> execution/*` from arch-poly's dogfood). This is the machine-enforcement counterpart to BOUNDARIES.md prose rules — agents and humans should rely on this rather than reading BOUNDARIES.md and self-checking.",
    inputSchema: z.object({
      staged: z.boolean().optional().describe("Check git-staged files (git diff --cached). Findings scoped to staged hunks."),
      diff: z.boolean().optional().describe("Check unstaged working-tree changes. Findings scoped to changed hunks."),
      files: z.array(z.string()).optional().describe("Explicit list of file paths to check (relative to cwd). Used when neither staged nor diff is true. Whole-file scan, no hunk filtering."),
    }),
    handler: async ({ staged, diff, files }) => {
      const cwd = process.cwd();
      const args = [];
      if (staged) args.push("--staged");
      else if (diff) args.push("--diff");
      else if (files) args.push(...files);
      return runBoundaryCheckJson({ archDir: requireArchDir(cwd), cwd, args });
    },
  },

  archkit_goal_intake: {
    description: "CGR (Clear Goal Run): accept a structured decomposition of a sprawling user ask into one or more discrete goals, persist them to .arch/goals/<slug>.md, and return a copy-pasteable payload (<=3800 chars) per goal that the user pastes after `/goal` in a fresh /clear'ed session. Call this AS SOON AS the user types a multi-goal or unclear ask in a fresh session — BEFORE writing code. You (the agent) do the decomposition: split the ask into 1..N discrete goals, give each a kebab-case slug, a one-line title, 2-5 exitCriteria, and optionally filesToTouch + requiredReading (paths like .arch/skills/<x>.skill that capture API quirks). archkit writes the files and returns payload strings — the user pastes payloads[0].payload after /goal to begin the first goal. If the ask is one goal, pass a single-element goals array. If the ask is ambiguous, ASK the user to clarify before calling this. Workflow: intake -> /clear + paste payload 0 -> work goal 0 -> archkit_goal_complete -> /clear + paste payload 1 -> ...",
    inputSchema: z.object({
      sourceAsk: z.string().optional().describe("The user's original ask (first ~500 chars). Stored with each goal for backtrace."),
      goals: z.array(z.object({
        slug: z.string().optional().describe("Kebab-case unique id. Auto-generated from title if omitted."),
        title: z.string().min(1).describe("One-line goal title."),
        why: z.string().optional().describe("Optional 1-3 sentence motivation."),
        exitCriteria: z.array(z.string()).min(1).describe("Concrete completion conditions. Goal is done when ALL are met."),
        filesToTouch: z.array(z.string()).optional().describe("Best-guess files this goal will modify."),
        requiredReading: z.array(z.string()).optional().describe("Paths the agent must read first, e.g. .arch/skills/kalshi.skill."),
        dependsOn: z.array(z.string()).optional().describe("Other goal slugs that must complete first."),
        body: z.string().optional().describe("Optional markdown body; auto-generated if omitted."),
      })).min(1).describe("One or more goals. Order matters — payloads[0] is the first goal the user starts."),
    }),
    handler: async ({ sourceAsk, goals }) => {
      const cwd = process.cwd();
      return runGoalIntake({ archDir: requireArchDir(cwd), cwd, sourceAsk, goals });
    },
  },

  archkit_goal_list: {
    description: "List active and completed CGR goals in .arch/goals/. Use to check what's already in flight before calling archkit_goal_intake (avoid duplicating an existing goal), or to find the next goal's slug after completing one.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGoalList({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_goal_show: {
    description: "Read a CGR goal's full structured content (frontmatter + markdown body) in one round-trip — alternative to calling archkit_goal_list then Reading the returned filepath. Use when you need the goal's exit-criteria, required-reading, files-to-touch, or body to decide what to work on. Returns { slug, meta:{title, status, created, 'exit-criteria':[], 'required-reading':[], 'files-to-touch':[], 'depends-on':[], 'source-ask':...}, body, filepath }. Returns error 'unknown_goal' if the slug is not in .arch/goals/ (also lists currently-active slugs to choose from).",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug (matches the filename at .arch/goals/<slug>.md)."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      const goal = loadGoal(archDir, slug);
      if (!goal) {
        const known = runGoalList({ archDir }).active.map(g => g.slug);
        throw archkitError("unknown_goal", `unknown goal: ${slug}`, {
          suggestion: known.length > 0 ? `Active goals: ${known.join(", ")}` : "No active goals — call archkit_goal_intake first.",
        });
      }
      const exit = Array.isArray(goal.meta["exit-criteria"]) ? goal.meta["exit-criteria"] : [];
      const required = Array.isArray(goal.meta["required-reading"]) ? goal.meta["required-reading"] : [];
      const nextStep = required.length > 0
        ? `Read required-reading files (${required.slice(0, 3).join(", ")}${required.length > 3 ? "…" : ""}), then work the ${exit.length} exit criterion/criteria. Mark done via archkit_goal_complete ${slug}.`
        : `Work the ${exit.length} exit criterion/criteria. Mark done via archkit_goal_complete ${slug}.`;
      return { slug, meta: goal.meta, body: goal.body, filepath: goal.filepath, nextStep };
    },
  },

  archkit_goal_payload: {
    description: "Re-render the copy-paste payload (<=3800 chars) for an existing CGR goal — use when the user lost the payload, wants to re-paste it, or you need to inspect it before instructing /clear + /goal. archkit_goal_intake returns payloads at creation time and archkit_goal_complete returns the NEXT goal's payload; this tool covers the in-between case of fetching a specific goal's payload on demand. Returns { payload:string, length:number, withinBudget:boolean }.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to render a payload for."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      const goal = loadGoal(archDir, slug);
      if (!goal) {
        const active = runGoalList({ archDir }).active.map(g => g.slug);
        throw archkitError("unknown_goal", `unknown goal: ${slug}`, {
          suggestion: active.length > 0
            ? `Active goals: ${active.join(", ")}. Call archkit_goal_payload with one of those slugs.`
            : `No active goals. Call archkit_goal_intake first to decompose the user's ask into goals.`,
        });
      }
      return runGoalPayload({ archDir, slug });
    },
  },

  archkit_goal_complete: {
    description: "Mark a CGR goal done. Moves the file from .arch/goals/<slug>.md to .arch/goals/done/<slug>.md, records completion date, and returns the NEXT pending goal's copy-paste payload (or nextGoal:null when the queue is empty). Use this at the end of a goal session, right before instructing the user to /clear and paste the next payload. Optional `notes` is appended as completion-notes frontmatter.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to complete."),
      notes: z.string().optional().describe("Optional 1-2 sentence completion notes."),
    }),
    handler: async ({ slug, notes }) => {
      const cwd = process.cwd();
      return runGoalComplete({ archDir: requireArchDir(cwd), slug, notes });
    },
  },

  archkit_doctor: {
    description: "Workflow logistic gauge — aggregates archkit_resolve_warmup + archkit_drift findings AND adds three new intent checks that ask whether .arch/ is actually load-bearing: (1) skills with zero real WRONG/RIGHT/WHY gotchas (present on disk but contributing nothing to archkit_review), (2) BAN directives in BOUNDARIES.md whose source-glob matches no file in the working tree (warning, not error — could be future-protecting, could be stale), (3) active CGR goals in .arch/goals/ with vacuous exit-criteria (<8 chars or generic phrases like \"ship it\", \"done\") or no required-reading. Returns { pass, checks:[{id,name,status,detail}], blockers, warnings, summary, intent, sources, nextStep }. Different from warmup: warmup runs at session start and is structural (\"can I trust .arch/ at all?\"); doctor runs on demand and is intent-checking (\"does the configured surface actually fire?\"). When to use: as a periodic health check before a long session, after BOUNDARIES.md edits, after adding skills, or when archkit-driven reviews start feeling like noise.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runDoctorJson({ archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_init: {
    description: "Initialize archkit in a project — THE canonical entry point for greenfield setup. Use this WHENEVER the user asks to set up / initialize / scaffold / configure archkit, or asks how to start with archkit. Returns the full wizard instructions inline (no separate SKILL.md to find), the skeleton index for all 9 archetypes (saas, internal, content, ecommerce, ai, mobile, realtime, data, _generic), the result of an internal PRD scan, and a nextStep hint. After calling this tool, you have everything needed to drive the wizard conversation: ask the user the questions the wizardInstructions name, perform the file writes the wizardInstructions name, call other archkit_* MCP tools where named (especially archkit_log_decision for the foundation ADR). Works on both greenfield (no .arch/) and re-init scenarios.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      let archDir = null;
      try { archDir = requireArchDir(cwd); } catch { /* greenfield — that's fine */ }
      return runInitJson({ cwd, archDir });
    },
  },
};
