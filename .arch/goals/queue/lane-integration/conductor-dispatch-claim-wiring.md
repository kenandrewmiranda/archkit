---
slug: conductor-dispatch-claim-wiring
title: Make the conductor pass actually claim each lane into the `dispatched` state it now has
status: pending
created: 2026-08-02
order: 16
project: lane-integration
exit-criteria:
  - The conductor's rendered dispatch step instructs the conductor to claim each claimable lane via archkit_goal_start with the worker identifier BEFORE or AS it spawns that lane's worker, so the goal enters `dispatched` rather than in-progress
  - A goal claimed that way shows up in archkit_session_state.in_flight with its lane, worker and lease, so a conductor session that is cleared mid-pass rehydrates the dispatch instead of seeing an empty board
  - The rendered pass no longer suggests archkit_goal_hold as the way to end a conductor session with workers running — on-hold stays reserved for deliberately parked work
  - A worker calling archkit_goal_start from its own session still only CONFIRMS the existing claim and does not flip the goal out of `dispatched`, matching the behaviour ADR 0027 already implements
  - Tests cover the rendered dispatch text carrying the claim step, and the end-to-end shape of claim -> dispatched -> in_flight -> complete
files-to-touch:
  - src/lib/format.mjs
  - src/lib/board.mjs
  - tests/cgr-conductor/run.mjs
required-reading: 
depends-on: 
owns:
  - src/lib/format.mjs
  - src/lib/board.mjs
  - tests/cgr-conductor/*
feature: cgr-conductor
verify-command: npm test
source-ask: file the conductor-wiring follow-up — ADR 0027's `dispatched` state is implemented and tested but never reached in practice, because archkit_conductor's dispatch step still doesn't tell the conductor to claim each lane with archkit_goal_start {worker}. Until that wiring lands, conductors keep falling back to the archkit_goal_hold workaround, which misrepresents an actively-worked lane as deliberately parked. Observed six times across two sessions.
lane: cgr-conductor
---


# Make the conductor pass actually claim each lane into the `dispatched` state it now has

## Why
ADR 0027 added `dispatched` (holds the lease, releases the Stop-hook guard) and it is fully tested, but nothing ever puts a goal INTO it. archkit_conductor's rendered dispatch step still says only “spawn ONE worker subagent per claimable lane”, so the conductor spawns workers and the workers call archkit_goal_start from their own sessions — which lands them in in-progress, re-arming the guard in the conductor's session. The conductor then reaches for archkit_goal_hold, which releases the guard but drops the lease semantics and shows an actively-worked lane as deliberately parked. That workaround fired six times across two sessions; the fix is inert until this wiring lands.

## Exit criteria
- [ ] The conductor's rendered dispatch step instructs the conductor to claim each claimable lane via archkit_goal_start with the worker identifier BEFORE or AS it spawns that lane's worker, so the goal enters `dispatched` rather than in-progress
- [ ] A goal claimed that way shows up in archkit_session_state.in_flight with its lane, worker and lease, so a conductor session that is cleared mid-pass rehydrates the dispatch instead of seeing an empty board
- [ ] The rendered pass no longer suggests archkit_goal_hold as the way to end a conductor session with workers running — on-hold stays reserved for deliberately parked work
- [ ] A worker calling archkit_goal_start from its own session still only CONFIRMS the existing claim and does not flip the goal out of `dispatched`, matching the behaviour ADR 0027 already implements
- [ ] Tests cover the rendered dispatch text carrying the claim step, and the end-to-end shape of claim -> dispatched -> in_flight -> complete

