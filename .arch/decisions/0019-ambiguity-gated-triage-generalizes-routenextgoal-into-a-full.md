# 0019. Ambiguity-gated triage generalizes routeNextGoal into a full-board selection decision

- **Date**: 2026-07-19
- **Status**: Accepted

## Context

routeNextGoal only surfaced a choice on ONE axis — an ungrouped queue AND a project track both live. Every other mixed board state (accumulating testing/verification debt, deliberately-parked on-hold work, multiple project tracks, an empty/blocked queue) was silently auto-picked by nextEligibleGoal. That silent auto-pick is the root of "the conductor just mindlessly picks the next queue number and runs it".

## Decision

Added a pure-lib sibling triageNextGoal(archDir) in src/lib/goals.mjs that classifies the WHOLE board into single (exactly one axis of work, no notable debt → frictionless auto-pick, == nextEligibleGoal) / choice (>1 axis, OR pending work alongside a non-empty testing backlog, OR ANY on-hold work, OR only-parked work → caller asks the user) / none (nothing eligible and nothing parked, empty:true → caller offers a plan/intake path) / resume (in-progress goal always pre-empts). An axis = each pending track (ungrouped queue counts as one, each project one) + testing-present + on-hold-present. on-hold is deliberately EXCLUDED from the single fast-path: silently resuming parked work is exactly the mindless behavior removed, so parked-only boards go to choice. Every return carries uniform board slices (queue+next, projects+next, testing count+slugs, onHold count+slugs, recommended auto-pick, empty flag). A cgr.triageMode knob (ambiguity default | always | off), resolved tolerantly via readCgrConfig, overrides the gate: always forces a choice every pass, off restores pure auto-pick. routeNextGoal is left UNCHANGED for back-compat; wiring triageNextGoal into the MCP conductor prompt is the separate queued goal conductor-triage-prompt-wiring.

## Consequences

The conductor can become project/debt-aware at startup once the prompt-wiring goal consumes triageNextGoal. Selection business logic now has two entry points during the transition (routeNextGoal live, triageNextGoal ready) until wiring lands. The default (ambiguity) preserves the frictionless /clear -> /conductor loop for the trivial single-track case; teams can opt into always (always ask) or off (legacy silent auto-pick) per project.
