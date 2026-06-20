---
slug: cgr-queue-folder-layout
title: Move pending CGRs into a goals/queue/ folder with backward-compat shim
status: completed
created: 2026-06-20
epic: parallel-cgr-workflow
order: 3
exit-criteria:
  - New goals are WRITTEN to .arch/goals/queue/<slug>.md (optionally .../queue/<project>/<slug>.md); a queueDir helper is added
  - listGoals + loadGoal DUAL-READ both legacy goals/ root and goals/queue/ so existing projects' goals stay visible (read-alias pattern, like planned->pending)
  - All transition helpers (startGoal, markTesting, markOnHold, completeGoal, abandonGoal) resolve and relocate correctly from either location
  - A one-time migration moves existing root-level *.md pending goals into queue/ (idempotent; leaves testing/done/proposed untouched)
  - ADR 0003 is amended (or a new ADR logged) recording the queue/ folder decision and the dual-read backward-compat strategy
  - Full suite green, including new tests for dual-read and migration idempotency
files-to-touch:
  - src/lib/goals.mjs
  - src/commands/goal.mjs
required-reading:
  - .arch/decisions/0003-lock-the-expanded-cgr-lifecycle-state-model-and-rename-the-s.md
  - src/lib/goals.mjs
depends-on:
  - cgr-project-branch-grouping
verify-command: npm test
source-ask: Review if the CGR workflow can include an actual Queue folder instead of pending goals sitting at the root. Introduce a net-new "projects" idea where relevant CGRs are set in a subfolder so the agent knows to start a new branch and commit each CGR to that branch, enabling agents to work on feature sets in parallel. If two agents cross each other in the codebase, add a chat.md the agents can use to communicate about potential conflicts, wired in as prework. Goal: make parallel work seamless.
started: 2026-06-20T15:41:42.878Z
completed: 2026-06-20T15:51:17.169Z
completion-notes: Added goals/queue/ as the pending-goal drawer (with queue/<project>/ nesting), queueDir helper, dual-read in listGoals/loadGoal across queue+legacy-root+testing, and an idempotent migratePendingGoalsToQueue run lazily from ensureGoalsLayout. Reordered ensureGoalsLayout before loadGoal in all 5 transition helpers to avoid a migrate-mid-transition duplicate. Logged ADR 0011; added 10 new tests (queue write, dual-read, migration, idempotency, lifecycle). 52/52 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-20
---



# Move pending CGRs into a goals/queue/ folder with backward-compat shim

## Why
Makes the state-to-folder map symmetric (queue/ · testing/ · done/). Revises ADR 0003 (status-is-truth, only testing/ is loud). Breaking on-disk change for a published package — requires dual-read + migration so existing projects keep working.

## Exit criteria
- [ ] New goals are WRITTEN to .arch/goals/queue/<slug>.md (optionally .../queue/<project>/<slug>.md); a queueDir helper is added
- [ ] listGoals + loadGoal DUAL-READ both legacy goals/ root and goals/queue/ so existing projects' goals stay visible (read-alias pattern, like planned->pending)
- [ ] All transition helpers (startGoal, markTesting, markOnHold, completeGoal, abandonGoal) resolve and relocate correctly from either location
- [ ] A one-time migration moves existing root-level *.md pending goals into queue/ (idempotent; leaves testing/done/proposed untouched)
- [ ] ADR 0003 is amended (or a new ADR logged) recording the queue/ folder decision and the dual-read backward-compat strategy
- [ ] Full suite green, including new tests for dual-read and migration idempotency

