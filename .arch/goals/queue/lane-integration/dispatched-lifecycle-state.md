---
slug: dispatched-lifecycle-state
title: Add a `dispatched` CGR state that holds the lease but releases the Stop-hook relay guard
status: pending
created: 2026-08-02
order: 14
project: lane-integration
exit-criteria:
  - A `dispatched` lifecycle state exists alongside in-progress/testing/on-hold: it HOLDS the lease and keeps the goal in in_flight, but RELEASES the Stop-hook relay guard so the conductor session can end
  - archkit_goal_start (or a conductor-side equivalent) can place a goal in `dispatched` when the claim is made on behalf of a subagent rather than the calling session
  - A goal in `dispatched` still appears in archkit_session_state.in_flight with its lane/worker/lease, and is NOT offered by frontier or nextEligibleGoal — distinct from on-hold, which drops the lease semantics entirely
  - The Stop hook does not emit keep-working criteria for a goal in `dispatched`
  - Lease TTL expiry still reclaims a `dispatched` goal as an orphan, exactly as it does for in-progress
  - Tests cover: guard released in `dispatched`, lease retained, frontier exclusion, and TTL reclaim
files-to-touch:
  - src/lib/goals.mjs
  - bin/archkit-stop-hook.mjs
  - src/mcp/tools.mjs
  - tests/cgr-states-wiring/
required-reading: 
depends-on:
  - finalize-version-bump
owns:
  - src/lib/goals.mjs
  - bin/archkit-stop-hook.mjs
  - src/mcp/tools.mjs
  - tests/cgr-states-wiring/*
feature: cgr-lifecycle
verify-command: npm test
source-ask: file all three, then dispatch finalize-version-bump with corrected owns — the three findings from the lane-integration dispatch pass: (1) Stop-hook guard is session-scoped but goal ownership is subagent-scoped, so every conductor pass gets told to work criteria belonging to a worker in another worktree; (2) the new .arch/ board-immutability guard false-positives on concurrent worker MCP writes and blames an innocent suite; (3) ten cwd-less spawns remain in test suites neither lane owned, plus migrate-playbooks resolves the archkit bin off process.cwd().
lane: cgr-lifecycle
---


# Add a `dispatched` CGR state that holds the lease but releases the Stop-hook relay guard

## Why
Under CGR 2.0 the conductor dispatches workers who call archkit_goal_start themselves, so the in-progress guard fires in the CONDUCTOR's session — where the only correct action is to wait. The hook then instructs the conductor to work exit criteria owned by a worker in a different worktree. Observed twice in a single dispatch pass (once per dispatched lane). The workaround was archkit_goal_hold, which releases the guard but misrepresents an actively-worked lane as parked and drops it out of frontier selection.

## Exit criteria
- [ ] A `dispatched` lifecycle state exists alongside in-progress/testing/on-hold: it HOLDS the lease and keeps the goal in in_flight, but RELEASES the Stop-hook relay guard so the conductor session can end
- [ ] archkit_goal_start (or a conductor-side equivalent) can place a goal in `dispatched` when the claim is made on behalf of a subagent rather than the calling session
- [ ] A goal in `dispatched` still appears in archkit_session_state.in_flight with its lane/worker/lease, and is NOT offered by frontier or nextEligibleGoal — distinct from on-hold, which drops the lease semantics entirely
- [ ] The Stop hook does not emit keep-working criteria for a goal in `dispatched`
- [ ] Lease TTL expiry still reclaims a `dispatched` goal as an orphan, exactly as it does for in-progress
- [ ] Tests cover: guard released in `dispatched`, lease retained, frontier exclusion, and TTL reclaim

