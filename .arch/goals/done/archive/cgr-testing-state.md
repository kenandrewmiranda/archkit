---
slug: cgr-testing-state
title: Implement the `testing` state (status + goals/testing/ folder + transitions + Stop-hook awareness)
status: done
created: 2026-06-07
exit-criteria:
  - goals.mjs gains a `testing` status + goals/testing/ folder; a transition moves an in-progress goal to testing (edit applied, verification pending)
  - archkit_goal_verify / archkit_goal_complete treat testing as the verification window: complete only succeeds from testing once exit-criteria/verify-command pass green
  - Stop hook still guards: a goal in `testing` is NOT done — it keeps blocking until verified+completed (no premature release)
  - ensureGoalsLayout creates goals/testing/; listGoals + nextEligibleGoal recognize the new state without breaking existing planned/in-progress/done flows
  - Unit tests cover the new state + transitions and the suite passes green
  - archkit_goal_verify / archkit_goal_complete treat testing as the verification window: complete only succeeds from testing once exit-criteria/verify-command pass green
  - Stop hook still guards: a goal in `testing` is NOT done — it keeps blocking until verified+completed (no premature release)
- archkit_goal_verify / archkit_goal_complete treat testing as the verification window: complete only succeeds from testing once exit-criteria/verify-command pass green
- Stop hook still guards: a goal in `testing` is NOT done — it keeps blocking until verified+completed (no premature release)
files-to-touch:
  - src/lib/goals.mjs
  - src/commands/goal.mjs
  - src/mcp/tools.mjs
required-reading:
  - src/lib/goals.mjs
  - src/lib/goal-detector.mjs
depends-on:
  - cgr-lifecycle-design
verify-command: npm test
source-ask: Conference feedback on CGR flow: add more states. Proposed folders pending/deferred/testing/completed. MCP scans pending→testing→deferred; when empty, consolidate completed into a per-session/day summary. Note: keep the original raw CGR file in an archive folder within completed/ so an agent can still pull full context. Decided to extend the relay loop, not rebuild: add a `testing` (edit-applied/unverified) state, rename the set-aside state to avoid the existing `deferred`/proposed collision, add a backlog-threshold ordering knob, and add an incremental consolidation/digest phase.
started: 2026-06-07
completed: 2026-06-07
completion-notes: Added the `testing` lifecycle state (ADR 0003). goals.mjs: STATUS_TESTING + testingDir(); ensureGoalsLayout creates goals/testing/; markTesting() relocates an active goal into goals/testing/ (status=testing, testing-since stamped); loadGoal/listGoals scan testing/; getActiveGoal & nextEligibleGoal treat testing as guarded/resumable (in-progress preferred); startGoal relocates a resumed testing goal back to goals/ root. Stop hook keeps blocking a testing goal with a verification-focused message (NOT done — no premature release). goal.mjs: runGoalTesting() + CLI `goal testing <slug>`; runGoalVerify flags verificationWindow; complete-from-testing honors the hard test gate (green succeeds, red refuses, goal stays parked). New suite tests/cgr-testing/ (13 tests); full suite 47/47 green. MCP tool/prompt/README surfacing intentionally left to cgr-states-mcp-wiring.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-07
---



# Implement the `testing` state (status + goals/testing/ folder + transitions + Stop-hook awareness)

## Why
The missing state behind the feedback: fast mass-edits land as `testing` (visible debt) instead of being prematurely completed and hidden in done/. A later fresh session drains testing/ by actually running verify before completion.

## Exit criteria
- [ ] goals.mjs gains a `testing` status + goals/testing/ folder; a transition moves an in-progress goal to testing (edit applied, verification pending)
- [ ] archkit_goal_verify / archkit_goal_complete treat testing as the verification window: complete only succeeds from testing once exit-criteria/verify-command pass green
- [ ] Stop hook still guards: a goal in `testing` is NOT done — it keeps blocking until verified+completed (no premature release)
- [ ] ensureGoalsLayout creates goals/testing/; listGoals + nextEligibleGoal recognize the new state without breaking existing planned/in-progress/done flows
- [ ] Unit tests cover the new state + transitions and the suite passes green

