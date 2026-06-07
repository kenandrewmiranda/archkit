---
slug: cgr-lifecycle-design
title: Lock the expanded CGR state model + resolve the `deferred` naming collision (ADR)
status: done
created: 2026-06-07
exit-criteria:
  - An ADR is logged via archkit_log_decision capturing the lifecycle: pending -> in-progress -> testing -> completed, plus abandoned and a renamed set-aside state (e.g. on-hold/blocked) distinct from proposed/deferred
  - ADR records the decision that `testing` = edit-applied-but-unverified, a persistent state that survives /clear (replacing today's premature goal_complete)
  - ADR records the storage decision: status stays the source of truth in frontmatter; only `testing/` gets a loud dedicated folder (not a folder per state); terminal work still archives under done/completed/
  - ADR notes the `deferred` collision and the chosen rename, so goal_defer/proposed semantics are left untouched
  - No source code changed in this goal — design lock only
  - An ADR is logged via archkit_log_decision capturing the lifecycle: pending -> in-progress -> testing -> completed, plus abandoned and a renamed set-aside state (e.g. on-hold/blocked) distinct from proposed/deferred
  - ADR records the storage decision: status stays the source of truth in frontmatter; only `testing/` gets a loud dedicated folder (not a folder per state); terminal work still archives under done/completed/
- An ADR is logged via archkit_log_decision capturing the lifecycle: pending -> in-progress -> testing -> completed, plus abandoned and a renamed set-aside state (e.g. on-hold/blocked) distinct from proposed/deferred
- ADR records the storage decision: status stays the source of truth in frontmatter; only `testing/` gets a loud dedicated folder (not a folder per state); terminal work still archives under done/completed/
files-to-touch:
  - .arch/decisions/
required-reading:
  - src/lib/goals.mjs
depends-on: 
verify-command: npm test
source-ask: Conference feedback on CGR flow: add more states. Proposed folders pending/deferred/testing/completed. MCP scans pending→testing→deferred; when empty, consolidate completed into a per-session/day summary. Note: keep the original raw CGR file in an archive folder within completed/ so an agent can still pull full context. Decided to extend the relay loop, not rebuild: add a `testing` (edit-applied/unverified) state, rename the set-aside state to avoid the existing `deferred`/proposed collision, add a backlog-threshold ordering knob, and add an incremental consolidation/digest phase.
started: 2026-06-07
completed: 2026-06-07
completion-notes: Logged ADR 0003 locking the CGR lifecycle (pending → in-progress → testing → completed, plus abandoned and on-hold). `testing` = edit-applied-but-unverified, persistent across /clear. Storage: status frontmatter is source of truth; only goals/testing/ gets a dedicated folder; terminal work archives under goals/done/ (raw under done/archive/). Set-aside state renamed `on-hold` to resolve the `deferred` collision — goal_defer/proposed semantics untouched. No source code changed.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-07
---



# Lock the expanded CGR state model + resolve the `deferred` naming collision (ADR)

## Why
Conference feedback wants more states. Before any code, pin the lifecycle and disambiguate `deferred` — it already means parked follow-up PROPOSALS (goals/proposed/ + archkit_goal_defer), which is NOT the user's set-aside-active-goal meaning. Every other goal depends on these names being settled.

## Exit criteria
- [ ] An ADR is logged via archkit_log_decision capturing the lifecycle: pending -> in-progress -> testing -> completed, plus abandoned and a renamed set-aside state (e.g. on-hold/blocked) distinct from proposed/deferred
- [ ] ADR records the decision that `testing` = edit-applied-but-unverified, a persistent state that survives /clear (replacing today's premature goal_complete)
- [ ] ADR records the storage decision: status stays the source of truth in frontmatter; only `testing/` gets a loud dedicated folder (not a folder per state); terminal work still archives under done/completed/
- [ ] ADR notes the `deferred` collision and the chosen rename, so goal_defer/proposed semantics are left untouched
- [ ] No source code changed in this goal — design lock only

