# 0004. Close the CGR graph flywheel — scoped slice-in at goal start, propose-out at goal complete

- **Date**: 2026-06-09
- **Status**: Accepted
- **Tags**: cgr, graph, context, knowledge-management

## Context

Completed CGR goals accumulated as a write-only archive (goals/done/), indexed only by date. Their richest signal — what files/structure the work touched — never flowed back into the surfaces future sessions actually read (the node graph in INDEX.md + clusters/*.graph, consumed by resolve_warmup/resolve_preflight). Two gaps compounded this:

1. The CGR relay never consulted the node graph. The injected payload (renderPayload) just listed manually-typed files-to-touch and said "run warmup" — the agent re-derived or guessed which files were related. The 3800-char PAYLOAD_BUDGET existed only because the original workflow pasted the payload as a /goal slash-command argument; the primary path now (/mcp__archkit__goal_next) injects via an MCP prompt message with no such limit.

2. goal_complete never reconciled the graph. drift detects graph/disk divergence reactively (only when someone runs it) and never authors a fix. A goal that introduced a new source module left the graph stale until a human noticed. Running detection against archkit's own 18 archived goals found 4 real, still-unfixed gaps (install-hooks.mjs, archkit-pretooluse-hook.mjs, warmup.mjs not in their clusters' .graph).

The node graph — not a richer goal archive — is the load-bearing context worth feeding. See [[0003-lock-the-expanded-cgr-lifecycle-state-model-and-rename-the-s]] for the lifecycle this builds on.

## Decision

Treat the node graph as the durable knowledge surface and close the loop in BOTH directions across a goal's life:

**Slice-in (read, at goal start).** renderPayload appends a goal-scoped graph neighborhood (new graphSlice() in src/lib/goals.mjs), keyed on files-to-touch: each touched path → its INDEX node by basePath prefix → the matching per-file .graph node line (role + in/out flow) → the cross-reference edges touching those clusters. The agent gets related files + edges up front instead of guessing. Stays silent when no touched file maps to a node. This is strictly more signal in fewer tokens than "go run warmup."

**Budget bifurcation.** Keep PAYLOAD_BUDGET (3800) as the copy-paste//goal fallback ceiling (the slash-arg limit is real there). Add RELAY_PAYLOAD_BUDGET (9000) for the MCP-injected relay path (goal_next/goal_resume), which has no arg limit, so it carries the fuller slice + an untruncated source-ask. renderPayload takes the ceiling as an option, defaulting to the tight one.

**Propose-out (write, at goal complete).** runGoalComplete runs a best-effort reconciliation pass (detectGraphGaps): candidate files = files-to-touch ∪ git working-tree changes, minus anything already a node (the "established" membership gate), minus tests/.arch/non-code. Remaining files are PROPOSED as graph deltas — undocumented-file (add a node line to an existing cluster) or unmapped-area (new cluster). Proposals persist to .arch/graph-proposals/<slug>.json (writeGraphProposal) and surface in the completion result + a terse nextStep flag.

**Core principle — propose, never auto-merge.** archkit detects gaps mechanically; a human or the still-warm completing agent authors the node prose and accepts it. archkit NEVER auto-writes INDEX.md or a .graph, mirroring the boundary_propose/gotcha_propose idiom — a wrong node misleads every future warmup, so it stays human/warm-agent gated. Reconciliation is best-effort and never blocks marking a goal done.

## Consequences

Easier: each completed goal leaves the graph richer for the next, so the per-area cost of "which files are related" is paid once and amortized; warmup/preflight context improves as a side effect of doing the work; graph drift is caught at completion (while context is warm) instead of accumulating until a manual drift run.

Constrained: the slice/reconciliation only work where a project keeps INDEX.md + clusters/*.graph populated — both degrade to no-ops on a missing/empty graph (safe on greenfield). detectGraphGaps relies on basePath-prefix matching, so a sloppy INDEX basePath mis-attributes files. unmapped-area's suggestedCluster is a coarse path-segment guess. Reconciliation fires only on goal_complete (not testing/abandon), by deliberate choice — only 'done' work should reshape the graph.

Still open (not yet built): (1) an accept tool (archkit_graph_accept) to turn an authored node line into an appended .graph edit + drop the proposal, so acceptance is one call not a manual edit; (2) surfacing listGraphProposals at warmup so pending graph debt is visible rather than a silent folder. Until (1)/(2) land, the write-back half stops at a persisted proposal the warm agent appends by hand.
