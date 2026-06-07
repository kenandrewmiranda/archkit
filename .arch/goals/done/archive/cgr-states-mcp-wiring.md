---
slug: cgr-states-mcp-wiring
title: Wire the new states/phase into MCP tools, slash prompts, and docs
status: done
created: 2026-06-07
exit-criteria:
  - MCP tool surface + slash prompts expose the testing transition, the renamed set-aside state, and the consolidation/digest action
  - goal_next / relay prompts reflect the new scan ordering and the testing-drain behavior
  - README + tool-count/docs updated to describe the expanded lifecycle (pending -> in-progress -> testing -> completed + on-hold + consolidation)
  - End-to-end: intake -> work -> testing -> verify -> complete -> consolidate works through the MCP/CLI path, suite green
  - End-to-end: intake -> work -> testing -> verify -> complete -> consolidate works through the MCP/CLI path, suite green
- End-to-end: intake -> work -> testing -> verify -> complete -> consolidate works through the MCP/CLI path, suite green
files-to-touch:
  - src/mcp/tools.mjs
  - src/mcp/prompts.mjs
  - src/commands/goal.mjs
  - README.md
required-reading:
  - src/mcp/tools.mjs
  - src/mcp/prompts.mjs
depends-on:
  - cgr-testing-state
  - cgr-backlog-ordering
  - cgr-consolidation-digest
verify-command: npm test
source-ask: Conference feedback on CGR flow: add more states. Proposed folders pending/deferred/testing/completed. MCP scans pending→testing→deferred; when empty, consolidate completed into a per-session/day summary. Note: keep the original raw CGR file in an archive folder within completed/ so an agent can still pull full context. Decided to extend the relay loop, not rebuild: add a `testing` (edit-applied/unverified) state, rename the set-aside state to avoid the existing `deferred`/proposed collision, add a backlog-threshold ordering knob, and add an incremental consolidation/digest phase.
started: 2026-06-07
completed: 2026-06-07
completion-notes: Wired the expanded CGR lifecycle (ADR 0003) across the agent-facing surface. Implemented the missing `on-hold` state in src/lib/goals.mjs (STATUS_ON_HOLD + markOnHold: parks in goals/ root, releases the guard, clears turn-cap; nextEligibleGoal excludes it from auto-pick but offers it as a last-resort resume). Added runGoalHold + `archkit goal hold` CLI. Exposed three new MCP tools — archkit_goal_testing, archkit_goal_hold, archkit_goal_consolidate (28→31). Updated slash prompts: goal_next scan-order/testing-drain description, status-aware relayHeader, and a goal_status that surfaces testing/pending/on-hold/consolidation. Docs: README tool count + new goal-lifecycle subsection, session-start digest (stale 25→31 + lifecycle prose), marketplace 28→31, mcp-server tool-count assertion, silent-success-audit coverage. New tests/cgr-states-wiring suite (14 tests incl. e2e intake→testing→verify→complete→consolidate). Full suite 49/49 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-07
---



# Wire the new states/phase into MCP tools, slash prompts, and docs

## Why
The states and digest are only useful if the relay surfaces them — goal_next ordering, the Stop-hook prompts, tool listings, and README/marketplace docs all need to reflect testing/on-hold/consolidation.

## Exit criteria
- [ ] MCP tool surface + slash prompts expose the testing transition, the renamed set-aside state, and the consolidation/digest action
- [ ] goal_next / relay prompts reflect the new scan ordering and the testing-drain behavior
- [ ] README + tool-count/docs updated to describe the expanded lifecycle (pending -> in-progress -> testing -> completed + on-hold + consolidation)
- [ ] End-to-end: intake -> work -> testing -> verify -> complete -> consolidate works through the MCP/CLI path, suite green

