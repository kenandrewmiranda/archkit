---
slug: drift-precision-workspace
title: Reduce drift false-positives in workspace/monorepo layouts
status: done
created: 2026-06-06
exit-criteria:
  - Drift applies workspace-aware suppression (or attaches a confidence level) so monorepo/workspace layouts do not false-fire orphaned-skill / structural findings
  - A regression test reproduces a prior workspace false-positive and asserts it is now suppressed (or downgraded)
  - Existing drift suites (drift-fix, drift-multi-node, drift-workspace) remain green
  - npm test is green
files-to-touch:
  - src/commands/drift.mjs
  - src/lib/parsers.mjs
  - tests/drift-workspace/run.mjs
required-reading:
  - .arch/INDEX.md
depends-on: 
verify-command: npm test
source-ask: Turn the explored archkit MCP improvements into a CGR queue reasonable for a 1.9X version bump. Scope (confirmed): include portable hook paths, drift precision, scoped caching, MCP prompts, and PreToolUse blocking as a 1.9 feature; defer plugin distribution to 2.0.
started: 2026-06-06
completed: 2026-06-06
completion-notes: Added a confidence level to drift findings. In workspace/monorepo layouts (detected via resolveWorkspaceGlobs), the source-tree-sensitive checks (orphaned-skill, missing-source, missing-file) are downgraded to confidence:"low" so they read as hints, not hard errors — they no longer drive the CLI exit code or doctor's blocker escalation. .arch/-internal checks stay "high". Regression tests reproduce a nested-member orphaned-skill false-positive and assert the downgrade; summary now reports byConfidence.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Reduce drift false-positives in workspace/monorepo layouts

## Why
Drift has produced orphaned-skill false positives in workspace monorepos (the v1.8.2 fix history); noisy drift erodes trust in the signal, so add workspace-aware suppression or a confidence score.

## Exit criteria
- [ ] Drift applies workspace-aware suppression (or attaches a confidence level) so monorepo/workspace layouts do not false-fire orphaned-skill / structural findings
- [ ] A regression test reproduces a prior workspace false-positive and asserts it is now suppressed (or downgraded)
- [ ] Existing drift suites (drift-fix, drift-multi-node, drift-workspace) remain green
- [ ] npm test is green

