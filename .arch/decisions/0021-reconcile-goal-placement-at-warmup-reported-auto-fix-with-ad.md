# 0021. Reconcile goal placement at warmup (reported auto-fix) with advisory-only staleness triage

- **Date**: 2026-07-19
- **Status**: Accepted
- **Tags**: cgr, goals, warmup, reconcile

## Context

CGR goal files live in status-named folders (`queue/`, root for in-progress/on-hold, `testing/`, `done/`), but a goal's on-disk folder and its `status:` frontmatter drift apart — status is edited while the file stays put, or a file is moved without its status following. ADR 0003 already establishes `status:` as the single source of truth for a goal's lifecycle, and ADR 0020 added `reconcileGoalsLayout(archDir,{apply})` — a pure, idempotent, quarantine-safe pass that re-files each goal into the folder its status dictates — but ADR 0020 explicitly DEFERRED the question of when/how that pass runs, and said nothing about detecting cross-project cruft. Left unreconciled, misplacement corrupts board/scan ordering (the conductor picks work by folder) and stale cross-project files accumulate. This decision records how the deferred wiring was resolved and how a second, riskier cleanup tier is bounded.

## Decision

1. The goals folder is a DERIVED CACHE; `status:` frontmatter is the source of truth for placement (restating ADR 0003 / ADR 0020 for this surface). Reconcile always resolves folder-vs-status conflicts in favor of status, never the reverse.

2. `archkit resolve warmup` now AUTO-FIXES placement by calling `reconcileGoalsLayout` (the ADR 0020 lib) on every session start, but REPORTS every move it makes — never silent. The same reconcile is exposed on demand as the new `archkit_goal_reconcile` MCP tool: dry-run to preview the moves, apply to perform them. Slug-derived destinations are path-traversal-validated (a crafted slug cannot escape the goals folder).

3. Tier-2 staleness triage — a lightweight check comparing the goals folder against chat/board state to flag cross-project cruft — is ADVISORY-ONLY. It reports signals for a human and NEVER mutates the filesystem. The bright line: source-of-truth-driven, bounded, reversible intra-project placement is safe to automate; higher-judgment cross-project cleanup stays a human decision.

4. CHANGELOG and README document the startup cleanup behavior and the manual tool so operators know placement self-heals and can see what moved.

## Consequences

Placement self-heals at every session start with no manual bookkeeping; because moves are reported, the operator always sees what shifted rather than finding files silently reorganized. Editing `status:` frontmatter is sufficient to re-file a goal — the folder never needs a hand-move. Confining auto-mutation to intra-project placement while holding cross-project staleness at advisory-only keeps the automatic path conservative and the risky cleanup human-gated. Path validation closes a traversal vector on the one place reconcile writes. Cost: the goals folder must be treated as regenerable — anything encoded only in folder location, not in `status:`, is not durable. Builds directly on ADR 0020 (the reconcile lib) and ADR 0003 (status authority); supersedes ADR 0020's deferral of the warmup-wiring question.
