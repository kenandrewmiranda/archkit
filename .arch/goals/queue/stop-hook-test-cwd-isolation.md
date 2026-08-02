---
slug: stop-hook-test-cwd-isolation
title: Stop the stop-hook test suite from mutating the repository's own .arch/ board
status: pending
created: 2026-08-02
order: 12
exit-criteria:
  - tests/stop-hook/run.mjs passes an explicit cwd (the temp project dir) to every spawnSync/spawn of the Stop hook, so no hook child ever inherits the repo root
  - Running the full npm test suite leaves .arch/ byte-identical — verified by capturing a git status/hash of .arch/ before and after a full run
  - A regression guard fails if any test suite mutates .arch/ during a run, so this class of leak cannot silently return
  - The whole suite is audited for the same pattern — any other spawnSync/spawn of an archkit bin without an explicit cwd is given one
  - npm test is green
files-to-touch:
  - tests/stop-hook/run.mjs
  - scripts/test.mjs
required-reading: 
depends-on: 
owns:
  - tests/stop-hook/*
  - scripts/test.mjs
feature: test-hygiene
verify-command: npm test
source-ask: Discovered during the lane-integration dispatch pass: both worktree workers independently found that `npm test` mutates the repository's own .arch/ directory. tests/stop-hook/run.mjs spawns the Stop hook via spawnSync without a cwd option, so the hook child inherits the test runner's cwd (the repo root) even though the payload names a temp project; the queue-drain consolidation then fires against the LIVE board, archiving real CGRs into done/archive/ and writing a digest. The conductor reproduced this a third time by running npm test in a worker's worktree.
lane: test-hygiene
---


# Stop the stop-hook test suite from mutating the repository's own .arch/ board

## Why
tests/stop-hook/run.mjs spawns the Stop hook via spawnSync with no cwd option, so the hook child inherits the test runner's cwd (the repo root) instead of the temp project its payload names. The queue-drain consolidation then fires against the LIVE board: real completed CGRs are archived into .arch/goals/done/archive/ and a digest is written, on every npm test. Confirmed three times independently in one session (both lane workers plus the conductor), and it silently swept 5 archived CGRs into a worker's first commit before being reverted. Anyone running npm test with loose files in .arch/goals/done/ hits this, so test runs are not side-effect-free and commits can pick up unrelated board churn.

## Exit criteria
- [ ] tests/stop-hook/run.mjs passes an explicit cwd (the temp project dir) to every spawnSync/spawn of the Stop hook, so no hook child ever inherits the repo root
- [ ] Running the full npm test suite leaves .arch/ byte-identical — verified by capturing a git status/hash of .arch/ before and after a full run
- [ ] A regression guard fails if any test suite mutates .arch/ during a run, so this class of leak cannot silently return
- [ ] The whole suite is audited for the same pattern — any other spawnSync/spawn of an archkit bin without an explicit cwd is given one
- [ ] npm test is green

