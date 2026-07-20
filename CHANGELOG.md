# Changelog

## Unreleased — API-doc hard gate + goals-layout reconcile

Two independent, additive bodies of work. An **API-doc hard gate** stops any edit against an undocumented external API before it lands, and a **goals-layout reconcile** treats the goals folder as a derived cache of each goal's `status` frontmatter and keeps the two in sync automatically. Both are safe: the gate is a no-op when disabled and fails open, and placement fixes are always reported.

### Added — API-doc hard gate (ADR 0022)

Enforces archkit's rule that **if an API is involved, a real doc or SDK must be referenced before you code against it** — at the keystroke, not caught later in review.

- **PreToolUse hard gate.** On an `Edit`/`Write`/`MultiEdit` the gate runs **before** the edit lands and returns `permissionDecision: 'deny'` (nothing is written) when any involved API is **uncleared**. It rides archkit's already-installed PreToolUse guardrail bin (one hook per event), runs before the boundary gate, and **fails open** so a gate bug never bricks edits.
- **Detect → clearance.** A heuristic **API-involvement detector** (`src/lib/api-detect.mjs`) scans the post-edit content; each detected API is checked against the **clearance registry** (`src/lib/api-registry.mjs`), backed by a per-project `.arch/apis.json` manifest that is the single source of truth for what's cleared. Any one uncleared API blocks the whole edit, and the deny message names each offender and prints both unblock commands verbatim.
- **Doc-or-override are the only clearances.** An API clears one of two ways — a registered real doc/SDK reference (`archkit_api_register <id> --doc <ref>`) or an explicit human override with a reason (`archkit_api_override <id> --reason`). Unknown/pending stays blocked.
- **New MCP tools** — `archkit_api_register` (clear an API with a doc/SDK reference), `archkit_api_override` (explicit human override + reason), `archkit_api_list` (show manifest clearance status).
- **No-op when disabled + source-only.** When `apiGate.enabled` is `false` the gate is a complete no-op. Only code source files are gated (extension allowlist); docs, `.arch/**`, config, and lockfiles are never blocked. `apiGate` defaults **enabled** — projects with the PreToolUse hook installed begin enforcing on upgrade (per-project opt-out is a one-flag change).

### Added — placement reconcile at warmup (ADR)

- **`archkit resolve warmup` reconciles goal placement.** On warmup the goals folder is scanned and each CGR file is auto-fixed into the folder its `status` frontmatter dictates (e.g. a `status: on-hold` goal sitting in `queue/` is moved to the on-hold folder). The folder is a **derived cache**; `status` is authoritative. Moves are **reported, not silent** — warmup surfaces what it relocated so nothing shifts under you unnoticed.
- **New `archkit_goal_reconcile` MCP tool.** Runs the same reconcile on demand as a **dry-run** (preview the moves) or **apply** (perform them), so you can reconcile placement outside the warmup path.
- **Tier-2 staleness triage is advisory-only.** A lightweight check compares the goals folder against chat/board state to flag cross-project cruft. It **reports and never mutates** — staleness is a signal for a human, not an automatic move.
- **Path-traversal hardened.** The reconcile destination derived from a goal's slug is validated so a crafted slug can't escape the goals folder.

## v1.17.0 — 2026-07-19 — ambiguity-gated conductor triage + status-line segment

Two operator-facing upgrades to the CGR relay, plus a distribution change while npm publishing is paused. Supersedes the never-published 1.16.0 (its unified-relay work is included).

### Added — ambiguity-gated conductor triage (ADR 0019)

- **The conductor stops mindlessly picking the next queue number.** New `triageNextGoal` generalizes goal selection across every board-ambiguity axis — ungrouped queue, project tracks, testing backlog, on-hold work — returning `single` (one obvious thing → auto-pick, the frictionless loop unchanged), `choice` (mixed board → ask which axis to advance), `none` (nothing eligible → offer the intake/plan path), or `resume` (an in-progress goal pre-empts). On `choice` the relay defers `startGoal` and drives an `AskUserQuestion` over the board slices instead of guessing.
- **`cgr.triageMode` knob** (`ambiguity` default · `always` · `off`), resolved tolerantly from `.arch/config.json`; `off` restores byte-for-byte silent auto-pick.
- **SessionStart board snapshot** — a compact one-line `queue N (next <slug>) · testing N · projects (label:count …) · on-hold N` now surfaces at session start for the common single-goal case (previously the board only rehydrated for live parallel state). Omitted cleanly when no goals exist; on a mixed board it nudges toward `/clear` + `/mcp__archkit__conductor`.

### Added — `archkit statusline` CLI

- **CGR heads-up display in the Claude Code status line.** New `archkit statusline` subcommand emits a compact segment (e.g. `⛏ <active-goal> (N queued)`) by reading `.arch/` on disk — the status line is a plain shell subprocess and can't speak MCP. Silent outside an archkit project or when no goal is active; degrades gracefully on absent/malformed `.arch/`. Add the documented snippet to your status-line command to enable.

### Changed — distribution paused on npm

- **Install from GitHub.** npm-registry publishing is on an unresolved account-side hold (403), so `release.yml` auto-publish is disabled and the registry is pinned at 1.15.0. archkit is pure ESM with no build step: `npm i -g github:kenandrewmiranda/archkit` (or `#v1.17.0`). Claude Code plugin users are unaffected — the plugin already installs from GitHub.

## v1.16.0 — 2026-06-27 — unified relay + auto-finalization

Collapses the CGR relay to a **three-command workflow**: `/mcp__archkit__intake` → `/clear` → `/mcp__archkit__conductor`. Previously the loop needed both `/goal_next` (single goal) and `/conductor` (parallel lanes); now `conductor` is the single advance command and picks the mode automatically. Plus a configurable finalization goal that auto-appends release chores to every batch.

### Changed

- **`/mcp__archkit__conductor` is the one relay command.** It folds the board and auto-selects: with a single eligible goal it loads that goal's payload to work in the foreground (the former `goal_next` behavior); with ≥2 parallel lanes — or workers in flight / a non-empty merge queue / expired leases — it runs the CGR 2.0 orchestration pass (spawn worktree-isolated workers, deep-review exceptions, drain the dependency-ordered merge queue verify-after-each).
- **New `/mcp__archkit__intake` prompt** — a first-class entry point that guides decomposing a sprawling ask into goals + lanes via `archkit_goal_intake`.
- **The SessionStart nudge, Stop-hook, and all relay guidance now point at `/conductor`** instead of `/goal_next`.

### Removed

- **`/mcp__archkit__goal_next` is removed** — its behavior is fully absorbed by `/conductor`. (`goal_resume`, `goal_status`, and `goal_review` remain as secondary commands.)

### Added — auto-appended finalization goal (`cgr.finalize`)

- **Every CGR batch can end with a wrap-up goal** that runs **last and solo** (an exclusive barrier depending on every batch goal): update the changelog, refresh docs, finalize commits with notes, and the opt-in outward steps (push / set up a release / deploy to development). So a sprawling ask always closes out its release chores in a fresh, focused context instead of tacking them onto the last feature goal.
- **One-time, per-project setup.** A project's first `archkit_goal_intake` appends nothing and instead surfaces a setup prompt; the agent asks you once (which steps + CI/CD), and the choice persists to `.arch/config.json` → `cgr.finalize` so it's never re-asked. Enabling **back-fills** the finalize goal onto the already-queued batch.
- **Configurable + opt-out.** New `archkit_finalize_config` MCP tool and `archkit finalize` CLI to read/toggle the feature, any individual step, and the CI/CD flavor (`none` / `github-actions` / `custom` + a deploy command). Defaults: changelog/docs/commit **on**, push/release/deploy-to-dev **off** (outward-facing actions are a deliberate opt-in). `enabled:false` turns the whole thing off.
- Consistent with archkit's rule that it **emits guidance, never runs git/deploy itself** — the goal carries the steps as exit-criteria; the agent does the local ones and instructs you for the rest.

## v1.15.0 — 2026-06-23

Three bodies of work land together: **CGR 2.0** parallel-lane orchestration (**ADRs 0013–0015**), the **skills → playbooks** rename (**ADR 0016**), and a **CLI dispatch fix**. Everything is additive and back-compat — existing `.arch/` projects and CLI usage keep working unchanged.

### Added — CGR 2.0 orchestration

- **Conductor/worker parallel lanes** with a persistent **append-only board** (`.arch/board/events.ndjson` folded to a derived `session_state`), **fission-based resume** (partial-complete split behind a hard verify gate), and **attention-gradient wind-down** (lease/completion policy knobs). New tools: `archkit_conductor`, `archkit_goal_fission`, `archkit_goal_handoff`, plus a `PreCompact` hook and `SessionStart(clear|compact)` rehydration that reclaims orphaned leases.
- **Intake emits a dependency DAG + predicted ownership**, partitioned into parallel lanes (cohesion by feature, disjoint `owns` globs, `exclusive` barriers).
- **AGENTS.md as the canonical orientation core** — `archkit export agents` compiles it (with a token ceiling) and the cursor/windsurf/copilot/aider targets derive from it.

### Changed — playbooks rename (skills → playbooks)

Resolves the namespace collision with Claude Code's first-class Agent Skills (`.claude/skills/`, `SKILL.md`). The operator confirmed the name before the rename; the change is **back-compat by design**.

### Changed

- **Canonical layout is now `.arch/playbooks/<id>.playbook`.** New scaffolds (`archkit init`, `archkit_init_generate`, the wizard) emit `.playbook` files into `.arch/playbooks/`. A new central resolver (`src/lib/playbooks.mjs`) is the single place that locates units; every reader (warmup, stats, drift, sync, gotcha, preflight, MCP resources) goes through it.
- **MCP, CLI, wizard, and docs vocabulary** now say "playbook". `INDEX.md` uses `## Playbooks → Files` / `## Keywords → Playbooks` headers (the parser still accepts the old `Skills` headers).
- **New MCP resource `archkit://playbook/{id}`** (the old `archkit://skill/{id}` stays as a deprecated alias). `resolve_warmup` summary gains a `playbooks` count (the `skills` key is kept as a back-compat alias).

### Back-compat (no migration required)

- **Legacy `.arch/skills/<id>.skill` files still load** everywhere — the resolver reads both layouts, with `.playbook` shadowing a same-id `.skill`. MCP tool param names (`skill`, `skills`), JSON output keys (`skills`, `orphaned-skill`, `invalid_skills`), and the `--skills` CLI flag are unchanged so existing callers and tests keep working.
- **`archkit migrate`** now consolidates a project: renames `.arch/skills/*.skill` → `.arch/playbooks/*.playbook`, moves the README, and removes the drained legacy dir (skips any unit that already exists as a `.playbook`).

### Fixed — CLI dispatch no longer falls through to the wizard

- **Unrecognized input stopped silently launching the interactive scaffold wizard.** `archkit upgrade` (and the dash-typed `-upgrade` / `--upgrade`) now route to the real **`update`** command; `--version` / `-v` and `--help` / `-h` are handled; and an unknown command word prints a **did-you-mean** suggestion and exits non-zero instead of opening the wizard. A bare `archkit` and recognized wizard flags (`--claude`) still launch the wizard. New `tests/cli-dispatch` suite locks this in.

## v1.10.1 — 2026-06-09

Closes the **CGR graph flywheel** (**ADR 0004**): completed goals now feed the node graph instead of accumulating as a write-only `goals/done/` archive. The graph (INDEX.md + `clusters/*.graph`) — the surface `resolve_warmup`/`resolve_preflight` actually read — gets richer as a side effect of doing the work, in both directions. Three follow-on CGRs shipped as one unit (the flywheel itself, the accept tool, and warmup surfacing — decomposed and run through archkit's own relay). Purely additive; degrades to a no-op on a missing/empty graph (safe on greenfield).

### Added — slice-in at goal start (read)

- **`renderPayload` now appends a goal-scoped graph neighborhood** (`graphSlice()` in `src/lib/goals.mjs`), keyed on `files-to-touch`: each touched path → its INDEX node by basePath prefix → the matching `.graph` node line (role + in/out flow) → the cross-reference edges touching those clusters. The relayed agent gets related files + edges up front instead of guessing. Silent when no touched file maps to a node. **Budget bifurcation**: `PAYLOAD_BUDGET` (3800) stays the tight `/goal` copy-paste ceiling; new `RELAY_PAYLOAD_BUDGET` (9000) carries the fuller slice + untruncated source-ask on the MCP-injected relay path (`goal_next`/`goal_resume`), which has no slash-arg limit.

### Added — propose-out at goal complete (write)

- **`archkit_goal_complete` runs a best-effort graph reconciliation** (`detectGraphGaps`): candidate files = `files-to-touch` ∪ git working-tree changes, minus established nodes, tests, and `.arch`/non-code. Remaining files are **proposed** as graph deltas — `undocumented-file` (append a node line to an existing cluster) or `unmapped-area` (needs a new cluster) — persisted to `.arch/graph-proposals/<slug>.json` (`writeGraphProposal`) and surfaced in the completion result. **Propose, never auto-merge**: archkit detects the gap mechanically; a human or the still-warm agent authors the node prose. Reconciliation never blocks marking a goal done.

### Added — `archkit_graph_accept` (close the write-back loop)

- **New MCP tool `archkit_graph_accept`** + `acceptGraphProposal()`: applies ONE authored node line from a persisted proposal to its cluster `.graph`, then drops the consumed gap (deleting the proposal once its last gap resolves) — the propose→accept partner to `archkit_boundary_propose`/`archkit_gotcha_propose`. The line is parse-validated **through `loadGraphCluster`** (the same loader warmup/preflight read with) on a throwaway probe; a malformed line is refused and the real `.graph` is left untouched. Only `undocumented-file` gaps are appendable; `unmapped-area` gaps are refused with guidance rather than guessed at. Brings the MCP tool count from 31 to **32**.

### Added — graph debt visible at warmup (W015)

- **`resolve_warmup` now surfaces pending graph-proposals** (`src/commands/resolve/warmup.mjs`): a new **W015** check reports the count + slugs of `.arch/graph-proposals/` via `listGraphProposals`, across the human banner (`log.warn` + `warnings`/`actions`) and the JSON/MCP result (`summary.pendingGraphProposals`), pointing at `archkit_graph_accept`. Silent when none pending, mirroring the W014 ADR-proposal check — so graph debt is visible, not a silent folder that rots.

### Tests

- Coverage added to **`tests/cgr-goals/`** (slice-in neighborhood, gap detection, propose/accept round-trip, parse-validation refusal) and **`tests/cgr-context-refresh/`** (W015 surfaces count+slugs in human + JSON; silent when clean). `tests/mcp-server/` and `tests/silent-success-audit/` updated for the new tool. Suite total: **49/49 green**.

## v1.10.0 — 2026-06-07

Expands the Clear Goal Run lifecycle from `planned → in-progress → done` into the full state model locked by **ADR 0003**: `pending → in-progress → testing → completed`, plus the side states `on-hold` and `abandoned`, and an incremental consolidation/digest phase. Born from conference feedback that fast mass-edits were getting `goal_complete`-d the instant they landed — hiding *unverified* work in `done/` and letting verification debt accumulate silently. Five goals shipped as one unit (decomposed and run through CGR's own relay — archkit dogfooding itself). Purely additive and backward-compatible: existing goal files keep parsing, and projects that never call the new transitions see the old flow unchanged. Brings the MCP tool count from 28 to **31**.

### Added — the `testing` state (verification debt made visible)

- **New `testing` lifecycle state** (`src/lib/goals.mjs`): edits applied, verification still *pending*. `markTesting()` relocates an in-progress goal into the one loud dedicated drawer `.arch/goals/testing/<slug>.md` and flips `status: testing` (stamping `testing-since`). A testing goal **survives `/clear` and stays guarded** by the Stop hook — it is *not* done. The hard test gate still applies on completion: `archkit_goal_complete` from `testing` runs the `verify-command` and refuses on red, so the goal stays parked until it's actually green. `ensureGoalsLayout`/`listGoals`/`loadGoal`/`getActiveGoal`/`nextEligibleGoal` all recognize the new drawer; `startGoal` relocates a resumed testing goal back to `goals/` root. New MCP tool **`archkit_goal_testing`** + CLI `archkit goal testing <slug>`.

### Added — the `on-hold` state (deliberately parked work)

- **New `on-hold` side state** resolves the `deferred` naming collision (ADR 0003): `on-hold` is a real, queued goal *deliberately set aside*, distinct from a `proposed` follow-up (`archkit_goal_defer`) and from `depends-on` blocking. Unlike `testing`, parking **releases** the relay guard so the session can end, and `nextEligibleGoal` won't auto-select it ahead of pending/testing work — it's offered only as a last-resort resume once nothing live is left. Lives in `goals/` root (status is the source of truth, no per-state folder). New MCP tool **`archkit_goal_hold`** + CLI `archkit goal hold <slug>`.

### Added — backlog-threshold ordering knob

- **`nextEligibleGoal` is now pending-first until verification debt accumulates**, then drains testing. Configurable via `.arch/config.json` → `cgr.backlogThreshold` (`{ count, ageDays }`, default `5` items / `7` days); either trigger flips selection to testing-first. Resume-in-progress and `depends-on` resolution still take precedence. Default out-of-the-box behavior is the simple pending-first batch — the threshold only fires when debt genuinely piles up.

### Added — incremental consolidation / digest

- **`consolidateGoals()`** folds terminal goals at the top of `goals/done/` into a dated per-day digest (`goals/done/digest/<YYYY-MM-DD>.md`) and preserves each raw CGR **verbatim** under `goals/done/archive/<slug>.md` (copy-then-unlink) so full context stays recoverable. Incremental (not gated on an empty queue) and idempotent. Fires automatically at queue-drain (`archkit_goal_complete`) and session-end (the Stop hook), and on demand via the new **`archkit_goal_consolidate`** tool + CLI `archkit goal consolidate`. `isGoalDone` checks `done/` **and** `done/archive/` so `depends-on` survives archival. Digests are recallable through `archkit_goal_list` (`listDigests`/`searchDigests`, mirroring the decisions read-side).

### Changed — MCP/prompt/doc wiring + status vocabulary

- **Surfaced the expanded lifecycle** across the agent-facing layer: three new MCP tools (28→31), a status-aware relay header (a resumed `testing` goal is framed as verification-draining), a `goal_next` description documenting the scan order, and a `goal_status` prompt that reports testing/pending/on-hold buckets plus the consolidation history. README gains a goal-lifecycle section + state diagram; the SessionStart digest, plugin marketplace, and tool-count assertions all updated.
- **Reconciled the status vocabulary to ADR 0003**: new goals are written as `pending` and completed goals as `completed`. The legacy values `planned`/`done` are accepted as **read aliases** (normalized in `statusOf`) so existing `.arch/goals/*.md` and `goals/done/*.md` keep parsing untouched. The `goals/done/` folder name is unchanged — only the `status:` value moved.

### Tests

- New suites: **`tests/cgr-testing/`**, **`tests/cgr-backlog/`**, **`tests/cgr-consolidation/`**, and **`tests/cgr-states-wiring/`** (on-hold transitions, guard release, ordering, the three new MCP handlers via `src/mcp/tools.mjs`, an end-to-end intake→testing→verify→complete→consolidate path, and status back-compat). `tests/mcp-server/` and `tests/silent-success-audit/` updated for the new tools; `tests/cgr-relay`, `tests/test-gate`, `tests/cgr-goals`, `tests/goal-proposals` updated for the archive/drain behavior and canonical status values. Suite total: **49/49 green**.

## v1.9.1 — 2026-06-06

Hardens the CGR guardrail surface and tightens the spec-derivation hot path. Five goals shipped as one unit: a **PreToolUse guardrail** (the flagship — block boundary violations *before* the edit lands), **portable/committable hook config**, **workspace-aware drift precision**, **request-scoped parse caching**, and **test coverage for the CGR relay prompts**. Purely additive.

### Added — PreToolUse guardrail (flagship)

- **`bin/archkit-pretooluse-hook.mjs`** (fail-open) backed by pure **`src/lib/pretooluse-eval.mjs`**: evaluates `Edit`/`Write`/`MultiEdit` *before* the write, reconstructs the post-edit file content, and blocks only **newly-introduced** imports that violate a `BOUNDARIES.md` BAN rule — returning a deny envelope with an actionable reason. Pre-existing violations and non-import edits pass through untouched (no false blocks). Registered as the 5th guardrail hook in `ARCHKIT_GUARDRAIL_HOOKS`, wired into `hooks/hooks.json` and emitted in portable form by `archkit_install_hooks`. This turns archkit from a PostToolUse reviewer into an up-front guardrail. New suite `tests/pretooluse-hook/` (banned→deny, clean→allow, precision, fail-open).

### Added — portable, committable hook config

- **Hooks now emit a portable command form** — `node $CLAUDE_PROJECT_DIR/bin/archkit-*.mjs` when archkit's bins live in the project tree (else the bare bin resolved via PATH), never a machine-specific absolute `/Users/...` path. `projectDir` is threaded through `renderGuardrailHooks`/`addGuardrailHooks`. `.claude/settings.json` is now **committable and shareable** across a team — un-gitignored (only `.claude/settings.local.json` stays per-machine). New portable-command assertions in `tests/hooks-status/`.

### Changed — drift precision in workspaces

- **Drift findings now carry a `confidence` level.** In workspace/monorepo layouts (detected via `resolveWorkspaceGlobs`), the source-tree-sensitive checks (`orphaned-skill`, `missing-source`, `missing-file`) are downgraded to `confidence:"low"` so they read as hints, not hard errors — they no longer drive the CLI exit code or the doctor's blocker escalation. `.arch/`-internal consistency checks (`orphaned-graph`, `orphaned-index-node`, `name-mismatch`) stay `high`. Drift summary now reports `byConfidence`. Regression test reproduces a nested-member orphaned-skill false-positive and asserts the downgrade.

### Changed — request-scoped parse caching

- **`createArchReader()`** (`src/lib/parsers.mjs`): a request-scoped memoizing reader (file reads + `SYSTEM.md`/`INDEX.md` parses), created fresh per warmup/drift invocation — **never** module-global (per ADR 0002, so successive calls in the long-running MCP server still reflect on-disk `.arch/` changes). Eliminates drift's duplicate `INDEX.md` parse by sharing one reader between `detectFindings` and the silent-success scan. New `tests/cgr-context-refresh/` assertion proves each `.arch` file is read+parsed exactly once per invocation.

### Tests

- CGR relay prompts (`goal_next`/`resume`/`review`/`status`) gain coverage in `tests/mcp-server/` — asserting `prompts/list` registration, the `goal_next` payload shape (relay header + rendered payload + in-progress side effect), and the empty-queue notice. Suite total: **45/45 green**.

## v1.9.0 — 2026-06-04

Hardens the Clear Goal Run loop on both ends: a **test gate** so "done" provably means tests pass, and **deferred-goal proposals** so follow-up work spotted mid-goal is captured and reviewed instead of lost. Adds 3 MCP tools (bringing the count to 28) and 1 MCP prompt. Purely additive — projects without a test script skip the gate gracefully, and the propose/review flow is opt-in.

### Added — CGR test gate

- **Auto-detected `verify-command`** (`src/lib/test-runner.mjs`): `archkit_goal_intake` now detects the project's test command — reads `package.json` → `scripts.test` and picks the runner from the lockfile (`pnpm` / `yarn` / `bun`, default `npm test`) — and stamps it onto every goal as `verify-command`. Best-effort and Node-first: returns `null` when there's no real test script (npm's `no test specified` placeholder counts as none), so projects without tests aren't blocked on a command that can't run. Per-goal override via the goal's `verifyCommand`/`verify-command` field.
- **Hard gate on `archkit_goal_complete`**: completion re-runs the `verify-command` and **refuses to complete a goal whose tests are red** (or whose command can't be launched). Red returns the failing output tail (`outputTail`, last ~2000 chars) plus a remediation `nextStep`; a passing gate stamps `tests-passed` / `tests-command` / `tests-at` onto the archived goal. The escape hatch for a genuinely-obsolete goal is `archkit_goal_abandon`, not completion.
- **Cheap preview on `archkit_goal_verify`**: runs the same command as a non-authoritative dry run and folds its result into the goal's `clean` signal, so the agent sees green/red (and keeps working on red) before calling complete. `runTests()` never throws — a spawn failure is reported as `ran:false` so callers degrade gracefully.

### Added — deferred-goal proposals (3 new MCP tools, 1 new prompt)

- **`archkit_goal_defer`** (tool #26): stash a follow-up the agent notices mid-session as a **proposed** goal in `.arch/goals/proposed/` — without derailing the active goal or touching the queue. Richer than the Stop-hook draft because the agent supplies a real title + exit-criteria. Dedupes by title hash.
- **`archkit_goal_promote`** (tool #27) / **`archkit_goal_dismiss`** (tool #28): the confirm/reject halves of the propose-and-confirm flow. `promote` turns selected proposals (`hashes:[...]` or `all:true`) into planned goals the CGR queue picks up and removes them from `proposed/`; `dismiss` discards them without promoting.
- **`/mcp__archkit__goal_review` prompt** (`src/mcp/prompts.mjs`): lists pending proposals and drives an `AskUserQuestion` multi-select so the user picks which to promote vs. dismiss; anything neither promoted nor dismissed stays pending.
- **Stop-hook auto-drafting** (`src/lib/goal-detector.mjs`): the Stop hook scans each turn for explicit deferral language ("out of scope for this PR", "follow-up: wire up retries", "in a separate goal", "circle back") and auto-drafts a proposal to `.arch/goals/proposed/<hash>.json`. Mirrors `decision-detector.mjs` — high-precision-over-recall: questions and exploratory "should we…?" phrasing are filtered out, since false positives spam the queue and erode trust faster than missed follow-ups hurt.

### Tests

- New suites `tests/test-gate/` (verify-command detection + the hard completion gate) and `tests/goal-proposals/` (defer/promote/dismiss + the deferral-language detector). `tests/mcp-server/` tool-count assertion updated 25 → 28; `tests/silent-success-audit/` and `tests/stop-hook/` updated for the new tools and auto-drafting.

### Docs

- README "Available tools" updated to **28**, documenting `archkit_goal_defer` / `archkit_goal_promote` / `archkit_goal_dismiss` and the `/mcp__archkit__goal_review` prompt; the CGR section gains "The test gate" and "Deferred-goal proposals" subsections.

## v1.8.3 — 2026-06-04

### Fixed — marketplace `install <slug>@<version>` ignored the pinned version

- **`apiRequest()` in `src/lib/marketplace.mjs` only appended query params for `GET`**, so the POST download caller silently dropped its `version` param — `archkit install <slug>@1.2.0` always fetched the latest release instead of the pinned one. The `/api/cli/*` surface reads params from the query string for both verbs (`GET /search?q=…` and `POST /configs/:slug/download?version=…`), so params are now appended for any method.

## v1.8.2 — 2026-05-30

### Fixed — drift false-positive orphaned-skill findings in workspace monorepos

- **`archkit drift` read only the root `package.json`** for the orphaned-skill check, so in pnpm/npm/yarn workspace monorepos — where runtime deps live in member manifests (`apps/*`, `packages/*`) — every skill whose package was declared in a workspace got flagged as orphaned. A repo whose root has only devDeps (turbo/eslint/etc.) tripped the check against an incomplete dep set (6 false positives observed in `arch-market`).
- New `src/lib/workspace-deps.mjs` (`collectDeps` / `collectWorkspaceDeps` / `resolveWorkspaceGlobs`) unions root + workspace-member deps. Detects workspaces from `pnpm-workspace.yaml` (`packages:` globs) and `package.json` `workspaces` (array or `{ packages: [] }`). Handles `apps/*` / `packages/*` enumeration and direct paths; skips `!` exclusions. `drift.mjs` now calls `collectDeps(cwd)`.
- Cascades to all three drift surfaces — the CLI, the `archkit_drift` MCP tool, and the doctor's `D-DRIFT` check all flow through `runDriftJson`, so the false positives clear everywhere. New `tests/drift-workspace` suite covers both workspace forms, direct paths, and a negative case proving genuinely-missing deps are still flagged.

## v1.8.1 — 2026-05-30

### Fixed — Stop hook output rejected by Claude Code

- **`bin/archkit-stop-hook.mjs` emitted `hookSpecificOutput.additionalContext`**, but `Stop` hooks have no such channel (it's only valid for `UserPromptSubmit`/`PostToolUse`/`PostToolBatch`/`SessionStart`). Claude Code rejected the entire payload on schema validation — so even the legitimate CGR relay guard (`decision:"block"`) silently failed to fire. The hook now uses the two valid Stop channels: working-memory sections (utilization + re-injected BOUNDARIES) ride in `reason` when the relay guard blocks, and surface as a non-blocking `systemMessage` otherwise. Tests in `tests/stop-hook` and `tests/cgr-relay` updated to assert the corrected shape.

## v1.8.0 — 2026-05-30

CGR fresh-context **relay loop** + **self-healing hook setup** + **ADR recall**, plus read-side symmetry across the surface: **goal verification/abandon**, **boundary capture**, and **MCP resources**. Makes the Clear Goal Run workflow frictionless (one keystroke to advance instead of copy-paste), able to detect/install its own guardrail hooks, and able to read back its own decisions/skills. Purely additive — the old paste-after-`/goal` flow still works as a fallback, and plain (non-CGR) sessions are unaffected. Brings tool count to 25, adds 3 MCP prompts, and adds MCP resources.

### Added — CGR relay loop

- **3 MCP prompts → slash commands** (`src/mcp/prompts.mjs`, registered in `src/mcp/server.mjs` via `registerPrompt`): `/mcp__archkit__goal_next` (marks the next eligible goal in-progress and injects its payload — the user's one keystroke after `/clear`, replacing the manual payload paste), `/mcp__archkit__goal_resume` (re-inject the active goal, no state change), `/mcp__archkit__goal_status` (read-only queue orientation). These are user-typed commands; the agent cannot trigger them (they pair with `/clear`).
- **`in-progress` goal lifecycle** in `src/lib/goals.mjs`: `startGoal` / `getActiveGoal` / `nextEligibleGoal` (honors `depends-on`) + a turn-cap loop-state (`.arch/goals/.loop-state.json`).
- **Goal-aware Stop hook** (`bin/archkit-stop-hook.mjs`): while a goal is in-progress, blocks stopping (`decision:"block"`) with the unmet exit-criteria as the reason, until the agent calls `archkit_goal_complete`. Safety valves: question-to-user detection (won't trap a genuine question) and a per-goal turn cap (`RELAY_TURN_CAP`, or `max-turns` frontmatter). Naturally scoped — only fires for goals started via the relay.
- **Guidance glue**: the SessionStart digest and the `archkit_goal_intake` / `archkit_goal_complete` / `archkit_goal_payload` descriptions + `nextStep`s now steer the user into the relay (`/clear` → `/mcp__archkit__goal_next`), with the payload retained as fallback.

### Added — `archkit_install_hooks` + D-HOOKS check

- **`archkit_install_hooks`** (tool #21): checks whether the four v1.6 guardrail hooks (SessionStart, Stop, PostToolUse, UserPromptSubmit) are wired into Claude Code, and installs the full set. Default = **emit mode** (returns the exact `{ hooks }` config for the agent to merge via Edit, so the user sees the diff); `apply:true` writes them into the **project** `.claude/settings.json` (idempotent, preserves existing hooks, never touches the global user file). No-op when the archkit plugin is enabled.
- **`archkit_doctor` gains D-HOOKS**: doctor now flags when the guardrail hooks aren't installed — closing a real blind spot. Previously doctor could report all-green while `.arch/` did nothing because no hook was wired to fire it. The MCP layer is the only surface that can detect this (it's connected regardless of hook wiring).
- Fixes a long-standing gap: `archkit init --install-hooks` predates the v1.6 guardrail hooks and only wires a git pre-commit hook + the legacy PreToolUse claude-hook + SessionStart. The new install path wires the complete set, including the Stop hook the relay guard needs.

### Added — `archkit_decisions_search` (ADR recall)

- **`archkit_decisions_search`** (tool #22): searches/lists past ADRs in `.arch/decisions/`. `archkit_log_decision` only ever **wrote** decisions — nothing read them back, at any layer (the CLI `decisions` command only supported `log`). This closed archkit's institutional-memory loop: `query` gives keyword-ranked results (title/tags weighted over body); omitting it lists recent ADRs; optional `status`/`tags`/`limit`. Carries the silent-success contract (`decisionsNote` when empty). Also adds `archkit decisions list` / `archkit decisions search` CLI subcommands.
- **`archkit_resolve_preflight` now surfaces `relatedDecisions`**: before changing a feature, preflight recalls ADRs mentioning it (with `relatedDecisionsNote` explaining an empty result), so settled choices aren't re-litigated — especially valuable in the fresh-context relay, where prior reasoning is gone from the window.

### Added — capture symmetry, goal verification, and MCP resources

- **`archkit_goal_verify`** (tool #23): gathers *evidence* a goal is done without auto-completing it — echoes exit-criteria as a checklist and adds objective signals (which files-to-touch are modified in git; what a staged review finds). Hardens the relay, whose Stop-guard otherwise trusts the `goal_complete` call blindly.
- **`archkit_goal_abandon`** (tool #24): drops a goal *without* marking it done — archives to `done/` with status `abandoned` (distinct from completed), clears the relay turn-cap, releases the guard, and returns the next goal. For obsolete/mis-scoped goals.
- **`archkit_boundary_propose`** (tool #25): the capture-symmetry partner to `archkit_gotcha_propose` — queues a proposed `BAN: source -> target` to `.arch/boundary-proposals/` for human review (validates glob syntax; no-ops if already enforced). Human-gated by design: archkit never auto-merges a BAN, since a wrong one blocks real work.
- **MCP resources** (`src/mcp/resources.mjs`): `.arch/` artifacts exposed as `@archkit:…` handles so the agent can reference source files without a tool round-trip — `archkit://system`, `archkit://index`, `archkit://boundaries`, and templated `archkit://skill/{id}` + `archkit://decision/{number}` (the templates enumerate available skills/ADRs via list callbacks). Cheaper than tool calls for repeated reads in long sessions.

Files: `src/mcp/prompts.mjs` (new), `src/mcp/resources.mjs` (new), `src/lib/hooks-status.mjs` (new), `src/commands/hooks.mjs` (new), `src/lib/decisions.mjs` (new), `src/lib/goals.mjs`, `src/lib/claude-settings.mjs`, `bin/archkit-stop-hook.mjs`, `bin/archkit-session-start.mjs`, `src/mcp/server.mjs`, `src/mcp/tools.mjs`, `src/commands/goal.mjs`, `src/commands/doctor.mjs`, `src/commands/decisions.mjs`, `src/commands/resolve/preflight.mjs`, `src/commands/boundary.mjs`, `src/mcp/server.mjs`. Tests: `tests/cgr-relay/` (10), `tests/hooks-status/` (10), `tests/decisions-search/` (9), `tests/goal-verify-abandon/` (6), `tests/boundary-propose/` (4), `tests/mcp-resources/` (2), plus updates to `tests/doctor/`, `tests/mcp-server/`, `tests/silent-success-audit/`.

## v1.7.2 — 2026-05-25

v1.8 work item C from [docs/roadmap/v1.8.md](docs/roadmap/v1.8.md). Adds `archkit doctor` — the workflow logistic gauge that aggregates structural + intent checks into a single envelope, exposed as both CLI (`archkit doctor`) and MCP tool (`archkit_doctor`). Pure additive; no existing caller breaks.

### Added — `archkit doctor` / `archkit_doctor`

Wraps `archkit_resolve_warmup` (quick mode) + `archkit_drift` and layers three new intent checks that ask whether `.arch/` is actually load-bearing:

- **D-INTENT-1 — skill gotcha coverage**: flags `.skill` files that exist on disk but carry zero real `WRONG:/RIGHT:/WHY:` patterns (skeleton placeholders like `WRONG: [example]` are subtracted). These files contribute nothing to `archkit review` and are pure dead-end.
- **D-INTENT-2 — BOUNDARIES.md BAN coverage**: walks the working tree (capped 5000 code files, skipping `node_modules`/`.git`/`dist`/etc.) and flags `BAN: source -> target` directives whose `source` glob matches no file. Could be future-protecting, could be stale — surfaced for human triage instead of silently ignored.
- **D-INTENT-3 — CGR goal quality**: scans active goals in `.arch/goals/` and flags any with vacuous `exit-criteria` (<8 chars, or generic phrases like "ship it", "done", "fix") or no `required-reading`. A weak goal trains the agent that exit-criteria don't mean anything.

Response shape: `{ pass, checks:[{id,name,status,detail}], blockers, warnings, warningsNote, summary, intent:{emptySkills, unappliedBans, weakGoals}, sources:{warmup, drift}, nextStep }`. Carries the v1.7.1 silent-success contract: clean state sets `warningsNote` ("Ran N aggregated check(s) — all clean"); a non-clean state populates `warnings[]` with `[warmup]` / `[drift]` / `[intent]` source prefixes; missing-source drift escalates to `blockers[]` and `pass: false`.

Why `doctor` and not "more warmup checks"? Warmup runs at session start and is structural ("can I trust .arch/ at all?"). Doctor runs on demand and is intent-checking ("does the rich content of .arch/ actually fire?"). Different question, different cadence — doctor doesn't belong in the session-start hot path.

Files: [`src/commands/doctor.mjs`](src/commands/doctor.mjs) (runner + CLI), [`src/mcp/tools.mjs`](src/mcp/tools.mjs) (`archkit_doctor` registration, brings tool count to 20), [`bin/archkit.mjs`](bin/archkit.mjs) (`archkit doctor` subcommand dispatch). Composition fix: doctor dynamic-imports `drift.mjs` with `ARCHKIT_RUN` temporarily cleared, so drift's CLI-dispatch auto-fire convention doesn't fire during composition; localized to a 10-line `loadDrift()` helper, no other commands touched.

### Added — `tests/doctor/run.mjs`

Seven cases: `no_arch_dir` throw path; clean-state pass + `warningsNote` present + every check `status:pass`; each of the three intent checks fires the expected `D-INTENT-*` warning and populates `intent.*`; missing-source drift escalates to `blocker` with `pass:false`; `nextStep` is non-empty and ≤280 chars across all matrices. The silent-success audit also gained an `archkit_doctor` case so the universal contract from v1.7.1 covers the new tool.

### Migration

None. All new fields are additive. `tests/mcp-server/run.mjs` updated its hardcoded 19 → 20 tool-count assertion to track the new registration.

## v1.7.1 — 2026-05-25

v1.8 foundation (items A + B from [docs/roadmap/v1.8.md](docs/roadmap/v1.8.md)). Promotes v1.7's `nextStep` quick-win pattern into a hard contract across every MCP tool, and adds a contract-enforcing test suite that fails CI when a new tool lands without it. Pure additive — every new field is optional, no existing caller breaks.

### Added — silent-success + nextStep contract on every MCP tool

All 19 `archkit_*` tools now return a `nextStep: string` field (imperative, names the next tool or action) on success. Tools whose primary domain field can come back as an empty array also return a paired `<field>Note` explaining what was checked and why it's empty — replacing the silent-zero / silent-pass dead-end that v1.7's quick wins partially closed on three tools.

Tools that already had `nextStep` in v1.7 (carried forward unchanged): `archkit_boundary_check`, `archkit_resolve_preflight`, `archkit_goal_intake`, `archkit_init`. Tools that gained it in v1.7.1:

- `archkit_drift`: empty `stale: []` now paired with `scanned: { indexNodes, graphFiles, skillFiles }` + `staleNote` ("Checked N nodes, M graphs, K skills — all consistent") + `nextStep` ("No drift to fix" / specific remediation per finding type).
- `archkit_review` + `archkit_review_staged`: `files: 0` now paired with `filesNote` distinguishing "nothing staged" from "staged files all filtered out" from "no path passed"; `nextStep` adapts to errors / warnings / clean.
- `archkit_gotcha_list`: empty `skills: []` paired with `skillsNote` ("no .arch/skills/ directory" vs "exists but empty"); also flags skills with 0 gotchas as a partial-empty case.
- `archkit_gotcha_propose`: `nextStep` reminds the human-review gate (`archkit gotcha --review`) — proposals don't auto-merge.
- `archkit_stats`: `recommendationsNote` when health is good; `nextStep` quotes the top recommendation.
- `archkit_resolve_warmup`: `nextStep` derives from blockers (when failing) or first action (when warning) or clean ("call preflight before editing").
- `archkit_resolve_preflight`: unknown-feature error path now carries `nextStep` listing valid ids or pointing at scaffold.
- `archkit_resolve_scaffold`: dry-run and apply paths both carry `nextStep`; error path for unsupported app type explains the workaround.
- `archkit_resolve_lookup`: per-result-type `nextStep` (cluster → "call preflight on a node"; node → "call preflight before editing"; skill → "read the file before writing code", or "add gotchas" when empty).
- `archkit_log_decision`: confirms ADR number + relative path; suggests follow-on log calls for related choices.
- `archkit_prd_check`: branched `nextStep` for "no PRD found" vs "PRD aligns" vs "archetype mismatch — reconcile."
- `archkit_goal_list`: `goalsNote` distinguishes "no goals yet" from "all done"; `nextStep` points at intake or the in-flight goal's payload.
- `archkit_goal_show`: `nextStep` quotes required-reading count + exit-criteria count and names the complete tool.
- `archkit_goal_payload`: budget-aware `nextStep` (paste instruction when under budget, trim instruction when over).
- `archkit_goal_complete`: `nextStep` mirrors `nextGoal` semantics (paste-next when queued, "all done" when empty).

### Added — `tests/silent-success-audit/run.mjs` contract enforcer

Spawns the MCP server in a temp fixture, calls every registered tool with minimal-valid input, and fails if any response is missing `nextStep`, or if a known-empty domain field (`stale`, `skills`, `recommendations`, `violations` via `rules:0` hint, `files:0` via `filesNote`) lacks its explanatory note. Hard-fails if a new tool lands in `src/mcp/tools.mjs` without a case in the audit — adding a tool now forces adding a test case in the same PR. Brings the suite count to 45.

### Fixed

- **Goal frontmatter parser**: `parseGoal()` in `src/lib/goals.mjs` was overwriting scalar values with `[]` whenever a key's value was empty (`source-ask: ` with nothing after the colon parsed as `[]` instead of `""`), causing `.trim()` to throw inside `renderPayload`. Now buffers list items per key and only promotes scalar → array when at least one `- item` line is actually found. Surfaced by the new audit suite when `archkit_goal_intake` was called without a `sourceAsk`.

### Migration

None required. Every new field is additive. Existing callers continue to parse the same `pass`, `findings`, `stale`, etc. fields they did before.

### Source

Continues the conference-feedback work (2026-05-25): dead-end indicators on every output. v1.7.0 was the proof-of-concept on three tools; v1.7.1 is the universal contract. Next up: v1.8 work item C — `archkit doctor` (aggregates the audit findings into a single user-facing check) and item D (telemetry-driven tool decomposition).

## v1.7.0 — 2026-05-25

Bundles the four highest-priority arch-poly dogfood remediations alongside a new **CGR (Clear Goal Run)** workflow that operationalizes one-goal-per-session discipline.

### Added

- **CGR — Clear Goal Run workflow**. New artifact directory `.arch/goals/<slug>.md` plus the goal lifecycle: planned → in-progress → done (archived to `.arch/goals/done/`). New CLI: `archkit goal list | show <slug> | payload <slug> | complete <slug> | intake --json '<json>'`. The intake step decomposes a sprawling user ask into 1..N discrete goals and emits a copy-pasteable payload per goal (≤3800 chars — the Claude Code slash-command limit) that the user pastes after `/goal` in a fresh `/clear`-ed session. Goal files are the source of truth; payloads just point to them, so context stays compact. Every CLI verb has an MCP twin so agents using the MCP bridge have full parity: `archkit_goal_intake`, `archkit_goal_list`, `archkit_goal_show`, `archkit_goal_payload`, `archkit_goal_complete` (5 new tools). Library: [`src/lib/goals.mjs`](src/lib/goals.mjs), CLI: [`src/commands/goal.mjs`](src/commands/goal.mjs).

- **`archkit boundary-check` — machine-enforced BOUNDARIES.md**. Parses `BAN: source-glob -> target-glob` directives from `.arch/BOUNDARIES.md` (standalone bullets, or embedded inside an existing `NEVER ...` line as `(BAN: src -> target)`), then walks staged / unstaged / explicit files for imports that violate any rule. Languages: JS/TS (`import` + `require`) and Python (`from … import …` + bare `import`); other languages return no violations rather than false positives. `--staged` and `--diff` modes scope findings to changed hunks. Also exposed as MCP tool `archkit_boundary_check({ staged?, diff?, files? })`. Closes the loop on the arch-poly observation that BOUNDARIES.md was the most valuable `.arch/` artifact but had zero enforcement. Files: [`src/lib/boundary-parser.mjs`](src/lib/boundary-parser.mjs), [`src/lib/import-detector.mjs`](src/lib/import-detector.mjs), [`src/commands/boundary.mjs`](src/commands/boundary.mjs).

- **Required-reading injection on `resolve preflight`**. `archkit resolve preflight <feature> <layer>` now returns a `requiredReading: [".arch/skills/<x>.skill", ...]` field listing skill files relevant to the feature (matched by feature-id, cluster-graph `$skill` reference, or INDEX.md keyword). The CLI also prints `Required reading: ...` as a literal prefix line before the JSON output, so the agent driving the tool pulls those skill files into context before writing code. This is the fix that would have caught arch-poly's `yes_bid → yes_bid_dollars` API quirk — `kalshi.skill` existed on disk, but nothing surfaced it during the work. `archkit_resolve_preflight` MCP tool description also updated to call out the new field.

- **`scripts/check-version-sync.mjs`** + `npm run check:versions` + `prepublishOnly` hook. Fails non-zero if `package.json` and `.claude-plugin/plugin.json` versions diverge. (Pre-fix: `plugin.json` was stuck at v1.6.2 while `package.json` shipped v1.6.5.)

- **Dead-end / silent-success indicators (conference-feedback quick wins)**. Every v1.7 tool now distinguishes "checked and found nothing" from "didn't really do anything," and every response carries a `nextStep` field for agents:
  - `archkit_boundary_check`: when `rules: 0` (BOUNDARIES.md has no machine-enforceable BAN directives), the response includes a `hint` explaining how to enable enforcement; a new `unappliedRules` array flags BAN rules whose source-glob matched no scanned file (could be stale, could be legitimately not in this run). Every result carries `nextStep`: "fix the violation," "add BAN directives," or "no action needed."
  - `archkit_resolve_preflight`: new `requiredReadingNote` field explains *why* `requiredReading` is empty (no skill files in project yet, vs. checked N skills and none matched). New `skillCatalogSize` counter. New `nextStep` field guides the agent: read the listed skills → write code, or resolve drift first, or proceed to review.
  - `archkit_goal_payload`: error on unknown slug now lists active goal slugs and suggests `archkit_goal_intake` if the queue is empty (matching `archkit_goal_show`'s existing recovery hint).
- CLI side: `archkit resolve preflight` prints `Required reading:` and `Next:` lines to **stderr** so stdout stays pure JSON for downstream parsers; agents and humans grepping tool output get the one-liners without breaking JSON.parse on the stdout.

### Fixed

- **`review --staged` no longer reports pre-existing findings on untouched lines** (arch-poly's #3 priority — the biggest signal/noise win). New helper `getDiffHunkLines()` parses `git diff --cached -U0` output into per-file changed-line sets, and `filterFindingsByHunks()` drops findings whose `.line` falls outside those sets. Applied in both `--staged` and `--diff` modes, and in both JSON (`--agent`) and human-readable paths. Findings without a `.line` field (file-level) still pass through. File: [`src/commands/review/staged-hunks.mjs`](src/commands/review/staged-hunks.mjs).

- **Wizard no longer mandates `verify-wiring` on non-JS projects**. Generated `SYSTEM.md`, `.claude/rules/superpowers-integration.md`, and `.claude/skills/archkit-protocol/SKILL.md` now omit the `archkit resolve verify-wiring src/` line when the project's declared stack contains no JS/TS framework (Python-only / Go-only / Swift-only / Rust-only / etc.). The verify-wiring command itself still warns loudly on 0-file scans (shipped in v1.6.x); this change stops *prescribing* the command in the first place when the stack makes it dead weight. New helper: [`src/lib/stack-detect.mjs`](src/lib/stack-detect.mjs) with `hasJsTsStack(cfg)`. Surfaced by arch-poly (Python-only Kalshi trading bot).

- **`.claude-plugin/plugin.json` synced to `package.json` version** (was v1.6.2, now v1.7.0). Both ship as one unit (npm package + Claude Code plugin) and must move in lockstep going forward — enforced by the new check script.

### Source: arch-poly dogfood (2026-05)

5-day stress test on a Python Kalshi prediction-market trading bot. Killer insight: `boundary-check` + skill injection on `preflight`, taken together, would have caught the production bug that motivated this release (the bot parsed Kalshi's `yes_bid` field as integer cents after the API switched to `yes_bid_dollars` decimal strings). The `kalshi.skill` file had the exact WRONG/RIGHT pattern that would have flagged it — but it never reached context because nothing surfaced it. v1.7's pair fix closes that gap.

### Tests + pre-existing failures cleaned up

Full test sweep at release time: **all 44 suites green** (5 new v1.7 suites + 39 regression suites including the entire `mcp-runners/` family). Three pre-existing failure modes that surfaced during pre-release validation were resolved as part of this release:

- **ajv module corruption** — `tests/mcp-server` and most `tests/mcp-runners/*` suites failed with `dataType_1.getJSONTypes is not a function` (and several siblings depending on call path) due to a partial `node_modules/ajv` install. Resolved by `rm -rf node_modules && npm install` — package-lock.json was intact, the install state wasn't.
- **`tests/mcp-server` stale tool-list assertion** — the suite asserted exactly 13 MCP tools; v1.7 adds 4 (boundary-check + 3 goal tools = 17). Updated the assertion list to the new canonical set.
- **`tests/mcp-init` testing removed behavior** — the suite verified direct writes to `~/.claude/mcp.json`, which `src/commands/init.mjs:515` deliberately removed in favor of delegating to `claude mcp add` (Claude Code v2.x no longer reads that path). Rewrote the suite to use a fake `claude` binary on PATH and assert the CLI is invoked with the right arguments — covering the happy path, the idempotent re-run, and the no-CLI-on-PATH fallback.

## v1.6.5 — 2026-05-20

### Fixed
- `archkit_review_staged` / `archkit review --staged` were returning `{files: 0, pass: true}` for any project whose source files aren't JavaScript, TypeScript, or Python. Root cause: the staged-file collector filtered `git diff --cached --name-only` output against a hardcoded `.ts/.tsx/.js/.mjs/.py` allowlist, dropping every Swift / Kotlin / Go / Rust / Ruby / Java / etc. file on the floor before review even started. The git-index detection itself was fine.
- Extension allowlist now covers all languages the project's language gate (v1.6.4, `src/commands/review/language.mjs`) already knows about: every JS-ecosystem extension *plus* `.swift .kt .kts .java .scala .go .rs .py .rb .php .ex .exs .cs .fs .vb .c .h .cpp .cc .hpp .m .mm .dart .lua .pl .r .jl .clj .cljs .sh .bash .zsh .ps1`. Per-file JS-ecosystem gating still skips JS-only heuristics on non-JS files — no nonsense findings.
- Same fix applies to `--diff` and `--dir` (which had the same hardcoded regex).
- Surfaced by the v1.6.2 iOS-dev dogfood (Swift / SwiftUI / SwiftData, 10 commits, ~30 reviews) — `archkit_review_staged` reported zero files on every commit despite real staged changes.

### Added
- **Project-level review suppression via `.arch/config.json`**. New schema:
  ```json
  { "review": { "disable": ["http-client", "db-efficiency"] } }
  ```
  Each entry must match a finding's `type` field as displayed in review output (`http-client`, `db-efficiency`, `cache`, `queue`, `convention`, `gotcha`, …). Architecture-correctness families (`import-hierarchy`, `import-boundary`, `boundary-violation`, `reserved-word`, `weak-suppression`) are intentionally non-disablable. Malformed or missing config degrades silently to "no disables."
- Stacks with v1.6.4's language gate: the gate handles "wrong language" (don't run JS-ecosystem heuristics on Swift); the new config handles "right language, wrong rule for our codebase" (Drizzle project that has standardized away from `.where(...).limit(50)` advice). Together they close the noise loop the iOS dogfood named.
- Design rationale: [`docs/decisions/0001-review-suppression-config-schema.md`](docs/decisions/0001-review-suppression-config-schema.md).

### Changed
- **MCP tool descriptions audited and expanded** so the LLM doesn't have to guess at semantics:
  - `archkit_review_staged`: now defines "staged" as the git index (`git diff --cached --diff-filter=ACM`), lists every file extension it picks up, and explains the `files:0` failure mode.
  - `archkit_resolve_warmup`: now spells out exactly what `deep:true` adds (W011 package.json↔skills coverage, W012 `.api` stub detection, W013 extension registry integrity) vs. the default structural-only mode.
  - `archkit_resolve_preflight`: now explains that valid `feature` values come from `.arch/INDEX.md`'s node→cluster mapping, and that an unknown-feature response returns the full `valid: [...]` array to pick from.
  - `archkit_review`, `archkit_resolve_scaffold`, `archkit_resolve_lookup`, `archkit_gotcha_propose`, `archkit_gotcha_list`, `archkit_stats`, `archkit_drift` — descriptions also expanded with concrete inputs/outputs and when-to-use anchors. Per-field `.describe(...)` hints added where useful.
- Surfaced by the same iOS dogfood: the user reported "thin descriptions" as one of the three top friction points, naming those three tools specifically.

## v1.6.4 — 2026-05-19

### Fixed
- `review` no longer applies JS/TS-ecosystem heuristics to non-JS source files. The seven affected check modules (`api`, `db`, `cache`, `queue`, `frontend-wiring`, `event`, `floating-promise`) are now gated by file extension and, for ambiguous files, by a new `## Stack:` field parsed from `SYSTEM.md`.
- Concretely: `ModelContext.fetch(...)` in a `.swift` file no longer produces a phantom `http-client` warning suggesting `AbortSignal.timeout(5000)`; Swift's `.from(_:)` static factory no longer triggers a `db-efficiency` warning suggesting a Drizzle `.where(...).limit(50)` chain. Same fix covers `.kt`, `.go`, `.py`, `.rs`, `.rb`, `.dart`, `.cs`, and other native-language extensions.
- JS/TS reviews are unchanged — real `fetch()` calls and Drizzle `select().from(table)` queries are still flagged.
- Surfaced by a Swift/SwiftUI/SwiftData dogfood report (see commit message). Root cause was that `src/commands/review.mjs` ran every check module on every file with no language gate.

### Added
- `parseSystem()` now extracts a `## Stack:` field alongside the existing `Type`/`Pattern`/`Conv` fields. Used by the language gate for files with ambiguous extensions.
- `src/commands/review/language.mjs`: `classifyStack(stack)` and `shouldRunJsEcosystemChecks(filepath, stack)` helpers. Behavior preserved when no stack is declared.

### Tests
- 16 new tests in `tests/language-gating/` covering both the bug-report scenarios (Swift) and the no-regression cases (TypeScript).

## v1.6.3 — 2026-05-19

### Fixed
- `drift` + `resolve warmup` W010: `parseIndex` now handles multi-node `## Nodes → Clusters → Files` lines like `@A @B @C → @cluster → .arch/clusters/cluster.graph`. Previously it captured only the first `@node`, set `cluster = nodeId` (since `[brackets]` were absent), and stored the literal `"@cluster → ..."` string as `basePath` — producing simultaneous false `orphaned-index-node`, `orphaned-graph`, and `missing-source` findings on every cluster line.
- `parseIndex` cross-refs no longer require a parenthesized reason — bare `@A → @B` lines (which `archkit_stats` already counts) are now picked up too, so W010 stops contradicting stats on the same file.
- `drift`: paths under `.arch/` or ending in `.graph`/`.skill`/`.api` are no longer checked as source files. Those are .arch/ artifacts and were already covered by the `orphaned-*` checks against directory contents.
- Surfaced by arch-infographs dogfood: 11 spurious findings on every drift run, with stats/warmup/lookup all simultaneously reporting the same graphs as healthy.

## v1.6.2 — 2026-05-10

### Docs
- CHANGELOG backfilled with v1.5.0–v1.6.1 entries (was missing the entire v1.5 line and v1.6.0/v1.6.1).
- Removed `docs/roadmap/mcp-server.md` — a 2026-04-18 roadmap for the MCP server, which shipped 10 days later in v1.4.0. The historical "why we shipped MCP" reasoning lives in the v1.4.0 CHANGELOG entry; the roadmap doc was pure future-confusion bait.
- Fixed `examples/README.md` to use a real CLI command (`resolve preflight tasks controller`) instead of the non-existent `resolve context`.
- Annotated `examples/*/RESULTS.md` and the examples summary table as **2026-03-31 / pre-v1.4 snapshots** so future readers don't misread them as current detection rates.

## v1.6.1 — 2026-05-09

### Fixed
- `drift`: name-mismatch check no longer false-positives on SYSTEM.md app names that carry a parenthetical description (`"arch-infographs (LinkedIn AI Content Pipeline)"`). Now strips parentheticals before normalization, and matches both scoped and unscoped npm package names. Surfaced by arch-infographs dogfood under v1.6.0.

## v1.6.0 — 2026-05-09

### Added — continuous-guardrail layer (3 new hooks)
- **Stop hook** (`archkit-stop-hook`): fires after every assistant turn. Surfaces the v1.6 utilization metric, re-injects a compact form of `.arch/BOUNDARIES.md` (NEVER lines only) so rules survive Claude Code's context compression, scans the response for boundary violations, and auto-drafts proposed ADRs from decision-language to `.arch/decisions/proposed/<hash>.json`.
- **PostToolUse hook** (`archkit-posttooluse-hook`): fires after every tool call. Increments the session-stats utilization counter and, for Edit/Write/MultiEdit on source files in `src/`, runs `archkit_review` inline and surfaces the top findings as additional context.
- **UserPromptSubmit hook** (`archkit-userpromptsubmit-hook`): fires before each user prompt is processed — the highest-leverage hook for the v1.6 utilization goal. Starts a new "task window" in session stats, keyword-matches the prompt against `.arch/INDEX.md`, and prepends matched feature/skill routing with a specific call-to-action (`archkit_resolve_lookup`) when ≥2 keywords hit.
- **Compound utilization metric** — per-task primary (target ≥75% of editing tasks consult archkit before first edit) + per-session secondary (archkit calls / Edit+Read+Glob+Grep). Surfaced every turn by Stop hook.
- `archkit_resolve_warmup` now reports `summary.pendingDecisionProposals` and surfaces a triage action when proposals are pending in `.arch/decisions/proposed/`.
- Three new libs: `src/lib/session-stats.mjs`, `src/lib/decision-detector.mjs`, `src/lib/boundary-patterns.mjs`. Three universal NEVER detectors ship in v1.6.0: SQL string concatenation, hardcoded credential prefixes (sk-, AKIA, ghp_, AIza, npm_), and `req.body`/`req.query`/`req.params` without a validator hint nearby.

### Why
- v1.5 made archkit-aware setup work but the dogfood finding on arch-infographs was that LLMs are one-shot by nature: agents made multiple non-trivial architectural decisions (network mode, embedding dedupe threshold, routing precedence) without logging any ADRs. CLAUDE.md's "non-negotiable" prose did nothing because agents never reached for `archkit_log_decision` mid-flow. v1.6 replaces agent self-discipline with deterministic hooks that fire automatically every turn / every edit / every prompt.

### Tests
- 89 new tests across 6 suites. Synthetic decision-language corpus (30 positives + 30 negatives) shows 100/100 precision/recall — caveat: corpus and regex co-tuned. Real-world calibration is a v1.6.x follow-up.

### Out of scope (deferred)
- Plain-text password storage detection, stack-traces-to-client detection, HTTP-without-timeout detection — too FP-prone without window-checking. v1.6.x patches.
- Per-archetype boundary patterns beyond universals — v1.6.x.
- Auto-acceptance of proposed ADRs — must require human review.

## v1.5.4 — 2026-05-03

### Added
- `archkit_init` MCP tool: the canonical greenfield entry point. Returns the full wizard instructions inline plus PRD scan results, the skeleton index for all 9 archetypes, and a `nextStep` hint — in one response. Replaces the v1.5.0–v1.5.3 chain of escape-hatch nudges that tried to steer agents toward a separate SKILL.md.

### Why
- Earlier v1.5.x dogfood showed that prose nudges in hook output don't reliably trigger agent behavior. The structural fix is an MCP tool whose description matches user intent ("set up / initialize / scaffold archkit") so the discovery problem becomes a tool-call problem instead of a prompt-engineering problem.

## v1.5.3 — 2026-05-03

### Fixed
- Greenfield SessionStart hook: closed remaining v1.5.2 escape hatches that let agents discover the legacy `archkit init` CLI before the v1.5 wizard skill. Updated `skills/archkit-init/SKILL.md` header to match.

## v1.5.2 — 2026-05-03

### Fixed
- Greenfield discovery: SessionStart hook now steers Claude toward the v1.5 wizard skill (`skills/archkit-init/SKILL.md`) instead of the legacy `archkit init` CLI scaffolder. The CLI stays available for reverse-engineering existing codebases; greenfield setup is wizard-driven.

## v1.5.1 — 2026-05-03

### Added
- `archkit_prd_check` MCP tool: detects a PRD/BRIEF/SPEC at common paths (`PRD.md`, `BRIEF.md`, `SPEC.md`, `docs/prd.md`, etc.) and, when `.arch/` exists, scores the PRD's archetype + deployment-mode signals against `SYSTEM.md` to surface mismatches.
- Wizard is now PRD-aware: its first action is to call `archkit_prd_check` so it can pre-fill archetype suggestions if a PRD exists.

## v1.5.0 — 2026-05-03

### Added
- **Claude Code plugin packaging** (`.claude-plugin/plugin.json`): archkit ships as a single atomic install — MCP server, SessionStart hook, and the `/archkit-init` wizard skill all install together via Claude Code's plugin mechanism. npm install path remains the canonical surface for Cursor / Continue / CI / Claude Code without plugins.
- **`/archkit-init` slash-command wizard skill** (`skills/archkit-init/SKILL.md`): seven-step interactive setup that runs in the chat pane (no terminal context-switch). Resolves the v1.4.x audience question — vibe-coders are the primary user, and the wizard meets them where they already are.
- **Decisions ADRs** (`.arch/decisions/`): new top-level directory in archkit projects for human-authored architecture decision records. `archkit_log_decision` MCP tool appends a new ADR with consistent metadata.

### Why
- v1.4.x dogfood revealed that even with the SessionStart hook nudging toward MCP tools, the *initial setup* moment for a new project was still terminal-driven and vibe-coder-hostile. Plugin packaging + chat-pane wizard collapses install + setup into one frictionless flow.

## v1.4.2 — 2026-05-02

### Fixed
- `archkit init --mcp` now registers via `claude mcp add archkit archkit-mcp --scope user` instead of writing directly to `~/.claude/mcp.json`. Claude Code v2.x reads MCP config from `~/.claude.json` (managed by the `claude mcp` CLI), not from the legacy `~/.claude/mcp.json` path. v1.4.0 and v1.4.1 silently registered to the wrong file — `claude mcp list` did not show archkit, and the MCP tools were not available in sessions even when the installer claimed success.

### Behavior
- If the `claude` CLI is not on `PATH`, `archkit init --mcp` now warns clearly and prints the manual command to run.
- Idempotent: re-running detects an existing `archkit:` entry in `claude mcp list` and does nothing.

## v1.4.1 — 2026-05-02

### Added
- **SessionStart hook** (`archkit-session-start`): when Claude Code opens a session in an archkit project (detected by walking up from cwd to find `.arch/SYSTEM.md`), the hook emits `additionalContext` describing the available `archkit_*` MCP tools and how `.arch/` is structured. Wired up by `archkit init --install-hooks --claude` alongside the existing PreToolUse hook.

### Why
- Dogfood (2026-05-02) showed that tool descriptions and the skill template alone don't reliably nudge agents toward `archkit_*` MCP tools — invocation was inconsistent. A SessionStart hook injects factual project context before the agent picks its first tool, which lands at a higher trust posture than runtime PreToolUse deny-reason text (which was observed to trigger prompt-injection skepticism).

### Changed
- `archkit init --install-hooks --claude` now writes both a PreToolUse entry and a SessionStart entry to `.claude/settings.json`. Existing PreToolUse behavior is unchanged.

## v1.4.0 — 2026-04-28

### Added
- **MCP server** (`archkit-mcp` and `archkit mcp serve`): stdio MCP server exposing 10 typed tools that mirror the CLI surface. Lets AI agents call archkit natively in Claude Code, Cursor, and Continue.
- `archkit init --install-hooks --mcp`: idempotent registration of archkit in `~/.claude/mcp.json`.
- `ArchkitError` class and shared error envelope (`{ code, message, suggestion?, docsUrl? }`) used by both CLI `--json` output and MCP `isError` responses.
- Per-command `run*Json()` exports (review, warmup, preflight, scaffold, lookup, gotcha-list, gotcha-propose, stats, drift) for direct programmatic use.

### Changed
- `archkit-protocol` skill template now nudges agents toward MCP tools when available.

### Dependencies
- Added `@modelcontextprotocol/sdk@^1.29.0`
- Added `zod@^3`
