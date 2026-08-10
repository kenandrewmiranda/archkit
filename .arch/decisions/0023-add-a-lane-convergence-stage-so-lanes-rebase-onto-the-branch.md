# 0023. Add a lane convergence stage so lanes rebase onto the branch tip and land as one integration point (amends ADR 0013)

- **Date**: 2026-08-02
- **Status**: Accepted
- **Tags**: cgr, orchestration, merge-queue, conductor, git

## Context

ADR 0013 specified integration as "a merge queue with sequential integration + verify-after-each", and the conductor implemented exactly that: step 5 drained the dependency-ordered merge queue as N independent merges of worker branches onto the branch, one per CGR, with no precondition on the state of those branches.

That is unsound against how workers are actually spawned. Agent-tool worktree workers branch from a STALE base — the worktree is cut when the worker spawns, not when its work lands — and lanes are only *predicted* to be disjoint (`owns` is a prediction; ownership accuracy is a measured, sub-1.0 signal in the handoff). So when two worker branches touch the same file, draining the queue naively means merge #2 arrives carrying the PRE-#1 content of that file and git resolves it as an intentional change: the second merge REVERTS what the first merge landed moments earlier, in the same drain, silently. This was observed in practice and recorded as a project gotcha ("integrate by path-extract, not `git merge`, or you clobber intervening work").

Two further problems compounded it. N merges for N CGRs means N chances for a lane to arrive stale, when a lane is by construction one worker context with one branch and should present one integration surface. And the flat slug list step 5 emitted (`a → b → c`) told the conductor an order but nothing about the precondition each merge had to satisfy.

Naming was a real constraint: "reconcile" is already taken in this codebase for goal-FILE placement (`archkit_goal_reconcile` / `reconcileGoalsLayout`, ADR 0020/0021). A second "reconcile" meaning branch integration would be genuinely confusable in tool output, docs, and greps.

## Decision

1. Insert a **lane convergence stage** between the merge queue's ordering and its drain. The word is *convergence* (converge / integration point), never *reconcile* — the two concepts stay lexically disjoint, and a test asserts the emitted plan contains no "reconcil*" substring.

2. `laneConvergencePlan(orderedQueue, {branch, depsOf, pathsOf, branchOf})` groups the already-dependency-ordered merge queue BY LANE, so each lane lands as ONE integration point rather than N independent merges onto the branch. `orderMergeQueue` is unchanged and still produces the flat CGR order the grouping consumes; `conductorPlan` exposes the result as `convergence` alongside the existing `mergeOrder`, which stays intact for existing consumers (the SessionStart digest, the `archkit_conductor` tool).

3. Every emitted group carries an explicit **rebase-onto-branch-tip precondition** as the primary integration primitive: converge the lane's worktree onto the tip of the integration branch (`cgr.integrationBranch`, default `main`) BEFORE it lands, so the merge can only fast-forward-or-conflict and can never silently revert an earlier integration point in the drain.

4. Each group also carries the **path-extract fallback** — `git checkout <lane-branch> -- <the lane's owned paths>`, run from the integration branch — scoped to the case where the rebase cannot be completed because the worker base is unrecoverably stale. It is bounded by the lane's declared ownership by construction, so intervening work outside those paths survives, which is exactly what a whole-tree merge from a stale base fails to guarantee.

5. Cross-lane dependency order is preserved through the grouping. Lane-level edges are induced from the CGR-level `depends_on` that `orderMergeQueue` already honored — a CGR depending on a CGR in another lane makes that lane a predecessor — and the lanes are Kahn-sorted with the queue's first-appearance index as the tie-break. A lane containing a CGR that depends on another lane's CGR therefore always lands after it, even when it appeared first in the flat queue. Mutually dependent lanes (a genuine cross-lane cycle) cannot collapse to one point each; the plan degrades to ordered SEGMENTS of the flat queue — preserving the flat order verbatim — and flags `split: true` so the entanglement is visible rather than silently mis-ordered.

6. `/mcp__archkit__conductor` step 5 emits the lane-grouped convergence plan (integration points, the precondition command, the integrate-and-verify command, and the fallback) instead of the flat slug list.

7. archkit still never runs git (instruct-not-act, ADR 0010). The whole stage is a PURE computation that EMITS a structure and rendered text; the conductor performs the rebases and merges. A test asserts `board.mjs` imports no `child_process` and calls no process-spawning API.

This AMENDS ADR 0013's merge-queue description: "sequential integration + verify-after-each" now reads "converge each lane onto the branch tip, then land one integration point per lane in cross-lane dependency order, verifying after each."

## Consequences

The stale-base revert class of bug is designed out rather than caught in review: a lane cannot land without first converging, and the plan says so at the point of use instead of relying on the conductor remembering a gotcha. Integration points scale with LANES, not CGRs, so a five-CGR lane presents one merge surface and one verify run instead of five.

Costs and constraints. Ownership prediction becomes load-bearing in a second place: the path-extract fallback is only as safe as the lane's `owns` ∪ `files-to-touch`, so an under-predicting lane can still under-extract — the ownership-accuracy signal in the handoff (ADR 0015) is the check on this. archkit cannot know the worker's worktree branch name (the Agent tool assigns it), so the emitted commands carry a `<worktree-branch:lane>` placeholder the conductor substitutes; a future intake/claim could record the branch on the CGR and make the commands literal. Cross-lane cycles produce more integration points than lanes, which is the correct conservative behavior but loses the per-lane collapse. And `cgr.integrationBranch` is a new config knob whose default (`main`) is wrong for a project that integrates elsewhere.

Related: ADR 0013 (conductor/worker lanes — amended here), ADR 0010 (instruct-not-act), ADR 0015 (ownership accuracy), ADR 0020/0021 (the *other* reconcile — goal-file placement, deliberately kept lexically distinct).
