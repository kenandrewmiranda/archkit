---
slug: hooks-status-archdir-alignment
title: Decide and settle whether hooks-status projectClaudeDir should follow ARCHKIT_ARCH_DIR
status: completed
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
started: 2026-08-11T13:56:38.604Z
lease: "{\"worker\":\"worker-hooks-status-archdir\",\"expires\":\"2026-08-12T13:56:38.605Z\"}"
dispatched-since: 2026-08-11T13:56:38.606Z
dispatched-to: worker-hooks-status-archdir
completed: 2026-08-11T14:19:45.321Z
completion-notes: "Branch B: projectClaudeDir deliberately does NOT follow ARCHKIT_ARCH_DIR — settled in ADR 0032 plus a 38-line comment at hooks-status.mjs:21-58. Executable code unchanged (comment-only diff, proved mechanically), divergence pinned by 9 tests in tests/archdir-resolution §9 that go red if anyone routes it through the resolver. Merged b9c0c4d, 80/80 green.</notes>\n</invoke>\n"
tests-passed: true
tests-command: npm test
tests-at: 2026-08-11
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

