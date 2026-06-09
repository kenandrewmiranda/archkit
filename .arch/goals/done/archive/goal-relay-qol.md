---
slug: goal-relay-qol
title: Relay QoL: 'done today' breadcrumb + one-line goal restatement in the goal_next relay header
status: completed
created: 2026-06-09
exit-criteria:
  - The relay header (relayHeader / goal_next handler in src/mcp/prompts.mjs) prepends a one-line tally of goals completed today (count + titles or slugs), read from done/digest + done/
  - The relay instructs the agent to restate the active goal in one sentence before starting work; the testing-state variant restates what was built + what still needs verifying
  - No tally line is shown when nothing was completed today (graceful empty case)
  - Tests/snapshots cover header composition for in-progress, testing, and empty-today cases
files-to-touch:
  - src/mcp/prompts.mjs
required-reading: 
depends-on: 
verify-command: npm test
source-ask: In the goal_next→clear→goal_next loop users lose track of what's done. Add a consolidated day-by-day worklog they can post to Jira (time logging minimal; ticket linking is backlog). Capture time spent per goal — it's important to understand how long something took. Synthesis approved: ISO datetime transition stamps → derived elapsed, with an explicit effort override; worklog export over existing digests; plus an in-loop "done today" breadcrumb and a one-line goal restatement.
started: 2026-06-09
completed: 2026-06-09
completion-notes: Added doneTodayTally + goalsCompletedOn (reads done/ raw + done/digest, deduped) to prepend a 'done today' breadcrumb to the goal_next/goal_resume relay header, and a status-aware one-sentence restatement instruction (build+done-condition for in-progress, built-vs-verifying for testing). Tests cover in-progress, testing, and empty-today composition.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-09
---



# Relay QoL: 'done today' breadcrumb + one-line goal restatement in the goal_next relay header

## Why
Kills the in-loop 'losing track' pain where it actually hurts (the user only ever sees goal_next), and pairs with the original one-liner request to restate the active goal before working it.

## Exit criteria
- [ ] The relay header (relayHeader / goal_next handler in src/mcp/prompts.mjs) prepends a one-line tally of goals completed today (count + titles or slugs), read from done/digest + done/
- [ ] The relay instructs the agent to restate the active goal in one sentence before starting work; the testing-state variant restates what was built + what still needs verifying
- [ ] No tally line is shown when nothing was completed today (graceful empty case)
- [ ] Tests/snapshots cover header composition for in-progress, testing, and empty-today cases

