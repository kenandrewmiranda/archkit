---
slug: intake-dag-ownership
title: Intake emits dependency DAG + predicted ownership + lanes
status: completed
created: 2026-06-23
epic: cgr2-orchestration
order: 1
exit-criteria:
  - goal_intake emits per-goal: dependsOn edges, predicted owns globs, a feature tag, and an exclusive flag
  - Lane partitioning groups CGRs by feature cohesion and REQUIRES disjoint owns across parallel lanes; overlapping ownership is serialized into one lane
  - Cross-cutting/exclusive goals are flagged to run solo as a barrier (everything merges before, fan-out resumes after)
  - Tests cover partition correctness, disjoint-ownership enforcement, and exclusive-goal isolation
  - goal_intake emits per-goal: dependsOn edges, predicted owns globs, a feature tag, and an exclusive flag
- goal_intake emits per-goal: dependsOn edges, predicted owns globs, a feature tag, and an exclusive flag
files-to-touch:
  - src/mcp/tools.mjs
  - src/lib/goals.mjs
required-reading:
  - .arch/decisions/0013-adopt-conductor-worker-orchestration-with-parallel-lanes-cgr.md
depends-on:
  - board-state-manager
verify-command: npm test
source-ask: Build CGR 2.0: conductor/worker parallel-lane orchestration with a persistent append-only board, fission-based resume, attention-gradient wind-down, plus AGENTS.md export and skills rename. See ADRs 0013-0015.
started: 2026-06-23T22:06:00.273Z
completed: 2026-06-23T22:13:41.886Z
completion-notes: Intake now emits the dependency DAG + predicted ownership + computed lanes. Added partitionLanes() (union-find over feature cohesion + owns-overlap → disjoint parallel lanes, exclusive goals as solo barriers with a staged fan-out/barrier/fan-out plan), owns/feature/exclusive frontmatter, and exported shared glob-overlap helpers that board.mjs now reuses. 15 new tests in tests/cgr-lanes/; full suite 54/54 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-23
---



# Intake emits dependency DAG + predicted ownership + lanes

## Why
The parallel-safety keystone of the execution model — lanes and conflict avoidance hang entirely off the quality of these predictions.

## Exit criteria
- [x] goal_intake emits per-goal: dependsOn edges, predicted owns globs, a feature tag, and an exclusive flag
- [x] Lane partitioning groups CGRs by feature cohesion and REQUIRES disjoint owns across parallel lanes; overlapping ownership is serialized into one lane
- [x] Cross-cutting/exclusive goals are flagged to run solo as a barrier (everything merges before, fan-out resumes after)
- [x] Tests cover partition correctness, disjoint-ownership enforcement, and exclusive-goal isolation

## How it landed
- `src/lib/goals.mjs`: `featureOf` accessor; `claimPrefix`/`globsIntersect`/`ownsOverlap` exported glob-overlap helpers; `partitionLanes()` (union-find over feature cohesion + owns overlap, exclusive goals as solo barriers, staged plan); `writeGoal` persists `owns`/`feature`/`exclusive`.
- `src/lib/board.mjs`: `fileOverlapConflicts` now imports the shared `globsIntersect` (removed its private duplicate) — one source of truth for claim collision.
- `src/mcp/tools.mjs`: `archkit_goal_intake` schema gains `owns`/`feature`/`exclusive`; description documents the lane plan.
- `src/commands/goal.mjs`: `runGoalIntake` partitions the batch, stamps each goal's computed `lane`, and returns `lanes:{ lanes, barriers, stages, parallelWidth }`.
- `tests/cgr-lanes/run.mjs`: 15 tests — field round-trip, glob overlap, partition correctness, disjoint-ownership enforcement (incl. transitive chains + files-to-touch proxy), exclusive barrier isolation, purity, and intake integration.

