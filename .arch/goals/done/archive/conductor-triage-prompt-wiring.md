---
slug: conductor-triage-prompt-wiring
title: Wire the conductor single-goal relay to the triage (defer start, ask when ambiguous)
status: completed
created: 2026-07-19
order: 2
exit-criteria:
  - The conductor prompt consumes the triage decision: on `single` it auto-starts + injects the payload exactly as today; on `choice` it does NOT call startGoal and instead returns a message instructing the agent to present the options via AskUserQuestion (queue / each project / drain testing / plan something new)
  - Each option maps to a concrete follow-up action the agent can take without another round-trip: starting a named goal, draining testing, or running archkit_goal_intake for the plan path
  - The empty/nothing-eligible case offers the plan path (decompose a new ask via intake) rather than a dead-end message
  - triageMode=off preserves today's silent auto-pick behavior byte-for-byte; the queue-vs-project relayRoutingChoice path is subsumed by (or consistent with) the generalized triage, with no double-prompt
  - Existing prompt/relay tests still pass and a test covers the new choice-message shape
  - The conductor prompt consumes the triage decision: on `single` it auto-starts + injects the payload exactly as today; on `choice` it does NOT call startGoal and instead returns a message instructing the agent to present the options via AskUserQuestion (queue / each project / drain testing / plan something new)
  - Each option maps to a concrete follow-up action the agent can take without another round-trip: starting a named goal, draining testing, or running archkit_goal_intake for the plan path
  - The conductor prompt consumes the triage decision: on `single` it auto-starts + injects the payload exactly as today; on `choice` it does NOT call startGoal and instead returns a message instructing the agent to present the options via AskUserQuestion (queue / each project / drain testing / plan something new)
  - Each option maps to a concrete follow-up action the agent can take without another round-trip: starting a named goal, draining testing, or running archkit_goal_intake for the plan path
- The conductor prompt consumes the triage decision: on `single` it auto-starts + injects the payload exactly as today; on `choice` it does NOT call startGoal and instead returns a message instructing the agent to present the options via AskUserQuestion (queue / each project / drain testing / plan something new)
- Each option maps to a concrete follow-up action the agent can take without another round-trip: starting a named goal, draining testing, or running archkit_goal_intake for the plan path
files-to-touch:
  - src/mcp/prompts.mjs
  - tests/
required-reading: 
depends-on:
  - conductor-ambiguity-triage
owns:
  - src/mcp/prompts.mjs
verify-command: npm test
source-ask: As I develop with archkit, what gets pulled in next is a clear issue — the conductor just mindlessly picks the next queue number and runs it. We should make the workflow ask the user whether to work the queue, projects, testing, or help set up a plan on what to tackle next — being more project-aware / aware of what's been going on. Review how influential the board is at startup and the overall selection business logic.
lane: lane-conductor-ambiguity-triage
started: 2026-07-19T18:07:39.133Z
completed: 2026-07-19T18:14:18.186Z
completion-notes: Wired singleGoalRelayMessage onto triageNextGoal; choice emits AskUserQuestion message across queue/project/testing/on-hold/plan axes; off preserves silent auto-pick; relayRoutingChoice subsumed by relayTriageChoice. 6 new cgr-relay tests, 62/62 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---




# Wire the conductor single-goal relay to the triage (defer start, ask when ambiguous)

## Why
singleGoalRelayMessage currently calls startGoal() and injects the payload in one breath. It must defer the start when the triage says `choice` and instead emit a message that drives AskUserQuestion over the board slices, including a "plan something new" option.

## Exit criteria
- [ ] The conductor prompt consumes the triage decision: on `single` it auto-starts + injects the payload exactly as today; on `choice` it does NOT call startGoal and instead returns a message instructing the agent to present the options via AskUserQuestion (queue / each project / drain testing / plan something new)
- [ ] Each option maps to a concrete follow-up action the agent can take without another round-trip: starting a named goal, draining testing, or running archkit_goal_intake for the plan path
- [ ] The empty/nothing-eligible case offers the plan path (decompose a new ask via intake) rather than a dead-end message
- [ ] triageMode=off preserves today's silent auto-pick behavior byte-for-byte; the queue-vs-project relayRoutingChoice path is subsumed by (or consistent with) the generalized triage, with no double-prompt
- [ ] Existing prompt/relay tests still pass and a test covers the new choice-message shape

