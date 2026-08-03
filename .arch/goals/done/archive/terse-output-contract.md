---
slug: terse-output-contract
title: Replace prose MCP output with graph notation and a symbol vocabulary
status: completed
created: 2026-08-02
order: 10
project: lane-integration
exit-criteria:
  - A shared formatting module renders board and lane state as a compact graph — lanes as branches, goals as leaves, barriers marked distinctly — instead of numbered prose paragraphs
  - A four-symbol severity vocabulary is defined once and reused everywhere — action, attention, error, ok — paired with markdown emphasis for the values that matter
  - Emphasis is markdown only; no ANSI escape sequences appear in any MCP tool result or prompt output
  - The conductor prompt is rebuilt on the shared renderer and its character count drops by at least half against the current output for the same board
  - Every instruction the old prose carried is still recoverable — the terse form loses tokens, not meaning, and a worker can still act on it without reading the old text
  - archkit_log_decision records the output contract so future surfaces adopt it instead of reinventing prose
files-to-touch:
  - src/lib/format.mjs
  - src/mcp/prompts.mjs
  - tests/
required-reading: 
depends-on:
  - merge-verify-command
owns:
  - src/lib/format.mjs
  - src/mcp/prompts.mjs
feature: output-contract
verify-command: npm test
source-ask: Append the three intake defects found while queuing the lane-integration batch, plus terse-output work. Defects — (1) exit criteria containing a colon-space are re-emitted as unindented list items after the exit-criteria block, corrupting goal frontmatter and rendering phantom duplicate criteria in payloads; (2) the auto-appended finalize barrier does not inherit the batch's `project`, so its payload instructs a different branch than the work it documents; (3) payload "Read first" paths point at .arch/goals/<slug>.md while files are written to .arch/goals/queue/<project>/<slug>.md. Output work — make MCP tool output terse and high-level using graph notation and a small symbol vocabulary instead of prose paragraphs, to cut agent-context tokens and make the feedback legible to end users. Color via markdown emphasis and symbols, NOT ANSI (ANSI does not render in MCP tool results). Scope is MCP output only, not the CLI.
lane: lane-frontmatter-colon-escaping
started: 2026-08-02T21:55:28.720Z
handoff: .arch/board/handoff/terse-output-contract.md
completed: 2026-08-02T22:19:56.415Z
completion-notes: Shared format.mjs renderer: lanes as branches, goals as leaves, barriers marked SOLO; four-symbol severity vocabulary defined once; markdown emphasis only, no ANSI (asserted across 9 prompt x board combinations). Conductor prompt 3103 -> 1428 chars (ratio 0.46) against a baseline pinned verbatim from real pre-contract output, with a 28-assertion instruction-preservation test. ADR 0026. Integrated as fd9251a; 75/75 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-08-02
---





# Replace prose MCP output with graph notation and a symbol vocabulary

## Why
The conductor prompt spends roughly 900 characters of numbered prose to convey a board state that a five-line graph renders better. Every one of those characters lands in agent context on every relay hop, and the prose is harder for an end user to scan than a lane tree. Scope is MCP output only — ANSI is deliberately excluded because escape codes surface as literal garbage in tool results.

## Exit criteria
- [ ] A shared formatting module renders board and lane state as a compact graph — lanes as branches, goals as leaves, barriers marked distinctly — instead of numbered prose paragraphs
- [ ] A four-symbol severity vocabulary is defined once and reused everywhere — action, attention, error, ok — paired with markdown emphasis for the values that matter
- [ ] Emphasis is markdown only; no ANSI escape sequences appear in any MCP tool result or prompt output
- [ ] The conductor prompt is rebuilt on the shared renderer and its character count drops by at least half against the current output for the same board
- [ ] Every instruction the old prose carried is still recoverable — the terse form loses tokens, not meaning, and a worker can still act on it without reading the old text
- [ ] archkit_log_decision records the output contract so future surfaces adopt it instead of reinventing prose

