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
import { runBoundaryCheckJson, runBoundaryProposeJson } from "../commands/boundary.mjs";
import { runDoctorJson } from "../commands/doctor.mjs";
import { runHooksInstallJson } from "../commands/hooks.mjs";
import { runDecisionsSearchJson } from "../commands/decisions.mjs";
import { runGoalIntake, runGoalList, runGoalComplete, runGoalPayload, runGoalAbandon, runGoalVerify, runGoalDefer, runGoalPromote, runGoalDismiss, runGoalTesting, runGoalHold, runGoalConsolidate, runGraphAccept } from "../commands/goal.mjs";
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
    description: "Run health checks on the .arch/ context system. Default (deep:false): structural checks only — SYSTEM.md present, INDEX.md parseable, clusters/ and skills/ readable, no obvious file-vs-index mismatches. Fast (<200ms typical) and safe to call repeatedly. it also surfaces pending review debt: (W014) ADR proposals auto-drafted to .arch/decisions/proposed/, and (W015) graph-proposals persisted to .arch/graph-proposals/ at goal_complete (ADR 0004) whose count+slugs appear in checks/warnings and summary.pendingGraphProposals — accept them with archkit_graph_accept so the node graph stays current. deep:true adds: (W011) cross-references package.json deps against skill coverage to flag major packages with no .skill file; (W012) scans .arch/apis/*.api for unpopulated [VERSION]/[BASE_URL] stubs that would force the LLM to fall back on training data; (W013) validates .arch/extensions/registry.json for orphaned entries. Deep mode reads more files and is appropriate at session start or after dependency churn. Returns { pass, mode, checks[], blockers[], warnings[], actions[], summary }. When to use: at the START of a coding session (default); after `npm install` or major refactors (deep:true); whenever context drift is suspected.",
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

  archkit_boundary_propose: {
    description: "Queue a proposed `BAN: source -> target` architectural boundary for human review — the capture-symmetry partner to archkit_gotcha_propose. Call when you discover a layering rule the codebase should enforce (e.g. the web layer must not import the db layer directly). archkit does NOT auto-merge it: a wrong BAN blocks real work, so this writes a pending proposal to .arch/boundary-proposals/ and a human pastes the banLine into BOUNDARIES.md. Validates the glob syntax (supports `*` and trailing `/*`) and no-ops if the rule is already enforced. Returns { queued, proposalPath, banLine, nextStep }.",
    inputSchema: z.object({
      source: z.string().min(1).describe("Source glob — the layer that must NOT import the target. E.g. 'src/web/*'."),
      target: z.string().min(1).describe("Target glob — what the source is banned from importing. E.g. 'src/db/*'."),
      why: z.string().optional().describe("Optional short rationale, appended as a parenthetical to the BAN line."),
    }),
    handler: async ({ source, target, why }) => {
      const cwd = process.cwd();
      return runBoundaryProposeJson({ archDir: requireArchDir(cwd), source, target, why });
    },
  },

  archkit_goal_intake: {
    description: "CGR (Clear Goal Run): accept a structured decomposition of a sprawling user ask into one or more discrete goals, persist them to .arch/goals/<slug>.md, and return a payload per goal (<=3800 chars). Call this AS SOON AS the user types a multi-goal or unclear ask in a fresh session — BEFORE writing code. You (the agent) do the decomposition: split the ask into 1..N discrete goals, give each a kebab-case slug, a one-line title, 2-5 exitCriteria, and optionally filesToTouch + requiredReading (paths like .arch/skills/<x>.skill that capture API quirks). If the ask is one goal, pass a single-element goals array. If the ask is ambiguous, ASK the user to clarify before calling this. To START the first goal, tell the user to run /clear then the slash command /mcp__archkit__goal_next (the relay — it marks the next goal in-progress and injects it automatically; the returned payloads are a fallback they can paste after /goal). You CANNOT run /clear or /mcp__archkit__goal_next yourself — they are the user's keystrokes; your job is to instruct them. Workflow: intake -> user: /clear + /mcp__archkit__goal_next -> work goal 0 (the Stop hook blocks stopping until it's done) -> archkit_goal_complete -> user: /clear + /mcp__archkit__goal_next -> ... TEST GATE: the project's test command is auto-detected from package.json scripts.test and baked onto each goal as verify-command; archkit_goal_complete re-runs it and refuses to complete on red. Pass verifyCommand per goal to scope it to that goal's slice (e.g. \"vitest run src/auth/\") or to set one when auto-detect can't.",
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
        verifyCommand: z.string().optional().describe("Test/verify command that gates completion (e.g. \"npm test\", \"vitest run src/auth/\"). Auto-detected from package.json scripts.test if omitted. archkit_goal_complete re-runs it and refuses to complete on red — bakes test confirmation into the goal. Set explicitly to scope to the goal's slice of the suite."),
        body: z.string().optional().describe("Optional markdown body; auto-generated if omitted."),
      })).min(1).describe("One or more goals. Order matters — payloads[0] is the first goal the user starts."),
    }),
    handler: async ({ sourceAsk, goals }) => {
      const cwd = process.cwd();
      return runGoalIntake({ archDir: requireArchDir(cwd), cwd, sourceAsk, goals });
    },
  },

  archkit_goal_list: {
    description: "List active and completed CGR goals in .arch/goals/. Use to check what's already in flight before calling archkit_goal_intake (avoid duplicating an existing goal), or to find the next goal's slug after completing one. Also returns `digests` (recent dated consolidation summaries from goals/done/digest/, each with the slugs it covers + a relativePath) and `archived` (count of raw CGRs preserved verbatim under goals/done/archive/ for full-context recovery) — this is the discoverable surface for the incremental consolidation/digest produced at queue-drain.",
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
    description: "Mark a CGR goal done. Moves the file from .arch/goals/<slug>.md to .arch/goals/done/<slug>.md, records completion date, and returns the NEXT pending goal's payload (or nextGoal:null when the queue is empty). Call this AS SOON AS the active goal's exit-criteria are all met — it is the signal that RELEASES the Stop-hook relay guard so the session can end. HARD TEST GATE: if the goal has a verify-command (auto-detected at intake or set explicitly), this re-runs it and REFUSES to complete on red — erroring with test_gate_failed and the failing output tail. Fix the tests and retry, or archkit_goal_abandon if the goal is obsolete. On success it stamps tests-passed/tests-command/tests-at on the archived goal. When this completion DRAINS the queue (no goal left), it also fires the incremental consolidation/digest: terminal goals are summarized into a dated digest at goals/done/digest/<date>.md and their raw CGR files are preserved verbatim under goals/done/archive/ (returned as `consolidation`). Then tell the user to run /clear then /mcp__archkit__goal_next to start the next goal in a fresh context (the returned payload is a fallback they can paste after /goal). Optional `notes` is appended as completion-notes frontmatter.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to complete."),
      notes: z.string().optional().describe("Optional 1-2 sentence completion notes."),
    }),
    handler: async ({ slug, notes }) => {
      const cwd = process.cwd();
      return runGoalComplete({ archDir: requireArchDir(cwd), cwd, slug, notes });
    },
  },

  archkit_goal_testing: {
    description: "CGR lifecycle transition: move an in-progress goal into the `testing` state — edits applied, verification still PENDING (ADR 0003). This is the antidote to the premature-completion antipattern: instead of calling archkit_goal_complete the instant a fast mass-edit lands (which hides unverified work in done/), park the goal as visible verification debt. The file relocates to .arch/goals/testing/<slug>.md (the one loud verification drawer) and the goal stays GUARDED by the Stop hook — it is NOT done. A goal in testing survives /clear and keeps blocking the relay until a (possibly later, fresh) session runs its verify-command/exit-criteria green and calls archkit_goal_complete. When to use: right after applying a goal's edits, BEFORE you've actually run the tests — especially when batching many edits whose verification you want to drain deliberately rather than rubber-stamp. Returns { slug, status:'testing', filepath, verifyCommand, nextStep }.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to move into the testing (verification-pending) state."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      return runGoalTesting({ archDir: requireArchDir(cwd), slug });
    },
  },

  archkit_goal_hold: {
    description: "CGR lifecycle transition: park a real, queued goal as `on-hold` — deliberately set aside but resumable (ADR 0003). Distinct from archkit_goal_defer (which stashes a follow-up PROPOSAL) and from depends-on blocking (auto-resolved): on-hold means a human/agent chose to pause work that is already in the queue. Unlike `testing`, parking RELEASES the Stop-hook relay guard so the session can end, and the goal is NOT auto-selected ahead of pending/testing work — nextEligibleGoal only offers it as a last-resort resume once nothing live is left. The file stays in .arch/goals/ root (status frontmatter is the source of truth, not a folder). Resume later with /clear then /mcp__archkit__goal_next, which flips it back to in-progress. When to use: when you need to set the current goal aside (blocked on an external decision, reprioritized) without dropping it (use archkit_goal_abandon to drop). Returns { slug, status:'on-hold', filepath, nextStep }.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to park as on-hold (deliberately set aside, resumable)."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      return runGoalHold({ archDir: requireArchDir(cwd), slug });
    },
  },

  archkit_goal_consolidate: {
    description: "Run the incremental CGR consolidation/digest phase on demand: fold every terminal goal currently sitting at the top level of .arch/goals/done/ into a dated per-day digest (goals/done/digest/<YYYY-MM-DD>.md) and preserve each raw CGR file verbatim under goals/done/archive/<slug>.md so an agent can still pull full context after the summary is written. INCREMENTAL — it only ever drains what is already terminal (completed/abandoned), so it is SAFE to call while other goals are still pending or in-progress; it is NOT gated on an empty queue. Idempotent: once a goal is archived it won't be re-digested. The relay also fires this automatically at queue-drain (archkit_goal_complete) and session-end (Stop hook); call this tool to trigger it explicitly (e.g. mid-sprint, to summarize a batch of finished goals). The resulting digests are discoverable via archkit_goal_list. Returns { date, consolidated, archived:[...], slugs:[...], digestPath, nextStep }.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGoalConsolidate({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_graph_accept: {
    description: "Close the write-back half of the CGR graph flywheel (ADR 0004): apply ONE authored node line from a persisted graph-proposal to its cluster .graph, then drop the consumed gap. archkit_goal_complete only DETECTS graph gaps and writes a proposal to .arch/graph-proposals/<slug>.json (with a fill-in suggestedLine per undocumented file); this tool COMMITS the authored node — the propose→accept partner to archkit_boundary_propose / archkit_gotcha_propose. You (the warm agent) author the node prose: take the proposal's suggestedLine, replace the <role — fill in> / <flow — fill in> placeholders with the file's real role + in/out flow, and pass it as `line`. archkit NEVER auto-merges a graph edit (a wrong node misleads every future warmup), and it parse-validates the line through the same loader warmup/preflight use — a malformed line is REFUSED and the .graph is left untouched. Only undocumented-file gaps (a file sitting under an existing cluster's basePath) are appendable; unmapped-area gaps need a whole new cluster + INDEX node and are refused with guidance rather than guessed at. When a proposal has multiple gaps, pass `file` to pick one; the proposal file is deleted once its last gap is accepted. When to use: right after archkit_goal_complete reports graph gaps, while context is still warm. Returns { ok, cluster, node, appendedLine, clusterPath, remainingGaps, proposalRemoved, nextStep }.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug whose graph-proposal (.arch/graph-proposals/<slug>.json) you're accepting from."),
      line: z.string().min(1).describe("The authored node line to append, e.g. \"WarmupCmd [S] : src/commands/resolve/warmup.mjs — session health checks | ArchkitBin → THIS → Parsers\". Take the proposal's suggestedLine and fill its <role>/<flow> placeholders. Must parse as a graph node or it is refused."),
      file: z.string().optional().describe("Which gap to accept, when the proposal has more than one. The file path as it appears in the proposal's gaps. Omit when the proposal has a single gap."),
    }),
    handler: async ({ slug, line, file }) => {
      const cwd = process.cwd();
      return runGraphAccept({ archDir: requireArchDir(cwd), slug, line, file });
    },
  },

  archkit_goal_verify: {
    description: "Gather evidence for whether a CGR goal is actually done — WITHOUT auto-completing it. Echoes the goal's exit-criteria as a checklist and adds objective signals: which of its files-to-touch are modified in the working tree, what a staged review finds (errors/findings), and — if the goal has a verify-command — a PREVIEW test run (archkit_goal_complete re-runs it as the authoritative gate). Use this right before archkit_goal_complete to avoid declaring done prematurely. Returns { slug, exitCriteria, filesToTouch:{touched,untouched}, stagedReview:{files,errors,findings}, tests:{command,ran,passed,exitCode,outputTail}, clean, nextStep }. clean is false if tests are red. Does not modify anything.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to verify."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      return runGoalVerify({ archDir: requireArchDir(cwd), cwd, slug });
    },
  },

  archkit_goal_abandon: {
    description: "Drop a CGR goal WITHOUT marking it done — for goals that are obsolete, mis-scoped, or superseded. Archives the file to .arch/goals/done/<slug>.md with status 'abandoned' (kept for history, distinct from completed), clears the relay turn-cap, and releases the Stop-hook guard. Returns the next pending goal's payload like archkit_goal_complete. Use instead of goal_complete when the work should NOT count as finished. Optional `reason` is stored as abandon-reason frontmatter.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to abandon."),
      reason: z.string().optional().describe("Optional 1-2 sentence reason (stored on the archived goal)."),
    }),
    handler: async ({ slug, reason }) => {
      const cwd = process.cwd();
      return runGoalAbandon({ archDir: requireArchDir(cwd), slug, reason });
    },
  },

  archkit_goal_defer: {
    description: "Stash a follow-up you noticed mid-session as a PROPOSED goal for a LATER session — without derailing the current goal. Use the moment you spot worthwhile work that is out of scope right now ('this also needs retry logic, but not in this goal'). Writes to .arch/goals/proposed/ (NOT a real goal yet); it does not change the active goal or the queue. At session end the user runs /mcp__archkit__goal_review to promote selected proposals into planned goals (or dismiss them). Prefer this over leaving a TODO in code or prose — proposals survive context resets and are surfaced for explicit confirmation. Returns { proposed, hash, duplicate, totalPending, nextStep }.",
    inputSchema: z.object({
      title: z.string().min(1).describe("One-line title of the follow-up, imperative if possible (e.g. 'Add retry/backoff to the upload client')."),
      why: z.string().optional().describe("Optional 1-2 sentence motivation — why this matters and why it's deferred."),
      exitCriteria: z.array(z.string()).optional().describe("Optional concrete completion conditions, carried onto the goal when promoted."),
      context: z.string().optional().describe("Optional short excerpt of where this came up, stored for backtrace."),
    }),
    handler: async (input) => {
      const cwd = process.cwd();
      return runGoalDefer({ archDir: requireArchDir(cwd), ...input });
    },
  },

  archkit_goal_promote: {
    description: "Promote pending follow-up proposals (from .arch/goals/proposed/, created by archkit_goal_defer or the Stop-hook deferred-work detector) into real PLANNED goals the CGR queue will pick up. Pass hashes:[...] for a user-selected subset, or all:true to promote everything pending. This is the 'confirm' half of the propose-and-confirm flow — call it AFTER presenting the proposals to the user (see the /mcp__archkit__goal_review prompt, which gathers their multi-select choice). Removes each promoted proposal. Returns { promoted:[{hash,slug}], notFound, remaining, nextStep }.",
    inputSchema: z.object({
      hashes: z.array(z.string().min(1)).optional().describe("Proposal hashes to promote (the user's selection). Omit when all:true."),
      all: z.boolean().optional().describe("Promote every pending proposal. Overrides hashes."),
    }),
    handler: async ({ hashes, all }) => {
      const cwd = process.cwd();
      return runGoalPromote({ archDir: requireArchDir(cwd), hashes, all });
    },
  },

  archkit_goal_dismiss: {
    description: "Discard pending follow-up proposals from .arch/goals/proposed/ WITHOUT turning them into goals — the 'reject' half of the propose-and-confirm flow. Pass hashes:[...] for a subset or all:true to clear the queue. Use for noise the detector drafted or follow-ups the user declined in /mcp__archkit__goal_review. To inspect what's pending first, the goal_review prompt lists them. Returns { dismissed, remaining, nextStep }.",
    inputSchema: z.object({
      hashes: z.array(z.string().min(1)).optional().describe("Proposal hashes to dismiss. Omit when all:true."),
      all: z.boolean().optional().describe("Dismiss every pending proposal."),
    }),
    handler: async ({ hashes, all }) => {
      const cwd = process.cwd();
      return runGoalDismiss({ archDir: requireArchDir(cwd), hashes, all });
    },
  },

  archkit_doctor: {
    description: "Workflow logistic gauge — aggregates archkit_resolve_warmup + archkit_drift findings AND adds four surface checks that ask whether .arch/ is actually load-bearing: (1) skills with zero real WRONG/RIGHT/WHY gotchas (present on disk but contributing nothing to archkit_review), (2) BAN directives in BOUNDARIES.md whose source-glob matches no file in the working tree (warning, not error — could be future-protecting, could be stale), (3) active CGR goals in .arch/goals/ with vacuous exit-criteria (<8 chars or generic phrases like \"ship it\", \"done\") or no required-reading, (4) whether archkit's guardrail hooks are even installed (D-HOOKS) — if not, the SessionStart digest, CGR Stop-guard, and review-on-edit never fire; fix with archkit_install_hooks. Returns { pass, checks:[{id,name,status,detail}], blockers, warnings, summary, intent, sources, nextStep }. Different from warmup: warmup runs at session start and is structural (\"can I trust .arch/ at all?\"); doctor runs on demand and is intent-checking (\"does the configured surface actually fire?\"). When to use: as a periodic health check before a long session, after BOUNDARIES.md edits, after adding skills, or when archkit-driven reviews start feeling like noise.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runDoctorJson({ archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_decisions_search: {
    description: "Search or list past architectural decisions (ADRs in .arch/decisions/). archkit_log_decision WRITES ADRs; this READS them back — closing archkit's institutional-memory loop so a settled choice isn't re-litigated after a context reset. Pass `query` for keyword-ranked results (matches title/tags weighted over body), or omit it to list the most recent decisions. Optional `status` (accepted/proposed/superseded/deprecated), `tags` filter, `limit` (default 10, cap 50). Call BEFORE changing an area to honor prior decisions — archkit_resolve_preflight also surfaces related ADRs automatically. Returns { decisions:[{number,title,status,date,tags,summary,relativePath,score}], total, returned, decisionsNote, nextStep }.",
    inputSchema: z.object({
      query: z.string().optional().describe("Keywords to rank ADRs by (title/tags/body). Omit to list recent decisions."),
      status: z.enum(["accepted", "proposed", "superseded", "deprecated"]).optional().describe("Only ADRs with this status."),
      tags: z.array(z.string()).optional().describe("Only ADRs carrying at least one of these tags."),
      limit: z.number().optional().describe("Max results (default 10, capped at 50)."),
    }),
    handler: async ({ query, status, tags, limit }) => {
      const cwd = process.cwd();
      return runDecisionsSearchJson({ archDir: requireArchDir(cwd), query, status, tags, limit });
    },
  },

  archkit_install_hooks: {
    description: "Check whether archkit's five guardrail hooks (SessionStart, Stop, PreToolUse, PostToolUse, UserPromptSubmit) are wired into Claude Code — and help install them. CRITICAL: `archkit init --install-hooks` predates these and does NOT install them, so on npm/global installs the CGR Stop-hook relay guard, the SessionStart tools digest, the PreToolUse boundary block, and review-on-edit silently never fire even when .arch/ is perfect. The MCP layer is the only surface that can detect this (it's connected regardless of hook wiring). archkit_doctor flags missing hooks; call THIS to fix them. Default (no args) = EMIT mode: returns hooksConfig (the exact { hooks } block) + the target .claude/settings.json path + instruction, for you to merge via Edit so the user sees the diff. Pass apply:true to write the missing hooks directly into the PROJECT's .claude/settings.json (preserves existing hooks; never touches the global user file). If the archkit plugin is enabled, the hooks come from it and this is a no-op. After install, the user must RESTART Claude Code for hooks to load.",
    inputSchema: z.object({
      apply: z.boolean().optional().describe("If true, write the missing guardrail hooks directly into the project's .claude/settings.json (idempotent, preserves existing hooks). Default false = emit the config for you to apply via Edit with the user watching."),
    }),
    handler: async ({ apply }) => {
      const cwd = process.cwd();
      return runHooksInstallJson({ cwd, apply: apply === true });
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
