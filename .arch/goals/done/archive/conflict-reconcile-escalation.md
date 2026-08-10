---
slug: conflict-reconcile-escalation
title: Implement ADR 0013's third conflict tier — escalate genuine conflicts to a reconcile CGR
status: completed
created: 2026-08-02
order: 2
project: lane-integration
exit-criteria:
  - A detected cross-lane conflict can mint a reconcile CGR that dependsOn the conflicting slugs and is marked exclusive, so the lane partition schedules it as a solo barrier
  - The minted CGR carries the conflicting files and slugs in its body so a fresh worker context can resolve it without re-deriving the conflict
  - Minting is idempotent — folding the same conflict event twice does not produce duplicate reconcile CGRs
  - Merge-sense 'reconcile' terminology is disambiguated from archkit_goal_reconcile (goal-file placement, ADR 0020/0021) in every tool description that mentions either, so the two senses are never confused in a fresh context
  - Tests cover conflict -> minted barrier CGR -> it appears in the frontier only after the conflicting slugs complete
files-to-touch:
  - src/lib/board.mjs
  - src/mcp/tools.mjs
  - tests/
required-reading: 
depends-on:
  - lane-reconcile-stage
owns:
  - src/lib/board.mjs
  - src/mcp/tools.mjs
feature: integration
verify-command: npm test
source-ask: Write up the lane-reconcile gap as a CGR project, and review the CGR workflow end to end for logistical soundness across software development, CI/CD, and documentation. Findings: (1) no lane->branch reconcile stage — merge queue drains per-CGR, not per-lane; (2) worktree workers branch from a stale base and the plan emits no rebase-onto-tip precondition, so sequential merges can clobber intervening work; (3) ADR 0013's third conflict tier (escalate to a reconcile goal) is unimplemented; (4) "verify after each merge" names no command and records no result; (5) bucketMergeGuidance emits a direct `git switch main && git merge <branch>`, bypassing the PR-gated CI that ci.yml and RELEASING.md both assume; (6) finalize stops at push — no PR, no CI wait; (7) no version-bump step exists in the CGR lifecycle despite check:versions and the release tag requiring package.json == plugin.json; (8) RELEASING.md is stale against release.yml (NPM_TOKEN / --provenance vs Trusted Publishing); (9) "reconcile" is overloaded against archkit_goal_reconcile (goal-file placement).
lane: lane-lane-reconcile-stage
started: 2026-08-02T21:55:28.543Z
handoff: .arch/board/handoff/conflict-reconcile-escalation.md
completed: 2026-08-02T22:18:41.177Z
completion-notes: Tier 3 of ADR 0013 shipped: conflicts mint an exclusive merge-reconcile CGR gated behind both conflicting slugs, idempotent on the sorted pair. Merge-sense vs placement-sense reconcile is now enforced registry-wide by a standing test. Integrated as 4b6d377 via path-extract; 75/75 suites green with the sibling lane.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---





# Implement ADR 0013's third conflict tier — escalate genuine conflicts to a reconcile CGR

## Why
ADR 0013 specifies a hybrid conflict strategy: pre-partition by ownership, worktree-isolate, then escalate to a reconcile goal. Tiers 1 and 2 shipped; tier 3 does not exist. Cross-lane conflicts today only become an `exception` string for manual conductor review, so the escalation path documented in the ADR silently dead-ends.

## Exit criteria
- [ ] A detected cross-lane conflict can mint a reconcile CGR that dependsOn the conflicting slugs and is marked exclusive, so the lane partition schedules it as a solo barrier
- [ ] The minted CGR carries the conflicting files and slugs in its body so a fresh worker context can resolve it without re-deriving the conflict
- [ ] Minting is idempotent — folding the same conflict event twice does not produce duplicate reconcile CGRs
- [ ] Merge-sense 'reconcile' terminology is disambiguated from archkit_goal_reconcile (goal-file placement, ADR 0020/0021) in every tool description that mentions either, so the two senses are never confused in a fresh context
- [ ] Tests cover conflict -> minted barrier CGR -> it appears in the frontier only after the conflicting slugs complete

