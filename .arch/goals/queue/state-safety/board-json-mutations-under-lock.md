---
slug: board-json-mutations-under-lock
title: Close the remaining lock-free read-modify-writes over .arch/board/ JSON and the chat board
status: pending
created: 2026-08-11
order: 11
project: state-safety
exit-criteria:
  - writeLoopState, bumpLoopBlock and ensureQueueBranch read INSIDE the lock and write atomically, so a concurrent turn-end cannot lose a turn-cap increment or a queue-branch record
  - appendChatEntry no longer loses an entry when two agents announce at once — either under the lock or converted to a genuinely append-only write
  - A test spawns concurrent writers against a temp fixture and proves no update is lost, with a pre-fix negative control that fails loudly if the workload is too weak to lose one
  - Lock-acquisition failure behaves consistently with ADR 0030 section 7 and is loud, not silent — no new silent fail-open on any converted path
  - Full suite green, with existing single-process behavior unchanged
files-to-touch:
  - src/lib/board.mjs
  - src/lib/goals.mjs
required-reading:
  - .arch/decisions/0030-fslock-primitive.md
  - src/lib/fslock.mjs
depends-on:
  - digest-append-only
owns:
  - src/lib/board.mjs
feature: concurrency
verify-command: npm test
source-ask: "Conductor follow-up from the goal-mutations-under-lock lane: that lane routed every goal-FILE mutation through the ADR 0030 lock, but disclosed three lock-free read-modify-writes it did not own — writeLoopState/bumpLoopBlock and ensureQueueBranch over the JSON under .arch/board/, and appendChatEntry over the gitignored coordination board. ADR 0030's scope names the loop/queue JSON, but that lane's exit criteria did not, and half-fixing them (atomic write without the lock) would not close their lost-update window. Filed so the remaining exposure is closed deliberately rather than assumed closed."
lane: concurrency
---


# Close the remaining lock-free read-modify-writes over .arch/board/ JSON and the chat board

## Why
goal-mutations-under-lock made the goal files safe, which makes the remaining holes easier to mistake for closed. writeLoopState/bumpLoopBlock and ensureQueueBranch still read-modify-write JSON under .arch/board/, and appendChatEntry is a lock-free append-RMW on the shared coordination board. The Stop hook runs in a separate process at every turn-end in every session, so these are exactly the multi-writer paths ADR 0030 was written for.

## Exit criteria
- [ ] writeLoopState, bumpLoopBlock and ensureQueueBranch read INSIDE the lock and write atomically, so a concurrent turn-end cannot lose a turn-cap increment or a queue-branch record
- [ ] appendChatEntry no longer loses an entry when two agents announce at once — either under the lock or converted to a genuinely append-only write
- [ ] A test spawns concurrent writers against a temp fixture and proves no update is lost, with a pre-fix negative control that fails loudly if the workload is too weak to lose one
- [ ] Lock-acquisition failure behaves consistently with ADR 0030 section 7 and is loud, not silent — no new silent fail-open on any converted path
- [ ] Full suite green, with existing single-process behavior unchanged

