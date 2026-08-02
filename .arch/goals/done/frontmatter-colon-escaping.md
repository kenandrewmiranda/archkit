---
slug: frontmatter-colon-escaping
title: Stop colon-bearing exit criteria from corrupting goal frontmatter
status: completed
created: 2026-08-02
order: 7
project: lane-integration
exit-criteria:
  - Goal frontmatter serialization quotes any scalar that YAML would otherwise parse ambiguously — at minimum values containing a colon-space, plus leading indicators such as dash, hash, ampersand, asterisk and brackets
  - A goal written with colon-bearing exit criteria round-trips exactly — write then read yields the same criteria list with no extra, dropped, or reordered entries
  - The same quoting applies to every frontmatter list archkit writes, not just exit-criteria — files-to-touch, owns, required-reading and depends-on share the defect
  - A regression test writes a goal whose criteria contain colons, dashes and backticks, re-reads it, and asserts an exact round-trip
  - Already-corrupted goal files on disk are tolerated on read rather than throwing, so existing projects are not bricked by the fix
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
started: 2026-08-02T17:47:14.408Z
completed: 2026-08-02T18:01:23.694Z
completion-notes: Root cause was two-sided and both halves are fixed. emitFrontmatter now quotes (JSON string syntax, a subset of YAML double-quoted) any value with colon-space/trailing colon, a leading YAML indicator, edge whitespace, " #" or newlines — applied uniformly to scalars AND every block list, so files-to-touch/owns/required-reading/depends-on are covered. The actual corruption mechanism was on the read side: parseGoal's scalar pass harvested list items as bogus top-level keys, so it now skips "- " lines. Corrupted files on disk are tolerated and heal on next write (emitFrontmatter refuses to re-emit non-identifier keys). 7 regression tests use the real criteria from the live batch; 4 fail against the pre-fix lib. Merged to feat/lane-integration; 71/71 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---




# Stop colon-bearing exit criteria from corrupting goal frontmatter

## Why
Every exit criterion whose text contains a colon-space was re-emitted as an unindented list item after the exit-criteria block — 5 stray lines across 3 goals in a single 6-goal intake. Payloads then render phantom duplicate criteria (one goal showed 8 for 6 authored), so a worker chases criteria the author never wrote. Unquoted YAML scalars containing a colon-space are ambiguous and must be quoted on write.

## Exit criteria
- [ ] Goal frontmatter serialization quotes any scalar that YAML would otherwise parse ambiguously — at minimum values containing a colon-space, plus leading indicators such as dash, hash, ampersand, asterisk and brackets
- [ ] A goal written with colon-bearing exit criteria round-trips exactly — write then read yields the same criteria list with no extra, dropped, or reordered entries
- [ ] The same quoting applies to every frontmatter list archkit writes, not just exit-criteria — files-to-touch, owns, required-reading and depends-on share the defect
- [ ] A regression test writes a goal whose criteria contain colons, dashes and backticks, re-reads it, and asserts an exact round-trip
- [ ] Already-corrupted goal files on disk are tolerated on read rather than throwing, so existing projects are not bricked by the fix

