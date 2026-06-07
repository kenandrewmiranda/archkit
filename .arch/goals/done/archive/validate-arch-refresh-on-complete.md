---
slug: validate-arch-refresh-on-complete
title: Refresh .arch/ context after goal completion so the next iteration is current
status: done
created: 2026-06-06
exit-criteria:
  - Trace whether archkit_goal_complete / nextEligibleGoal / the relay refreshes architecture-derived state (INDEX parse, drift findings, warmup digest) between goals — document the finding in the goal notes or an ADR
  - If refresh is missing or stale, IMPLEMENT it (re-derive or invalidate the relevant caches/state on goal completion or on goal_next) so the next goal sees current nodes/graph/drift
  - Add a test covering the refresh behavior (or, if no refresh is genuinely needed, an ADR explaining why plus a test pinning that contract)
  - npm test passes
files-to-touch:
  - src/lib/goals.mjs
  - src/commands/goal.mjs
required-reading:
  - src/lib/goals.mjs
  - src/commands/goal.mjs
  - src/mcp/prompts.mjs
  - bin/archkit-stop-hook.mjs
depends-on:
  - release-v1-9-0
verify-command: npm test
source-ask: (1) add a CGR goal to build out archkit's own .arch/ so the warmup/utilization metric is meaningful; (2) validate that nodes/graph and the arch system get refreshed after a goal completes so the next iteration is up to date — both after 1.9 ships.
started: 2026-06-06
completed: 2026-06-06
completion-notes: Path B outcome: no refresh code needed. Traced the long-running MCP server — it holds zero in-memory arch cache; every resolve/warmup/drift/review/lookup/goals path re-reads .arch/ fresh per call (parsers.mjs build fresh objects each call). The next goal re-derives context via (1) per-call fresh disk reads and (2) renderPayload's unconditional 'archkit resolve warmup' instruction after /clear. Documented in ADR 0002 and pinned with tests/cgr-context-refresh/ (renderPayload carries the warmup instruction; runWarmupJson/runDriftJson reflect on-disk changes across successive calls). npm test 44/44 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Refresh .arch/ context after goal completion so the next iteration is current

## Why
After archkit_goal_complete, the next CGR iteration (/mcp__archkit__goal_next) should see up-to-date nodes/graph/drift. Validate whether completion or goal_next re-derives the architecture context; if it doesn't, implement the refresh so stale context can't leak into the next goal.

## Exit criteria
- [ ] Trace whether archkit_goal_complete / nextEligibleGoal / the relay refreshes architecture-derived state (INDEX parse, drift findings, warmup digest) between goals — document the finding in the goal notes or an ADR
- [ ] If refresh is missing or stale, IMPLEMENT it (re-derive or invalidate the relevant caches/state on goal completion or on goal_next) so the next goal sees current nodes/graph/drift
- [ ] Add a test covering the refresh behavior (or, if no refresh is genuinely needed, an ADR explaining why plus a test pinning that contract)
- [ ] npm test passes

