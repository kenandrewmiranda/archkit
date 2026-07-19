# 0020. Full-tree goal placement reconciliation (status-driven re-filing)

- **Date**: 2026-07-19
- **Status**: Accepted

## Context

CGR files drift into the narrow scans' blind spots (queueGoalFiles reads one level deep; flatGoalFiles only each dir's top level), so a goal buried at any depth gets skipped by the relay, or a stale zombie copy shadows the live one. migratePendingGoalsToQueue only fixes legacy root pending.

## Decision

Add reconcileGoalsLayout(archDir,{apply}) in goals.mjs: walk the ENTIRE goals tree at any depth and re-file each goal to the folder its status dictates (pending->queue/ or queue/<project>/, in-progress|on-hold->root, testing->testing/, completed|abandoned->done/). Status is the source of truth; the folder is a derived cache. Zombie duplicate slugs collapse to the copy whose location already matches its status. Status-less/unparseable .md files are QUARANTINED (moved to goals/quarantine/, never deleted). Non-goal drawers (digest/, proposed/, quarantine/) and the chat board are skipped. done/archive/ counts as placed for completed goals so history is never dragged up. Unknown-but-present statuses are left untouched (conservative). apply:false is a pure dry-run; the function never throws and is idempotent. outOfPlaceCount == moved.length is the health signal a startup auto-fix keys off. Warmup wiring is deferred to the separate warmup-reconcile-surface goal.

## Consequences

A single deterministic pass fixes the whole misplacement bug class. Quarantine (not delete) keeps recovery possible. Leaving unknown statuses and skipping digests/proposals avoids collateral damage. The pure-lib function is safe to call from warmup as a reported auto-fix.
