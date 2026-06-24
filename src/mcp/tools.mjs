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
import { runAuditSpecJson } from "../commands/resolve/audit-spec.mjs";
import { runVerifyWiringJson } from "../commands/resolve/verify-wiring.mjs";
import { runLookupJson } from "../commands/resolve.mjs";
import { runGotchaListJson, runGotchaProposeJson } from "../commands/gotcha.mjs";
import { runStatsJson } from "../commands/stats.mjs";
import { runDriftJson } from "../commands/drift.mjs";
import { runLogDecisionJson } from "../commands/decisions.mjs";
import { runPrdCheckJson } from "../commands/prd.mjs";
import { runInitJson } from "../commands/init-mcp.mjs";
import { runInitGenerateJson } from "../commands/init-generate.mjs";
import { runBoundaryCheckJson, runBoundaryProposeJson } from "../commands/boundary.mjs";
import { runDoctorJson } from "../commands/doctor.mjs";
import { runSyncJson } from "../commands/sync.mjs";
import { runHooksInstallJson } from "../commands/hooks.mjs";
import { runDecisionsSearchJson } from "../commands/decisions.mjs";
import { runGoalIntake, runGoalList, runGoalComplete, runGoalPayload, runGoalStart, runGoalAbandon, runGoalVerify, runGoalDefer, runGoalPromote, runGoalDismiss, runGoalTesting, runGoalHold, runGoalConsolidate, runGraphAccept, runGoalHandoff, runGoalFission } from "../commands/goal.mjs";
import { runWorklog } from "../commands/worklog.mjs";
import { loadGoal } from "../lib/goals.mjs";
import { sessionState, conductorPlan } from "../lib/board.mjs";
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
    description: "Run health checks on the .arch/ context system. Default (deep:false): structural checks only — SYSTEM.md present, INDEX.md parseable, clusters/ and playbooks/ (legacy skills/) readable, no obvious file-vs-index mismatches. Fast (<200ms typical) and safe to call repeatedly. it also surfaces pending review debt: (W014) ADR proposals auto-drafted to .arch/decisions/proposed/, and (W015) graph-proposals persisted to .arch/graph-proposals/ at goal_complete (ADR 0004) whose count+slugs appear in checks/warnings and summary.pendingGraphProposals — accept them with archkit_graph_accept so the node graph stays current. deep:true adds: (W011) cross-references package.json deps against playbook coverage to flag major packages with no playbook; (W012) scans .arch/apis/*.api for unpopulated [VERSION]/[BASE_URL] stubs that would force the LLM to fall back on training data; (W013) validates .arch/extensions/registry.json for orphaned entries. Deep mode reads more files and is appropriate at session start or after dependency churn. Returns { pass, mode, checks[], blockers[], warnings[], actions[], summary }. When to use: at the START of a coding session (default); after `npm install` or major refactors (deep:true); whenever context drift is suspected.",
    inputSchema: z.object({
      deep: z.boolean().optional().describe("If true, also run W011 (package.json↔playbooks coverage), W012 (.api stub detection), W013 (extension registry integrity). Default false."),
    }),
    handler: async ({ deep }) => {
      const cwd = process.cwd();
      return runWarmupJson({ archDir: requireArchDir(cwd), deep });
    },
  },

  archkit_resolve_preflight: {
    description: "Verify a feature/layer combination exists and is correctly wired in .arch/ before generating code. The set of valid `feature` values is derived from .arch/INDEX.md — specifically the node→cluster mapping under '## Nodes' (each entry like `[feature.layer] : cluster-name` registers the feature). When an unknown `feature` is passed, the response contains `error: \"unknown_feature\"` and a `valid: [...]` array listing every feature id INDEX.md currently knows about — read that array to pick the right name. `layer` is a free-form architecture layer (controller / service / repository / types / validation / test / ui / etc.) matched against the same INDEX.md entries; mismatches are reported but do not error. The handler also returns recent git history for the feature's basePath and pending gotcha proposals. **Important**: the response includes a `requiredReading: [\".arch/playbooks/<x>.playbook\", ...]` array listing playbook files relevant to this feature (matched by id, cluster-graph reference, or keyword). When non-empty, READ those playbook files before writing code — they capture API quirks and known wrong-patterns that won't show up in the source tree. When to use: BEFORE writing or modifying code in a feature path, to confirm the feature exists, learn its conventions, and pull in any relevant playbook context.",
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
    description: "Look up a single id in .arch/ — matches against node ids in INDEX.md, playbook ids (filename without .playbook / legacy .skill), and cluster ids (filename without .graph). Returns the matching record with its source file, basePath, and any related metadata. When to use: when a referenced symbol, package, or cluster name shows up in code or conversation and you need to know what archkit considers it.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Node / playbook / cluster id (e.g. \"auth.service\", \"stripe\", \"billing\")."),
    }),
    handler: async ({ id }) => {
      const cwd = process.cwd();
      return runLookupJson({ archDir: requireArchDir(cwd), id });
    },
  },

  archkit_gotcha_propose: {
    description: "Queue a new gotcha — a wrong/right code pattern with a why explanation — onto the named playbook's pending proposals. Does NOT write to the playbook file directly; proposals land in .arch/proposals/ and are merged later via `archkit gotcha accept`. The `wrong` and `right` fields are matched as literal substrings by archkit review, so include enough surrounding context to be unique but not so much that minor formatting differences break the match. When to use: when you discover a pattern that should be enforced or warned about in future sessions (a bug you just fixed, a footgun the user pointed out, a convention the codebase enforces but isn't documented).",
    inputSchema: z.object({
      skill: z.string().min(1).describe("Playbook id (filename without .playbook) this gotcha belongs to. Must exist in .arch/playbooks/ (or legacy .arch/skills/). The param is named `skill` for back-compat."),
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
    description: "List every playbook file (.arch/playbooks/*.playbook, legacy .arch/skills/*.skill) with its gotcha count and a sample of the wrong patterns. Use this to (a) avoid duplicating a gotcha that already exists before calling archkit_gotcha_propose, and (b) spot playbooks with zero gotchas — those playbooks are present but contribute nothing to review's pattern matching. (Returns a `skills` array key for back-compat.)",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGotchaListJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_stats: {
    description: "Return a health dashboard for .arch/: counts of playbooks/clusters/nodes/APIs/decisions, SYSTEM.md and INDEX.md completeness, gotcha density per playbook, and a prioritized `recommendations` list for what to improve next. Read-only. When to use: to assess archkit setup completeness, decide which playbook to flesh out, or report progress to the user.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runStatsJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_drift: {
    description: "Detect mismatches between .arch/ and the live codebase: playbooks referencing packages that no longer exist in package.json, INDEX.md entries pointing at deleted basePaths, cluster .graph nodes whose source files are gone, name/scope mismatches. Returns findings with severity and suggested actions; does NOT modify files. When to use: as a periodic maintenance check, after a refactor, after dependency removal, or whenever review starts surfacing rules that feel outdated.",
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

  archkit_audit_spec: {
    description: "Audit a spec/PRD's `- [ ] REQ-...` requirements against the source tree and report which appear implemented. This is requirement-by-requirement COVERAGE — the agent's 'did I build every REQ?' self-check — and is DISTINCT from archkit_prd_check, which scores archetype/mode DRIFT of a PRD vs SYSTEM.md (does the doc still match the declared architecture). Parses requirements from `- [ ] REQ-001: Description` checkbox lines or `| REQ-001 | ... |` table rows, then keyword-matches each against code under srcDir. Returns { total, covered, uncovered, coveragePercent, items:[{id,description,covered,coverage,...}], specFile, srcDir, nextStep }. A missing spec file, or a spec with zero REQ lines, returns a structured { error, suggestion, nextStep } envelope (never a throw or silent empty result). NOTE: coverage is a heuristic keyword match, not proof — treat uncovered as 'likely missing' and covered as 'likely present, verify'. When to use: after finishing a feature or CGR goal, to self-check requirement coverage before declaring done.",
    inputSchema: z.object({
      specFile: z.string().min(1).describe("Path (relative to cwd or absolute) to the spec/PRD/brief containing `- [ ] REQ-...` requirement lines."),
      srcDir: z.string().optional().describe("Source directory to scan for implementation evidence. Default 'src'."),
    }),
    handler: async ({ specFile, srcDir = "src" }) => {
      const cwd = process.cwd();
      return runAuditSpecJson({ archDir: requireArchDir(cwd), specFile, srcDir });
    },
  },

  archkit_sync: {
    description: "Detect .arch/ spec files that have gone stale against the live src/ tree — the context-freshness scan. Compares the codebase to .arch/ and reports what an agent must author/update to keep its context current: new feature directories (src/features|modules|domains/* plus *.handler / *.chain files) missing from INDEX.md, installed package.json deps that match a known playbook but have no playbook file, INDEX.md nodes whose basePath directory was deleted, and playbook version drift vs the installed package version. Returns { archDir, srcDir, suggestions:[{type,id,action,command?}], syncNeeded:boolean, nextStep }. DISTINCT from archkit_drift (which reconciles the cluster .graph node-graph against source files — drift is graph-internal consistency; sync is which .arch/ DOCS need writing after you add features or deps) and from archkit_doctor (which gauges whether the .arch/ surface is load-bearing at all). When to use: after adding a feature directory, installing/removing a dependency, or deleting code — to find which .arch/ files need updating so future-session context isn't stale.",
    inputSchema: z.object({
      srcDir: z.string().optional().describe("Source directory to compare against .arch/. Default 'src'."),
    }),
    handler: async ({ srcDir = "src" }) => {
      const cwd = process.cwd();
      return runSyncJson({ archDir: requireArchDir(cwd), srcDir });
    },
  },

  archkit_verify_wiring: {
    description: "Scan the source tree for exported functions/classes that are never imported outside their own directory — the dead-code / unwired-component check. The post-implementation 'is it actually wired?' question: after building a feature, confirm its exports are reachable, not orphaned. Walks srcDir (skips node_modules/dist/dotfiles and .test./.spec. files), builds an export map and a cross-file import graph, then flags any file whose exports have ZERO external importers. Files matching entry-point patterns (*.controller/route/router/middleware/handler.*, app.*, index.*) are excluded — they are mounted, not imported. Each finding is { file, exports:[...], internalImporters:[...], status } where status is DEAD_CODE (no importers at all) or INTERNAL_ONLY (imported only within its own dir). Supports .ts/.tsx/.js/.mjs; a non-JS/TS tree returns a warning, not findings. Returns { files, exports, unwired:[...], srcDir, nextStep } (or { error/warning, ... } envelopes). NOTE: a heuristic — dynamic imports, DI containers, and framework auto-loading can make a real component look unwired; treat findings as 'likely orphaned, verify' before deleting. DISTINCT from archkit_drift (reconciles the .arch/ graph against source) and archkit_review (rule/gotcha lint of named files). When to use: after finishing a feature or CGR goal, to catch components you wrote but forgot to wire in.",
    inputSchema: z.object({
      srcDir: z.string().optional().describe("Source directory to scan for unwired/dead components. Default 'src'."),
    }),
    handler: async ({ srcDir = "src" }) => {
      const cwd = process.cwd();
      return runVerifyWiringJson({ archDir: requireArchDir(cwd), srcDir });
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
    description: "CGR (Clear Goal Run): accept a structured decomposition of a sprawling user ask into one or more discrete goals, persist them to .arch/goals/<slug>.md, and return a payload per goal (<=3800 chars). Call this AS SOON AS the user types a multi-goal or unclear ask in a fresh session — BEFORE writing code. You (the agent) do the decomposition: split the ask into 1..N discrete goals, give each a kebab-case slug, a one-line title, 2-5 exitCriteria, and optionally filesToTouch + requiredReading (paths like .arch/playbooks/<x>.playbook that capture API quirks). If the ask is one goal, pass a single-element goals array. If the ask is ambiguous, ASK the user to clarify before calling this. To START the first goal, tell the user to run /clear then the slash command /mcp__archkit__goal_next (the relay — it marks the next goal in-progress and injects it automatically; the returned payloads are a fallback they can paste after /goal). You CANNOT run /clear or /mcp__archkit__goal_next yourself — they are the user's keystrokes; your job is to instruct them. Workflow: intake -> user: /clear + /mcp__archkit__goal_next -> work goal 0 (the Stop hook blocks stopping until it's done) -> archkit_goal_complete -> user: /clear + /mcp__archkit__goal_next -> ... TEST GATE: the project's test command is auto-detected from package.json scripts.test and baked onto each goal as verify-command; archkit_goal_complete re-runs it and refuses to complete on red. Pass verifyCommand per goal to scope it to that goal's slice (e.g. \"vitest run src/auth/\") or to set one when auto-detect can't. PARALLEL-LANE PLANNING (CGR 2.0, ADR 0013): each goal may also carry `dependsOn` (DAG edges), `owns` (predicted file-ownership globs — the conflict unit), `feature` (cohesion tag), and `exclusive` (run-solo barrier). Intake partitions the batch into parallel lanes (grouped by feature cohesion, REQUIRING disjoint owns across lanes — overlapping ownership is serialized into one lane; exclusive goals become solo barriers), stamps each goal's computed `lane`, and returns the plan as `lanes:{ lanes, barriers, stages, parallelWidth }`. Predicting owns/feature well is what lets workers run concurrently without colliding.",
    inputSchema: z.object({
      sourceAsk: z.string().optional().describe("The user's original ask (first ~500 chars). Stored with each goal for backtrace."),
      goals: z.array(z.object({
        slug: z.string().optional().describe("Kebab-case unique id. Auto-generated from title if omitted."),
        title: z.string().min(1).describe("One-line goal title."),
        why: z.string().optional().describe("Optional 1-3 sentence motivation."),
        exitCriteria: z.array(z.string()).min(1).describe("Concrete completion conditions. Goal is done when ALL are met."),
        filesToTouch: z.array(z.string()).optional().describe("Best-guess files this goal will modify."),
        requiredReading: z.array(z.string()).optional().describe("Paths the agent must read first, e.g. .arch/playbooks/kalshi.playbook."),
        dependsOn: z.array(z.string()).optional().describe("Other goal slugs that must complete first — the dependency DAG edge. Folded by archkit_session_state into blocked/frontier and used by lane partitioning to sequence within a lane."),
        owns: z.array(z.string()).optional().describe("Predicted file-ownership globs this goal claims (e.g. [\"src/auth/*\", \"src/lib/jwt.mjs\"]) — the parallel-safety keystone (ADR 0013). Lane partitioning REQUIRES disjoint owns across parallel lanes: any two goals whose owns overlap are serialized into ONE lane. Best-effort prediction; worktree isolation is the safety net for imperfections. Falls back to filesToTouch when omitted."),
        feature: z.string().optional().describe("Feature-cohesion tag (e.g. \"auth\", \"checkout\"). The PRIMARY lane-grouping signal: goals sharing a feature land in one lane (same feature ≈ same files, kept serial + context-warm). Distinct from `epic` (sequencing) and `project` (branch isolation) — `feature` drives the conductor/worker lane partition."),
        exclusive: z.boolean().optional().describe("Mark a cross-cutting goal (repo-wide rename, \"add logging everywhere\") that must run SOLO as a barrier: everything before it merges, it runs alone, then fan-out resumes. Pulled out of the parallel lane partition and emitted as its own barrier stage."),
        epic: z.string().optional().describe("Optional group label tying this goal to a larger objective (e.g. \"oauth-migration\"). Goals sharing an epic are clustered in archkit_goal_list's `epics` view — the project-space segmentation. Slugified on write. NOTE: `epic` is a SEQUENCING group (drains one objective before the next); use `project` instead when goals should be branch-isolated for parallel work."),
        project: z.string().optional().describe("Optional branch-isolated feature set (e.g. \"oauth-ui\"). Goals sharing a project are meant to live on ONE git branch (feat/<project>) so multiple agents can work feature sets in parallel without colliding. When set, the goal's payload gains a branch-prework block telling the agent to `git switch -c feat/<project>` before editing and commit each completed CGR to that branch (archkit emits the guidance; the agent runs git). Surfaced in archkit_goal_list's `projects` view. Distinct from `epic`: epic = sequencing group (run order); project = branch-isolated feature set (parallel work). Slugified on write."),
        order: z.number().optional().describe("Explicit relay sort key — lower runs first. Omit to auto-assign from this goal's position in the goals array (offset past existing live goals), so /mcp__archkit__goal_next honors the decomposition order instead of alphabetical slug order. Set explicitly to pin a sequence."),
        verifyCommand: z.string().optional().describe("Test/verify command that gates completion (e.g. \"npm test\", \"vitest run src/auth/\"). Auto-detected from package.json scripts.test if omitted. archkit_goal_complete re-runs it and refuses to complete on red — bakes test confirmation into the goal. Set explicitly to scope to the goal's slice of the suite."),
        body: z.string().optional().describe("Optional markdown body; auto-generated if omitted."),
      })).min(1).describe("One or more goals. Order matters — the goals array order becomes each goal's relay `order` (honored by /mcp__archkit__goal_next), and payloads[0] is the first goal the user starts."),
    }),
    handler: async ({ sourceAsk, goals }) => {
      const cwd = process.cwd();
      return runGoalIntake({ archDir: requireArchDir(cwd), cwd, sourceAsk, goals });
    },
  },

  archkit_goal_list: {
    description: "List active and completed CGR goals in .arch/goals/. Active goals are returned in RELAY QUEUE ORDER (by `order` then epic then slug), so active[0] is the goal /mcp__archkit__goal_next will pick next. When any goal carries an `epic`, also returns an `epics` map (epic label -> goal slugs in queue order) — the sequencing-group segmentation view. When any goal carries a `project`, also returns a `projects` map (project label -> goal slugs in queue order) — the branch-isolated feature sets (each meant to live on feat/<project> for parallel work). Use to check what's already in flight before calling archkit_goal_intake (avoid duplicating an existing goal), or to find the next goal's slug after completing one. Also returns `digests` (recent dated consolidation summaries from goals/done/digest/, each with the slugs it covers + a relativePath) and `archived` (count of raw CGRs preserved verbatim under goals/done/archive/ for full-context recovery) — this is the discoverable surface for the incremental consolidation/digest produced at queue-drain.",
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

  archkit_session_state: {
    description: "CGR 2.0 conductor view — return the FOLDED board for parallel-lane orchestration (board-state-manager, ADR 0014). The board is purely DERIVED: it is reconstituted on every call by folding the append-only event log at .arch/board/events.ndjson (events: claimed, completed, fissioned, merged, conflict, lease-expired) and scanning the CGR record files — there is NO mutable board file, so it survives /clear and auto-compaction and can never drift from its inputs. Returns the seven-slice projection { lanes, frontier, blocked, in_flight, merge_queue, conflicts, leases_expired }: `lanes` groups every live CGR by its parallel track; `frontier` is the pending CGRs whose depends_on are all met and that aren't already claimed (the workable set a fresh worker should pull from); `blocked` is live CGRs with an unmet dependency (each with its blockedOn list); `in_flight` is CGRs claimed but not yet completed (lane/worker/lease); `merge_queue` is CGRs completed but not yet merged (full|partial); `conflicts` is file-overlap among live CGRs plus conflict events; `leases_expired` is in-flight claims whose lease TTL elapsed (reclaim as orphans). When to use: at conductor session start (after /clear or compaction) to rehydrate what remains in flight, and before dispatching a worker to pick the next frontier CGR or reclaim an expired lease. Read-only — folds, never writes.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      const board = sessionState(archDir);
      const counts = {
        lanes: Object.keys(board.lanes).length,
        frontier: board.frontier.length,
        blocked: board.blocked.length,
        in_flight: board.in_flight.length,
        merge_queue: board.merge_queue.length,
        conflicts: board.conflicts.length,
        leases_expired: board.leases_expired.length,
      };
      const empty = Object.values(counts).every((n) => n === 0);
      const out = { ...board, counts };
      if (empty) {
        // Silent-success: an empty board is a valid derived state, not a failure —
        // say so rather than returning seven bare empty slices.
        out.boardNote = "Board empty — no folded events in .arch/board/events.ndjson and no live CGRs. The board is purely derived from those inputs.";
        out.nextStep = "No CGRs in flight. Run archkit_goal_next (or intake) to queue work; workers append claimed/completed events that this board folds.";
      } else {
        out.nextStep = `Board: ${counts.frontier} frontier, ${counts.in_flight} in-flight, ${counts.merge_queue} to merge, ${counts.blocked} blocked, ${counts.leases_expired} expired leases.`;
      }
      return out;
    },
  },

  archkit_conductor: {
    description: "CGR 2.0 CONDUCTOR LOOP — the orchestration plan for one foreground (conductor) session pass (conductor-loop-hooks, ADR 0013). After /clear or compaction the foreground session ORCHESTRATES rather than codes: it reads this plan and runs the loop — (1) claim the next frontier CGR(s) under a lease (archkit advances the board; the lease TTL is cgr.leaseTtlHours, default 24h), (2) spawn ONE worker subagent per claimable LANE in an isolated git worktree (lanes have disjoint file-ownership, so they run in parallel; `barriers` are exclusive cross-cutting CGRs that run SOLO), (3) collect each worker's HANDOFF return, (4) DEEP-REVIEW ONLY the `exceptions` (partial completions, non-green verification, low ownership-accuracy, cross-lane conflicts) — rubber-stamp the `clean` set, (5) drain `mergeOrder` as a SEQUENTIAL merge queue, dependency-ordered, verifying after EACH merge. Read-only — folds the board, never writes (claim/reclaim/merge are the agent's explicit follow-up actions; archkit emits the plan, the agent acts). Returns { claimableLanes, barriers, inFlight, mergeOrder, exceptions, clean, conflicts, leasesExpired, blocked, counts, nextStep }. DISTINCT from archkit_session_state (the raw seven-slice board): conductor LAYERS the loop view on top — lane-grouped claimable work, the dependency-ordered merge queue, and the exceptions-to-review filter. When to use: at conductor session start to plan a dispatch pass, and after collecting worker handoffs to decide merges.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      const plan = conductorPlan(archDir);
      const c = plan.counts;
      const idle = c.frontier === 0 && c.in_flight === 0 && c.merge_queue === 0 && c.leases_expired === 0;
      const out = { ...plan };
      if (idle) {
        out.conductorNote = "Conductor idle — no frontier to claim, nothing in flight, empty merge queue. The plan is purely derived from the board (.arch/board/events.ndjson + CGR files).";
        out.nextStep = "Nothing to orchestrate. Run archkit_goal_intake to queue work, or /mcp__archkit__goal_next to start a goal — workers append claimed/completed events this plan folds.";
      } else {
        const review = c.exceptions > 0 ? `, deep-review ${c.exceptions} exception${c.exceptions === 1 ? "" : "s"}` : "";
        const reclaim = c.leases_expired > 0 ? `, reclaim ${c.leases_expired} orphan lease${c.leases_expired === 1 ? "" : "s"}` : "";
        out.nextStep = `Loop: claim ${c.claimableLanes} lane${c.claimableLanes === 1 ? "" : "s"}${c.barriers ? ` + ${c.barriers} barrier${c.barriers === 1 ? "" : "s"}` : ""}, ${c.in_flight} in flight, merge ${c.merge_queue} in dep order${review}${reclaim}. Spawn one worktree-isolated worker per claimable lane; merge sequentially with verify-after-each.`;
      }
      return out;
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

  archkit_goal_start: {
    description: "CGR relay — mark a SPECIFIC goal in-progress by slug and return its payload. This is the actionable companion to the /mcp__archkit__goal_next routing CHOICE: goal_next normally auto-picks the next goal, but when BOTH the ungrouped queue AND one or more project feature-sets (feat/<project>) have ready work, it surfaces a choice instead of guessing (cgr-relay-queue-vs-project-routing). After you present that choice to the user (AskUserQuestion) and they pick a track, call this with that track's recommended 'next' slug to begin it. Starting an UNGROUPED queue goal records the batch's shared cgr-queue-<date> branch (every plain queue goal reuses it); a project goal branches on feat/<project>. archkit only emits branch guidance in the payload — it never runs git. Use ONLY to resolve a routing choice or to deliberately start an out-of-order goal; for the normal one-keystroke advance the user runs /mcp__archkit__goal_next. Returns { slug, status:'in-progress', payload, nextStep }.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to start (mark in-progress). Typically the 'next' slug for the track the user chose in the goal_next routing prompt."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      return runGoalStart({ archDir: requireArchDir(cwd), slug });
    },
  },

  archkit_goal_handoff: {
    description: "CGR 2.0 wind-down — author the carry-forward HANDOFF artifact for a goal (handoff-and-winddown, ADR 0015). The attention-gradient policy reserves the context window's PEAK zone (first ~65%) for high-attention work and the degradation-TOLERANT tail for authoring this handoff: once your context fill reaches cgr.windDownAt (default 0.65, per-model override via cgr.windDownAtByModel in .arch/config.json), STOP accepting new goals and call this instead — it is the worker return, the PreCompact flush, the rehydration input, and the fission successor-input, all one object. Writes .arch/board/handoff/<slug>.md with done(+evidence), decisions, files-actual-vs-predicted, remaining, continuation-notes, open-questions, and verification-status; survives /clear and auto-compaction like the event log. Computes an OWNERSHIP-ACCURACY signal: the goal's predicted file-ownership (its `owns` globs ∪ declared files-to-touch) vs the files ACTUALLY touched (your `actualFiles` ∪ the git working tree) — surfaced as accuracy + matched/unexpected/missed. Stamps the `handoff` pointer onto the goal and (when `successor` is given) onto the fission successor CGR's frontmatter, so the handoff is referenced by successor frontmatter and readable via archkit_session_state's `handoffs` slice. Does NOT complete or move the goal (wind-down is authoring, not closing): after authoring, archkit_goal_complete it if verification is green, or park it with archkit_goal_testing. When to use: at the wind-down threshold, OR before a deliberate /clear/compaction, OR when fissioning a partial goal into a lean successor. Returns { path, pointer, ownershipAccuracy, ownership, verificationStatus, windDownAt, successor, nextStep }.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to author the handoff for."),
      done: z.array(z.union([
        z.string(),
        z.object({ criterion: z.string(), evidence: z.string().optional() }),
      ])).optional().describe("Completed exit-criteria, each ideally as { criterion, evidence } where evidence is concrete proof (test name, command output, file:line). Plain strings are accepted and stored with empty evidence."),
      decisions: z.array(z.string()).optional().describe("Non-trivial decisions made while working the goal — the institutional memory a fresh head needs. For ARCHITECTURAL decisions, also archkit_log_decision an ADR; this list is the lighter per-goal record."),
      remaining: z.array(z.string()).optional().describe("Work NOT yet done — the lean successor's starting backlog. Empty when the goal is fully complete."),
      continuationNotes: z.string().optional().describe("Free-form notes for the next session's fresh head: where you left off, gotchas, what to re-plan. The tail writes it down; the fresh head re-plans (reasoning-heavy re-planning is NOT done in the degraded tail)."),
      openQuestions: z.array(z.string()).optional().describe("Unresolved questions that need a human or a fresh-context decision."),
      verificationStatus: z.enum(["green", "red", "partial", "unverified"]).optional().describe("State of the verify-command/exit-criteria: green (all pass), red (failing), partial (some verified), or unverified (not run). Default unverified. Drives the nextStep guidance and surfaces in session_state."),
      actualFiles: z.array(z.string()).optional().describe("Files this goal actually touched. Unioned with the git working-tree changes to compute ownership accuracy vs the goal's predicted owns/files-to-touch. Omit to use the git working tree alone."),
      successor: z.string().optional().describe("Slug of the fission successor CGR to ALSO stamp with this handoff pointer (the carry-forward reference). Must already exist. Omit when not fissioning."),
      model: z.string().optional().describe("The authoring model id (e.g. claude-opus-4-8). Recorded on the handoff and used to resolve the per-model wind-down threshold (cgr.windDownAtByModel)."),
    }),
    handler: async ({ slug, done, decisions, remaining, continuationNotes, openQuestions, verificationStatus, actualFiles, successor, model }) => {
      const cwd = process.cwd();
      return runGoalHandoff({ archDir: requireArchDir(cwd), cwd, slug, done, decisions, remaining, continuationNotes, openQuestions, verificationStatus, actualFiles, successor, model });
    },
  },

  archkit_goal_complete: {
    description: "Mark a CGR goal done. Moves the file from .arch/goals/<slug>.md to .arch/goals/done/<slug>.md, records the completion DATETIME (full ISO-8601), and returns the NEXT pending goal's payload (or nextGoal:null when the queue is empty). Call this AS SOON AS the active goal's exit-criteria are all met — it is the signal that RELEASES the Stop-hook relay guard so the session can end. HARD TEST GATE: if the goal has a verify-command (auto-detected at intake or set explicitly), this re-runs it and REFUSES to complete on red — erroring with test_gate_failed and the failing output tail. Fix the tests and retry, or archkit_goal_abandon if the goal is obsolete. On success it stamps tests-passed/tests-command/tests-at on the archived goal. TIME CAPTURE: started/completed are full datetimes, so the result carries derived wall-clock elapsed (`elapsedMs` / `effort`); pass the optional `timeSpent` (e.g. '2h', '90m') to record honest hands-on effort, which is persisted as the time-spent frontmatter key and TAKES PRECEDENCE over derived elapsed (wall-clock includes idle gaps). When this completion DRAINS the queue (no goal left), it also fires the incremental consolidation/digest: terminal goals are summarized into a dated digest at goals/done/digest/<date>.md and their raw CGR files are preserved verbatim under goals/done/archive/ (returned as `consolidation`). END-OF-BUCKET: when this completion drains the LAST live goal of its bucket — a project feature set (feat/<project>) or the ungrouped queue (cgr-queue-<date>) — the result carries `bucketCompletion` ({ bucket, project, branch, mainline, mainlineSource, mergeGuidance }) and the nextStep leads with a merge-or-archive CHOICE. Present it to the user with AskUserQuestion: MERGE lands the branch (relay the emitted `mergeGuidance`, e.g. `git switch <mainline> && git merge <branch>` — archkit NEVER runs git; the user does) or ARCHIVE only (the CGRs consolidate into done/ as usual and the branch is left unmerged, no git guidance). The mainline target is configurable via .arch/config.json → cgr.mainline and otherwise detected (main/master, default main). `bucketCompletion` is null on an ordinary mid-bucket completion (no prompt). Then tell the user to run /clear then /mcp__archkit__goal_next to start the next goal in a fresh context (the returned payload is a fallback they can paste after /goal). Optional `notes` is appended as completion-notes frontmatter.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to complete."),
      notes: z.string().optional().describe("Optional 1-2 sentence completion notes."),
      timeSpent: z.string().optional().describe("Optional explicit hands-on effort (e.g. '2h', '90m', '1h30m'). Persisted as the time-spent frontmatter key and used in preference to derived wall-clock elapsed, which counts idle gaps. Omit to let archkit report the derived started→completed elapsed."),
    }),
    handler: async ({ slug, notes, timeSpent }) => {
      const cwd = process.cwd();
      return runGoalComplete({ archDir: requireArchDir(cwd), cwd, slug, notes, timeSpent });
    },
  },

  archkit_goal_fission: {
    description: "CGR 2.0 FISSION — split a PARTIALLY-met goal at wind-down with a HARD verify gate (fission-transition, ADR 0014/0015). Resume is by fission, not replay: a fully-met CGR closes normally (archkit_goal_complete), but a goal that's only PARTLY done splits here. The MET criteria are verified IN ISOLATION, and ONLY on green does the finished portion close as a terminal `partial` record while a LEAN SUCCESSOR carrying just the UNMET criteria + a carry-forward handoff + lineage (forked_from / superseded_by, linked both ways) is forked — so the next fresh session loads the remainder, not the history. The gate is HARD and inherits the same no-silent-debt rule as full completion: if verification CANNOT be ISOLATED to the met criteria (you didn't supply a `verifyCommand` scoped to them, and the goal's whole-goal verify-command would also exercise the unmet work) OR the isolated run is RED, fission BLOCKS and surfaces to attention — it NEVER forks unverified debt into the successor. Tell the agent which criteria are done via `criteriaMet` (a boolean vector aligned by index with the goal's exit-criteria); a fully-true vector is refused (complete normally), an all-false vector is refused (nothing finished to close). On success it authors the handoff (.arch/board/handoff/<slug>.md, remaining = the unmet criteria), appends cgr.closed(partial) + cgr.forked to the board event log, and the scheduler then PREFERS the forked continuation over cold pending work. When to use: at the wind-down threshold when a goal is genuinely partly-done and you want to bank the verified portion and hand off the rest. Returns { completion:'partial', closed:{slug,criteriaMet,archivedAt}, successor:{slug,carriedForward,handoff,lineage,payload}, verify, events, ownershipAccuracy, nextStep }.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to fission (the partially-met goal to split)."),
      criteriaMet: z.array(z.boolean()).optional().describe("Per-criterion met flags aligned BY INDEX with the goal's exit-criteria (true = done). Falls back to the goal's stamped criteria-met. An all-true vector is rejected (complete normally); an all-false vector is rejected (nothing finished to close) — fission needs a genuine partial."),
      verifyCommand: z.string().optional().describe("Verify-command scoped to ONLY the MET criteria (e.g. a single test file/path) — the ISOLATION proof that gates the split. Required unless the goal carries a `partial-verify-command` frontmatter field. Without it fission BLOCKS: the whole-goal verify-command can't be isolated to the met criteria, and forking unverified debt is refused (no silent debt fork)."),
      successorSlug: z.string().optional().describe("Override the forked successor's slug (default <slug>-cont, deduped against live + archived goals)."),
      done: z.array(z.union([z.string(), z.object({ criterion: z.string(), evidence: z.string().optional() })])).optional().describe("Evidence for the MET criteria, recorded on the carry-forward handoff. Defaults to the met criteria text."),
      decisions: z.array(z.string()).optional().describe("Non-trivial decisions made while working the goal — recorded on the handoff for the successor's fresh head."),
      remaining: z.array(z.string()).optional().describe("Override the successor's carried-forward backlog. Defaults to the UNMET criteria."),
      continuationNotes: z.string().optional().describe("Free-form notes for the successor's fresh head: where you left off, gotchas, what to re-plan."),
      openQuestions: z.array(z.string()).optional().describe("Unresolved questions for a human or fresh-context decision."),
      actualFiles: z.array(z.string()).optional().describe("Files this goal actually touched. Unioned with the git working tree for the handoff's ownership-accuracy signal."),
      model: z.string().optional().describe("Authoring model id (e.g. claude-opus-4-8), recorded on the handoff."),
      notes: z.string().optional().describe("Completion notes for the closed partial record."),
      timeSpent: z.string().optional().describe("Explicit hands-on effort (e.g. '2h', '90m') for the closed partial record."),
    }),
    handler: async ({ slug, criteriaMet, verifyCommand, successorSlug, done, decisions, remaining, continuationNotes, openQuestions, actualFiles, model, notes, timeSpent }) => {
      const cwd = process.cwd();
      return runGoalFission({ archDir: requireArchDir(cwd), cwd, slug, criteriaMet, verifyCommand, successorSlug, done, decisions, remaining, continuationNotes, openQuestions, actualFiles, model, notes, timeSpent });
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

  archkit_worklog: {
    description: "Render a copy-pasteable day-by-day worklog of COMPLETED CGR goals — title, outcome, time, and completion notes — for posting to Jira / standups. The deliverable that closes the goal_next→/clear→goal_next loop's loss-of-track: a pure REPORT over completed-goal data already on disk (un-consolidated done/ root, raw done/archive/, and consolidated done/digest/ as a sparse fallback) — it writes nothing. Each entry's TIME is the explicit hands-on effort (the time-spent override set at archkit_goal_complete) when present, otherwise the derived started→completed wall-clock TAGGED '(elapsed)' so an estimate is never misreported as logged effort; a legacy date-only goal shows no time. Entries are deduped by slug and grouped by day, most recent first; a range total sums the quantifiable effort and flags how many entries were untracked. Default range is TODAY. Pass `from`/`to` (ISO YYYY-MM-DD) for a range — `from` alone runs through today, `to` alone is open-started. Returns { from, to, count, totalMs, totalDisplay, entries:[{slug,title,day,outcome,notes,effort}], markdown, nextStep } — `markdown` is the copy-paste artifact to hand the user.",
    inputSchema: z.object({
      from: z.string().optional().describe("Start day (ISO YYYY-MM-DD). Omit for today. Alone (no `to`), runs from this day through today."),
      to: z.string().optional().describe("End day (ISO YYYY-MM-DD), inclusive. Omit for today. Alone (no `from`), includes everything up to this day."),
    }),
    handler: async ({ from, to }) => {
      const cwd = process.cwd();
      return runWorklog({ archDir: requireArchDir(cwd), from, to });
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
    description: "Workflow logistic gauge — aggregates archkit_resolve_warmup + archkit_drift findings AND adds four surface checks that ask whether .arch/ is actually load-bearing: (1) playbooks with zero real WRONG/RIGHT/WHY gotchas (present on disk but contributing nothing to archkit_review), (2) BAN directives in BOUNDARIES.md whose source-glob matches no file in the working tree (warning, not error — could be future-protecting, could be stale), (3) active CGR goals in .arch/goals/ with vacuous exit-criteria (<8 chars or generic phrases like \"ship it\", \"done\") or no required-reading, (4) whether archkit's guardrail hooks are even installed (D-HOOKS) — if not, the SessionStart digest, CGR Stop-guard, and review-on-edit never fire; fix with archkit_install_hooks. Returns { pass, checks:[{id,name,status,detail}], blockers, warnings, summary, intent, sources, nextStep }. Different from warmup: warmup runs at session start and is structural (\"can I trust .arch/ at all?\"); doctor runs on demand and is intent-checking (\"does the configured surface actually fire?\"). When to use: as a periodic health check before a long session, after BOUNDARIES.md edits, after adding playbooks, or when archkit-driven reviews start feeling like noise.",
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

  archkit_init_generate: {
    description: "GENERATE the .arch/ scaffold from structured answers — the acting counterpart to archkit_init, which only INSTRUCTS. Use this to complete greenfield setup end-to-end: after archkit_init returns the wizard instructions, archetype skeletons, and PRD signal, decide the answers WITH the user (which archetype, what stack, the feature list) and call this tool to WRITE the files — no inquirer TTY required. It drives the same scaffold-generation core the interactive wizard wraps, so the output is identical: .arch/SYSTEM.md, INDEX.md, README.md, BOUNDARIES.md, CONTEXT.compact.md, clusters/*.graph (one per feature + infra + events), playbooks/*.playbook, apis/*.api, lenses/*, and — when claudeMode (default true) — CLAUDE.md + .claude/rules/ + .claude/skills/ + .claude/settings.json hooks, plus a git pre-commit review hook when a .git dir is present. REFUSES to clobber an existing .arch/ unless overwrite:true. After it returns, call archkit_resolve_warmup to verify and archkit_log_decision to record the foundation ADR. Required: appName, appType. Everything else has archetype-derived defaults.",
    inputSchema: z.object({
      appName: z.string().min(1).describe("Project/app name shown in generated files (e.g. \"acme-billing\")."),
      appType: z.enum(["saas", "ecommerce", "realtime", "data", "ai", "mobile", "ios-swift", "internal", "content"]).describe("Archetype — determines architecture pattern, folder conventions, reserved words, default stack, and graph node templates. Pick from archkit_init's skeletonsIndex. \"ios-swift\" = native Swift/SwiftUI iOS app (MVVM) with decision-aware backend/storage option sets — see stackDecision."),
      stack: z.record(z.string()).optional().describe("Stack as a {layer: tool} map (e.g. {\"Frontend\":\"Next.js\",\"Database\":\"PostgreSQL\"}). Omit to use the archetype's default stack."),
      features: z.array(z.object({
        id: z.string().min(1).describe("Lowercase feature id (becomes the cluster filename), e.g. \"auth\"."),
        name: z.string().optional().describe("Human display name. Defaults from id."),
        keywords: z.string().optional().describe("Comma-separated routing keywords for INDEX.md. Defaults to id."),
      })).optional().describe("Features to scaffold as clusters. Omit to use the archetype's suggested features. At least one feature is required (after defaults)."),
      skills: z.array(z.string()).optional().describe("Package playbook ids to scaffold (must exist in the playbook catalog, e.g. \"postgres\", \"stripe\"). Unknown ids are rejected. Default none. The param is named `skills` for back-compat."),
      crossRefs: z.union([z.literal("ai"), z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() }))]).optional().describe("Feature dependency edges: \"ai\" to mark them AI-inferred at codegen time, or an explicit list of {from,to,reason}. Default none."),
      stackDecision: z.object({
        serverStack: z.object({
          chosen: z.string().describe("Chosen server-stack option id (e.g. \"vapor\", \"hono\", \"fastapi\")."),
          rationale: z.string().optional().describe("Why this option fits the project's stated needs."),
          recommendations: z.array(z.object({ id: z.string(), pct: z.number() })).optional().describe("AI-assigned recommendation weighting per option id (percentages, weighted to the project's needs)."),
        }).optional(),
        storage: z.object({
          chosen: z.string().describe("Chosen storage option id (e.g. \"minio\", \"local-disk-caddy\", \"postgres-only\")."),
          rationale: z.string().optional(),
          recommendations: z.array(z.object({ id: z.string(), pct: z.number() })).optional(),
        }).optional(),
      }).optional().describe("Decision-aware archetypes (ios-swift) carry annotated serverStackOptions + storageOptions instead of a hardcoded backend. Record the chosen option per group, a rationale, and an AI-weighted recommendation % per option — written into SYSTEM.md's Stack Decision section. Omit to fall back to the archetype defaults (vapor + minio for ios-swift); the response then echoes the available options so you can re-run with a recorded decision."),
      claudeMode: z.boolean().optional().describe("Also generate Claude Code native files (CLAUDE.md, .claude/rules/, .claude/skills/, .claude/settings.json hooks). Default true — the integration is the point."),
      outDir: z.string().optional().describe("Where to write the scaffold. Default \".arch\"."),
      overwrite: z.boolean().optional().describe("Allow regenerating over an existing .arch/ scaffold (destructive). Default false — the tool refuses if SYSTEM.md already exists."),
    }),
    handler: async ({ overwrite, ...answers }) => {
      const cwd = process.cwd();
      let archDir = null;
      try { archDir = requireArchDir(cwd); } catch { /* greenfield — expected */ }
      return runInitGenerateJson({ cwd, archDir, answers, overwrite });
    },
  },
};
