# 0026. Render MCP board output as a graph with a four-symbol severity vocabulary and markdown-only emphasis

- **Date**: 2026-08-02
- **Status**: Accepted
- **Tags**: cgr, conductor, mcp, output, format

## Context

The /mcp__archkit__conductor prompt spent roughly 900 characters of numbered prose describing a board state that five lines of graph render better. Three costs stacked up:

1. Every one of those characters lands in agent context on every relay hop. The conductor prompt is re-emitted after each /clear, and it is the first thing in a fresh conductor's window — the most expensive real estate archkit owns.
2. The prose scaled O(lanes). Step 5 spelled out the same five commands (precondition, integrate, verify, record, fallback) once per integration point, differing only in the lane token. A four-lane drain paid four copies of identical instructions.
3. Each surface invented its own shape. `renderConvergencePlan` used `1. / 2. / 3.` sub-steps and `•` bullets; the conductor prompt used `1..6` with `•` bullets; goal_status used aligned `label:  value` columns; boardSnapshot used ` - ` separated fragments. Nothing was reusable, and nothing agreed on how to mark "this one needs a look".

There was also a live hazard: the test harnesses colorize with ANSI, and it would have been natural to reach for the same escape codes in tool output. MCP tool results and prompt messages are transported as plain text into an agent's context — an escape sequence surfaces there as literal garbage (`←[32m`), burning tokens and destroying exactly the scannability the color was for.

## Decision

One shared renderer, `src/lib/format.mjs`, defines the archkit MCP OUTPUT CONTRACT. Three rules bind everything that renders board or lane state.

**1. GRAPH, NOT PROSE.** Board state is a tree: lanes are branches, goals are leaves (ordered within a lane by `→`), barriers are marked distinctly with `⊘` + the attention symbol + `**SOLO**`. Counts are a stat strip (`board frontier **4** · lanes **2** · merge **2** · blocked 0`), not a sentence. Repeated per-point boilerplate is factored into ONE substitution template (`W` = the point's worktree/branch, `L` = its lane) so rendering cost is O(1) in lanes instead of O(lanes); each integration point then costs a single leaf carrying its order, lane, slugs, dependency edges, resolved verify command, and owned paths.

Exports: `tree`, `laneTree`, `stats`, `boardLine`, `step`, `convergenceGraph`, `debt`/`debtLine`, and `conductorGraph` — the whole orchestration pass composed from the primitives.

**2. FOUR SYMBOLS, DEFINED ONCE.** `SEVERITIES = [action, attention, error, ok]`, mapped by `SYM` to `▸ ! ✗ ✓`. There is no fifth severity. Structural glyphs (`├─ └─ │ ⊘ → ⇠ ·`) live in a separate `GLYPH` table because they carry shape, not urgency. A one-line `LEGEND` ships with any output that uses them, so the vocabulary is recoverable from the message itself. `sym()` degrades an unknown severity to `action` rather than throwing — a rendering bug must never take a prompt down.

**3. MARKDOWN EMPHASIS ONLY — NEVER ANSI.** `strong()` (`**x**`) for a value that changes what the reader does; `code()` (`` `x` ``) for anything meant to be run verbatim. Emphasis tracks actionability: a non-zero count is bolded and carries its severity symbol; a ZERO stays plain, because nothing owed is nothing to look at. `hasAnsi()`/`stripAnsi()` are the guards, and tests/cgr-output-contract asserts the ESC byte (`\x1b`) appears in no prompt result on any board shape, and not even in format.mjs's own source.

Terseness must not cost instructions. The graph form keeps every instruction the prose carried — the six loop steps, the lane→slug map, the barrier solo rule, the merge order, the rebase-onto-tip precondition and path-extract fallback, the resolved verify command and the record call with its arguments, the deep-review exception list, the integration-debt ledger, and the "you spawn workers, archkit only emits the plan" framing. What it drops is connective prose, repeated boilerplate, and restatement. The rule for future surfaces is LEGEND + TREE, never delete semantics.

Adopted by every prompt in src/mcp/prompts.mjs: `conductor` (fully — it contributes no prose of its own, it just calls `conductorGraph`), `goal_status` (stat strip + bucket tree), plus the severity vocabulary through `relayHeader`, `relayTriageChoice`, `goal_review`, and `intake`.

## Consequences

Measured on a fixture board with two claimable lanes, a solo barrier, two workers in flight, a two-lane merge queue with a partial completion, and one unverified merge: the conductor prompt went from **3103 to 1428 characters (ratio 0.46 — a 54% cut)** and from 35 lines to 19. The ratio IMPROVES as lanes are added, because the per-point boilerplate is no longer repeated; tests/cgr-output-contract asserts both the ≤0.5 bound and the improve-with-scale property.

Easier: a new surface gets the shape for free and cannot invent a fifth severity or a sixth bullet style. Emphasis has a rule instead of a habit.

Harder / constrained:
- The severity glyphs are non-ASCII. A surface that must be pure-ASCII has to change `SYM` centrally, which is the point, but it is a coordinated change.
- `attention` is `!`, which is also JS negation — source-level "did you hardcode the glyph" checks can only be run on the non-ASCII members.
- Step 5's per-point commands are now a template with `W`/`L` substitutions rather than N fully-expanded command sets. The header states the substitution explicitly; a reader who skips it sees placeholders. This was judged the right trade: the expanded form already contained `<worktree-for-backend>` placeholders, so it was never copy-pasteable either.
- `renderConvergencePlan` in src/lib/board.mjs is no longer on the conductor path. It remains exported and tested as the verbose renderer; `convergenceGraph` supersedes it for MCP output. Collapsing the two is follow-up work owned by the board lane.
- Two existing suites' prompt-shape assertions were updated to the graph form (tests/cgr-convergence EC4, tests/cgr-merge-verify EC3). Any future assertion on conductor prompt text should match the graph, not prose.
- Scope is MCP output only. `boardSnapshot` (src/lib/board.mjs) and the SessionStart rehydration digest (bin/archkit-session-start.mjs) are hook `additionalContext`, not MCP results; they have not been migrated and should adopt this contract next.
