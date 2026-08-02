# 0027. Add a `dispatched` CGR state: claimed on behalf of a subagent, holds the lease, releases the Stop-hook guard

- **Date**: 2026-08-02
- **Status**: Accepted
- **Tags**: cgr, lifecycle, state-model, orchestration, hooks

## Context

Under CGR 2.0 (ADR 0013) the conductor dispatches one worker subagent per lane, each in its own git worktree. The archkit MCP server, however, resolves archDir from a single process.cwd(), so every session — conductor and workers alike — reads and writes ONE `.arch/`. When a worker calls archkit_goal_start the goal goes `in-progress` in that shared state.

The Stop-hook relay guard is SESSION-scoped: it fires in the foreground (conductor) session, and `in-progress` is a GUARDED status (ADR 0003). So the conductor gets told to keep working exit-criteria owned by a worker editing a different worktree. Complying would write the same files twice and discard one set of changes. Observed three times across two conductor sessions.

Neither existing escape fits. archkit_goal_complete would have the conductor attest to work it did not do and has not reviewed, and its test gate would run in the wrong tree. archkit_goal_hold — the workaround actually used — releases the guard but misrepresents an actively-worked lane as deliberately parked, drops the lease semantics, and pulls the goal out of the in-flight picture.

The distinguishing fact none of the existing states carries: the CLAIMING session is not the WORKING session.

## Decision

Add `dispatched` to the locked lifecycle vocabulary of ADR 0003 as a second live state alongside `in-progress`. It means: claimed on behalf of another session.

- HOLDS the lease. dispatchGoal() stamps `lease` ({worker, expires}) from cgr.leaseTtlHours if the goal does not already carry one, plus `dispatched-since` and `dispatched-to`. The conductor path additionally appends the `claimed` board event, so the folded board shows the goal in `in_flight` with lane/worker/lease.
- RELEASES the Stop-hook relay guard. `dispatched` is deliberately excluded from GUARDED_STATUSES, so getActiveGoal skips it and the hook emits no keep-working criteria. Instead it surfaces a non-blocking note naming the dispatched slugs and their workers.
- Stays LIVE. It is in LIVE_STATUSES (file-overlap conflict detection: a dispatched CGR is being edited right now) and in DRAIN_LIVE_STATUSES (unfinished work in its bucket). It is NOT offered by nextEligibleGoal, routeNextGoal, or triageNextGoal, and the board's frontier already excludes it because frontier is pending-only.
- Files in goals/ root, exactly like in-progress and on-hold. Status is the source of truth, not the folder (ADR 0003); no new folder.
- Terminal transitions are unrestricted: archkit_goal_complete, archkit_goal_handoff, archkit_goal_testing, archkit_goal_hold and archkit_goal_fission all work from `dispatched`, so the worker that owns the goal closes it normally from its own session.
- startGoal PRESERVES `dispatched` rather than flipping it to `in-progress`. A worker calling archkit_goal_start on a goal dispatched to it is confirming it is working it — the working session is still not the foreground one, so re-engaging the conductor's guard would reintroduce the bug. `startGoal(archDir, slug, { reclaim: true })` is the explicit escape for a conductor taking work back after a failed or expired dispatch.
- Lease TTL expiry is unchanged. Reclaim keys off the lease, not the status, so an orphaned `dispatched` goal folds into leases_expired and is reclaimed exactly as an orphaned `in-progress` one.

Entry point: archkit_goal_start gains an optional `worker`. With it, the claim is a dispatch; without it, the tool behaves exactly as before.

## Consequences

Easier: a conductor session can end while its lanes are still being worked, without lying about the state of the board. Lane status stays honest — `dispatched` work keeps its lease, keeps counting as live for conflict detection and bucket drain, and keeps showing in session_state.in_flight, none of which `on-hold` preserved. Orphan reclaim needed no new machinery because it was already lease-driven.

Harder / constrained: the lifecycle vocabulary grows to seven values, and `dispatched` / `on-hold` / `testing` are a confusable set that the MCP description budget suite (tests/mcp-tool-descriptions) now has to keep separable. Every new status-set predicate must decide explicitly whether `dispatched` belongs — the sets are no longer "guarded == live". A goal left `dispatched` by a worker that never returns is only recovered on lease expiry, so cgr.leaseTtlHours becomes the practical bound on a stuck lane. This amends ADR 0003's state model; it does not supersede it — the canonical happy path pending -> in-progress -> testing -> completed is unchanged.
