---
slug: agents-md-export
title: AGENTS.md as the canonical orientation core
status: completed
created: 2026-06-23
epic: cgr2-orchestration
order: 5
exit-criteria:
  - archkit export agents emits AGENTS.md as the canonical compiled target (compact intent + boundaries + routing)
  - Existing exports (cursor, windsurf, copilot, aider) are derived FROM AGENTS.md rather than emitted in parallel
  - AGENTS.md stays within the orientation-core token ceiling and is enforced by stats
  - Tests cover AGENTS.md generation and derivation of at least one downstream format
files-to-touch:
  - src/commands/export.mjs
  - src/lib/compile.mjs
required-reading: 
depends-on: 
verify-command: npm test
source-ask: Build CGR 2.0: conductor/worker parallel-lane orchestration with a persistent append-only board, fission-based resume, attention-gradient wind-down, plus AGENTS.md export and skills rename. See ADRs 0013-0015.
started: 2026-06-23T23:10:36.830Z
completed: 2026-06-23T23:16:42.740Z
completion-notes: AGENTS.md is now the canonical compiled orientation core (new src/lib/compile.mjs: compileAgentsMd = intent + boundaries + routing). export.mjs gained an `agents` target and now derives cursor/windsurf/copilot/aider FROM the compiled AGENTS.md via deriveDownstream (no parallel emission). Token ceiling (AGENTS_MD_TOKEN_CEILING=2000) enforced at export time and surfaced/flagged by `archkit stats` (analyzeAgents + recommendation). New tests/agents-export suite (11 tests) covers generation, ceiling, and downstream derivation.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-23
---



# AGENTS.md as the canonical orientation core

## Why
Industry converged on AGENTS.md as the single cross-tool standard; it is also the always-resident core of the orientation layer.

## Exit criteria
- [ ] archkit export agents emits AGENTS.md as the canonical compiled target (compact intent + boundaries + routing)
- [ ] Existing exports (cursor, windsurf, copilot, aider) are derived FROM AGENTS.md rather than emitted in parallel
- [ ] AGENTS.md stays within the orientation-core token ceiling and is enforced by stats
- [ ] Tests cover AGENTS.md generation and derivation of at least one downstream format

