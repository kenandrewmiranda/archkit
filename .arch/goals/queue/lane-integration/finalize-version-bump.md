---
slug: finalize-version-bump
title: Add a version-bump step to the finalize goal so a batch can produce a taggable commit
status: pending
created: 2026-08-02
order: 4
project: lane-integration
exit-criteria:
  - cgr.finalize.steps gains a `version` step (default OFF, consistent with outward-facing steps being opt-in) surfaced by archkit_finalize_config
  - When enabled, the synthesized finalize goal gains exit criteria to bump the version in every file the project's version-sync check covers, and to re-run that check before committing
  - The version step is ordered before the changelog and commit steps so the changelog entry and the commit describe the version being cut
  - Existing configs without the new step keep working unchanged (back-compatible read of cgr.finalize.steps)
  - Tests cover the new step appearing in the synthesized goal only when enabled
files-to-touch:
  - src/lib/goals.mjs
  - src/mcp/tools.mjs
  - tests/
required-reading: 
depends-on:
  - pr-based-landing
owns:
  - src/lib/goals.mjs
  - src/mcp/tools.mjs
feature: cicd
verify-command: npm test
source-ask: Write up the lane-reconcile gap as a CGR project, and review the CGR workflow end to end for logistical soundness across software development, CI/CD, and documentation. Findings: (1) no lane->branch reconcile stage — merge queue drains per-CGR, not per-lane; (2) worktree workers branch from a stale base and the plan emits no rebase-onto-tip precondition, so sequential merges can clobber intervening work; (3) ADR 0013's third conflict tier (escalate to a reconcile goal) is unimplemented; (4) "verify after each merge" names no command and records no result; (5) bucketMergeGuidance emits a direct `git switch main && git merge <branch>`, bypassing the PR-gated CI that ci.yml and RELEASING.md both assume; (6) finalize stops at push — no PR, no CI wait; (7) no version-bump step exists in the CGR lifecycle despite check:versions and the release tag requiring package.json == plugin.json; (8) RELEASING.md is stale against release.yml (NPM_TOKEN / --provenance vs Trusted Publishing); (9) "reconcile" is overloaded against archkit_goal_reconcile (goal-file placement).
lane: lane-lane-reconcile-stage
---


# Add a version-bump step to the finalize goal so a batch can produce a taggable commit

## Why
check:versions enforces package.json == .claude-plugin/plugin.json, and release.yml refuses to publish unless the tag equals package.json version — yet no step in the CGR lifecycle ever bumps them. finalize's exit criteria stop at 'push', so every release requires out-of-band manual surgery, which is precisely where past releases went wrong.

## Exit criteria
- [ ] cgr.finalize.steps gains a `version` step (default OFF, consistent with outward-facing steps being opt-in) surfaced by archkit_finalize_config
- [ ] When enabled, the synthesized finalize goal gains exit criteria to bump the version in every file the project's version-sync check covers, and to re-run that check before committing
- [ ] The version step is ordered before the changelog and commit steps so the changelog entry and the commit describe the version being cut
- [ ] Existing configs without the new step keep working unchanged (back-compatible read of cgr.finalize.steps)
- [ ] Tests cover the new step appearing in the synthesized goal only when enabled

