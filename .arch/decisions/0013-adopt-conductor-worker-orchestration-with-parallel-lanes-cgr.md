# 0013. Adopt conductor/worker orchestration with parallel lanes (CGR 2.0)

- **Date**: 2026-06-23
- **Status**: Accepted
- **Tags**: cgr, orchestration, architecture, parallelism

## Context

Today's CGR relay is single-threaded: one context = one worker = one goal, advanced by a human keystroke (/clear + /mcp__archkit__goal_next) per goal. Users compare this unfavorably to parallel agent execution and want independent work to run concurrently. The constraint that forced the per-goal human relay was that the foreground session WAS the worker, so advancing meant a human-driven context reset.

Larger context windows (1M) do not remove this — effective reasoning still degrades as context fills ("attention budget", not token scarcity, is the real limit). So the goal is to parallelize independent work while keeping each unit of work in a high-quality slice of context.

## Decision

Invert the foreground session from worker to **conductor**. After /new_session the foreground session orchestrates rather than codes: it reserves work, spawns worker subagents in isolated git worktrees, reviews their structured returns, and integrates via a merge queue. Workers are ephemeral and disposable; the conductor stays lean by dispatching by reference (goal slug + lane spec) and receiving summaries, never raw diffs.

Work is organized into **lanes**: a lane is a set of CGRs run sequentially in one worker context, ordered by dependency; lanes run in parallel when their predicted file-ownership sets are disjoint. Intake groups CGRs into lanes by **feature cohesion**, which simultaneously (1) keeps worker context warm, (2) minimizes cross-lane conflicts (same feature = same files, kept serial in one lane), and (3) partitions state writes so parallel workers never contend. Cross-cutting goals (repo-wide renames, "add logging everywhere") are flagged **exclusive** and run solo as a barrier.

Conflict strategy is hybrid, in order: pre-partition by ownership (pessimistic), worktree-isolate (contain), then a reconcile goal for genuine merge conflicts (escalate). Worktree isolation is the safety net for imperfect ownership prediction.

Native Claude Code primitives this rests on (verified mid-2026): subagent nesting with isolated context, per-subagent worktree isolation, and the inability of any hook/tool to invoke /clear — which is why the conductor (not a keystroke) drives advancement.

## Consequences

Easier: independent work runs in parallel; the human memorizes one command (/new_session); the conductor decides when to advance instead of the human.

Harder/constrained: intake must now emit a dependency DAG + predicted file-ownership per goal (the keystone — everything hangs off it); the Stop-guard moves from per-goal to per-lane release; the conductor must stay disciplined about leanness (review only exceptions, not every diff) or it loses the ability to supervise many lanes; a merge queue with sequential integration + verify-after-each is required.

This is evolution, not a rewrite: the existing lifecycle (pending/in-progress/testing/completed/on-hold/abandoned/proposed) and the test gate survive intact; only relay granularity changes from per-goal to per-session-batch.

Related: see the fission-resume ADR and the attention-gradient wind-down ADR.
