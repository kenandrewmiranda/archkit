---
slug: warmup-surface-graph-debt
title: Surface pending graph-proposals at resolve_warmup so graph debt is visible, not a silent folder
status: completed
created: 2026-06-09
exit-criteria:
  - resolve_warmup reports the count and slugs of pending proposals from .arch/graph-proposals/ via listGraphProposals
  - Surfaced in BOTH the human banner output and the JSON/MCP warmup result
  - Zero pending proposals produces no output (silent when clean), mirroring existing warmup checks
  - Tests cover: warmup with N pending proposals surfaces them; warmup with none stays quiet
  - npm test is green
  - Tests cover: warmup with N pending proposals surfaces them; warmup with none stays quiet
- Tests cover: warmup with N pending proposals surfaces them; warmup with none stays quiet
files-to-touch:
  - src/commands/resolve/warmup.mjs
  - src/lib/goals.mjs
  - src/mcp/tools.mjs
  - tests/cgr-context-refresh/run.mjs
required-reading:
  - src/commands/resolve/warmup.mjs
  - src/lib/goals.mjs
  - .arch/decisions/0004-close-the-cgr-graph-flywheel-scoped-slice-in-at-goal-start-p.md
depends-on: 
verify-command: npm test
source-ask: After building the graph flywheel (slice-in + propose-out, ADR 0004), set the two open follow-ups as new CGRs to work next: #1 an archkit_graph_accept tool that closes the loop by applying an authored node line and dropping the proposal, and #2 surfacing pending graph-proposals at resolve_warmup so the debt is visible.
started: 2026-06-09
completed: 2026-06-09
completion-notes: Added W015 to resolve_warmup: lists count+slugs of pending .arch/graph-proposals/ via listGraphProposals in checks/warnings/actions, summary.pendingGraphProposals, and a log.warn human banner line. Silent when none pending. Tests added to cgr-context-refresh.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-09
---



# Surface pending graph-proposals at resolve_warmup so graph debt is visible, not a silent folder

## Why
ADR 0004 left graph proposals persisted but unsurfaced. Feeding listGraphProposals into warmup (the way digests surface in goal_list) makes pending graph debt visible so it gets accepted instead of rotting.

## Exit criteria
- [ ] resolve_warmup reports the count and slugs of pending proposals from .arch/graph-proposals/ via listGraphProposals
- [ ] Surfaced in BOTH the human banner output and the JSON/MCP warmup result
- [ ] Zero pending proposals produces no output (silent when clean), mirroring existing warmup checks
- [ ] Tests cover: warmup with N pending proposals surfaces them; warmup with none stays quiet
- [ ] npm test is green

