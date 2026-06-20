# 0011. Move pending CGRs into a goals/queue/ folder with dual-read back-compat

- **Date**: 2026-06-20
- **Status**: Accepted
- **Tags**: cgr, goals, storage, lifecycle, parallel-work

## Context

ADR 0003 locked the CGR lifecycle (pending → in-progress → testing → completed, plus on-hold/abandoned) and a deliberately minimal folder scheme: only goals/testing/ and goals/done/ earned dedicated folders; everything else — pending, in-progress, on-hold — sat at the goals/ ROOT distinguished solely by its status: frontmatter. ADR 0003 explicitly REJECTED a folder-per-state scheme and said future requests for a pending/ folder "should be refused unless this ADR is superseded."

Two things changed the calculus:
1. The state→folder map was asymmetric: testing/ and done/ had drawers but the much larger pending backlog was loose at the root, mixed in with the one in-progress goal, the on-hold goals, the coordination board (chat.md), and .loop-state.json. A pending queue is the bucket users actually scan, and it had no home.
2. cgr-project-branch-grouping (ADR 0010) introduced `project` as a branch-isolated feature set. Users asked for project CGRs to cluster in a subfolder so an agent picking up a feature set sees its goals grouped and works them on one branch — a per-project sub-namespace that a flat root cannot express.

The hard constraint: archkit is a published package with existing projects whose pending goals live at goals/ root. Any on-disk move is a breaking change unless reads tolerate both layouts.

## Decision

Introduce goals/queue/ as the home for PENDING goals, making the live-state map symmetric: queue/ (pending) · testing/ (verification debt) · done/ (terminal). This is a deliberate, scoped amendment to ADR 0003's "no pending/ folder" stance — that refusal stands for in-progress and on-hold, which REMAIN at goals/ root (status is still the source of truth for those). Only "queued, not yet started" work gets the new drawer.

Specifics:
- A `queueDir(archDir)` helper returns goals/queue/. writeGoal writes new goals there. A goal carrying a `project` is filed one level deeper under goals/queue/<project>/<slug>.md so a feature set's CGRs cluster on disk (realizing the ADR 0010 projects idea physically).
- DUAL-READ back-compat (the read-alias pattern, mirroring planned→pending): listGoals and loadGoal resolve goals across goals/queue/ (+ one level of project subfolders), the legacy goals/ root, AND goals/testing/. Queue-first precedence so a migrated copy wins over a stale root one. Existing projects' root-level pending goals stay fully visible and actionable without any migration step. Pure-read paths never move files.
- A one-time, idempotent migration (migratePendingGoalsToQueue) relocates legacy root-level *.md PENDING goals (including the legacy `planned` alias) into queue/, nesting project goals under queue/<project>/. It runs lazily from ensureGoalsLayout on any WRITE path, leaves in-progress/on-hold (root) and testing/done/proposed (own subdirs) untouched, never overwrites an existing destination, and never throws.
- Transition helpers (startGoal, markTesting, markOnHold, completeGoal, abandonGoal) relocate correctly from EITHER location because they resolve via loadGoal's dual-read and then write the canonical target folder (root for in-progress/on-hold, testing/, done/), removing the source. ensureGoalsLayout now runs BEFORE loadGoal in each helper so the lazy migration settles a goal's location before it is captured — otherwise a just-loaded root pending goal would be migrated mid-transition and duplicated.

## Consequences

Easier:
- The pending backlog has a dedicated, scannable drawer that mirrors testing/ and done/ — the symmetric queue·testing·done map users expected.
- Project feature sets cluster on disk under queue/<project>/, so an agent picking up a project sees its CGRs grouped and knows to branch (feat/<project>) — the parallel-work goal of the epic.
- Existing projects keep working untouched: dual-read means no flag day, and the migration tidies them on the next write without manual steps.

Harder / constrained:
- There are now two valid on-disk homes for a pending goal (root, queue/) during the back-compat window. This is intentional and bounded — the migration converges every project to queue/ on first write — but readers MUST go through listGoals/loadGoal (which dual-read); no code should readdir goals/ root directly for pending goals.
- queue/ is now a sanctioned per-state folder, narrowing ADR 0003's "only testing/" rule. The rule still holds for in-progress and on-hold (no folders — status frontmatter governs); queue/ is the single sanctioned exception, justified by it being the backlog bucket plus the project sub-namespace carrier.
- Transition helpers must keep ensureGoalsLayout ordered before loadGoal; reverting that order reintroduces the migrate-mid-transition duplicate bug (covered by a regression test).
