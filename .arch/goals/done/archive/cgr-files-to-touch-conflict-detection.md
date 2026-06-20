---
slug: cgr-files-to-touch-conflict-detection
title: Detect file overlap across in-progress CGRs and inject into prework
status: completed
created: 2026-06-20
epic: parallel-cgr-workflow
order: 1
exit-criteria:
  - A pure function computes file overlap between a target goal's files-to-touch and the files-to-touch of all other live (in-progress/testing) goals, returning the conflicting goal slug(s) + shared paths
  - renderPayload (and/or preflight) injects a CONFLICT prework block listing overlapping live goals + shared files when overlap exists; silent when none
  - Overlap detection tolerates missing/empty files-to-touch and never throws (pure read of .arch/)
  - Detection is scoped sensibly across projects/branches (cross-project overlap is the high-signal case and is surfaced)
  - Unit tests cover overlap, no-overlap, and empty-files cases; full suite green
files-to-touch:
  - src/lib/goals.mjs
required-reading:
  - .arch/decisions/0003-lock-the-expanded-cgr-lifecycle-state-model-and-rename-the-s.md
  - src/lib/goals.mjs
depends-on:
  - cgr-project-branch-grouping
verify-command: npm test
source-ask: Review if the CGR workflow can include an actual Queue folder instead of pending goals sitting at the root. Introduce a net-new "projects" idea where relevant CGRs are set in a subfolder so the agent knows to start a new branch and commit each CGR to that branch, enabling agents to work on feature sets in parallel. If two agents cross each other in the codebase, add a chat.md the agents can use to communicate about potential conflicts, wired in as prework. Goal: make parallel work seamless.
started: 2026-06-20T15:28:39.831Z
completed: 2026-06-20T15:32:24.477Z
completion-notes: Added pure computeFileConflicts + filesToTouchOf + detectFileConflicts(archDir,slug) to src/lib/goals.mjs computing file overlap against live (in-progress/testing) goals, returning conflicting slug(s) + shared paths with cross-project (cross-branch) overlaps flagged high-risk and sorted first. renderPayload now injects a ⚠ CONFLICT prework block (silent when no overlap). Tolerant of missing/empty files-to-touch; pure read of .arch/, never throws. 7 new unit tests; full suite green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-20
---



# Detect file overlap across in-progress CGRs and inject into prework

## Why
Reliable backbone for the chat.md idea: every goal already declares files-to-touch, so archkit can mechanically warn when a goal overlaps another in-progress/testing goal's files instead of relying on agents reading a markdown board.

## Exit criteria
- [ ] A pure function computes file overlap between a target goal's files-to-touch and the files-to-touch of all other live (in-progress/testing) goals, returning the conflicting goal slug(s) + shared paths
- [ ] renderPayload (and/or preflight) injects a CONFLICT prework block listing overlapping live goals + shared files when overlap exists; silent when none
- [ ] Overlap detection tolerates missing/empty files-to-touch and never throws (pure read of .arch/)
- [ ] Detection is scoped sensibly across projects/branches (cross-project overlap is the high-signal case and is surfaced)
- [ ] Unit tests cover overlap, no-overlap, and empty-files cases; full suite green

