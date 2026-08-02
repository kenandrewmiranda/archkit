---
slug: board-guard-concurrent-write
title: Stop the .arch/ board-immutability guard from blaming an innocent suite for a concurrent agent write
status: pending
created: 2026-08-02
order: 15
project: lane-integration
exit-criteria:
  - The guard distinguishes a mutation caused by the suite under test from one caused by a concurrent writer outside the test process, and does not fail the run for the latter
  - When a concurrent external write is detected the run reports it as a distinct, clearly-worded condition — never as `<suite> mutated the board`
  - The guard still fails hard, naming the suite, when a suite genuinely writes to .arch/ — proven by a throwaway probe suite as in the original implementation
  - tests/stop-hook/run.mjs's sibling-project assertion is strengthened to compare the .arch/ tree RECURSIVELY (contents, not just top-level entry names) — the current readdirSync check would have passed against the very bug it guards
  - npm test is green, and green twice in a row while an unrelated process writes .arch/ mid-run
files-to-touch:
  - scripts/test.mjs
  - tests/stop-hook/run.mjs
required-reading: 
depends-on: 
owns:
  - scripts/test.mjs
  - tests/stop-hook/*
feature: board-guard
verify-command: npm test
source-ask: file all three, then dispatch finalize-version-bump with corrected owns — the three findings from the lane-integration dispatch pass: (1) Stop-hook guard is session-scoped but goal ownership is subagent-scoped, so every conductor pass gets told to work criteria belonging to a worker in another worktree; (2) the new .arch/ board-immutability guard false-positives on concurrent worker MCP writes and blames an innocent suite; (3) ten cwd-less spawns remain in test suites neither lane owned, plus migrate-playbooks resolves the archkit bin off process.cwd().
lane: board-guard
---


# Stop the .arch/ board-immutability guard from blaming an innocent suite for a concurrent agent write

## Why
scripts/test.mjs hashes .arch/ around each suite and attributes any delta to whichever suite was running. Worker MCP calls write the MAIN tree's .arch/ regardless of which worktree the worker lives in, so a verify run in the main tree during a dispatch pass goes red and names an unrelated suite. Observed directly: `drift-fix` was blamed for the tool-description-diet worker's archkit_goal_handoff write. Because npm test is also the archkit_goal_complete test gate, a mid-flight board can fail an otherwise-green completion.

## Exit criteria
- [ ] The guard distinguishes a mutation caused by the suite under test from one caused by a concurrent writer outside the test process, and does not fail the run for the latter
- [ ] When a concurrent external write is detected the run reports it as a distinct, clearly-worded condition — never as `<suite> mutated the board`
- [ ] The guard still fails hard, naming the suite, when a suite genuinely writes to .arch/ — proven by a throwaway probe suite as in the original implementation
- [ ] tests/stop-hook/run.mjs's sibling-project assertion is strengthened to compare the .arch/ tree RECURSIVELY (contents, not just top-level entry names) — the current readdirSync check would have passed against the very bug it guards
- [ ] npm test is green, and green twice in a row while an unrelated process writes .arch/ mid-run

