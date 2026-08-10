# MCP tool surface — description contract and moved detail

Tool descriptions in `src/mcp/tools.mjs` are loaded into every agent's context
whether or not the tool is ever called. They are archkit's largest fixed token
cost, so they are held to a contract and a byte ceiling.

## The contract

Every description is written in this shape:

1. **Lead line** — one sentence saying what the tool does.
2. **Call-shaping detail only** — a fact earns its place only if it changes how
   the tool is called or how its result is read (required args, refusal
   conditions, dry-run defaults, heuristics that must not be trusted blindly).
3. **`Trigger:`** — the distinguishing condition under which to reach for it.
4. **Disambiguation pointer** — for confusable neighbours, one clause naming the
   other tool and the axis that separates them.

Rationale, history, and design narrative do **not** live in descriptions. They
live in the ADRs under `.arch/decisions/`, and descriptions cite them by number
(e.g. `ADR 0013`) rather than restating them.

Return shapes are not enumerated either: the result envelope is right there in
the agent's context after the call. Only fields that must be *acted on* are
named (e.g. `bucketCompletion`, `requiredReading`, `pendingEscalations`).

## Byte ceiling

**800 bytes per description.** Enforced by `tests/mcp-tool-descriptions/run.mjs`,
which also asserts the total across the surface stays at or under the
post-diet budget. Both numbers fail loudly rather than drifting.

Baseline before the diet: 49 tools, 50 581 bytes total, largest 2 821.
After: 49 tools, 24 326 bytes total, largest 796 — a 52% cut.

## Where the moved prose went

| Was in a description | Now lives in |
| --- | --- |
| CGR lifecycle states, `testing` / `on-hold` semantics | ADR 0003 |
| Graph flywheel: propose at complete, accept later | ADR 0004 |
| Project feature sets, queue-vs-project relay routing | ADR 0010, 0012 |
| Conductor/worker orchestration, parallel lanes, tier-3 conflict escalation | ADR 0013 |
| Board as an append-only event log, fission-not-replay | ADR 0014 |
| Attention gradient, wind-down threshold, lease policy | ADR 0015 |
| Auto-appended finalization goal | ADR 0018 |
| Goal-placement reconciliation (status is truth, folder is cache) | ADR 0020, 0021 |
| API-doc hard gate at PreToolUse | ADR 0022 |
| Lane convergence / rebase-onto-tip | ADR 0023 |
| Per-lane post-integration verify command | ADR 0024 |
| PR-gated bucket landing | ADR 0025 |

Detail with no ADR home, recorded here instead:

- **`archkit_review_staged` file filter.** Staged paths are kept when the
  extension is a known code file: `.js .jsx .ts .tsx .mjs .cjs .vue .svelte
  .astro .swift .kt .kts .java .scala .go .rs .py .rb .php .ex .exs .cs .fs .vb
  .c .h .cpp .cc .hpp .m .mm .dart .lua .pl .r .jl .clj .cljs .sh .bash .zsh
  .ps1`. Lockfiles, images, markdown, and binaries are skipped, which is why a
  staged-but-non-code change reports `files: 0`.
- **`archkit_review` disable families.** `.arch/config.json → review.disable`
  takes finding `type` values (e.g. `http-client`, `db-efficiency`). The
  architecture families `import-hierarchy`, `import-boundary`,
  `boundary-violation`, and `reserved-word` ignore the disable list.
- **`archkit_resolve_warmup` warning codes.** W011 major dependency with no
  playbook; W012 unpopulated `[VERSION]` / `[BASE_URL]` stub in
  `.arch/apis/*.api`; W013 orphaned entry in `.arch/extensions/registry.json`;
  W014 auto-drafted ADR proposal awaiting review; W015 persisted graph-proposal
  awaiting `archkit_graph_accept`. W011–W013 only run under `deep: true`.
- **`archkit_boundary_check` violation rule.** An import is a violation when the
  *source file* matches a rule's source-glob **and** the *imported module*
  matches that rule's target-glob. Import and require are both parsed for
  JS/TS-family files; `from … import` and bare `import` for Python. Other
  languages return zero violations by design rather than guessing.
- **`archkit_verify_wiring` exclusions.** Entry-point filename patterns
  (`*.controller|route|router|middleware|handler.*`, `app.*`, `index.*`),
  `node_modules`, `dist`, dotfiles, and `.test.` / `.spec.` files are skipped.
  Findings are `DEAD_CODE` (no importers at all) or `INTERNAL_ONLY` (importers
  only inside the file's own directory).
- **`archkit_goal_complete` bucket landing.** `bucketCompletion` carries
  `{ bucket, project, branch, mainline, mainlineSource, landing, ciCd,
  mergeGuidance }`. `landing` is `pull-request` when a CI provider is configured
  at `.arch/config.json → cgr.finalize.ciCd`, otherwise `direct-merge`. The
  mainline target comes from `cgr.mainline`, else detected `main`/`master`,
  defaulting to `main`.
- **`archkit_worklog` data sources.** Completed goals are read from the
  un-consolidated `done/` root, then `done/archive/`, then `done/digest/` as a
  sparse fallback; entries are deduped by slug.
- **Two senses of "reconcile".** `archkit_goal_reconcile` is *placement* — it
  moves goal files between `.arch/goals/` folders and never touches file content
  or git. `archkit_board_conflict` is *merge* — conflicting file content between
  two lanes, escalated into a `merge-reconcile-*` CGR. Lane convergence
  (rebase-onto-tip before a lane lands) is a third, separate thing.
