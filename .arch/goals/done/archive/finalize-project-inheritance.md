---
slug: finalize-project-inheritance
title: Make the finalize barrier inherit the batch project so it lands on the same branch
status: completed
created: 2026-08-02
order: 8
project: lane-integration
exit-criteria:
  - The synthesized finalize goal inherits `project` when the batch it depends on shares one, so its branch prework matches the work it finalizes
  - A batch spanning multiple projects, or none, falls back to the current shared dated queue branch rather than guessing a project
  - The finalize goal is written to the same queue location its inherited project implies, so goal reconcile does not immediately relocate it
  - A test asserts branch prework parity between the finalize goal payload and the batch goals it depends on
files-to-touch:
  - src/lib/goals.mjs
  - tests/
required-reading: 
depends-on: 
owns:
  - src/lib/goals.mjs
feature: intake-defects
verify-command: npm test
source-ask: Append the three intake defects found while queuing the lane-integration batch, plus terse-output work. Defects — (1) exit criteria containing a colon-space are re-emitted as unindented list items after the exit-criteria block, corrupting goal frontmatter and rendering phantom duplicate criteria in payloads; (2) the auto-appended finalize barrier does not inherit the batch's `project`, so its payload instructs a different branch than the work it documents; (3) payload "Read first" paths point at .arch/goals/<slug>.md while files are written to .arch/goals/queue/<project>/<slug>.md. Output work — make MCP tool output terse and high-level using graph notation and a small symbol vocabulary instead of prose paragraphs, to cut agent-context tokens and make the feedback legible to end users. Color via markdown emphasis and symbols, NOT ANSI (ANSI does not render in MCP tool results). Scope is MCP output only, not the CLI.
lane: lane-frontmatter-colon-escaping
started: 2026-08-02T17:47:18.967Z
completed: 2026-08-02T18:02:01.224Z
completion-notes: buildFinalizeGoal now resolves each batch goal and inherits `project` only when the batch is UNANIMOUS; a mixed or ungrouped batch inherits nothing and falls back to the shared dated queue branch rather than guessing one of the projects. Because writeGoal files a projected goal under queue/<project>/, inheriting also fixes the on-disk home — a dry-run reconcileGoalsLayout is asserted not to relocate it. Parity test deepEquals the finalize payload's branch-prework lines against those of every batch goal it depends on. Merged to feat/lane-integration; 71/71 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---




# Make the finalize barrier inherit the batch project so it lands on the same branch

## Why
The auto-appended finalize goal had no project field, so its payload instructed `git switch -c cgr-queue-<date>` while all six real goals were on feat/lane-integration. The goal that writes the CHANGELOG, commits and pushes would have been on a different branch than the work it documents — a silent, guaranteed-wrong instruction at the batch's most consequential step.

## Exit criteria
- [ ] The synthesized finalize goal inherits `project` when the batch it depends on shares one, so its branch prework matches the work it finalizes
- [ ] A batch spanning multiple projects, or none, falls back to the current shared dated queue branch rather than guessing a project
- [ ] The finalize goal is written to the same queue location its inherited project implies, so goal reconcile does not immediately relocate it
- [ ] A test asserts branch prework parity between the finalize goal payload and the batch goals it depends on

