---
slug: document-v1-9-features
title: Document v1.9 features (test gate + deferred-goal proposals) in README + CHANGELOG
status: done
created: 2026-06-04
exit-criteria:
  - README "Available tools" section updated to 28 and documents archkit_goal_defer, archkit_goal_promote, archkit_goal_dismiss
  - README CGR section documents the test gate (auto-detected verify-command, hard gate on goal_complete) and the deferred-goal propose/review/promote flow (incl. /mcp__archkit__goal_review)
  - CHANGELOG.md has a 1.9.0 entry summarizing the test gate and deferred-goal proposals
  - npm test passes
files-to-touch:
  - README.md
  - CHANGELOG.md
required-reading:
  - src/lib/test-runner.mjs
  - src/lib/goal-detector.mjs
  - src/commands/goal.mjs
  - src/mcp/prompts.mjs
depends-on: 
verify-command: npm test
source-ask: Dogfood test: document the v1.9 features (CGR test gate + deferred-goal proposals) in the README and CHANGELOG.
started: 2026-06-05
completed: 2026-06-05
completion-notes: README updated to 28 tools (+goal_defer/promote/dismiss and /goal_review prompt) with new "test gate" and "deferred-goal proposals" CGR subsections; CHANGELOG gained a v1.9.0 entry. npm test: 43/43 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-05
---



# Document v1.9 features (test gate + deferred-goal proposals) in README + CHANGELOG

## Why
v1.9 added the goal test gate (verify-command), deferred-goal proposals, and three new MCP tools. The README still says "Available tools (25)" and its CGR section predates these features.

## Exit criteria
- [ ] README "Available tools" section updated to 28 and documents archkit_goal_defer, archkit_goal_promote, archkit_goal_dismiss
- [ ] README CGR section documents the test gate (auto-detected verify-command, hard gate on goal_complete) and the deferred-goal propose/review/promote flow (incl. /mcp__archkit__goal_review)
- [ ] CHANGELOG.md has a 1.9.0 entry summarizing the test gate and deferred-goal proposals
- [ ] npm test passes

