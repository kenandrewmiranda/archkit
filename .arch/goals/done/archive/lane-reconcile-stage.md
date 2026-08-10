---
slug: lane-reconcile-stage
title: Add a lane reconcile stage so lanes converge before the merge queue drains
status: completed
created: 2026-08-02
order: 0
project: lane-integration
exit-criteria:
  - board.mjs exposes a reconcile plan that groups the ordered merge queue BY LANE, so each lane converges into a single integration point instead of N independent merges onto the branch
  - The emitted plan carries an explicit rebase-onto-branch-tip precondition per lane (primary integration primitive), with `git checkout <branch> -- <owned paths>` path-extract documented as the fallback for lanes whose worker base is unrecoverably stale
  - Cross-lane dependency order from orderMergeQueue is preserved: a lane containing a CGR that depends_on a CGR in another lane still lands after it
  - The /mcp__archkit__conductor prompt step 5 emits the lane-grouped reconcile plan instead of a flat slug list
  - A test covers the stale-base scenario: two lanes whose reconcile order would clobber if merged naively, asserting the plan emits the rebase precondition
  - archkit_log_decision records the reconcile-stage design (amending ADR 0013's merge-queue description)
  - Cross-lane dependency order from orderMergeQueue is preserved: a lane containing a CGR that depends_on a CGR in another lane still lands after it
  - A test covers the stale-base scenario: two lanes whose reconcile order would clobber if merged naively, asserting the plan emits the rebase precondition
- Cross-lane dependency order from orderMergeQueue is preserved: a lane containing a CGR that depends_on a CGR in another lane still lands after it
- A test covers the stale-base scenario: two lanes whose reconcile order would clobber if merged naively, asserting the plan emits the rebase precondition
files-to-touch:
  - src/lib/board.mjs
  - src/mcp/prompts.mjs
  - tests/
required-reading: 
depends-on: 
owns:
  - src/lib/board.mjs
  - src/mcp/prompts.mjs
feature: integration
verify-command: npm test
source-ask: Write up the lane-reconcile gap as a CGR project, and review the CGR workflow end to end for logistical soundness across software development, CI/CD, and documentation. Findings: (1) no lane->branch reconcile stage — merge queue drains per-CGR, not per-lane; (2) worktree workers branch from a stale base and the plan emits no rebase-onto-tip precondition, so sequential merges can clobber intervening work; (3) ADR 0013's third conflict tier (escalate to a reconcile goal) is unimplemented; (4) "verify after each merge" names no command and records no result; (5) bucketMergeGuidance emits a direct `git switch main && git merge <branch>`, bypassing the PR-gated CI that ci.yml and RELEASING.md both assume; (6) finalize stops at push — no PR, no CI wait; (7) no version-bump step exists in the CGR lifecycle despite check:versions and the release tag requiring package.json == plugin.json; (8) RELEASING.md is stale against release.yml (NPM_TOKEN / --provenance vs Trusted Publishing); (9) "reconcile" is overloaded against archkit_goal_reconcile (goal-file placement).
lane: lane-lane-reconcile-stage
started: 2026-08-02T17:47:19.616Z
completed: 2026-08-02T17:56:50.603Z
completion-notes: Shipped as the lane CONVERGENCE stage (deliberately not "reconcile" — archkit_goal_reconcile keeps that word for goal-file placement; a test asserts the emitted plan contains no reconcil* substring). laneConvergencePlan() groups the dependency-ordered merge queue into one integration point per lane, Kahn-sorted over lane-level edges induced from CGR depends_on with queue first-appearance as tie-break, so a dependent lane can never land first; mutually-dependent lanes degrade to contiguous flat-order segments with split:true rather than dropping items. Every group carries a rebase-onto-tip precondition plus a path-extract fallback bounded by the lane's owned paths. Conductor step 5 now renders the plan instead of a flat slug list. New cgr.integrationBranch knob (default main). ADR 0023. Merged to feat/lane-integration; npm test 70/70 green after merge.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---




# Add a lane reconcile stage so lanes converge before the merge queue drains

## Why
The conductor's step 5 drains a per-CGR merge queue with no rebase-onto-tip precondition. Because Agent-tool worktree workers branch from a STALE base, a naive sequential `git merge` of worker branches can revert work an earlier merge in the same drain just landed. Lanes need to converge to the branch tip first, then land as one integration point per lane.

## Exit criteria
- [ ] board.mjs exposes a reconcile plan that groups the ordered merge queue BY LANE, so each lane converges into a single integration point instead of N independent merges onto the branch
- [ ] The emitted plan carries an explicit rebase-onto-branch-tip precondition per lane (primary integration primitive), with `git checkout <branch> -- <owned paths>` path-extract documented as the fallback for lanes whose worker base is unrecoverably stale
- [ ] Cross-lane dependency order from orderMergeQueue is preserved: a lane containing a CGR that depends_on a CGR in another lane still lands after it
- [ ] The /mcp__archkit__conductor prompt step 5 emits the lane-grouped reconcile plan instead of a flat slug list
- [ ] A test covers the stale-base scenario: two lanes whose reconcile order would clobber if merged naively, asserting the plan emits the rebase precondition
- [ ] archkit_log_decision records the reconcile-stage design (amending ADR 0013's merge-queue description)

