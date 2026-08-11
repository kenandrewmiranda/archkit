---
slug: fslock-primitive
title: A file-lock and atomic-write primitive with no new dependencies
status: completed
created: 2026-08-10
order: 2
project: state-safety
exit-criteria:
  - A new src/lib/fslock.mjs exports an atomic write (tmp+rename, promoting the saveGoalProposal pattern) and a scoped advisory lock built on fs.openSync(..., 'wx') carrying pid + timestamp
  - A stale lock is broken on a TTL rather than deadlocking, and breaking one is reported, never silent
  - The lock is reentrant-safe or explicitly documented as not, and releases on throw so a failed mutation cannot strand the lock
  - No new runtime dependency is added
  - "A new test suite proves: mutual exclusion across real concurrent processes, stale-lock breaking, release-on-throw, and that a torn write is never observable by a concurrent reader"
files-to-touch:
  - src/lib/fslock.mjs
  - tests/fslock/run.mjs
required-reading: 
depends-on:
  - adr-shared-state-contracts
owns:
  - src/lib/fslock.mjs
  - tests/fslock/**
feature: fslock
verify-command: npm test
source-ask: "since we have multiple lanes, we do have some race issues on multiple fronts, can we evaluate our current strategy and how we can properly address this? — Evaluation found: CGR state is split across two stores with opposite concurrency models. The board (.arch/board/events.ndjson, gitignored) is a correct append-only log with a pure fold. Goal frontmatter (.arch/goals/**, git-tracked) is ADR 0003's declared source of truth but is mutated by lock-free read-modify-write, with zero locking anywhere in the codebase. Sharpest edges: consolidateGoals (RMW on the digest that also deletes source goal files) is called from the Stop hook, a separate process spawned at every turn-end in every session; stampGoalFields is lock-free RMW on the authoritative store; archDir is resolved from process.cwd() at ~40 MCP sites, so worktree sharing is accidental rather than contractual."
lane: fslock
started: 2026-08-10T21:10:24.622Z
lease: "{\"worker\":\"worker-fslock\",\"expires\":\"2026-08-11T21:10:24.623Z\"}"
dispatched-since: 2026-08-10T21:10:24.627Z
dispatched-to: worker-fslock
completed: 2026-08-11T02:23:08.126Z
completion-notes: "Landed as merge 703043a on feat/state-safety (worker commit d30777c), 78/78 exit 0. src/lib/fslock.mjs ships atomicWriteFileSync/atomicWriteJsonSync (tmp+rename, sibling temp so the rename stays intra-device) and a wx-based advisory lock carrying pid+host+token+timestamp, with withLock/withArchLock as the caller-facing form. Lock is reentrant WITHIN a process (depth-counted, release order-independent), never across processes. Stale locks break on a 30s TTL and every break is reported via brokeStale + an onEvent sink; an unparseable lockfile is dated by mtime so corruption cannot deadlock. Fail-open is explicit: contention past the wait budget still runs the caller's mutation, flagged failedOpen with the blocking holder named. Zero new dependencies. Callers deliberately unconverted — goal-mutations-under-lock owns that."
tests-passed: true
tests-command: npm test
tests-at: 2026-08-11
---






# A file-lock and atomic-write primitive with no new dependencies

## Why
There is currently no locking anywhere in archkit. saveGoalProposal's tmp+rename (goals.mjs:3153) is the only correct atomic write and it is used in exactly one place. Both patterns need to be one reusable, tested module before any caller adopts them.

## Exit criteria
- [ ] A new src/lib/fslock.mjs exports an atomic write (tmp+rename, promoting the saveGoalProposal pattern) and a scoped advisory lock built on fs.openSync(..., 'wx') carrying pid + timestamp
- [ ] A stale lock is broken on a TTL rather than deadlocking, and breaking one is reported, never silent
- [ ] The lock is reentrant-safe or explicitly documented as not, and releases on throw so a failed mutation cannot strand the lock
- [ ] No new runtime dependency is added
- [ ] A new test suite proves: mutual exclusion across real concurrent processes, stale-lock breaking, release-on-throw, and that a torn write is never observable by a concurrent reader

