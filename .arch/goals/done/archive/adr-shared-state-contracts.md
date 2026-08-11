---
slug: adr-shared-state-contracts
title: "ADRs: the shared-state write contract and the archDir resolution contract"
status: completed
created: 2026-08-10
order: 1
project: state-safety
exit-criteria:
  - "An ADR states the shared-state WRITE contract: which mutators are covered, atomic-replace via tmp+rename as the baseline, an advisory lock for multi-step mutations, stale-lock TTL breaking, and the fail-open-vs-fail-closed decision with its reasoning"
  - That ADR names the concrete race each rule closes (Stop-hook concurrent consolidation, stampGoalFields lost update, reclaim TOCTOU, reconcile move-under-reader) so the contract is traceable to observed defects, and states explicitly that appendEvent's O_APPEND path is already correct and is NOT to be wrapped
  - "A second ADR states the archDir RESOLUTION contract: ARCHKIT_ARCH_DIR as the explicit signal, process.cwd() as the documented fallback, and what a worktree worker is guaranteed to see — replacing today's accidental sharing"
  - "Both ADRs record what was deliberately NOT done: full event-sourcing of status transitions, and why (it rewrites ADR 0003's contract for races Tier 1 already closes)"
files-to-touch:
  - .arch/decisions/
required-reading: 
depends-on: 
owns:
  - .arch/decisions/**
exclusive: true
verify-command: npm test
source-ask: "since we have multiple lanes, we do have some race issues on multiple fronts, can we evaluate our current strategy and how we can properly address this? — Evaluation found: CGR state is split across two stores with opposite concurrency models. The board (.arch/board/events.ndjson, gitignored) is a correct append-only log with a pure fold. Goal frontmatter (.arch/goals/**, git-tracked) is ADR 0003's declared source of truth but is mutated by lock-free read-modify-write, with zero locking anywhere in the codebase. Sharpest edges: consolidateGoals (RMW on the digest that also deletes source goal files) is called from the Stop hook, a separate process spawned at every turn-end in every session; stampGoalFields is lock-free RMW on the authoritative store; archDir is resolved from process.cwd() at ~40 MCP sites, so worktree sharing is accidental rather than contractual."
lane: barrier-adr-shared-state-contracts
started: 2026-08-10T20:59:38.212Z
completed: 2026-08-10T21:07:36.002Z
completion-notes: "Authored ADR 0030 (shared-state write contract: atomic tmp+rename baseline, advisory 'wx' lockfile for read-modify-write, re-read inside the lock, TTL stale-breaking always reported, release-on-throw, fail-OPEN on acquisition with reasoning, appendEvent explicitly exempt — each rule traced to one of the four observed races) and ADR 0031 (archDir resolution: ARCHKIT_ARCH_DIR explicit signal, cwd walk-up as documented fallback, worktree-worker guarantee, stated as a prerequisite for 0030 since the lock is scoped per resolved archDir). Both record full event-sourcing as deliberately not done. Committed to feat/state-safety as f200a62; 77/77 suites green. The verify tool reports files-to-touch untouched only because the ADRs were already committed."
tests-passed: true
tests-command: npm test
tests-at: 2026-08-10
---




# ADRs: the shared-state write contract and the archDir resolution contract

## Why
Both fixes change a contract every caller depends on, and ADR numbering is itself a create-race if two goals author ADRs concurrently. Authoring them solo, first, settles the vocabulary (which mutators are 'shared-state', what the lock guarantees, what fail-open means here) before any code depends on it.

## Exit criteria
- [ ] An ADR states the shared-state WRITE contract: which mutators are covered, atomic-replace via tmp+rename as the baseline, an advisory lock for multi-step mutations, stale-lock TTL breaking, and the fail-open-vs-fail-closed decision with its reasoning
- [ ] That ADR names the concrete race each rule closes (Stop-hook concurrent consolidation, stampGoalFields lost update, reclaim TOCTOU, reconcile move-under-reader) so the contract is traceable to observed defects, and states explicitly that appendEvent's O_APPEND path is already correct and is NOT to be wrapped
- [ ] A second ADR states the archDir RESOLUTION contract: ARCHKIT_ARCH_DIR as the explicit signal, process.cwd() as the documented fallback, and what a worktree worker is guaranteed to see — replacing today's accidental sharing
- [ ] Both ADRs record what was deliberately NOT done: full event-sourcing of status transitions, and why (it rewrites ADR 0003's contract for races Tier 1 already closes)

