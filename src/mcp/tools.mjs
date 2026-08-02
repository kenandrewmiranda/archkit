// src/mcp/tools.mjs
// Tool registry for archkit MCP server. Each entry has:
//   - description: prose used at tool-pick time (CRITICAL — iterate post-dogfood)
//   - inputSchema: Zod schema for validation
//   - handler: (validatedInput) => Promise<resultObject> (throws ArchkitError on failure)
//
// DESCRIPTIONS ARE BUDGETED. Every description is loaded into agent context on
// every session whether or not the tool is called, so each one is: lead line →
// call-shaping detail only → `Trigger:` → a pointer to any confusable neighbour.
// Rationale/history belongs in the ADR it came from (cited by number), NOT here.
// Contract, the 800-byte-per-description ceiling, and the detail that moved out
// of these strings: docs/mcp-tool-surface.md.
// The ceiling is enforced by tests/mcp-tool-descriptions/run.mjs.

import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

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
import { runApiRegister, runApiOverride, runApiList } from "../commands/api.mjs";
import { runDoctorJson } from "../commands/doctor.mjs";
import { runSyncJson } from "../commands/sync.mjs";
import { runHooksInstallJson } from "../commands/hooks.mjs";
import { runDecisionsSearchJson } from "../commands/decisions.mjs";
import { runGoalIntake, runGoalList, runGoalComplete, runGoalPayload, runGoalStart, runGoalAbandon, runGoalVerify, runGoalDefer, runGoalPromote, runGoalDismiss, runGoalTesting, runGoalHold, runGoalConsolidate, runGoalReconcile, runGraphAccept, runGoalHandoff, runGoalFission } from "../commands/goal.mjs";
import { runWorklog } from "../commands/worklog.mjs";
import { loadGoal, runFinalizeConfig, reconcileGoalsLayout, dispatchGoal, laneOf } from "../lib/goals.mjs";
import { detectStaleGoals } from "../lib/goal-triage.mjs";
import { sessionState, conductorPlan, recordMerge, recordConflict, claimFrontier } from "../lib/board.mjs";
import { archkitError } from "../lib/errors.mjs";

// ── Warmup goal-hygiene augmentation (warmup-reconcile-surface) ──────────────
// On top of runWarmupJson's structural checks, the warmup handler (a) auto-fixes
// goal-tree placement drift via reconcileGoalsLayout(apply:true) and REPORTS what
// moved (never a silent relocate), gated by a configurable escalation threshold,
// and (b) surfaces detectStaleGoals as an ADVISORY (never auto-acted, never
// mutating). Both are wrapped defensively — a reconcile/triage hiccup degrades to
// a note so warmup NEVER throws.

const DEFAULT_RECONCILE_WARN_THRESHOLD = 3;

// Tolerant read of the escalation threshold (.arch/config.json →
// cgr.reconcile.warnThreshold), mirroring readCgrConfig/readStalenessConfig: a
// missing/invalid config falls back to the default and never throws.
function readReconcileWarnThreshold(archDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(archDir, "config.json"), "utf8"));
    const n = Number(cfg?.cgr?.reconcile?.warnThreshold);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch { /* no/invalid config → default */ }
  return DEFAULT_RECONCILE_WARN_THRESHOLD;
}

// Current git branch — drives the stale-triage branch-mismatch dimension. Read
// the same tolerant way preflight resolves git: a non-repo / detached HEAD yields
// null and the branch signal simply reads as absent (no false positives).
function currentGitBranch(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out || null;
  } catch { return null; }
}

// Fold the auto-fix report + advisory scan into the warmup result IN PLACE.
// Everything here is best-effort and defensive so warmup stays never-throw.
function surfaceGoalHygiene(archDir, cwd, result) {
  result.checks = result.checks || [];
  result.warnings = result.warnings || [];
  result.actions = result.actions || [];
  result.summary = result.summary || {};

  // (A) Auto-fix goal-tree placement drift and REPORT what got relocated.
  try {
    const report = reconcileGoalsLayout(archDir, { apply: true });
    const moved = report.moved || [];
    const duplicates = report.duplicates || [];
    const quarantined = report.quarantined || [];
    const outOfPlace = report.outOfPlaceCount || 0;

    result.reconcile = { moved, duplicates, quarantined, outOfPlaceCount: outOfPlace };
    result.summary.goalsReconciled = outOfPlace;
    result.summary.goalsQuarantined = quarantined.length;
    result.summary.goalsDuplicatesResolved = duplicates.length;

    const changed = outOfPlace > 0 || duplicates.length > 0 || quarantined.length > 0;
    if (changed) {
      const parts = [];
      if (outOfPlace > 0) {
        parts.push(`${outOfPlace} relocated (${moved.slice(0, 6).map(m => `${m.slug}→${m.status}`).join(", ")}${moved.length > 6 ? "…" : ""})`);
      }
      if (duplicates.length > 0) parts.push(`${duplicates.length} duplicate(s) resolved`);
      if (quarantined.length > 0) parts.push(`${quarantined.length} quarantined`);
      const detail = parts.join("; ");

      const threshold = readReconcileWarnThreshold(archDir);
      const prominent = outOfPlace >= threshold;
      result.checks.push({
        id: "W016",
        check: "Goal-tree placement reconciled",
        status: prominent ? "warn" : "pass",
        detail,
      });
      if (prominent) {
        // PROMINENT: escalate to warnings + a review action.
        result.warnings.push(`⚠ Goal-tree drift: ${outOfPlace} goal(s) were out of place (threshold ${threshold}) and auto-relocated — ${detail}. High drift means the goal tree is churning; review .arch/goals/.`);
        result.actions.push(`Review ${outOfPlace} auto-relocated goal(s): ${moved.slice(0, 8).map(m => m.slug).join(", ")}. Confirm each landed in the right state folder.`);
      } else {
        // QUIET: below threshold → an informational note, NOT a warning.
        result.actions.push(`Goal-tree auto-fixed (${detail}) — informational, below the warn threshold (${threshold}).`);
      }
      // Quarantined junk is always worth naming — files parked out of the tree.
      if (quarantined.length > 0) {
        result.actions.push(`${quarantined.length} non-goal file(s) quarantined to .arch/goals/quarantine/: ${quarantined.slice(0, 5).map(q => q.file).join(", ")}. Recover or delete.`);
      }
    } else {
      result.checks.push({ id: "W016", check: "Goal-tree placement", status: "pass", detail: "all goals correctly placed" });
    }
  } catch (err) {
    result.reconcile = result.reconcile || { moved: [], duplicates: [], quarantined: [], outOfPlaceCount: 0 };
    result.checks.push({ id: "W016", check: "Goal-tree reconcile", status: "warn", detail: `skipped — ${err?.message || "reconcile error"}` });
  }

  // (B) Advisory cross-project cruft scan — NEVER auto-acted, never mutating.
  try {
    const branch = currentGitBranch(cwd);
    const stale = detectStaleGoals(archDir, { branch });
    result.staleAdvisory = stale;
    result.summary.staleAdvisories = stale.length;
    if (stale.length > 0) {
      const detail = stale.slice(0, 8).map(s => `${s.slug} (${s.suggestion})`).join(", ");
      result.checks.push({ id: "W017", check: "Stale goal advisory", status: "warn", detail: `${stale.length} pending goal(s) look like other-project cruft` });
      result.actions.push(`ADVISORY: ${stale.length} pending goal(s) look like other-project cruft — hold/dismiss/keep? ${detail}. NOT auto-acted; decide per goal (archkit_goal_hold / archkit_goal_dismiss / leave as-is).`);
    }
  } catch (err) {
    result.staleAdvisory = result.staleAdvisory || [];
    result.checks.push({ id: "W017", check: "Stale goal advisory", status: "warn", detail: `skipped — ${err?.message || "triage error"}` });
  }

  return result;
}

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
    description: "Lint one or more NAMED files against archkit rules and gotchas; returns findings (errors/warnings/infos) keyed by filepath plus pass:boolean. Non-JS files skip JS-ecosystem heuristics. Rule families are disableable per project via .arch/config.json -> review.disable, except the architecture families (import-hierarchy, import-boundary, boundary-violation, reserved-word). Trigger: you edited specific paths and want those checked. To check everything staged for commit instead, use archkit_review_staged.",
    inputSchema: z.object({
      files: z.array(z.string().min(1)).min(1).describe("Paths (relative to cwd or absolute) to review. Must exist on disk."),
    }),
    handler: async ({ files }) => {
      const cwd = process.cwd();
      return runReviewJson({ files, archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_review_staged: {
    description: "Lint the git INDEX -- files from `git diff --cached`, filtered to known code extensions; NOT unstaged working-tree edits, NOT the last commit. files:0 means nothing code-like is staged, so run `git add` first. Same review.disable config as archkit_review. Trigger: pre-commit safety net, or the user mentions staging/committing. To check an explicit file list instead, use archkit_review.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runReviewJson({ files: [], archDir: requireArchDir(cwd), cwd, staged: true });
    },
  },

  archkit_resolve_warmup: {
    description: "Health-check the .arch/ context system before coding: SYSTEM.md / INDEX.md / clusters / playbooks present and parseable, plus pending review debt -- drafted ADR proposals (W014) and persisted graph-proposals (W015) to apply with archkit_graph_accept. deep:true additionally flags major deps with no playbook (W011), unpopulated stubs in .arch/apis/*.api (W012), and orphaned extension registry entries (W013). Trigger: session start (default), or after `npm install` / a major refactor (deep:true). Structural trust check -- for whether the configured surface actually FIRES, use archkit_doctor.",
    inputSchema: z.object({
      deep: z.boolean().optional().describe("If true, also run W011 (package.json↔playbooks coverage), W012 (.api stub detection), W013 (extension registry integrity). Default false."),
    }),
    handler: async ({ deep }) => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      const result = await runWarmupJson({ archDir, deep });
      // Fold in goal-tree auto-fix (reported, threshold-gated) + advisory cruft
      // scan. Defensive: surfaceGoalHygiene never throws, so warmup stays
      // never-throw even if reconcile/triage hits a snag.
      return surfaceGoalHygiene(archDir, cwd, result);
    },
  },

  archkit_resolve_preflight: {
    description: "Verify a feature/layer exists and is wired in .arch/ BEFORE writing code in its path. `feature` must be a node id from INDEX.md -- an unknown one returns error:'unknown_feature' plus a `valid` array to pick from. `layer` (controller/service/repository/ui/...) is matched but never errors. READ every path in the returned `requiredReading` playbook array before coding: they hold API quirks and known wrong-patterns absent from the source tree. Trigger: before modifying an EXISTING feature. For a NEW feature's file layout, use archkit_resolve_scaffold.",
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
    description: "Return the file-creation checklist for a feature -- which files, in what order, with the project's naming conventions -- from INDEX.md and the matching cluster .graph. Accepts an existing feature id (its real wiring) or a new id (generic scaffold from SYSTEM.md conventions). Trigger: starting a NEW feature, before creating files -- never guess directory layout from training data when this knows the project's actual convention.",
    inputSchema: z.object({
      feature: z.string().min(1).describe("Feature id to scaffold. May be new or existing."),
    }),
    handler: async ({ feature }) => {
      const cwd = process.cwd();
      return runScaffoldJson({ archDir: requireArchDir(cwd), cwd, feature });
    },
  },

  archkit_resolve_lookup: {
    description: "Look up ONE id in .arch/ -- node ids in INDEX.md, playbook ids, or cluster ids -- and return its record with source file and basePath. Trigger: a symbol, package, or cluster name shows up in code or conversation and you need archkit's view of it.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Node / playbook / cluster id (e.g. \"auth.service\", \"stripe\", \"billing\")."),
    }),
    handler: async ({ id }) => {
      const cwd = process.cwd();
      return runLookupJson({ archDir: requireArchDir(cwd), id });
    },
  },

  archkit_gotcha_propose: {
    description: "Queue a wrong/right/why code pattern onto a playbook's PENDING proposals in .arch/proposals/. Does not edit the playbook: a human merges via `archkit gotcha accept`. `wrong` and `right` are matched as literal substrings by archkit_review, so include enough context to be unique but not so much that minor formatting drift breaks the match. Trigger: you found a pattern future sessions should be warned about. Check archkit_gotcha_list first to avoid duplicates.",
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
    description: "List every playbook with its gotcha count and a sample of its wrong-patterns. Trigger: before archkit_gotcha_propose, to avoid duplicating an existing gotcha, or to spot playbooks with zero gotchas that contribute nothing to review. (Returns a `skills` key for back-compat.)",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGotchaListJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_stats: {
    description: "Read-only health dashboard for .arch/: counts of playbooks/clusters/nodes/APIs/decisions, SYSTEM.md and INDEX.md completeness, gotcha density per playbook, and a prioritized `recommendations` list. Trigger: assess setup completeness, pick which playbook to flesh out, or report progress. For staleness against live code, use archkit_sync or archkit_drift.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runStatsJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_drift: {
    description: "Detect mismatches between the .arch/ node graph and live code: playbooks for packages no longer in package.json, INDEX.md entries whose basePath was deleted, cluster .graph nodes whose files are gone, name/scope mismatches. Read-only. Trigger: after a refactor or dependency removal, or when review surfaces rules that feel outdated. Graph-vs-source consistency -- for which .arch/ DOCS still need writing, use archkit_sync.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runDriftJson({ archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_log_decision: {
    description: "Append an auto-numbered, dated, slugified decision record to .arch/decisions/. Trigger: WHENEVER a non-trivial architectural choice is made (stack, pattern, library, tradeoff) -- this directory is the project's memory across context resets. Read them back with archkit_decisions_search.",
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
    description: "Find a PRD (PRD.md / BRIEF.md / SPEC.md / ...), score its archetype signals, and -- when .arch/SYSTEM.md exists -- report where the doc and the declared architecture disagree. Needs no .arch/ directory. Trigger: before /archkit-init (it pre-fills archetype picks), when the user mentions a PRD/spec/brief, or to audit architecture-vs-intent drift. For per-requirement build coverage, use archkit_audit_spec.",
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
    description: "Audit a spec's `- [ ] REQ-001: ...` checkbox lines or `| REQ-001 | ... |` table rows against code under srcDir and report which appear implemented. Coverage is a heuristic keyword match, not proof -- read uncovered as 'likely missing' and covered as 'verify'. A missing spec or zero REQ lines returns a structured error envelope, never a throw. Trigger: after finishing a feature or CGR goal, self-checking 'did I build every REQ?'. For archetype drift of the PRD itself, use archkit_prd_check.",
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
    description: "Report which .arch/ DOCS need authoring after code changes: new feature directories missing from INDEX.md, installed deps that match a known playbook but have no playbook file, INDEX.md nodes whose basePath was deleted, and playbook version drift. Trigger: after adding a feature directory, installing/removing a dependency, or deleting code. Docs-to-write -- for graph-vs-source consistency use archkit_drift; for whether .arch/ is load-bearing at all use archkit_doctor.",
    inputSchema: z.object({
      srcDir: z.string().optional().describe("Source directory to compare against .arch/. Default 'src'."),
    }),
    handler: async ({ srcDir = "src" }) => {
      const cwd = process.cwd();
      return runSyncJson({ archDir: requireArchDir(cwd), srcDir });
    },
  },

  archkit_verify_wiring: {
    description: "Find exports that nothing outside their own directory imports -- the dead-code / unwired-component check. Walks srcDir (.ts/.tsx/.js/.mjs; a non-JS tree returns a warning, not findings) and flags each file DEAD_CODE (no importers) or INTERNAL_ONLY. Entry-point patterns (*.controller/route/router/middleware/handler.*, app.*, index.*) are excluded -- they are mounted, not imported. Heuristic: dynamic imports, DI containers, and framework auto-loading can fake an orphan, so verify before deleting. Trigger: after finishing a feature or CGR goal, to catch what you built but forgot to wire in.",
    inputSchema: z.object({
      srcDir: z.string().optional().describe("Source directory to scan for unwired/dead components. Default 'src'."),
    }),
    handler: async ({ srcDir = "src" }) => {
      const cwd = process.cwd();
      return runVerifyWiringJson({ archDir: requireArchDir(cwd), srcDir });
    },
  },

  archkit_boundary_check: {
    description: "Enforce `BAN: source-glob -> target-glob` directives from .arch/BOUNDARIES.md against the git index (staged:true), the working-tree diff (diff:true), or an explicit `files` list. An import is a violation when the source file matches a rule's source-glob AND the imported module matches its target-glob. JS/TS and Python only; other languages return zero violations rather than false positives. Trigger: pre-commit or pre-review enforcement -- call this instead of reading BOUNDARIES.md and self-checking.",
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
    description: "Queue a proposed `BAN: source -> target` boundary to .arch/boundary-proposals/ for human review -- the boundary twin of archkit_gotcha_propose. Never auto-merged: a wrong BAN blocks real work, so a human pastes the emitted banLine into BOUNDARIES.md. Validates glob syntax (`*`, trailing `/*`) and no-ops when the rule is already enforced. Trigger: you spotted a layering rule the codebase should enforce (e.g. the web layer must not import db directly).",
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

  archkit_api_register: {
    description: "Record a doc URL, local file path, or SDK package that CLEARS the API-doc gate for an API surface -- status `referenced` in the manifest .arch/apis.json (ADR 0022). The gate is a PreToolUse block on edits reaching an external or unknown API until it is referenced here or overridden. A missing `ref` is a structured error, not a silently-uncleared entry. Trigger: before writing code against an external API, once you have its docs or SDK in hand. With NO docs available, use archkit_api_override.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Stable API identifier being cleared, e.g. \"stripe.charges.create\" or \"aws.s3.putObject\"."),
      ref: z.string().min(1).describe("The doc/SDK reference: a documentation URL, a local file path, or an SDK package name. Required — a referenced entry only clears the gate when it carries an actual reference. To proceed WITHOUT docs, use archkit_api_override instead."),
      kind: z.enum(["doc", "sdk"]).optional().describe("How the API is vouched for: \"doc\" (documentation URL/path) or \"sdk\" (SDK package). Default \"doc\"."),
    }),
    handler: async ({ id, ref, kind }) => {
      const cwd = process.cwd();
      return runApiRegister({ archDir: requireArchDir(cwd), id, ref, kind });
    },
  },

  archkit_api_override: {
    description: "Record an EXPLICIT human override clearing the API-doc gate for a surface with no docs or SDK -- status `override`, audit-stamped with reason and timestamp in .arch/apis.json (ADR 0022). A non-empty `reason` is required, since this bypasses the doc requirement. Trigger: you must proceed against an undocumented API and the user has accepted that tradeoff. With docs in hand, use archkit_api_register instead.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Stable API identifier to override, e.g. \"legacy.internal.thing\"."),
      reason: z.string().min(1).describe("Justification for proceeding without docs — recorded verbatim in the manifest as the audit trail. Required."),
    }),
    handler: async ({ id, reason }) => {
      const cwd = process.cwd();
      return runApiOverride({ archDir: requireArchDir(cwd), id, reason });
    },
  },

  archkit_api_list: {
    description: "List every API-doc clearance in .arch/apis.json, bucketed into referenced (doc/SDK vouched), overridden (explicit human override), and pending (recorded but still BLOCKED by the gate). Read-only (ADR 0022). Trigger: audit which API surfaces are cleared vs still gated.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runApiList({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_goal_intake: {
    description: "CGR intake -- persist YOUR decomposition of a sprawling ask into discrete goals under .arch/goals/ and return a payload per goal. You do the split: per goal a kebab-case slug, one-line title, 2-5 exitCriteria, optional filesToTouch/requiredReading, and for parallel lanes (ADR 0013) `owns` file-globs DISJOINT across goals plus optional dependsOn / feature / exclusive. Clarify an ambiguous ask first. verify-command is auto-detected and re-run as a hard gate at completion; pass verifyCommand to scope it. A solo finalize goal is auto-appended (ADR 0018); on `finalize.setup` ask the user once and persist via archkit_finalize_config. Trigger: a multi-goal or unclear ask in a fresh session, BEFORE any code. Then tell the user to run /clear and /mcp__archkit__conductor -- you cannot run those.",
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
        order: z.number().optional().describe("Explicit relay sort key — lower runs first. Omit to auto-assign from this goal's position in the goals array (offset past existing live goals), so /mcp__archkit__conductor honors the decomposition order instead of alphabetical slug order. Set explicitly to pin a sequence."),
        verifyCommand: z.string().optional().describe("Test/verify command that gates completion (e.g. \"npm test\", \"vitest run src/auth/\"). Auto-detected from package.json scripts.test if omitted. archkit_goal_complete re-runs it and refuses to complete on red — bakes test confirmation into the goal. Set explicitly to scope to the goal's slice of the suite."),
        body: z.string().optional().describe("Optional markdown body; auto-generated if omitted."),
      })).min(1).describe("One or more goals. Order matters — the goals array order becomes each goal's relay `order` (honored by /mcp__archkit__conductor), and payloads[0] is the first goal the user starts."),
    }),
    handler: async ({ sourceAsk, goals }) => {
      const cwd = process.cwd();
      return runGoalIntake({ archDir: requireArchDir(cwd), cwd, sourceAsk, goals });
    },
  },

  archkit_finalize_config: {
    description: "Read or set .arch/config.json -> cgr.finalize, the per-project policy for the wrap-up goal archkit_goal_intake auto-appends to every batch: changelog, docs, commit, plus opt-in version-bump / push / release / deploy-to-dev (ADR 0018). Call with no fields (or show:true) to read; enabled:false turns the feature off. Defaults: changelog/docs/commit ON, the rest OFF. Trigger: intake returned `finalize.setup` -- present the steps with AskUserQuestion (which steps, github-actions vs custom CI, deploy command) and save the answers here, which stamps configured:true so intake stops nudging.",
    inputSchema: z.object({
      show: z.boolean().optional().describe("Read-only: return the current resolved finalize config without writing."),
      enabled: z.boolean().optional().describe("Master switch. false disables the whole feature (no finalize goal appended at intake)."),
      steps: z.object({
        version: z.boolean().optional().describe("Bump the release version in every file the project's version check covers, then re-run that check. Ordered before changelog/commit so both describe the version being cut (off by default)."),
        changelog: z.boolean().optional().describe("Update the changelog."),
        docs: z.boolean().optional().describe("Update documentation (README / docs/)."),
        commit: z.boolean().optional().describe("Finalize commits with notes/comments + the project's commit trailer."),
        push: z.boolean().optional().describe("Push the branch to the remote (outward-facing — off by default)."),
        release: z.boolean().optional().describe("Set up a release: version bump + tag per the project's release flow (outward-facing — off by default)."),
        deployDev: z.boolean().optional().describe("Deploy to the development environment (outward-facing — off by default)."),
      }).optional().describe("Per-step toggles. Only the keys you pass are changed; omitted steps keep their current value."),
      ciCd: z.enum(["none", "github-actions", "custom"]).optional().describe("CI/CD flavor the push/release/deploy steps should follow. 'custom' pairs with deployCommand."),
      deployCommand: z.string().optional().describe("Command the deploy-to-dev (or custom CI) step should run/instruct, e.g. \"npm run deploy:dev\". Surfaced in the finalize goal's exit-criterion."),
    }),
    handler: async (input) => {
      const cwd = process.cwd();
      return runFinalizeConfig({ archDir: requireArchDir(cwd), ...input });
    },
  },

  archkit_goal_list: {
    description: "List active and completed CGR goals. Active goals come back in RELAY QUEUE ORDER, so active[0] is what /mcp__archkit__conductor picks next. Also returns `epics` (sequencing groups), `projects` (branch-isolated feature sets living on feat/<project>), `digests` (dated consolidation summaries), and `archived` (count of raw CGRs kept verbatim). Trigger: check what is already in flight before archkit_goal_intake, or find the next goal's slug. For one goal's full content, use archkit_goal_show.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGoalList({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_goal_show: {
    description: "Read ONE CGR goal's frontmatter and body in a single round-trip -- exit-criteria, required-reading, files-to-touch, depends-on, source-ask -- instead of archkit_goal_list plus a Read. An unknown slug returns error 'unknown_goal' with the active slugs to choose from. Trigger: you need a specific goal's criteria to decide what to work on.",
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
    description: "CGR board STATE -- the raw folded projection of the parallel-lane board: lanes, frontier (workable now), blocked, in_flight, merge_queue, merged (with recorded verify outcome), conflicts, leases_expired (ADR 0014). Purely derived by folding the append-only event log .arch/board/events.ndjson plus the CGR files, so it survives /clear and cannot drift. Read-only. Trigger: rehydrate what remains in flight after /clear or compaction, or inspect one slice. For the DISPATCH PLAN layered on top -- claimable lanes, merge order, exceptions to review -- use archkit_conductor.",
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
        merged: board.merged.length,
        unverified_merges: board.merged.filter((m) => m.verifyStatus !== "green").length,
        conflicts: board.conflicts.length,
        leases_expired: board.leases_expired.length,
      };
      const empty = Object.values(counts).every((n) => n === 0);
      const out = { ...board, counts };
      if (empty) {
        // Silent-success: an empty board is a valid derived state, not a failure —
        // say so rather than returning seven bare empty slices.
        out.boardNote = "Board empty — no folded events in .arch/board/events.ndjson and no live CGRs. The board is purely derived from those inputs.";
        out.nextStep = "No CGRs in flight. Run archkit_goal_intake (or /mcp__archkit__intake) to queue work; workers append claimed/completed events that this board folds.";
      } else {
        const debt = counts.unverified_merges ? `, ${counts.unverified_merges} merged UNVERIFIED` : "";
        out.nextStep = `Board: ${counts.frontier} frontier, ${counts.in_flight} in-flight, ${counts.merge_queue} to merge${debt}, ${counts.blocked} blocked, ${counts.leases_expired} expired leases.`;
      }
      return out;
    },
  },

  archkit_conductor: {
    description: "CGR conductor PLAN -- what to do in one orchestration pass (ADR 0013): claimableLanes to claim under a lease, barriers that run SOLO, mergeOrder, convergence (per-lane rebase-onto-tip then a concrete verify command, ADR 0023/0024), unverifiedMerges (integration debt), exceptions to deep-review vs clean to rubber-stamp, and pendingEscalations (collisions not yet escalated -- mint a solo barrier via archkit_board_conflict). Spawn ONE worker subagent per claimable lane in an isolated worktree. Read-only: claiming, merging, and escalating are your follow-up calls. Trigger: conductor session start, and after collecting worker handoffs. For the raw board slices underneath, use archkit_session_state.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      const plan = conductorPlan(archDir);
      const c = plan.counts;
      // Integration debt keeps the conductor NON-idle: a merge with no green
      // recorded verify is inherited work, not silence to be read as green.
      const idle = c.frontier === 0 && c.in_flight === 0 && c.merge_queue === 0
        && c.leases_expired === 0 && c.unverified_merges === 0 && c.escalations_pending === 0;
      const out = { ...plan };
      if (!c.escalations_pending) {
        out.pendingEscalationsNote = plan.conflictEscalations.length
          ? `No unescalated conflicts — all ${plan.conflictEscalations.length} detected collision(s) already have a merge-reconcile CGR.`
          : "No conflicts detected — escalation (ADR 0013 tier 3) only applies once two CGRs genuinely collide.";
      }
      const debt = c.unverified_merges > 0
        ? `, ${c.unverified_merges} UNVERIFIED merge${c.unverified_merges === 1 ? "" : "s"} to re-verify`
        : "";
      if (!c.unverified_merges) {
        out.unverifiedMergesNote = c.merged
          ? `No integration debt — all ${c.merged} recorded merge(s) carry a green verify outcome.`
          : "No merges recorded yet — integration debt is derived from `merged` events, which archkit_board_merged appends after each integration point lands.";
      }
      if (idle) {
        out.conductorNote = "Conductor idle — no frontier to claim, nothing in flight, empty merge queue, no unverified merges. The plan is purely derived from the board (.arch/board/events.ndjson + CGR files).";
        out.nextStep = "Nothing to orchestrate. Run archkit_goal_intake to queue work, or /mcp__archkit__conductor to start a goal — workers append claimed/completed events this plan folds.";
      } else {
        const review = c.exceptions > 0 ? `, deep-review ${c.exceptions} exception${c.exceptions === 1 ? "" : "s"}` : "";
        const reclaim = c.leases_expired > 0 ? `, reclaim ${c.leases_expired} orphan lease${c.leases_expired === 1 ? "" : "s"}` : "";
        const bar = c.barriers ? ` + ${c.barriers} barrier${c.barriers === 1 ? "" : "s"}` : "";
        const esc = c.escalations_pending > 0 ? `, escalate ${c.escalations_pending} conflict${c.escalations_pending === 1 ? "" : "s"}` : "";
        out.nextStep = `Loop: claim ${c.claimableLanes} lane${c.claimableLanes === 1 ? "" : "s"}${bar}, ${c.in_flight} in flight, merge ${c.merge_queue} in dep order${review}${reclaim}${debt}${esc}. Verify after EACH integration point, then record it with archkit_board_merged.`;
      }
      return out;
    },
  },

  archkit_board_merged: {
    description: "Record that a lane's integration LANDED, with its post-integration VERIFY outcome -- one `merged` event per CGR (ADR 0024). Status is derived, never trusted: no verifyCommand -> unverified; verifyCommand + passed:true -> green; passed:false -> red. archkit runs no git and no tests; it records what you report, so recording an unverifiable merge is correct -- anything not green resurfaces as archkit_conductor's unverifiedMerges. Trigger: after each integration point in the convergence drain (rebase, merge, run verify, then call this).",
    inputSchema: z.object({
      slugs: z.array(z.string().min(1)).optional().describe("The CGR slugs that landed in THIS integration point (a lane's group from the convergence plan). One `merged` event is appended per slug, all sharing the same verification outcome."),
      slug: z.string().min(1).optional().describe("Single-CGR shorthand for `slugs`. Pass one or the other."),
      lane: z.string().optional().describe("The lane whose integration point landed. Defaults to each CGR's declared lane."),
      branch: z.string().optional().describe("The integration branch it landed on (cgr.integrationBranch, default main)."),
      verifyCommand: z.string().optional().describe("The verify command actually run AFTER the merge, on the integration branch. Omit ONLY when none resolved — the merge is then recorded as unverified integration debt, never as green."),
      verifySource: z.enum(["cgr", "project", "mixed", "none"]).optional().describe("Where the command came from: the CGR's own verify-command, the project test command, a union of both across the lane, or none."),
      passed: z.boolean().optional().describe("Did the verify command PASS on the integration branch? Omitting it with a command records `unverified` (verify-not-run) — the honest state, not a green assumption."),
      exitCode: z.number().optional().describe("Exit code of the verify run, when known."),
      worker: z.string().optional().describe("Worker/agent that performed the integration, when known."),
      note: z.string().optional().describe("Free-form note carried on the verification payload (e.g. which criteria the run covered)."),
    }),
    handler: async ({ slugs, slug, lane, branch, verifyCommand, verifySource, passed, exitCode, worker, note }) => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      const list = [...(slugs || []), ...(slug ? [slug] : [])];
      if (list.length === 0) {
        throw archkitError("missing_slug", "archkit_board_merged requires slugs (or slug)", {
          suggestion: "Pass the CGR slugs that landed in this integration point — archkit_conductor's convergence.groups[].slugs is exactly that list.",
        });
      }
      const res = recordMerge(archDir, {
        slugs: list, lane, branch, worker, verifyCommand, verifySource, passed, exitCode, note,
      });
      const plan = conductorPlan(archDir);
      const out = {
        slugs: res.slugs,
        lane: lane || null,
        branch: branch || null,
        verification: res.verification,
        events: res.merged.length,
        unverifiedMerges: plan.unverifiedMerges,
        mergeQueueRemaining: plan.counts.merge_queue,
      };
      if (!plan.unverifiedMerges.length) {
        out.unverifiedMergesNote = "No integration debt — every recorded merge carries a green verify outcome.";
      }
      const v = res.verification;
      out.nextStep = v.status === "green"
        ? `Recorded ${res.slugs.length} merged CGR(s) VERIFIED green via \`${v.command}\`. ${plan.counts.merge_queue} left in the merge queue — converge the next lane onto the tip.`
        : `Recorded ${res.slugs.length} merged CGR(s) as ${v.status} (${v.reason}) — integration debt. Re-run the verify on the branch and re-record with archkit_board_merged.`;
      return out;
    },
  },

  archkit_board_conflict: {
    description: "Record a genuine cross-lane collision on file CONTENT and ESCALATE it (ADR 0013 tier 3): appends a `conflict` event and mints an exclusive `merge-reconcile-<a>-<b>` CGR depending on every colliding slug, so it schedules as a solo barrier carrying the slugs, files, and provenance verbatim in its body. Idempotent -- the same collision mints only one CGR. This is the MERGE sense of reconcile (conflicting file content); it is NOT archkit_goal_reconcile, the PLACEMENT sense that moves goal FILES between folders (ADR 0020/0021). Trigger: two CGRs genuinely collide during a convergence drain -- call this instead of resolving it inline in the conductor's context.",
    inputSchema: z.object({
      slugs: z.array(z.string().min(1)).min(2).describe("The CGR slugs that genuinely collided (at least two). These become the minted reconcile CGR's depends_on, so it can only reach the frontier after all of them complete."),
      files: z.array(z.string()).optional().describe("The conflicting file paths. They become the reconcile CGR's owns/files-to-touch AND are listed in its body, so the resolving worker doesn't have to re-derive the conflict."),
      lane: z.string().optional().describe("The lane the conflict surfaced on, when it was a single lane's integration point."),
      lanes: z.array(z.string()).optional().describe("The lanes involved, when the collision spans more than one."),
      note: z.string().optional().describe("Free-form provenance note carried on the event and into the minted CGR's body (e.g. which drain step surfaced it)."),
      escalate: z.boolean().optional().describe("Set false to record the conflict event WITHOUT minting a reconcile CGR (record-only). Defaults to true — escalation is the point of tier 3."),
    }),
    handler: async ({ slugs, files, lane, lanes, note, escalate }) => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      const uniq = [...new Set((slugs || []).map((s) => String(s).trim()).filter(Boolean))];
      if (uniq.length < 2) {
        throw archkitError("missing_slug", "archkit_board_conflict requires at least two DISTINCT conflicting slugs", {
          suggestion: "Pass the CGRs that collided — archkit_conductor's `conflicts` slice carries the slug pairs it already detected.",
        });
      }
      const res = recordConflict(archDir, {
        slugs: uniq, files: files || [], lane, lanes: lanes || [], note: note || "",
        escalate: escalate !== false,
      });
      const plan = conductorPlan(archDir);
      const r = res.reconcile;
      const out = {
        slugs: res.slugs,
        files: res.files,
        lanes: res.lanes,
        event: res.event.type,
        at: res.event.at,
        reconcile: r
          ? { slug: r.slug, minted: r.minted, reason: r.reason, dependsOn: r.dependsOn || res.slugs, exclusive: true, path: r.path }
          : null,
        pendingEscalations: plan.pendingEscalations,
        blocked: plan.board.blocked.filter((b) => r && b.slug === r.slug),
      };
      if (!res.files.length) {
        out.filesNote = "No conflicting files recorded — the reconcile CGR was minted with no ownership prediction, so the resolving worker must derive the file set from the colliding CGRs.";
      }
      if (!plan.pendingEscalations.length) {
        out.pendingEscalationsNote = "No unescalated conflicts left on the board — every detected collision now has a merge-reconcile CGR.";
      }
      out.nextStep = !r
        ? `Conflict recorded for ${res.slugs.join(" + ")} (no CGR minted — escalate:false). Re-run with escalate:true to queue the reconcile work.`
        : r.minted
          ? `Minted ${r.slug} — an exclusive barrier CGR depending on ${res.slugs.join(", ")}. It reaches the frontier only after those complete; dispatch a solo worker for it then.`
          : `${r.slug} already exists (${r.reason}) — the conflict is recorded again but not re-queued. Work the existing reconcile CGR.`;
      return out;
    },
  },

  archkit_goal_payload: {
    description: "Re-render an existing CGR goal's copy-paste payload. archkit_goal_intake returns payloads at creation and archkit_goal_complete returns the NEXT goal's; this covers fetching a specific goal's on demand. Trigger: the user lost the payload, wants to re-paste it, or you need to inspect it.",
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
    description: "Mark a SPECIFIC goal in-progress by slug and return its payload, recording the branch guidance -- the batch's shared cgr-queue-<date> for an ungrouped goal, feat/<project> for a project goal (ADR 0012). archkit emits guidance only; it never runs git. Pass `worker` to claim it as `dispatched` instead (ADR 0027): the lease is held and the goal stays in_flight, but the Stop-hook guard is released HERE because a subagent does the work. Trigger: the conductor surfaced a queue-vs-project routing CHOICE and the user picked a track, you are dispatching a lane, or you deliberately want an out-of-order goal. For the normal one-keystroke advance the user runs /mcp__archkit__conductor.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to start (mark in-progress). Typically the 'next' slug for the track the user chose in the conductor routing prompt."),
      worker: z.string().optional().describe("Worker subagent id this claim is made ON BEHALF OF. Supplying it dispatches instead of starting: status becomes `dispatched`, a lease ({worker, expires} from cgr.leaseTtlHours) is stamped, a `claimed` board event is appended so the goal shows in archkit_session_state.in_flight with its lane/worker/lease, and the Stop-hook relay guard is released in THIS session — the conductor must wait for the worker, not work the criteria itself. The goal is NOT offered by frontier/nextEligibleGoal while dispatched, and an abandoned dispatch is reclaimed on lease-TTL expiry exactly like an orphaned in-progress goal. Omit for a normal same-session start."),
    }),
    handler: async ({ slug, worker }) => {
      const cwd = process.cwd();
      const archDir = requireArchDir(cwd);
      if (!worker || !String(worker).trim()) return runGoalStart({ archDir, slug });
      // Dispatch path (ADR 0027). runGoalStart renders the payload + validates the
      // slug (unknown_goal), then startGoal marks it in-progress; dispatchGoal
      // immediately re-files it as `dispatched`, and claimFrontier stamps the
      // board's `claimed` event so the fold shows it in_flight with lane/worker/
      // lease. dispatchGoal preserves an existing lease, so claiming first or
      // second yields the same TTL.
      const started = runGoalStart({ archDir, slug });
      const goal = loadGoal(archDir, slug);
      const claim = claimFrontier(archDir, { slug, worker: String(worker).trim(), lane: laneOf(goal) });
      const dispatched = dispatchGoal(archDir, slug, { worker: String(worker).trim() });
      return {
        ...started,
        status: dispatched.status,
        worker: dispatched.worker,
        lane: claim.lane,
        lease: dispatched.lease,
        nextStep: `Goal "${slug}" is DISPATCHED to ${dispatched.worker} (lane ${claim.lane}) and holds a lease until ${dispatched.lease?.expires}. Hand the payload to that worker. Do NOT work its exit-criteria in this session — the Stop-hook guard is released here on purpose. When the worker returns, review its handoff and close the goal from the owning session.`,
      };
    },
  },

  archkit_goal_handoff: {
    description: "Author a goal's carry-forward HANDOFF at .arch/board/handoff/<slug>.md: done (with evidence), decisions, remaining, continuation-notes, open-questions, verification-status. Also computes ownership accuracy -- predicted `owns` / files-to-touch vs files actually touched. Survives /clear; readable later via archkit_session_state, and stamped onto a fission successor when `successor` is given. Does NOT close the goal: follow with archkit_goal_complete if green, archkit_goal_testing if not. Trigger: your context fill reaches cgr.windDownAt (default 0.65, ADR 0015), before a deliberate /clear, or when fissioning.",
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
    description: "Mark a CGR goal DONE -- archives it to .arch/goals/done/, returns the NEXT goal's payload, and RELEASES the Stop-hook relay guard. HARD TEST GATE: re-runs the goal's verify-command and REFUSES on red (test_gate_failed plus the failing tail) -- fix and retry, or archkit_goal_abandon if obsolete. Optional `timeSpent` ('2h','90m') overrides derived elapsed. Draining the queue fires the done/digest consolidation. On a bucket's last goal, `bucketCompletion` carries a merge-or-archive CHOICE: present it with AskUserQuestion and relay `mergeGuidance` VERBATIM -- archkit never runs git (ADR 0025). Trigger: all exit-criteria met. Applied but unverified -> archkit_goal_testing; paused -> archkit_goal_hold; part-done -> archkit_goal_fission.",
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
    description: "Split a PARTIALLY-met goal at wind-down (ADR 0014/0015). Pass `criteriaMet`, a boolean vector aligned by index with the goal's exit-criteria: the met portion closes as a terminal `partial` record and a LEAN SUCCESSOR carrying only the unmet criteria plus handoff and lineage is forked, which the scheduler then prefers over cold pending work. HARD GATE: the met criteria are verified IN ISOLATION, so supply a `verifyCommand` scoped to them -- if verification cannot be isolated or runs red, fission BLOCKS rather than fork unverified debt. All-true and all-false vectors are refused. Trigger: at wind-down a goal is genuinely part-done and you want to bank the verified part.",
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
    description: "Park an in-progress goal as `testing` -- edits applied, verification still PENDING (ADR 0003). Moves the file to .arch/goals/testing/ and KEEPS the Stop-hook guard on, so it survives /clear and keeps blocking the relay until some later session runs it green and calls archkit_goal_complete. Trigger: right after applying a goal's edits, BEFORE you have actually run the tests. Verified green -> archkit_goal_complete; pausing for an external reason -> archkit_goal_hold.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to move into the testing (verification-pending) state."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      return runGoalTesting({ archDir: requireArchDir(cwd), slug });
    },
  },

  archkit_goal_hold: {
    description: "Park a real queued goal as `on-hold` -- deliberately set aside but resumable (ADR 0003). Unlike `testing` this RELEASES the Stop-hook guard so the session can end, and the goal is not auto-selected until nothing live is left; the file stays in .arch/goals/ because status, not folder, is the source of truth. Resume with /clear then /mcp__archkit__conductor. Trigger: blocked on an external decision or reprioritized. Criteria all met -> archkit_goal_complete; verification pending -> archkit_goal_testing; dropping it for good -> archkit_goal_abandon; stashing a NEW follow-up idea -> archkit_goal_defer; still being worked, just by a SUBAGENT -> archkit_goal_start with `worker` (dispatched keeps the lease; on-hold drops it).",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to park as on-hold (deliberately set aside, resumable)."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      return runGoalHold({ archDir: requireArchDir(cwd), slug });
    },
  },

  archkit_goal_consolidate: {
    description: "Fold every terminal goal sitting at the top of .arch/goals/done/ into a dated digest (done/digest/<YYYY-MM-DD>.md) and preserve each raw CGR verbatim under done/archive/. Incremental and idempotent -- it only drains what is already terminal, so it is safe while other goals are pending. Fires automatically at queue-drain and session end. Trigger: summarize a finished batch mid-sprint on demand. Digests are discoverable via archkit_goal_list.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGoalConsolidate({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_goal_reconcile: {
    description: "PLACEMENT-sense reconcile -- re-file goal FILES into the folder their STATUS dictates (ADR 0020/0021). Status is the truth; the folder is a derived cache. Mapping: pending -> queue/ or queue/<project>/, in-progress|on-hold -> goals/ root, testing -> testing/, completed|abandoned -> done/; duplicate slugs collapse onto the correctly-placed copy and status-less or unparseable .md files are quarantined. Walks the whole tree at any depth. DRY-RUN by default -- pass apply:true to actually move anything. It never touches file CONTENT or git: for the merge sense (a merge-reconcile CGR over colliding content) use archkit_board_conflict. Trigger: the relay picks the wrong goal, a completed goal keeps resurfacing, or after manual surgery under .arch/goals/.",
    inputSchema: z.object({
      apply: z.boolean().optional().describe("false/omitted = DRY-RUN: return the proposed moves/dups/quarantine without writing. true = perform them. Default false — inspect before applying."),
    }),
    handler: async ({ apply }) => {
      const cwd = process.cwd();
      return runGoalReconcile({ archDir: requireArchDir(cwd), apply });
    },
  },

  archkit_worklog: {
    description: "Render a copy-pasteable day-by-day worklog of COMPLETED CGR goals -- title, outcome, time, completion notes -- for Jira or standups. Pure report over data already on disk; writes nothing. Time is the explicit time-spent set at completion, else derived wall-clock tagged '(elapsed)' so an estimate is never misreported as logged effort. Deduped by slug, grouped by day, newest first. Default range is today; `from`/`to` are ISO dates. Trigger: the user asks what got done, or wants a standup/Jira update -- hand them the returned `markdown`.",
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
    description: "Apply ONE authored node line from a persisted graph-proposal to its cluster .graph and drop the consumed gap (ADR 0004) -- the accept half of the flywheel archkit_goal_complete starts by writing .arch/graph-proposals/<slug>.json. YOU author the prose: take the proposal's suggestedLine, replace its <role>/<flow> placeholders, and pass it as `line`. archkit never auto-merges a graph edit and REFUSES a line that fails the same parse warmup uses. Only undocumented-file gaps are appendable; unmapped-area gaps need a new cluster and are refused. Pass `file` to pick among several gaps. Trigger: goal_complete reported graph gaps and context is still warm.",
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
    description: "Gather evidence that a CGR goal is done WITHOUT completing it: its exit-criteria as a checklist, which files-to-touch are actually modified, what a staged review finds, and a PREVIEW run of the verify-command (archkit_goal_complete re-runs it as the authoritative gate). `clean` is false when tests are red. Modifies nothing. Trigger: right before archkit_goal_complete, to avoid declaring done prematurely.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Goal slug to verify."),
    }),
    handler: async ({ slug }) => {
      const cwd = process.cwd();
      return runGoalVerify({ archDir: requireArchDir(cwd), cwd, slug });
    },
  },

  archkit_goal_abandon: {
    description: "Drop a CGR goal WITHOUT counting it as finished -- archives to .arch/goals/done/ with status 'abandoned', clears the relay turn-cap, releases the Stop-hook guard, and returns the next goal's payload. Optional `reason` is stored as abandon-reason. Trigger: the goal is obsolete, mis-scoped, or superseded. Finished work -> archkit_goal_complete; only pausing it -> archkit_goal_hold.",
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
    description: "Stash a follow-up you noticed mid-session as a PROPOSAL in .arch/goals/proposed/ -- not a real goal, and it changes neither the active goal nor the queue. Prefer this over a TODO in code: proposals survive context resets and are surfaced for explicit confirmation via /mcp__archkit__goal_review, which promotes (archkit_goal_promote) or discards (archkit_goal_dismiss) them. Trigger: the moment you spot worthwhile work that is out of scope right now.",
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
    description: "Turn pending proposals from .arch/goals/proposed/ into real PLANNED goals the CGR queue will pick up -- pass hashes:[...] for a user-selected subset or all:true for everything. Trigger: the 'confirm' half of propose-and-confirm, AFTER the user picks in /mcp__archkit__goal_review. To reject instead, use archkit_goal_dismiss.",
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
    description: "Discard pending proposals from .arch/goals/proposed/ without turning them into goals -- pass hashes:[...] for a subset or all:true. The 'reject' half of propose-and-confirm. Trigger: detector noise, or follow-ups the user declined in /mcp__archkit__goal_review. To accept instead, use archkit_goal_promote.",
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
    description: "Ask whether .arch/ is actually LOAD-BEARING: aggregates archkit_resolve_warmup and archkit_drift findings and adds four surface checks -- playbooks with zero real WRONG/RIGHT/WHY gotchas, BAN globs matching no file in the tree, active goals with vacuous exit-criteria, and whether archkit's guardrail hooks are installed at all (D-HOOKS; fix with archkit_install_hooks). Trigger: periodic health check before a long session, after BOUNDARIES.md or playbook edits, or when archkit reviews start feeling like noise. Intent-checking -- for the session-start structural check use archkit_resolve_warmup.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runDoctorJson({ archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_decisions_search: {
    description: "Search or list past decision records in .arch/decisions/ -- the read side of archkit_log_decision. Pass `query` for keyword-ranked results (title and tags outweigh body), or omit it for the most recent; optional status (accepted/proposed/superseded/deprecated), tags, and limit (default 10, cap 50). Trigger: BEFORE changing an area, so a settled decision is not re-litigated after a context reset. archkit_resolve_preflight surfaces related records automatically.",
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
    description: "Check whether archkit's five guardrail hooks (SessionStart, Stop, PreToolUse, PostToolUse, UserPromptSubmit) are wired into Claude Code, and install the missing ones. `archkit init --install-hooks` does not install these, so on npm or global installs the CGR Stop guard, the SessionStart digest, the PreToolUse boundary block, and review-on-edit silently never fire even with a perfect .arch/. Default is EMIT mode: returns the exact hooks block and the target .claude/settings.json path for you to merge with Edit. apply:true writes them into the PROJECT settings, never the global user file. No-op under the archkit plugin. Trigger: archkit_doctor flagged D-HOOKS, or guardrails are not firing. The user must RESTART Claude Code afterwards.",
    inputSchema: z.object({
      apply: z.boolean().optional().describe("If true, write the missing guardrail hooks directly into the project's .claude/settings.json (idempotent, preserves existing hooks). Default false = emit the config for you to apply via Edit with the user watching."),
    }),
    handler: async ({ apply }) => {
      const cwd = process.cwd();
      return runHooksInstallJson({ cwd, apply: apply === true });
    },
  },

  archkit_init: {
    description: "THE canonical entry point for archkit setup -- returns the full wizard instructions inline, the skeleton index for all 9 archetypes, and an internal PRD scan. Works greenfield or re-init. Trigger: the user asks to set up / initialize / scaffold / configure archkit, or how to start with it. This only INSTRUCTS: drive the wizard conversation it describes, then WRITE the scaffold with archkit_init_generate and record the foundation decision with archkit_log_decision.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      let archDir = null;
      try { archDir = requireArchDir(cwd); } catch { /* greenfield — that's fine */ }
      return runInitJson({ cwd, archDir });
    },
  },

  archkit_init_generate: {
    description: "WRITE the .arch/ scaffold from structured answers -- the acting counterpart to archkit_init, which only instructs; no inquirer TTY needed. Produces SYSTEM.md, INDEX.md, README.md, BOUNDARIES.md, CONTEXT.compact.md, clusters/*.graph, playbooks/*.playbook, apis/*.api, lenses/*, plus (claudeMode, default true) CLAUDE.md, .claude/rules|skills|settings.json hooks, and a git pre-commit review hook. REFUSES to clobber an existing .arch/ unless overwrite:true. Requires appName and appType; everything else defaults from the archetype. Trigger: after deciding the answers with the user. Then archkit_resolve_warmup to verify.",
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
