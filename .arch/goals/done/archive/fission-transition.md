---
slug: fission-transition
title: Fission: partial-complete split with hard verify gate
status: completed
created: 2026-06-23
epic: cgr2-orchestration
order: 3
exit-criteria:
  - At wind-down, a fully-met CGR closes normally; a partially-met CGR triggers fission
  - Partial close runs verify-command on the MET criteria and BLOCKS + surfaces to attention if verification can't be isolated to them OR is red (no silent debt fork)
  - On success, a successor CGR is created with only the unmet criteria + handoff + lineage (forked_from / superseded_by); scheduler prefers the continuation over cold pending work
  - Events appended: cgr.closed(partial) and cgr.forked
  - Tests cover block-on-unverifiable-partial and successful fork-with-carry-forward
  - Events appended: cgr.closed(partial) and cgr.forked
- Events appended: cgr.closed(partial) and cgr.forked
files-to-touch:
  - src/lib/board.mjs
  - src/lib/goals.mjs
  - src/commands/goal.mjs
  - src/mcp/tools.mjs
required-reading:
  - .arch/decisions/0014-resume-by-cgr-fission-not-replay-board-as-append-only-event.md
  - .arch/decisions/0015-attention-gradient-wind-down-completion-lease-policy-knobs.md
depends-on:
  - board-state-manager
  - handoff-and-winddown
verify-command: npm test
source-ask: Build CGR 2.0: conductor/worker parallel-lane orchestration with a persistent append-only board, fission-based resume, attention-gradient wind-down, plus AGENTS.md export and skills rename. See ADRs 0013-0015.
started: 2026-06-23T22:35:18.145Z
completed: 2026-06-23T22:47:44.357Z
completion-notes: Added CGR fission: pure partitionCriteria/fissionDecision/forkSuccessor/successorSlugFor/isContinuation in goals.mjs + continuation-preference in nextEligibleGoal/routeNextGoal. New runGoalFission (command) with a HARD verify gate — blocks on unverifiable-partial (no isolated verify-command) or red, else authors the carry-forward handoff, forks a lean successor (unmet criteria + lineage forked_from/superseded_by), appends cgr.closed(partial)+cgr.forked events, and closes the met portion as a terminal partial record. New archkit_goal_fission MCP tool + CLI subcommand. New tests/cgr-fission suite (10 tests); bumped mcp-server tool count 39→40 + silent-success-audit case. 56/56 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-23
---



# Fission: partial-complete split with hard verify gate

## Why
Turns resume from replay into fission — close the done part, fork a lean successor for the remainder.

## Exit criteria
- [ ] At wind-down, a fully-met CGR closes normally; a partially-met CGR triggers fission
- [ ] Partial close runs verify-command on the MET criteria and BLOCKS + surfaces to attention if verification can't be isolated to them OR is red (no silent debt fork)
- [ ] On success, a successor CGR is created with only the unmet criteria + handoff + lineage (forked_from / superseded_by); scheduler prefers the continuation over cold pending work
- [ ] Events appended: cgr.closed(partial) and cgr.forked
- [ ] Tests cover block-on-unverifiable-partial and successful fork-with-carry-forward

