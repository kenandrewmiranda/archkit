---
slug: cgr-consolidation-digest
title: Add the incremental consolidation/digest phase (summarize completed/, keep raw CGRs in completed/archive/)
status: done
created: 2026-06-07
exit-criteria:
  - A consolidation step produces a dated per-session/day digest summarizing what was completed since the last consolidation (incremental — NOT gated on the whole queue being empty)
  - Raw completed CGR files are preserved verbatim under an archive subfolder within completed/ (e.g. goals/done/archive/<slug>.md) so full context is recoverable
  - The digest is discoverable through an existing surface (e.g. searchable like decisions/), not a dead file
  - Trigger fires on queue-drain and/or session-end without losing any raw goal content
  - Unit tests cover digest generation + raw-file archival, suite green
files-to-touch:
  - src/lib/goals.mjs
  - src/commands/goal.mjs
  - src/mcp/tools.mjs
required-reading:
  - src/lib/goals.mjs
depends-on:
  - cgr-lifecycle-design
verify-command: npm test
source-ask: Conference feedback on CGR flow: add more states. Proposed folders pending/deferred/testing/completed. MCP scans pending→testing→deferred; when empty, consolidate completed into a per-session/day summary. Note: keep the original raw CGR file in an archive folder within completed/ so an agent can still pull full context. Decided to extend the relay loop, not rebuild: add a `testing` (edit-applied/unverified) state, rename the set-aside state to avoid the existing `deferred`/proposed collision, add a backlog-threshold ordering knob, and add an incremental consolidation/digest phase.
started: 2026-06-07
completed: 2026-06-07
completion-notes: Added the incremental consolidation/digest phase. New lib in src/lib/goals.mjs: consolidateGoals() drains terminal goals at the top of goals/done/ into a dated per-day digest (goals/done/digest/<date>.md) and moves each raw CGR verbatim (copy-then-unlink) to goals/done/archive/<slug>.md; incremental (works while other goals are still pending, not gated on an empty queue) and idempotent (same-day re-runs append without dupes via slug markers). isGoalDone now checks done/ AND done/archive/ so depends-on survives archival. listDigests/searchDigests mirror decisions read-side for recall. Triggers: runGoalComplete fires it on queue-drain (returns `consolidation`); the Stop hook fires it as a session-end safety net (announces once, then silent). Discoverable via archkit_goal_list (new `digests` + `archived` fields). Added `archkit goal consolidate` CLI subcommand. Tests: new tests/cgr-consolidation suite (7 tests) covers digest generation, verbatim archival, incremental-with-pending, idempotency, depends-on survival, search, and e2e queue-drain; updated cgr-relay + test-gate for the new archive/drain behavior. Full suite 46/46 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-07
---



# Add the incremental consolidation/digest phase (summarize completed/, keep raw CGRs in completed/archive/)

## Why
Net-new value: at queue-drain or session-end, digest completed goals into a dated per-session/day summary (recallable, sibling to decisions/). Per the user's note, the original raw CGR files are PRESERVED in an archive subfolder of completed/ so an agent can still pull full context.

## Exit criteria
- [ ] A consolidation step produces a dated per-session/day digest summarizing what was completed since the last consolidation (incremental — NOT gated on the whole queue being empty)
- [ ] Raw completed CGR files are preserved verbatim under an archive subfolder within completed/ (e.g. goals/done/archive/<slug>.md) so full context is recoverable
- [ ] The digest is discoverable through an existing surface (e.g. searchable like decisions/), not a dead file
- [ ] Trigger fires on queue-drain and/or session-end without losing any raw goal content
- [ ] Unit tests cover digest generation + raw-file archival, suite green

