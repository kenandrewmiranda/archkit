---
slug: pr-based-landing
title: Land bucket branches through a PR so CI actually gates the merge
status: completed
created: 2026-08-02
order: 3
project: lane-integration
exit-criteria:
  - bucketMergeGuidance is CI-aware: when cgr.finalize.ciCd indicates a CI provider, it emits push + open-a-PR guidance (e.g. `git push -u origin <branch>` then `gh pr create --base <mainline>`) instead of a direct merge to mainline
  - With no CI provider configured the existing direct-merge guidance is preserved, so projects without CI are unaffected
  - The emitted guidance tells the agent to wait for the required checks before merging, consistent with RELEASING.md step 3
  - archkit still never runs git — the change is to the emitted string and its config gating only (instruct-not-act, ADR 0010)
  - archkit_log_decision records the PR-gated landing decision
  - Tests cover both branches of the CI-aware guidance
  - bucketMergeGuidance is CI-aware: when cgr.finalize.ciCd indicates a CI provider, it emits push + open-a-PR guidance (e.g. `git push -u origin <branch>` then `gh pr create --base <mainline>`) instead of a direct merge to mainline
- bucketMergeGuidance is CI-aware: when cgr.finalize.ciCd indicates a CI provider, it emits push + open-a-PR guidance (e.g. `git push -u origin <branch>` then `gh pr create --base <mainline>`) instead of a direct merge to mainline
files-to-touch:
  - src/lib/goals.mjs
  - tests/
required-reading: 
depends-on: 
owns:
  - src/lib/goals.mjs
  - .github/workflows/ci.yml
feature: cicd
verify-command: npm test
source-ask: Write up the lane-reconcile gap as a CGR project, and review the CGR workflow end to end for logistical soundness across software development, CI/CD, and documentation. Findings: (1) no lane->branch reconcile stage — merge queue drains per-CGR, not per-lane; (2) worktree workers branch from a stale base and the plan emits no rebase-onto-tip precondition, so sequential merges can clobber intervening work; (3) ADR 0013's third conflict tier (escalate to a reconcile goal) is unimplemented; (4) "verify after each merge" names no command and records no result; (5) bucketMergeGuidance emits a direct `git switch main && git merge <branch>`, bypassing the PR-gated CI that ci.yml and RELEASING.md both assume; (6) finalize stops at push — no PR, no CI wait; (7) no version-bump step exists in the CGR lifecycle despite check:versions and the release tag requiring package.json == plugin.json; (8) RELEASING.md is stale against release.yml (NPM_TOKEN / --provenance vs Trusted Publishing); (9) "reconcile" is overloaded against archkit_goal_reconcile (goal-file placement).
lane: lane-lane-reconcile-stage
handoff: .arch/board/handoff/pr-based-landing.md
completed: 2026-08-02T22:19:18.369Z
completion-notes: bucketMergeGuidance is now CI-aware: with cgr.finalize.ciCd set it emits push + gh pr create + wait-for-checks; with no provider the direct merge is preserved byte for byte. archkit still runs no git. ADR 0025. Integrated as 4b6d377; 75/75 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---




# Land bucket branches through a PR so CI actually gates the merge

## Why
bucketMergeGuidance emits `git switch <mainline> && git merge <branch>` — a direct merge to main. But ci.yml has a pull_request trigger and RELEASING.md step 3 explicitly documents 'open a PR, merge to main (CI runs check:versions + the full suite on the PR)'. Today the CGR workflow's terminal step bypasses the very gate the project's own docs promise, and CI runs on main only AFTER the code has landed.

## Exit criteria
- [ ] bucketMergeGuidance is CI-aware: when cgr.finalize.ciCd indicates a CI provider, it emits push + open-a-PR guidance (e.g. `git push -u origin <branch>` then `gh pr create --base <mainline>`) instead of a direct merge to mainline
- [ ] With no CI provider configured the existing direct-merge guidance is preserved, so projects without CI are unaffected
- [ ] The emitted guidance tells the agent to wait for the required checks before merging, consistent with RELEASING.md step 3
- [ ] archkit still never runs git — the change is to the emitted string and its config gating only (instruct-not-act, ADR 0010)
- [ ] archkit_log_decision records the PR-gated landing decision
- [ ] Tests cover both branches of the CI-aware guidance

