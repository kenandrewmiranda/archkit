# 0028. Claim IS the dispatch: the conductor pass renders archkit_goal_start {slug, worker} before the spawn, and a closed claim leaves in_flight

- **Date**: 2026-08-03
- **Status**: Accepted
- **Tags**: cgr, orchestration, conductor, board, output-contract

## Context

ADR 0027 added the `dispatched` state — claimed on behalf of a subagent, holds the lease, releases the Stop-hook guard — and it is fully implemented and tested. Nothing ever reached it. The rendered conductor pass (format.mjs conductorGraph, step 2) said only "claim + dispatch 1 worker/lane", with no call to make, so conductors spawned workers and let each worker call archkit_goal_start from its own session. That lands `in-progress` in the single shared .arch/, which re-arms the guard in the CONDUCTOR's session — the exact bug ADR 0027 exists to close. Conductors then fell back to archkit_goal_hold, which frees the guard but drops the lease and shows an actively-worked lane as deliberately parked. Observed six times across two sessions.

A second gap surfaced while testing the end-to-end shape: sessionState folded in_flight purely from the event log (lifecycle stuck at `claimed`), and nothing appends a `completed` event on a normal completion. A dispatched CGR that its worker closed therefore stayed in_flight forever, so every rehydrate re-surfaced a finished dispatch and its lease kept aging toward reclaim.

## Decision

Make the CLAIM the rendered dispatch instruction, and let terminal CGR status end a claim.

- board.mjs derives the claim calls a pass owes: `dispatchClaims({claimableLanes, barriers})` returns one `archkit_goal_start {slug, worker}` per claimable slug, grouped by DISPATCH UNIT — a lane, or a solo barrier keyed by its own slug so two barriers never collide onto one worker id. Default worker ids come from `dispatchWorkerId` (`w-<lane>`); the conductor substitutes the real subagent id. Exposed as `conductorPlan().dispatch` plus `counts.dispatch_claims`, so the structured plan and the rendered pass read the same derivation.
- format.mjs step 2 emits the claim ONCE as a substitution template (O(1) in lanes, like the convergence template): CLAIM first `archkit_goal_start {slug, worker:w-<lane>}` -> `dispatched` (lease held, THIS guard freed, survives /clear), with `archkit_goal_hold` marked as the ✗ anti-pattern rather than offered as an action. on-hold stays reserved for deliberately parked work.
- sessionState's in_flight fold now skips a claimed slug whose CGR is done. Status is the source of truth (ADR 0003); the event log remains the record, but a closed CGR is not in flight regardless of whether a `completed` event was ever appended. leases_expired inherits this, so a finished dispatch no longer ages into reclaim.
- The pinned `legacyConductorProse` baseline in tests/cgr-output-contract (the EC4 ratio's other side) was EXTENDED with the prose form of the new claim instruction, not rewritten. EC4 measures one instruction set rendered two ways; carrying an instruction on only the graph side would silently convert "the graph beats prose 2:1" into "no instruction may ever be added".

## Consequences

Easier: a conductor that follows the rendered pass now actually produces `dispatched` lanes — lease held, guard released in the claiming session, lane/worker/lease visible in archkit_session_state.in_flight, so a mid-pass /clear rehydrates the dispatch instead of an empty board. The goal_hold workaround has both a replacement and an explicit prohibition at the step where the temptation arises.

Harder / constrained: the default `w-<lane>` worker ids are a convention, not an identity — a conductor that spawns two waves onto one lane must pass distinct ids itself or the second claim reuses the first's lease holder. The rendered template shows the lane-derived form, while a barrier's structured id is slug-derived, so the two differ for barriers. in_flight now depends on CGR files as well as the event log, so a fold over an event log whose CGRs were archived elsewhere reports fewer in-flight items than the log alone would. And the completion path still appends no `completed` board event outside fission, so the merge_queue stays empty for a normally-completed CGR — filed as a follow-up proposal, not fixed here.
