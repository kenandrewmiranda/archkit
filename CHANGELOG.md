# Changelog

## v1.6.4 — 2026-05-19

### Fixed
- `review` no longer applies JS/TS-ecosystem heuristics to non-JS source files. The seven affected check modules (`api`, `db`, `cache`, `queue`, `frontend-wiring`, `event`, `floating-promise`) are now gated by file extension and, for ambiguous files, by a new `## Stack:` field parsed from `SYSTEM.md`.
- Concretely: `ModelContext.fetch(...)` in a `.swift` file no longer produces a phantom `http-client` warning suggesting `AbortSignal.timeout(5000)`; Swift's `.from(_:)` static factory no longer triggers a `db-efficiency` warning suggesting a Drizzle `.where(...).limit(50)` chain. Same fix covers `.kt`, `.go`, `.py`, `.rs`, `.rb`, `.dart`, `.cs`, and other native-language extensions.
- JS/TS reviews are unchanged — real `fetch()` calls and Drizzle `select().from(table)` queries are still flagged.
- Surfaced by a Swift/SwiftUI/SwiftData dogfood report (see commit message). Root cause was that `src/commands/review.mjs` ran every check module on every file with no language gate.

### Added
- `parseSystem()` now extracts a `## Stack:` field alongside the existing `Type`/`Pattern`/`Conv` fields. Used by the language gate for files with ambiguous extensions.
- `src/commands/review/language.mjs`: `classifyStack(stack)` and `shouldRunJsEcosystemChecks(filepath, stack)` helpers. Behavior preserved when no stack is declared.

### Tests
- 16 new tests in `tests/language-gating/` covering both the bug-report scenarios (Swift) and the no-regression cases (TypeScript).

## v1.6.3 — 2026-05-19

### Fixed
- `drift` + `resolve warmup` W010: `parseIndex` now handles multi-node `## Nodes → Clusters → Files` lines like `@A @B @C → @cluster → .arch/clusters/cluster.graph`. Previously it captured only the first `@node`, set `cluster = nodeId` (since `[brackets]` were absent), and stored the literal `"@cluster → ..."` string as `basePath` — producing simultaneous false `orphaned-index-node`, `orphaned-graph`, and `missing-source` findings on every cluster line.
- `parseIndex` cross-refs no longer require a parenthesized reason — bare `@A → @B` lines (which `archkit_stats` already counts) are now picked up too, so W010 stops contradicting stats on the same file.
- `drift`: paths under `.arch/` or ending in `.graph`/`.skill`/`.api` are no longer checked as source files. Those are .arch/ artifacts and were already covered by the `orphaned-*` checks against directory contents.
- Surfaced by arch-infographs dogfood: 11 spurious findings on every drift run, with stats/warmup/lookup all simultaneously reporting the same graphs as healthy.

## v1.6.2 — 2026-05-10

### Docs
- CHANGELOG backfilled with v1.5.0–v1.6.1 entries (was missing the entire v1.5 line and v1.6.0/v1.6.1).
- Removed `docs/roadmap/mcp-server.md` — a 2026-04-18 roadmap for the MCP server, which shipped 10 days later in v1.4.0. The historical "why we shipped MCP" reasoning lives in the v1.4.0 CHANGELOG entry; the roadmap doc was pure future-confusion bait.
- Fixed `examples/README.md` to use a real CLI command (`resolve preflight tasks controller`) instead of the non-existent `resolve context`.
- Annotated `examples/*/RESULTS.md` and the examples summary table as **2026-03-31 / pre-v1.4 snapshots** so future readers don't misread them as current detection rates.

## v1.6.1 — 2026-05-09

### Fixed
- `drift`: name-mismatch check no longer false-positives on SYSTEM.md app names that carry a parenthetical description (`"arch-infographs (LinkedIn AI Content Pipeline)"`). Now strips parentheticals before normalization, and matches both scoped and unscoped npm package names. Surfaced by arch-infographs dogfood under v1.6.0.

## v1.6.0 — 2026-05-09

### Added — continuous-guardrail layer (3 new hooks)
- **Stop hook** (`archkit-stop-hook`): fires after every assistant turn. Surfaces the v1.6 utilization metric, re-injects a compact form of `.arch/BOUNDARIES.md` (NEVER lines only) so rules survive Claude Code's context compression, scans the response for boundary violations, and auto-drafts proposed ADRs from decision-language to `.arch/decisions/proposed/<hash>.json`.
- **PostToolUse hook** (`archkit-posttooluse-hook`): fires after every tool call. Increments the session-stats utilization counter and, for Edit/Write/MultiEdit on source files in `src/`, runs `archkit_review` inline and surfaces the top findings as additional context.
- **UserPromptSubmit hook** (`archkit-userpromptsubmit-hook`): fires before each user prompt is processed — the highest-leverage hook for the v1.6 utilization goal. Starts a new "task window" in session stats, keyword-matches the prompt against `.arch/INDEX.md`, and prepends matched feature/skill routing with a specific call-to-action (`archkit_resolve_lookup`) when ≥2 keywords hit.
- **Compound utilization metric** — per-task primary (target ≥75% of editing tasks consult archkit before first edit) + per-session secondary (archkit calls / Edit+Read+Glob+Grep). Surfaced every turn by Stop hook.
- `archkit_resolve_warmup` now reports `summary.pendingDecisionProposals` and surfaces a triage action when proposals are pending in `.arch/decisions/proposed/`.
- Three new libs: `src/lib/session-stats.mjs`, `src/lib/decision-detector.mjs`, `src/lib/boundary-patterns.mjs`. Three universal NEVER detectors ship in v1.6.0: SQL string concatenation, hardcoded credential prefixes (sk-, AKIA, ghp_, AIza, npm_), and `req.body`/`req.query`/`req.params` without a validator hint nearby.

### Why
- v1.5 made archkit-aware setup work but the dogfood finding on arch-infographs was that LLMs are one-shot by nature: agents made multiple non-trivial architectural decisions (network mode, embedding dedupe threshold, routing precedence) without logging any ADRs. CLAUDE.md's "non-negotiable" prose did nothing because agents never reached for `archkit_log_decision` mid-flow. v1.6 replaces agent self-discipline with deterministic hooks that fire automatically every turn / every edit / every prompt.

### Tests
- 89 new tests across 6 suites. Synthetic decision-language corpus (30 positives + 30 negatives) shows 100/100 precision/recall — caveat: corpus and regex co-tuned. Real-world calibration is a v1.6.x follow-up.

### Out of scope (deferred)
- Plain-text password storage detection, stack-traces-to-client detection, HTTP-without-timeout detection — too FP-prone without window-checking. v1.6.x patches.
- Per-archetype boundary patterns beyond universals — v1.6.x.
- Auto-acceptance of proposed ADRs — must require human review.

## v1.5.4 — 2026-05-03

### Added
- `archkit_init` MCP tool: the canonical greenfield entry point. Returns the full wizard instructions inline plus PRD scan results, the skeleton index for all 9 archetypes, and a `nextStep` hint — in one response. Replaces the v1.5.0–v1.5.3 chain of escape-hatch nudges that tried to steer agents toward a separate SKILL.md.

### Why
- Earlier v1.5.x dogfood showed that prose nudges in hook output don't reliably trigger agent behavior. The structural fix is an MCP tool whose description matches user intent ("set up / initialize / scaffold archkit") so the discovery problem becomes a tool-call problem instead of a prompt-engineering problem.

## v1.5.3 — 2026-05-03

### Fixed
- Greenfield SessionStart hook: closed remaining v1.5.2 escape hatches that let agents discover the legacy `archkit init` CLI before the v1.5 wizard skill. Updated `skills/archkit-init/SKILL.md` header to match.

## v1.5.2 — 2026-05-03

### Fixed
- Greenfield discovery: SessionStart hook now steers Claude toward the v1.5 wizard skill (`skills/archkit-init/SKILL.md`) instead of the legacy `archkit init` CLI scaffolder. The CLI stays available for reverse-engineering existing codebases; greenfield setup is wizard-driven.

## v1.5.1 — 2026-05-03

### Added
- `archkit_prd_check` MCP tool: detects a PRD/BRIEF/SPEC at common paths (`PRD.md`, `BRIEF.md`, `SPEC.md`, `docs/prd.md`, etc.) and, when `.arch/` exists, scores the PRD's archetype + deployment-mode signals against `SYSTEM.md` to surface mismatches.
- Wizard is now PRD-aware: its first action is to call `archkit_prd_check` so it can pre-fill archetype suggestions if a PRD exists.

## v1.5.0 — 2026-05-03

### Added
- **Claude Code plugin packaging** (`.claude-plugin/plugin.json`): archkit ships as a single atomic install — MCP server, SessionStart hook, and the `/archkit-init` wizard skill all install together via Claude Code's plugin mechanism. npm install path remains the canonical surface for Cursor / Continue / CI / Claude Code without plugins.
- **`/archkit-init` slash-command wizard skill** (`skills/archkit-init/SKILL.md`): seven-step interactive setup that runs in the chat pane (no terminal context-switch). Resolves the v1.4.x audience question — vibe-coders are the primary user, and the wizard meets them where they already are.
- **Decisions ADRs** (`.arch/decisions/`): new top-level directory in archkit projects for human-authored architecture decision records. `archkit_log_decision` MCP tool appends a new ADR with consistent metadata.

### Why
- v1.4.x dogfood revealed that even with the SessionStart hook nudging toward MCP tools, the *initial setup* moment for a new project was still terminal-driven and vibe-coder-hostile. Plugin packaging + chat-pane wizard collapses install + setup into one frictionless flow.

## v1.4.2 — 2026-05-02

### Fixed
- `archkit init --mcp` now registers via `claude mcp add archkit archkit-mcp --scope user` instead of writing directly to `~/.claude/mcp.json`. Claude Code v2.x reads MCP config from `~/.claude.json` (managed by the `claude mcp` CLI), not from the legacy `~/.claude/mcp.json` path. v1.4.0 and v1.4.1 silently registered to the wrong file — `claude mcp list` did not show archkit, and the MCP tools were not available in sessions even when the installer claimed success.

### Behavior
- If the `claude` CLI is not on `PATH`, `archkit init --mcp` now warns clearly and prints the manual command to run.
- Idempotent: re-running detects an existing `archkit:` entry in `claude mcp list` and does nothing.

## v1.4.1 — 2026-05-02

### Added
- **SessionStart hook** (`archkit-session-start`): when Claude Code opens a session in an archkit project (detected by walking up from cwd to find `.arch/SYSTEM.md`), the hook emits `additionalContext` describing the available `archkit_*` MCP tools and how `.arch/` is structured. Wired up by `archkit init --install-hooks --claude` alongside the existing PreToolUse hook.

### Why
- Dogfood (2026-05-02) showed that tool descriptions and the skill template alone don't reliably nudge agents toward `archkit_*` MCP tools — invocation was inconsistent. A SessionStart hook injects factual project context before the agent picks its first tool, which lands at a higher trust posture than runtime PreToolUse deny-reason text (which was observed to trigger prompt-injection skepticism).

### Changed
- `archkit init --install-hooks --claude` now writes both a PreToolUse entry and a SessionStart entry to `.claude/settings.json`. Existing PreToolUse behavior is unchanged.

## v1.4.0 — 2026-04-28

### Added
- **MCP server** (`archkit-mcp` and `archkit mcp serve`): stdio MCP server exposing 10 typed tools that mirror the CLI surface. Lets AI agents call archkit natively in Claude Code, Cursor, and Continue.
- `archkit init --install-hooks --mcp`: idempotent registration of archkit in `~/.claude/mcp.json`.
- `ArchkitError` class and shared error envelope (`{ code, message, suggestion?, docsUrl? }`) used by both CLI `--json` output and MCP `isError` responses.
- Per-command `run*Json()` exports (review, warmup, preflight, scaffold, lookup, gotcha-list, gotcha-propose, stats, drift) for direct programmatic use.

### Changed
- `archkit-protocol` skill template now nudges agents toward MCP tools when available.

### Dependencies
- Added `@modelcontextprotocol/sdk@^1.29.0`
- Added `zod@^3`
