---
slug: test-cwd-audit-remainder
title: Give an explicit cwd to the ten remaining cwd-less spawns outside the stop-hook suite
status: completed
created: 2026-08-02
order: 16
project: lane-integration
exit-criteria:
  - Every spawnSync/spawn/execFileSync/execSync of an archkit bin in tests/api-gate, tests/cgr-board, tests/claude-hook, tests/cli-dispatch, tests/posttooluse-hook, tests/pretooluse-hook and tests/userpromptsubmit-hook is given an explicit cwd pointing at that suite's temp project
  - tests/migrate-playbooks/run.mjs resolves the archkit bin from __dirname rather than process.cwd()
  - Each of those suites passes when run DIRECTLY (node tests/<suite>/run.mjs from the repo root), not only under the npm test sandbox, and leaves .arch/ byte-identical when run that way
  - The source-scan guard that pins this invariant is generalized from the stop-hook suite to cover every suite, so a new cwd-less spawn fails the run wherever it lands
  - npm test is green
files-to-touch:
  - tests/api-gate/run.mjs
  - tests/cgr-board/run.mjs
  - tests/claude-hook/run.mjs
  - tests/cli-dispatch/run.mjs
  - tests/posttooluse-hook/run.mjs
  - tests/pretooluse-hook/run.mjs
  - tests/userpromptsubmit-hook/run.mjs
  - tests/migrate-playbooks/run.mjs
required-reading: 
depends-on: 
owns:
  - tests/api-gate/*
  - tests/cgr-board/*
  - tests/claude-hook/*
  - tests/cli-dispatch/*
  - tests/posttooluse-hook/*
  - tests/pretooluse-hook/*
  - tests/userpromptsubmit-hook/*
  - tests/migrate-playbooks/*
  - tests/spawn-cwd-audit/*
feature: test-cwd-audit
verify-command: npm test
source-ask: "file all three, then dispatch finalize-version-bump with corrected owns — the three findings from the lane-integration dispatch pass: (1) Stop-hook guard is session-scoped but goal ownership is subagent-scoped, so every conductor pass gets told to work criteria belonging to a worker in another worktree; (2) the new .arch/ board-immutability guard false-positives on concurrent worker MCP writes and blames an innocent suite; (3) ten cwd-less spawns remain in test suites neither lane owned, plus migrate-playbooks resolves the archkit bin off process.cwd()."
lane: test-cwd-audit
started: 2026-08-02T23:36:11.714Z
on-hold-since: 2026-08-02
handoff: .arch/board/handoff/test-cwd-audit-remainder.md
completed: 2026-08-02T23:45:49.314Z
completion-notes: Worker lane test-cwd-audit. 11 cwd-less spawns given explicit cwd across api-gate, cgr-board, claude-hook, cli-dispatch, posttooluse-hook, pretooluse-hook, userpromptsubmit-hook; migrate-playbooks resolves the archkit bin from __dirname. New tests/spawn-cwd-audit suite scans every tests/*.mjs repo-wide with rule-based exemptions (no name allowlist), scan floors and negative fixtures. Criterion 3 proved by direct runs of all 9 suites with .arch/ hash 19e8ede2e8ec6d7e identical before and after each. Merged at 95b4630; npm test 77/77 green, exit 0.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---






# Give an explicit cwd to the ten remaining cwd-less spawns outside the stop-hook suite

## Why
The stop-hook-test-cwd-isolation lane fixed its own three spawns and neutralized the rest with a cwd sandbox, but ten spawns in suites it did not own still omit cwd. They are harmless under `npm test` because the sandbox covers them, and leaky the moment a suite is run directly — which is exactly how these suites are debugged. tests/migrate-playbooks/run.mjs additionally resolves the archkit bin off process.cwd(), a latent bug the sandbox exposed.

## Exit criteria
- [ ] Every spawnSync/spawn/execFileSync/execSync of an archkit bin in tests/api-gate, tests/cgr-board, tests/claude-hook, tests/cli-dispatch, tests/posttooluse-hook, tests/pretooluse-hook and tests/userpromptsubmit-hook is given an explicit cwd pointing at that suite's temp project
- [ ] tests/migrate-playbooks/run.mjs resolves the archkit bin from __dirname rather than process.cwd()
- [ ] Each of those suites passes when run DIRECTLY (node tests/<suite>/run.mjs from the repo root), not only under the npm test sandbox, and leaves .arch/ byte-identical when run that way
- [ ] The source-scan guard that pins this invariant is generalized from the stop-hook suite to cover every suite, so a new cwd-less spawn fails the run wherever it lands
- [ ] npm test is green

