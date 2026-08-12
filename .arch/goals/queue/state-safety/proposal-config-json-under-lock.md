---
slug: proposal-config-json-under-lock
title: "Close the last lock-free read-modify-writes: goal proposals and the archkit config JSON"
status: pending
created: 2026-08-12
order: 20
project: state-safety
exit-criteria:
  - saveGoalProposal and the proposal-gap rewrite at src/lib/goals.mjs:1103 read INSIDE the ADR 0030 lock and write atomically, so a concurrent session cannot erase a proposal or a gap another one just recorded
  - The config JSON read-modify-write at src/lib/goals.mjs:2499 is either converted the same way or documented in place as safe, with the reason it cannot lose an update
  - A test spawns concurrent real processes against a temp fixture and proves no proposal and no gap is lost, with a pre-fix negative control that fails loudly if the workload is too weak to lose one
  - "No new silent fail-open: any lock-acquisition failure on a converted path warns per ADR 0030 section 7, consistent with the paths converted by the prior lane"
  - An audit test pins that these writers stay locked and atomic, in the same shape as the tests/board-json-lock audits, so a future edit cannot quietly revert them
  - Full suite green, with existing single-process behavior unchanged
files-to-touch:
  - src/lib/goals.mjs
required-reading:
  - .arch/decisions/0030-fslock-primitive.md
  - src/lib/fslock.mjs
  - tests/board-json-lock/run.mjs
depends-on: 
owns:
  - src/lib/goals.mjs
feature: concurrency
verify-command: npm test
source-ask: "Conductor residual from the board-json-mutations-under-lock lane: that lane closed the loop-state, queue-branch and chat-board write paths, but three lock-free read-modify-writes over JSON remain outside its named scope."
lane: concurrency
---


# Close the last lock-free read-modify-writes: goal proposals and the archkit config JSON

## Why
board-json-mutations-under-lock closed the loop-state, queue-branch and chat-board paths, but three JSON read-modify-writes were outside its named scope and remain lock-free. The proposal-gap rewrite is the sharpest: it is a load-modify-write of a file another session can also write, so the same lost-update shape ADR 0030 exists to prevent is still live there.

## Exit criteria
- [ ] saveGoalProposal and the proposal-gap rewrite at src/lib/goals.mjs:1103 read INSIDE the ADR 0030 lock and write atomically, so a concurrent session cannot erase a proposal or a gap another one just recorded
- [ ] The config JSON read-modify-write at src/lib/goals.mjs:2499 is either converted the same way or documented in place as safe, with the reason it cannot lose an update
- [ ] A test spawns concurrent real processes against a temp fixture and proves no proposal and no gap is lost, with a pre-fix negative control that fails loudly if the workload is too weak to lose one
- [ ] No new silent fail-open: any lock-acquisition failure on a converted path warns per ADR 0030 section 7, consistent with the paths converted by the prior lane
- [ ] An audit test pins that these writers stay locked and atomic, in the same shape as the tests/board-json-lock audits, so a future edit cannot quietly revert them
- [ ] Full suite green, with existing single-process behavior unchanged

