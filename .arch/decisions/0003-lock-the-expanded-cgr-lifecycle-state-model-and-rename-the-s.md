# 0003. Lock the expanded CGR lifecycle state model and rename the set-aside state to `on-hold`

- **Date**: 2026-06-07
- **Status**: Accepted
- **Tags**: cgr, goals, lifecycle, state-model, naming

## Context

Conference feedback on the CGR (Clear Goal Run) relay loop asked for more states. The reported failure mode: fast mass-edits get marked `goal_complete` the moment the edit lands — before verification — which hides unverified work in `done/` and lets debt accumulate silently mid-sprint. The raw proposal floated folders `pending/deferred/testing/completed` with the MCP scanning pending→testing→deferred and consolidating completed into a per-session/day digest.

Two problems had to be settled BEFORE any code (this goal touches no source — design lock only), because four downstream goals (cgr-testing-state, cgr-backlog-ordering, cgr-consolidation-digest, cgr-states-mcp-wiring) all depend on these names being final:

1. Today's state vocabulary in `src/lib/goals.mjs` is `planned` (default written status) → `in-progress` (STATUS_ACTIVE) → `done` (STATUS_DONE), plus `abandoned`. There is no state for "edit applied but not yet verified," so the relay prematurely completes.

2. The word `deferred` is ALREADY taken. `archkit_goal_defer` + `goals/proposed/<hash>.json` mean "parked follow-up PROPOSAL surfaced during a session, awaiting human promotion" (see `proposedDir`, `writeGoalProposal`, `promoteGoalProposal`). That is NOT the user's intended meaning of "deliberately set aside an ACTIVE goal." Reusing `deferred` for the set-aside state would collide with established proposal semantics.

Prior ADR 0002 established that the relay holds zero in-memory arch state (stateless per-call reads), so persistence of any new state must live on disk in the goal file — nothing to invalidate, but nothing cached to lean on either.

## Decision

Lock the CGR lifecycle to these `status:` frontmatter values (the status field is the single source of truth for a goal's state):

- `pending` — decomposed and queued, not started. (Reconciles today's `planned`; `planned` is accepted as a back-compat alias so existing goal files keep parsing.)
- `in-progress` — actively being worked. (Unchanged from today's STATUS_ACTIVE.)
- `testing` — NEW. Edits applied, verification still pending. This is a PERSISTENT state that survives `/clear`: it replaces today's premature `goal_complete`. A goal sits in `testing` until a (possibly later, fresh) session actually runs the verify-command/exit-criteria green; only then does it advance to `completed`. The Stop hook keeps guarding a `testing` goal — it is NOT done.
- `completed` — terminal success. (Reconciles today's `done`.)
- `abandoned` — terminal drop without success. (Unchanged.)
- `on-hold` — NEW. The deliberately-set-aside ACTIVE goal. This is the chosen rename that resolves the `deferred` collision: `on-hold` (not `deferred`/`blocked`) is distinct from `proposed`/`deferred` (which stay reserved for follow-up PROPOSALS) and from `depends-on` blocking (which the relay already resolves automatically). `on-hold` means a human/agent chose to park real, queued work.

Canonical happy path: `pending → in-progress → testing → completed`. Side states: `abandoned` (terminal) and `on-hold` (resumable).

STORAGE — status in frontmatter is authoritative; folders are minimal and exist only where physical separation earns its keep:
- `goals/` root holds `pending`, `in-progress`, and `on-hold` (distinguished by their `status:` field, NOT by folder).
- `goals/testing/` — the ONE new loud dedicated folder. Verification debt gets its own visible drawer so a fresh session can see and drain it. We explicitly REJECT a folder-per-state scheme (no `pending/`, `on-hold/`, etc.) — that would fight the status-is-truth rule and multiply move operations.
- `goals/done/` — terminal archive for `completed` and `abandoned` work (existing folder retained). Raw CGR files are preserved verbatim under `goals/done/archive/` (wired by cgr-consolidation-digest) so full context stays recoverable after consolidation.
- `goals/proposed/` — UNCHANGED. Holds follow-up proposal `.json` files written by `archkit_goal_defer`. This is the `proposed`/`deferred` concept and is explicitly NOT a lifecycle state. `goal_defer`/`promoteGoalProposal`/`goal_review` semantics are left fully untouched by this rename.

## Consequences

Easier:
- The premature-completion bug now has a named home: mass-edits land in `testing` (visible debt) instead of being hidden in `done/`. A later fresh session drains `goals/testing/` by actually running verify before completing.
- Downstream goals can build against fixed names: cgr-testing-state implements the `testing` status + `goals/testing/` folder + transitions; cgr-backlog-ordering keys its threshold knob off the `testing` backlog; cgr-consolidation-digest archives raw CGRs under `goals/done/archive/`; cgr-states-mcp-wiring surfaces `testing`, `on-hold`, and the digest in tools/prompts/README.
- No `deferred` ambiguity: `on-hold` (active goal parked) and `proposed`/`deferred` (follow-up proposal awaiting promotion) are now orthogonal concepts with separate words and separate storage.

Harder / constrained:
- `goals/testing/` is the only sanctioned per-state folder. Future requests for `pending/` or `on-hold/` folders should be refused unless this ADR is superseded — status frontmatter is the source of truth.
- A vocabulary reconciliation is now owed in code: `planned→pending` and `done→completed`. This must be done with back-compat (alias `planned`/`done` on read) so existing `.arch/goals/*.md` and `goals/done/*.md` files keep parsing; the rename is a code task for cgr-testing-state / cgr-states-mcp-wiring, NOT this design-lock goal.
- The Stop hook's done-detection must treat `testing` as NOT-done (keep guarding); cgr-testing-state owns that wiring.

No source code was changed in this goal — this ADR is the deliverable. The `deferred`/`proposed` proposal flow (`archkit_goal_defer`, `goals/proposed/`) is deliberately left exactly as-is.
