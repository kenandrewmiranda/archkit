---
slug: conductor-startup-board-awareness
title: Surface a compact board snapshot at SessionStart for the common (non-parallel) case
status: completed
created: 2026-07-19
order: 3
exit-criteria:
  - The SessionStart additionalContext always includes a one-line compact board snapshot when any goals exist: queue N (next slug) - testing N - projects (label:count...) - on-hold N
  - The snapshot is derived from the existing board/goals folding helpers (no new mutable state) and is omitted cleanly when no goals exist, so greenfield/no-CGR projects see no noise
  - The snapshot nudges toward the triage: when state is mixed it points the user at /clear + /mcp__archkit__conductor to choose, matching the ambiguity-gated behavior
  - The existing parallel-state rehydration block still fires for live board state and is not duplicated by the new snapshot
  - A test covers the snapshot line for a mixed board and its absence for an empty board
  - The SessionStart additionalContext always includes a one-line compact board snapshot when any goals exist: queue N (next slug) - testing N - projects (label:count...) - on-hold N
  - The snapshot nudges toward the triage: when state is mixed it points the user at /clear + /mcp__archkit__conductor to choose, matching the ambiguity-gated behavior
  - The SessionStart additionalContext always includes a one-line compact board snapshot when any goals exist: queue N (next slug) - testing N - projects (label:count...) - on-hold N
  - The snapshot nudges toward the triage: when state is mixed it points the user at /clear + /mcp__archkit__conductor to choose, matching the ambiguity-gated behavior
- The SessionStart additionalContext always includes a one-line compact board snapshot when any goals exist: queue N (next slug) - testing N - projects (label:count...) - on-hold N
- The snapshot nudges toward the triage: when state is mixed it points the user at /clear + /mcp__archkit__conductor to choose, matching the ambiguity-gated behavior
files-to-touch:
  - bin/archkit-session-start.mjs
  - src/lib/board.mjs
  - tests/
required-reading: 
depends-on:
  - conductor-ambiguity-triage
owns:
  - bin/archkit-session-start.mjs
verify-command: npm test
source-ask: As I develop with archkit, what gets pulled in next is a clear issue — the conductor just mindlessly picks the next queue number and runs it. We should make the workflow ask the user whether to work the queue, projects, testing, or help set up a plan on what to tackle next — being more project-aware / aware of what's been going on. Review how influential the board is at startup and the overall selection business logic.
lane: lane-conductor-ambiguity-triage
started: 2026-07-19T18:14:22.287Z
completed: 2026-07-19T18:18:08.893Z
completion-notes: Added boardSnapshot(archDir) to board.mjs (pure, via triageNextGoal) and wired it into the SessionStart hook as a one-line queue/testing/projects/on-hold snapshot with a mixed-board conductor nudge; omitted cleanly when no goals; rehydration block untouched. 4 new claude-hook tests, 62/62 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---




# Surface a compact board snapshot at SessionStart for the common (non-parallel) case

## Why
The SessionStart digest only rehydrates the board when there is live parallel state (frontier/in-flight/merge/leases). In the common single-goal case the user starts a session blind to queue/testing/project/on-hold state — the board is a durable orientation surface doing none of that job.

## Exit criteria
- [ ] The SessionStart additionalContext always includes a one-line compact board snapshot when any goals exist: queue N (next slug) - testing N - projects (label:count...) - on-hold N
- [ ] The snapshot is derived from the existing board/goals folding helpers (no new mutable state) and is omitted cleanly when no goals exist, so greenfield/no-CGR projects see no noise
- [ ] The snapshot nudges toward the triage: when state is mixed it points the user at /clear + /mcp__archkit__conductor to choose, matching the ambiguity-gated behavior
- [ ] The existing parallel-state rehydration block still fires for live board state and is not duplicated by the new snapshot
- [ ] A test covers the snapshot line for a mixed board and its absence for an empty board

