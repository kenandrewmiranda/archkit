# 0024. Resolve a concrete post-integration verify command per lane and record its outcome on the merged event

- **Date**: 2026-08-02
- **Status**: Accepted
- **Tags**: cgr, conductor, verification, board

## Context

Conductor step 5 said "drain the merge queue, verifying after EACH" but named no command and recorded no result, so verification was advisory prose with no artifact.

Two concrete gaps:
1. The CGR test gate (verify-command) runs at archkit_goal_complete INSIDE the worker's worktree, PRE-merge. A green worktree does not prove a green integration branch after the lane lands — the whole point of the convergence stage (ADR 0023) is that the worker's base was stale.
2. Nothing appended a `merged` event at all, so the folded board could not tell a verified integration from an assumed-green one. Silence read as success.

## Decision

Make both halves concrete — RESOLVE a command, then RECORD the result.

RESOLVE (read half). `resolveVerifyCommand(slugs, { verifyOf, projectCommand })` in src/lib/board.mjs is the fallback chain, applied PER CGR and unioned per lane:
  1. the CGR's own `verify-command` frontmatter (scoped to its slice), else
  2. the project test command (package.json scripts.test, via detectTestCommand — DETECTION only), else
  3. none — source "none", `unresolved: true`.
Each lane's integration point in laneConvergencePlan now carries `integration.verify` (a concrete string), `verifySource` (cgr|project|mixed|none), `verifyBySlug`, and `verifiable`. A lane whose CGRs resolve to different commands gets their de-duped union joined with `&&` (source "mixed") — all must pass. An unverifiable lane is FLAGGED in the rendered plan ("NO command resolved… record it as unverified rather than assuming green"), never left silently blank. The plan gained explicit VERIFY and RECORD steps.

RECORD (write half). `recordMerge(archDir, {...})` appends one `merged` event per CGR in the integration point, each carrying a normalized verification payload. The status is DERIVED, never taken on trust: no command -> unverified (no-verify-command); command + passed:true -> green; + passed:false -> red (verify-failed); command with no reported result -> unverified (verify-not-run). A `merged` event with no payload folds to unverified, never to green. New MCP tool `archkit_board_merged` is how the conductor reports it (archkit still runs no git and no tests).

SURFACE. sessionState gained a `merged` slice (green|red|unverified per CGR); conductorPlan gained `unverifiedMerges` + counts.unverified_merges, and integration debt now keeps archkit_conductor non-idle. The /mcp__archkit__conductor prompt renders it as loop step 6.

archkit is still instruct-not-act: board.mjs imports detectTestCommand (a package.json read) but never runTests, spawns nothing, and runs no git.

## Consequences

Easier: a later pass can see what it inherited — "merged with no green verify" is now a visible ledger instead of an assumption. Each lane gets the RIGHT command (a CGR scoped to `vitest run src/auth/` keeps it) rather than one plan-wide command that only applied when every CGR agreed.

Harder / constrained:
- The conductor must call archkit_board_merged after each integration point. A merge that is never recorded is invisible to the board — the gap moves from "unverified merges look green" to "unrecorded merges look unmerged", which is the safer failure direction but still requires the discipline.
- `merged` is now a real lifecycle terminal: a recorded CGR leaves merge_queue. Anything that appended merged events casually would change board state.
- sessionState grew from 8 to 9 slices; consumers asserting an exact key set need updating (tests/cgr-board did).
- laneConvergencePlan's old single `verify` option is kept only as a back-compat alias for `projectVerify`.
- Recording an unverifiable merge is CORRECT and preferred over not recording it — the debt ledger is the point.
