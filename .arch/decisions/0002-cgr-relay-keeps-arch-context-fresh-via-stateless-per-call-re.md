# 0002. CGR relay keeps arch context fresh via stateless per-call reads, not cache invalidation

- **Date**: 2026-06-06
- **Status**: Accepted
- **Tags**: cgr, mcp, architecture, caching

## Context

Goal `validate-arch-refresh-on-complete` asked whether architecture-derived state (INDEX parse, drift findings, warmup digest, graph/nodes) is refreshed between CGR goals so the next iteration sees current state — and to implement a refresh if it was missing or stale.

The concern is real on its face: the archkit MCP server is a long-running stdio process. `/clear` wipes the *conversation* context, but between goals (`/clear` → `/mcp__archkit__goal_next`) the server PROCESS keeps running. If any arch-derived state were memoized at module/singleton scope in that process, a stale cache could leak from one goal into the next.

A thorough trace of the server dispatch and every resolve/warmup/drift/review/lookup/goals code path was done to find such caches.

## Decision

Add NO cache-invalidation code. The trace found there is nothing to invalidate: the MCP server holds zero in-memory arch state.

Findings:
- Dispatch is fresh per call. `src/mcp/server.mjs` registers handlers that, on each tool call, invoke the command's `run*Json` with a freshly resolved `archDir` (`src/mcp/tools.mjs`). No closure-captured or server-object arch state.
- Every derivation reads `.arch/` fresh from disk on every call: `src/lib/parsers.mjs` (`parseSystem`/`parseIndex`/`loadGraphCluster`/`loadSkillGotchas`) constructs new objects each call; `runWarmupJson`, `runDriftJson` (`detectFindings`), preflight, review, and `goals.mjs` `listGoals`/`loadGoal`/`nextEligibleGoal` all re-read per call. The only module-level mutable state is `logger.mjs`'s `quiet` flag — not arch data.
- The next goal's context is re-derived by two mechanisms, neither of which is a cache: (1) per-call fresh disk reads mean whatever the prior goal changed on disk is immediately visible; (2) `renderPayload` (`src/lib/goals.mjs`) UNCONDITIONALLY emits `Then run: archkit resolve warmup`, so after `/clear` the agent re-derives the warmup digest against current disk state.

So "refresh on goal completion" is automatic and structural, not a step that can be forgotten. Instead of dead invalidation code, PIN the contract with a regression test (`tests/cgr-context-refresh/`): (a) `renderPayload` always carries the warmup refresh instruction; (b) `runWarmupJson` and `runDriftJson` reflect on-disk `.arch/` changes across successive calls in the same process (proving no stale cache).

## Consequences

Easier: the next CGR goal always sees current nodes/graph/drift with no extra wiring; reasoning about freshness is local (read-from-disk) rather than depending on a cache-lifecycle.

Constrained (the point of the test): if someone later adds memoization to parsers/warmup/drift for performance, the pinned `tests/cgr-context-refresh/` suite fails unless they also scope the cache per-call or wire invalidation on goal transition — preventing a perf optimization from silently reintroducing cross-goal staleness.

Trade-off accepted: re-parsing `.arch/` on every tool call is slightly more I/O, but `.arch/` is small and warmup already targets <200ms; correctness-by-construction beats a cache here.
