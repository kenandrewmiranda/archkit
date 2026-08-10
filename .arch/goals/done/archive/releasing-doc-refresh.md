---
slug: releasing-doc-refresh
title: Refresh RELEASING.md to match how release.yml actually publishes
status: completed
created: 2026-08-02
order: 5
project: lane-integration
exit-criteria:
  - The NPM_TOKEN one-time-setup section is replaced with the Trusted Publishing setup (repo + workflow-filename binding on npmjs.com) that release.yml actually requires
  - The two documented traps are captured: renaming release.yml breaks publishing until the publisher config is updated, and adding setup-node registry-url breaks the OIDC exchange
  - The publish command in the doc matches the workflow (`npm publish --access public`, provenance automatic under OIDC — no explicit flag)
  - The Node 22 / npm >= 11.5.1 requirement for Trusted Publishing is stated
  - The cutting-a-release steps match the real gates: version bump in both files, check:versions, PR + CI, then tag from main
  - The two documented traps are captured: renaming release.yml breaks publishing until the publisher config is updated, and adding setup-node registry-url breaks the OIDC exchange
  - The cutting-a-release steps match the real gates: version bump in both files, check:versions, PR + CI, then tag from main
- The two documented traps are captured: renaming release.yml breaks publishing until the publisher config is updated, and adding setup-node registry-url breaks the OIDC exchange
- The cutting-a-release steps match the real gates: version bump in both files, check:versions, PR + CI, then tag from main
files-to-touch:
  - RELEASING.md
required-reading: 
depends-on: 
owns:
  - RELEASING.md
feature: docs
verify-command: npm test
source-ask: Write up the lane-reconcile gap as a CGR project, and review the CGR workflow end to end for logistical soundness across software development, CI/CD, and documentation. Findings: (1) no lane->branch reconcile stage — merge queue drains per-CGR, not per-lane; (2) worktree workers branch from a stale base and the plan emits no rebase-onto-tip precondition, so sequential merges can clobber intervening work; (3) ADR 0013's third conflict tier (escalate to a reconcile goal) is unimplemented; (4) "verify after each merge" names no command and records no result; (5) bucketMergeGuidance emits a direct `git switch main && git merge <branch>`, bypassing the PR-gated CI that ci.yml and RELEASING.md both assume; (6) finalize stops at push — no PR, no CI wait; (7) no version-bump step exists in the CGR lifecycle despite check:versions and the release tag requiring package.json == plugin.json; (8) RELEASING.md is stale against release.yml (NPM_TOKEN / --provenance vs Trusted Publishing); (9) "reconcile" is overloaded against archkit_goal_reconcile (goal-file placement).
lane: docs
started: 2026-08-02T17:47:20.064Z
completed: 2026-08-02T17:49:13.173Z
completion-notes: RELEASING.md rewritten for npm Trusted Publishing (OIDC): NPM_TOKEN setup replaced with the package-settings trusted-publisher binding, both traps documented (workflow-FILENAME vs display-name binding; setup-node registry-url injecting a placeholder token and manufacturing a fake 403), publish command corrected to `npm publish --access public` with automatic provenance, Node 22.14 / npm 11.5.1 requirement stated, and the release steps re-sequenced to the real gates. Merged to feat/lane-integration as 1bc6b2e.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---




# Refresh RELEASING.md to match how release.yml actually publishes

## Why
RELEASING.md still documents an NPM_TOKEN automation-token 'one-time setup' and `npm publish --provenance`. release.yml deliberately abandoned both for npm Trusted Publishing (OIDC), and carries hard-won constraints the doc omits entirely — the trusted publisher is bound to the workflow FILENAME, and adding setup-node's registry-url injects a placeholder token that manufactures a fake 403. A stale release doc is how a release breaks at the worst moment.

## Exit criteria
- [ ] The NPM_TOKEN one-time-setup section is replaced with the Trusted Publishing setup (repo + workflow-filename binding on npmjs.com) that release.yml actually requires
- [ ] The two documented traps are captured: renaming release.yml breaks publishing until the publisher config is updated, and adding setup-node registry-url breaks the OIDC exchange
- [ ] The publish command in the doc matches the workflow (`npm publish --access public`, provenance automatic under OIDC — no explicit flag)
- [ ] The Node 22 / npm >= 11.5.1 requirement for Trusted Publishing is stated
- [ ] The cutting-a-release steps match the real gates: version bump in both files, check:versions, PR + CI, then tag from main

