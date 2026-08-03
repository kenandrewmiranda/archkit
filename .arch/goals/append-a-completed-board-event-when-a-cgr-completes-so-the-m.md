---
slug: append-a-completed-board-event-when-a-cgr-completes-so-the-m
title: Append a `completed` board event when a CGR completes, so the merge queue fills outside fission
status: in-progress
created: 2026-08-03
exit-criteria:
  - archkit_goal_complete (runGoalComplete) appends a `completed` board event carrying the CGR's lane, worker and completion (full|partial)
  - A completed-but-unmerged CGR appears in archkit_session_state.merge_queue and in the conductor's convergence plan
  - Completing a CGR that was never claimed does not manufacture a phantom merge entry for work that already landed on the integration branch
  - Tests cover complete -> merge_queue -> archkit_board_merged -> off the queue
files-to-touch: 
required-reading: 
depends-on: 
verify-command: 
source-ask: "Deferred during a prior session: conductor-dispatch-claim-wiring: the e2e test showed in_flight cleared on completion (via the new terminal-status check) but merge_queue never filled."
started: 2026-08-03T00:56:22.558Z
---


# Append a `completed` board event when a CGR completes, so the merge queue fills outside fission

## Why
Nothing appends a `completed` event on a normal completion — only fission does (src/commands/goal.mjs). So sessionState.merge_queue stays empty for CGRs that genuinely completed and were never merged, and the conductor's convergence stage has nothing to drain. Surfaced while wiring the claim -> dispatched -> in_flight -> complete shape (ADR 0028); fixing it changes board behaviour repo-wide, so it needs its own goal.

## Exit criteria
- [ ] archkit_goal_complete (runGoalComplete) appends a `completed` board event carrying the CGR's lane, worker and completion (full|partial)
- [ ] A completed-but-unmerged CGR appears in archkit_session_state.merge_queue and in the conductor's convergence plan
- [ ] Completing a CGR that was never claimed does not manufacture a phantom merge entry for work that already landed on the integration branch
- [ ] Tests cover complete -> merge_queue -> archkit_board_merged -> off the queue

