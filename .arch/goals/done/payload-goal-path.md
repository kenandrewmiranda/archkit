---
slug: payload-goal-path
title: Emit the real on-disk goal path in every payload
status: completed
created: 2026-08-02
order: 9
project: lane-integration
exit-criteria:
  - The payload Read-first path is the goal's actual resolved filepath rather than a reconstructed root-level guess
  - The path stays correct across every canonical location a goal can occupy — queue root, queue project subfolder, goals root, and testing
  - A test asserts the emitted path resolves to an existing file for a project-scoped goal and for an ungrouped queue goal
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
started: 2026-08-02T17:47:19.172Z
completed: 2026-08-02T18:02:36.997Z
completion-notes: New exported goalRelPath(archDir, filepath, slug) derives the Read-first path from what loadGoal actually resolved, relative to the project root and forward-slashed via toPosixPath (Windows-safe, consistent with the windows-paths suite). Verified across all four canonical homes — queue root, queue/<project>/, goals/ root, testing/ — including following a goal through startGoal then markTesting. Tests assert the emitted path fs.existsSync. Merged to feat/lane-integration; 71/71 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---




# Emit the real on-disk goal path in every payload

## Why
Every payload's Read-first line says .arch/goals/<slug>.md, but intake writes to .arch/goals/queue/<project>/<slug>.md. A fresh worker's very first instructed action fails, in a context that has no other way to find its own goal file.

## Exit criteria
- [ ] The payload Read-first path is the goal's actual resolved filepath rather than a reconstructed root-level guess
- [ ] The path stays correct across every canonical location a goal can occupy — queue root, queue project subfolder, goals root, and testing
- [ ] A test asserts the emitted path resolves to an existing file for a project-scoped goal and for an ungrouped queue goal

