# 0029. Record a CGR's completion on the board only when it was claimed, and carry its integration metadata on the event

- **Date**: 2026-08-03
- **Status**: Accepted
- **Tags**: cgr, board, orchestration, merge-queue

## Context

Nothing appended a `completed` board event on a normal completion — only fission did (runGoalFission). The board's merge_queue is derived from that event, so a CGR a worker finished normally never reached it: the conductor's convergence stage had nothing to drain, and before ADR 0028's terminal-status check the CGR stayed pinned in in_flight forever. The merge queue only ever filled for fissioned goals, which is why the gap went unnoticed.

Appending unconditionally is wrong in the other direction. Most CGRs are worked in the FOREGROUND — started and completed in the same tree, no worktree, no branch. Recording those would manufacture an integration point per completion and send the conductor asking a human to merge a branch that does not exist.

A second problem sits behind it: completion ARCHIVES the CGR to .arch/goals/done/, which loadGoal deliberately does not read. Everything the merge queue needs about a CGR — its lane, dependency edges, owned paths, and its own verify command — lived only in that file. A merge queue that outlived the file it described was reduced to slug plus timestamp: dependency order collapsed, the path-extract fallback lost its bound, and a CGR's own verify-command silently degraded to the project default.

## Decision

Add board.mjs `recordCompletion(archDir, {slug, ...})`, called by runGoalComplete after the archive succeeds.

- GATED ON A PRIOR CLAIM. The event is appended only when the fold shows the slug's lifecycle at `claimed` — i.e. it was claimed by claimFrontier as a dispatch (ADR 0027/0028), which is exactly the worktree-isolated case that has a branch to merge. A never-claimed foreground CGR records nothing and returns reason `never-claimed`. Idempotent: a slug already folded past `claimed` returns `already-<lifecycle>` and appends nothing, so re-completion and log replay are safe.
- THE EVENT CARRIES THE INTEGRATION METADATA the archived file takes with it: lane, worker, completion (full|partial), depends_on, owned paths (owns ∪ files-to-touch), and the CGR's verify-command. foldEvents accumulates dependsOn/paths/verify the same way it already accumulates lane/worker/lease; sessionState's merge_queue entries prefer the live CGR and fall back to what the event carried; mergeQueueOrder and laneConvergence resolve deps/paths/verify the same way. No new event type — the ADR 0014 vocabulary is unchanged.
- runGoalComplete returns `boardRecord` {recorded, reason, lane} and, when recorded, says in nextStep that the CGR left in_flight for the merge queue. The append is best-effort: a board failure never blocks marking a goal done.

## Consequences

Easier: the dispatch loop finally closes — claim -> dispatched -> in_flight -> complete -> merge_queue -> convergence -> archkit_board_merged -> off the board, with each step derived from events that survive /clear. A completed stack still merges bottom-up after its CGR files are archived, and each integration point keeps the verify command and owned paths it was planned with.

Harder / constrained: "was it claimed?" is now load-bearing for whether work shows up as needing integration — a conductor that spawns a worker WITHOUT claiming (the pre-ADR-0028 habit) gets no merge-queue entry, and its lane silently never converges. The claim step in the rendered pass is what prevents that, so the two ADRs depend on each other. Completed events are also now the only record of an archived CGR's deps and owned paths: rewriting or truncating .arch/board/events.ndjson loses integration metadata that used to be recoverable from goals/done/. Fission still appends its own `completed` event directly (ungated) to preserve its existing partial-completion semantics, so that path does not pick up the carried metadata.
