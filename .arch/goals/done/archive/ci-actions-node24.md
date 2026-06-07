---
slug: ci-actions-node24
title: Migrate GitHub Actions off the deprecated Node 20 runtime (bump checkout/setup-node to v5)
status: done
created: 2026-06-06
exit-criteria:
  - actions/checkout and actions/setup-node are pinned to @v5 (Node 24 runtime) in BOTH .github/workflows/ci.yml and .github/workflows/release.yml
  - No remaining @v4 references to checkout/setup-node anywhere under .github/workflows/
  - The next CI run on the change shows no 'Node.js 20 actions are deprecated' annotation and the workflow stays green (npm ci, check:versions, npm test)
  - The next CI run on the change shows no 'Node.js 20 actions are deprecated' annotation and the workflow stays green (npm ci, check: versions, npm test)
- The next CI run on the change shows no 'Node.js 20 actions are deprecated' annotation and the workflow stays green (npm ci, check: versions, npm test)
files-to-touch:
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
required-reading: 
depends-on: 
verify-command: npm test
source-ask: After the v1.9.1 release, the CI run surfaced a deprecation warning: actions/checkout@v4 and actions/setup-node@v4 run on Node.js 20, forced to Node 24 after 2026-06-16. Turn the follow-up into a CGR goal.
started: 2026-06-06
completed: 2026-06-06
completion-notes: Bumped actions/checkout & setup-node to @v5 (Node 24 runtime) in ci.yml and release.yml. No @v4 refs remain. Verified on PR #26: CI green (npm ci, check:versions, npm test) with an empty annotations array — no Node 20 deprecation warning.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Migrate GitHub Actions off the deprecated Node 20 runtime (bump checkout/setup-node to v5)

## Why
The v1.9.1 release run flagged that actions/checkout@v4 and actions/setup-node@v4 run on Node 20, which GitHub forces to Node 24 after 2026-06-16 and removes 2026-09-16. Bumping to the v5 majors (Node 24 runtime) clears the deprecation before it becomes a hard break.

## Exit criteria
- [ ] actions/checkout and actions/setup-node are pinned to @v5 (Node 24 runtime) in BOTH .github/workflows/ci.yml and .github/workflows/release.yml
- [ ] No remaining @v4 references to checkout/setup-node anywhere under .github/workflows/
- [ ] The next CI run on the change shows no 'Node.js 20 actions are deprecated' annotation and the workflow stays green (npm ci, check:versions, npm test)

