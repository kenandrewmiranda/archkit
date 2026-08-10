---
slug: merge-verify-command
title: Make verify-after-each-merge concrete: emit a command and record the result
status: completed
created: 2026-08-02
order: 1
project: lane-integration
exit-criteria:
  - The reconcile/merge plan resolves a concrete post-integration verify command per lane — the CGR's verify-command when set, falling back to the project test command — and emits it alongside each integration step
  - The `merged` board event carries the verification outcome (command + pass/fail) so the folded board can distinguish verified from unverified integrations
  - archkit_conductor surfaces unverified-but-merged CGRs so a later pass can see integration debt instead of silently assuming green
  - Tests cover the fallback chain (per-CGR verify-command -> project test command -> none) and the merged-event verification payload
files-to-touch:
  - src/lib/board.mjs
  - src/mcp/prompts.mjs
  - src/mcp/tools.mjs
  - tests/
required-reading: 
depends-on:
  - lane-reconcile-stage
owns:
  - src/lib/board.mjs
  - src/mcp/prompts.mjs
feature: integration
verify-command: npm test
source-ask: Write up the lane-reconcile gap as a CGR project, and review the CGR workflow end to end for logistical soundness across software development, CI/CD, and documentation. Findings: (1) no lane->branch reconcile stage — merge queue drains per-CGR, not per-lane; (2) worktree workers branch from a stale base and the plan emits no rebase-onto-tip precondition, so sequential merges can clobber intervening work; (3) ADR 0013's third conflict tier (escalate to a reconcile goal) is unimplemented; (4) "verify after each merge" names no command and records no result; (5) bucketMergeGuidance emits a direct `git switch main && git merge <branch>`, bypassing the PR-gated CI that ci.yml and RELEASING.md both assume; (6) finalize stops at push — no PR, no CI wait; (7) no version-bump step exists in the CGR lifecycle despite check:versions and the release tag requiring package.json == plugin.json; (8) RELEASING.md is stale against release.yml (NPM_TOKEN / --provenance vs Trusted Publishing); (9) "reconcile" is overloaded against archkit_goal_reconcile (goal-file placement).
lane: lane-lane-reconcile-stage
started: 2026-08-02T18:07:22.725Z
completed: 2026-08-02T18:21:07.271Z
completion-notes: Verify-after-each-merge is concrete on both ends (ADR 0024): resolveVerifyCommand applies the per-CGR -> project-test-command -> none chain and each lane's integration point emits its own command (or an explicit "unverifiable"); recordMerge + the new archkit_board_merged tool put the outcome on the merged event with a DERIVED status; sessionState gained a `merged` slice and conductorPlan/prompt surface unverifiedMerges as integration debt. New suite tests/cgr-merge-verify (22 tests); 72/72 suites green. Committed as abcf6f5 on feat/lane-integration.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---




# Make verify-after-each-merge concrete: emit a command and record the result

## Why
Step 5 says 'verifying after EACH' but names no command. The test gate runs at goal_complete INSIDE the worktree, pre-merge — so post-merge integration verification is advisory prose with no artifact. A green worktree does not prove a green branch after integration.

## Exit criteria
- [ ] The reconcile/merge plan resolves a concrete post-integration verify command per lane — the CGR's verify-command when set, falling back to the project test command — and emits it alongside each integration step
- [ ] The `merged` board event carries the verification outcome (command + pass/fail) so the folded board can distinguish verified from unverified integrations
- [ ] archkit_conductor surfaces unverified-but-merged CGRs so a later pass can see integration debt instead of silently assuming green
- [ ] Tests cover the fallback chain (per-CGR verify-command -> project test command -> none) and the merged-event verification payload

