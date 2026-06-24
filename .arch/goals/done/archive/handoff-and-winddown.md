---
slug: handoff-and-winddown
title: Handoff artifact + attention-gradient tail-zone wind-down
status: completed
created: 2026-06-23
epic: cgr2-orchestration
order: 2
exit-criteria:
  - Handoff artifact schema written to .arch/board/handoff/<slug>.md: done(+evidence), decisions, files-actual-vs-predicted, remaining, continuation-notes, open-questions, verification-status
  - Worker stops accepting new goals at cgr.windDownAt (default 0.65, config + per-model override via cgr.windDownAtByModel) and switches to wind-down authoring only
  - Handoff is referenced by successor CGR frontmatter and readable via session_state
  - Ownership-accuracy signal (actual vs predicted files) is computed and recorded on the handoff
  - Tests cover handoff round-trip (author -> read) and threshold-triggered mode switch
  - Handoff artifact schema written to .arch/board/handoff/<slug>.md: done(+evidence), decisions, files-actual-vs-predicted, remaining, continuation-notes, open-questions, verification-status
- Handoff artifact schema written to .arch/board/handoff/<slug>.md: done(+evidence), decisions, files-actual-vs-predicted, remaining, continuation-notes, open-questions, verification-status
files-to-touch:
  - src/lib/board.mjs
  - src/lib/goals.mjs
  - src/mcp/tools.mjs
  - .arch/config.json
required-reading:
  - .arch/decisions/0015-attention-gradient-wind-down-completion-lease-policy-knobs.md
depends-on:
  - board-state-manager
verify-command: npm test
source-ask: Build CGR 2.0: conductor/worker parallel-lane orchestration with a persistent append-only board, fission-based resume, attention-gradient wind-down, plus AGENTS.md export and skills rename. See ADRs 0013-0015.
started: 2026-06-23T22:18:31.068Z
completed: 2026-06-23T22:30:06.160Z
completion-notes: Added handoff artifact (.arch/board/handoff/<slug>.md) with writeHandoff/readHandoff round-trip, glob-aware ownership-accuracy, and a handoffs slice in session_state. Added attention-gradient wind-down knobs (windDownAt/windDownMode/windDownDecision/leaseTtlHours, default 0.65 + per-model override) + .arch/config.json. New archkit_goal_handoff MCP tool (runGoalHandoff stamps the pointer on goal + successor) and a relay-header wind-down policy line. New tests/cgr-handoff suite; updated cgr-board key-set + mcp-server/silent-success-audit tool registries. 55/55 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-23
---



# Handoff artifact + attention-gradient tail-zone wind-down

## Why
The linchpin artifact — worker return, PreCompact flush, rehydration input, and fission carry-forward are all the same object, authored in the degradation-tolerant tail.

## Exit criteria
- [ ] Handoff artifact schema written to .arch/board/handoff/<slug>.md: done(+evidence), decisions, files-actual-vs-predicted, remaining, continuation-notes, open-questions, verification-status
- [ ] Worker stops accepting new goals at cgr.windDownAt (default 0.65, config + per-model override via cgr.windDownAtByModel) and switches to wind-down authoring only
- [ ] Handoff is referenced by successor CGR frontmatter and readable via session_state
- [ ] Ownership-accuracy signal (actual vs predicted files) is computed and recorded on the handoff
- [ ] Tests cover handoff round-trip (author -> read) and threshold-triggered mode switch

