---
slug: conductor-loop-hooks
title: Conductor orchestration loop + PreCompact/SessionStart rehydration
status: completed
created: 2026-06-23
epic: cgr2-orchestration
order: 4
exit-criteria:
  - Conductor loop: session_state -> claim frontier (lease) -> spawn worker subagents per lane (worktree-isolated) -> collect handoff returns -> deep-review only exceptions -> sequential merge queue with verify-after-each
  - PreCompact hook flushes in-context state to events + handoff before compaction
  - SessionStart(clear|compact) hook rehydrates the conductor from the folded board and reclaims leases older than cgr.leaseTtlHours (default 24)
  - config.json carries cgr.windDownAt (0.65), cgr.windDownAtByModel ({}), cgr.leaseTtlHours (24) alongside cgr.backlogThreshold
  - Stop-guard release moves from per-goal to per-lane (lane drained OR wind-down handoff produced)
  - Tests cover orphan-lease reclaim, rehydrate-from-board, and merge-queue ordering
  - Conductor loop: session_state -> claim frontier (lease) -> spawn worker subagents per lane (worktree-isolated) -> collect handoff returns -> deep-review only exceptions -> sequential merge queue with verify-after-each
- Conductor loop: session_state -> claim frontier (lease) -> spawn worker subagents per lane (worktree-isolated) -> collect handoff returns -> deep-review only exceptions -> sequential merge queue with verify-after-each
files-to-touch:
  - src/lib/board.mjs
  - src/mcp/tools.mjs
  - src/commands/goal.mjs
  - bin/archkit-precompact-hook.mjs
  - bin/archkit-session-start.mjs
required-reading:
  - .arch/decisions/0013-adopt-conductor-worker-orchestration-with-parallel-lanes-cgr.md
depends-on:
  - board-state-manager
  - handoff-and-winddown
  - intake-dag-ownership
verify-command: npm test
source-ask: Build CGR 2.0: conductor/worker parallel-lane orchestration with a persistent append-only board, fission-based resume, attention-gradient wind-down, plus AGENTS.md export and skills rename. See ADRs 0013-0015.
started: 2026-06-23T22:54:41.130Z
completed: 2026-06-23T23:09:42.036Z
completion-notes: Conductor orchestration loop (claimFrontier/reclaimExpiredLeases/orderMergeQueue/conductorExceptions/conductorPlan in board.mjs) + archkit_conductor tool & /mcp__archkit__conductor prompt; PreCompact hook flushes board snapshot + handoff guidance; SessionStart(clear|compact) rehydrates and reclaims orphan leases >leaseTtlHours; Stop-guard now per-lane (drained OR wind-down handoff). New tests/cgr-conductor (16 tests). 57/57 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-23
---



# Conductor orchestration loop + PreCompact/SessionStart rehydration

## Why
Ties it together: the lean conductor that claims, spawns workers in worktrees, reviews exceptions, merges, and survives context resets.

## Exit criteria
- [ ] Conductor loop: session_state -> claim frontier (lease) -> spawn worker subagents per lane (worktree-isolated) -> collect handoff returns -> deep-review only exceptions -> sequential merge queue with verify-after-each
- [ ] PreCompact hook flushes in-context state to events + handoff before compaction
- [ ] SessionStart(clear|compact) hook rehydrates the conductor from the folded board and reclaims leases older than cgr.leaseTtlHours (default 24)
- [ ] config.json carries cgr.windDownAt (0.65), cgr.windDownAtByModel ({}), cgr.leaseTtlHours (24) alongside cgr.backlogThreshold
- [ ] Stop-guard release moves from per-goal to per-lane (lane drained OR wind-down handoff produced)
- [ ] Tests cover orphan-lease reclaim, rehydrate-from-board, and merge-queue ordering

