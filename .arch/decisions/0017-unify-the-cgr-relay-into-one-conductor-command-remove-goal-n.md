# 0017. Unify the CGR relay into one /conductor command (remove goal_next)

- **Date**: 2026-06-27
- **Status**: Accepted
- **Tags**: cgr, relay, orchestration, mcp, breaking-change, dx

## Context

CGR 2.0 (ADR 0013) introduced a `conductor` orchestration prompt alongside the existing `goal_next` single-goal relay. That left two advance commands users had to choose between after /clear: /mcp__archkit__goal_next (load one goal, work it in the foreground) and /mcp__archkit__conductor (orchestrate parallel lanes; explicitly "don't code here"). The operator wants the daily workflow to be exactly three commands to remember — /intake, /clear, /conductor — and finds maintaining two near-identical relay entry points confusing. The two prompts differ only on one question: is there one goal, or multiple parallel lanes?

## Decision

Make `conductor` the single, lane-aware relay command and REMOVE `goal_next` entirely (operator chose removal over keeping a deprecated alias). The conductor handler folds the board (conductorPlan) first and branches: orchestrate when claimableLanes >= 2 OR in_flight > 0 OR merge_queue > 0 OR leases_expired > 0 (the CGR 2.0 dispatch pass); otherwise fall back to the single-goal foreground relay extracted from the former goal_next (routeNextGoal → renderPayload → startGoal → relayHeader, preserving the queue-vs-project routing choice and the idle case). Promote intake to a first-class `/mcp__archkit__intake` prompt so the loop is /intake → /clear → /conductor. Repoint the SessionStart nudge, the Stop-hook, and all ~46 hardcoded /mcp__archkit__goal_next guidance strings to /conductor. goal_resume / goal_status / goal_review remain as secondary (non-core) prompts. Prior ADRs that reference goal_next are left untouched as historical record.

## Consequences

Easier: one advance command to learn and to wire; the single-goal case stays a simple /clear → /conductor loop (no worker spawn for a lone goal), and parallelism kicks in automatically only when the board has ≥2 lanes. The three-command surface (/intake, /clear, /conductor) is the whole workflow. Harder/constrained: removing goal_next is a breaking change to the slash-command surface — anyone with /goal_next muscle memory or external docs referencing it gets "unknown command" (mitigated by the SessionStart nudge now teaching /conductor). The orchestrate-vs-foreground threshold (claimableLanes >= 2) is a heuristic; a single lane containing multiple goals is walked one goal at a time in the foreground rather than dispatched to a worker, which is intentional but means very large single lanes don't auto-parallelize. Supersedes the two-command relay model implied by ADR 0013.
