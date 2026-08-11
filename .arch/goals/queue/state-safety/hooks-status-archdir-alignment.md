---
slug: hooks-status-archdir-alignment
title: Decide and settle whether hooks-status projectClaudeDir should follow ARCHKIT_ARCH_DIR
status: pending
created: 2026-08-11
order: 9
project: state-safety
exit-criteria:
  - "The intended behavior is decided and written down: either projectClaudeDir legitimately resolves from cwd independently of the archDir contract, or it must derive its project root from the resolved archDir"
  - If it should follow the contract, projectClaudeDir derives its root from src/lib/archdir.mjs instead of its own walk-up, and its WALKER_EXCEPTIONS entry in tests/archdir-resolution/run.mjs is deleted
  - If cwd-independence is correct, the WALKER_EXCEPTIONS reason is expanded to state WHY a hooks-status answer may diverge from the named .arch/, and a test pins that divergence as intended rather than accidental
  - Behavior with ARCHKIT_ARCH_DIR unset is unchanged, asserted not assumed
  - Full suite green
files-to-touch:
  - src/lib/hooks-status.mjs
  - tests/archdir-resolution/run.mjs
required-reading:
  - .arch/decisions/0031-archdir-resolution-contract-archkit-arch-dir-is-the-explicit.md
  - src/lib/archdir.mjs
depends-on: 
owns:
  - src/lib/hooks-status.mjs
feature: archdir
verify-command: npm test
source-ask: "Conductor follow-up from the archdir-command-walker-residual lane: the worker disclosed that src/lib/hooks-status.mjs projectClaudeDir is a genuine sibling of the retired private walkers — it walks up looking for .arch/.claude as a root marker and ignores ARCHKIT_ARCH_DIR. It returns a .claude/ path rather than an archDir, so it was allowlisted in the new anti-regression guard with that reason rather than silently changed, since src/lib/hooks-status.mjs was outside that lane's ownership. Filed so the exception is revisited deliberately instead of hardening into permanent cover."
lane: archdir
---


# Decide and settle whether hooks-status projectClaudeDir should follow ARCHKIT_ARCH_DIR

## Why
projectClaudeDir (src/lib/hooks-status.mjs:20) walks up for .arch/.claude as a root marker and ignores ARCHKIT_ARCH_DIR, so in a worktree the hooks-status answer can describe a different project than every other archkit surface. It is currently carried as a reasoned exception in the ADR 0031 anti-regression guard; that exception should be either justified permanently in writing or removed by making the resolution explicit.

## Exit criteria
- [ ] The intended behavior is decided and written down: either projectClaudeDir legitimately resolves from cwd independently of the archDir contract, or it must derive its project root from the resolved archDir
- [ ] If it should follow the contract, projectClaudeDir derives its root from src/lib/archdir.mjs instead of its own walk-up, and its WALKER_EXCEPTIONS entry in tests/archdir-resolution/run.mjs is deleted
- [ ] If cwd-independence is correct, the WALKER_EXCEPTIONS reason is expanded to state WHY a hooks-status answer may diverge from the named .arch/, and a test pins that divergence as intended rather than accidental
- [ ] Behavior with ARCHKIT_ARCH_DIR unset is unchanged, asserted not assumed
- [ ] Full suite green

