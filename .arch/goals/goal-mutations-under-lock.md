---
slug: goal-mutations-under-lock
title: Route every goal-file mutation through the lock and atomic write
status: dispatched
created: 2026-08-10
order: 3
project: state-safety
exit-criteria:
  - stampGoalFields, the runGoalComplete archive, and reconcileGoalsLayout's move all mutate under the lock and write atomically
  - stampGoalFields re-reads the goal INSIDE the lock so a concurrent stamp of a different field can no longer be lost
  - reclaimExpiredLeases re-checks lease expiry inside the lock before stamping, closing the TOCTOU that lets a renewed lease be dropped
  - A test proves concurrent stamps of different fields on one goal both survive, and that a lease renewed during a reclaim pass is not dropped
  - Full suite green, with existing single-process behavior unchanged
files-to-touch:
  - src/lib/goals.mjs
  - src/lib/board.mjs
  - tests/cgr-concurrency/run.mjs
required-reading: 
depends-on:
  - fslock-primitive
owns:
  - src/lib/goals.mjs
  - src/lib/board.mjs
  - tests/cgr-concurrency/**
feature: concurrency
verify-command: npm test
source-ask: "since we have multiple lanes, we do have some race issues on multiple fronts, can we evaluate our current strategy and how we can properly address this? — Evaluation found: CGR state is split across two stores with opposite concurrency models. The board (.arch/board/events.ndjson, gitignored) is a correct append-only log with a pure fold. Goal frontmatter (.arch/goals/**, git-tracked) is ADR 0003's declared source of truth but is mutated by lock-free read-modify-write, with zero locking anywhere in the codebase. Sharpest edges: consolidateGoals (RMW on the digest that also deletes source goal files) is called from the Stop hook, a separate process spawned at every turn-end in every session; stampGoalFields is lock-free RMW on the authoritative store; archDir is resolved from process.cwd() at ~40 MCP sites, so worktree sharing is accidental rather than contractual."
lane: lane-windows-path-portability
started: 2026-08-11T02:52:13.065Z
lease: "{\"worker\":\"worker-goal-lock\",\"expires\":\"2026-08-12T02:52:13.067Z\"}"
dispatched-since: 2026-08-11T02:52:13.069Z
dispatched-to: worker-goal-lock
---





# Route every goal-file mutation through the lock and atomic write

## Why
stampGoalFields (goals.mjs:1415) is loadGoal -> mutate -> writeFileSync with no lock, and it is the funnel every lifecycle transition passes through. Concurrent stamps of different fields silently drop one. runGoalComplete's archive and reconcileGoalsLayout's write+rmSync have the same exposure, and reclaimExpiredLeases folds the board and then stamps, so a worker renewing in that window loses its lease and its lane is re-dispatched.

## Exit criteria
- [ ] stampGoalFields, the runGoalComplete archive, and reconcileGoalsLayout's move all mutate under the lock and write atomically
- [ ] stampGoalFields re-reads the goal INSIDE the lock so a concurrent stamp of a different field can no longer be lost
- [ ] reclaimExpiredLeases re-checks lease expiry inside the lock before stamping, closing the TOCTOU that lets a renewed lease be dropped
- [ ] A test proves concurrent stamps of different fields on one goal both survive, and that a lease renewed during a reclaim pass is not dropped
- [ ] Full suite green, with existing single-process behavior unchanged

