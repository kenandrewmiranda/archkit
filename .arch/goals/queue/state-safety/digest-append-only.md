---
slug: digest-append-only
title: Make consolidation append-only so concurrent Stop hooks cannot lose entries
status: pending
created: 2026-08-10
order: 4
project: state-safety
exit-criteria:
  - Consolidation no longer read-modify-writes the digest; entries are appended, so a concurrent consolidation cannot clobber another's entries
  - "Archive-then-delete ordering is preserved and made crash-safe: a goal file is never removed before its raw copy is durable"
  - Consolidation is idempotent — the existing already-consolidated slug check still holds under concurrency, with no duplicate entries
  - A test spawns genuinely concurrent consolidations and proves every entry survives and no goal file is lost
  - Existing digest format stays readable by listGoalDigests and archkit_goal_list
files-to-touch:
  - src/lib/goals.mjs
  - tests/cgr-consolidate/run.mjs
required-reading: 
depends-on:
  - goal-mutations-under-lock
owns:
  - tests/cgr-consolidate/**
feature: concurrency
verify-command: npm test
source-ask: "since we have multiple lanes, we do have some race issues on multiple fronts, can we evaluate our current strategy and how we can properly address this? — Evaluation found: CGR state is split across two stores with opposite concurrency models. The board (.arch/board/events.ndjson, gitignored) is a correct append-only log with a pure fold. Goal frontmatter (.arch/goals/**, git-tracked) is ADR 0003's declared source of truth but is mutated by lock-free read-modify-write, with zero locking anywhere in the codebase. Sharpest edges: consolidateGoals (RMW on the digest that also deletes source goal files) is called from the Stop hook, a separate process spawned at every turn-end in every session; stampGoalFields is lock-free RMW on the authoritative store; archDir is resolved from process.cwd() at ~40 MCP sites, so worktree sharing is accidental rather than contractual."
lane: lane-windows-path-portability
---


# Make consolidation append-only so concurrent Stop hooks cannot lose entries

## Why
consolidateGoals (goals.mjs:3270) reads the digest, deletes the source goal files, then writes the digest back — and it runs from bin/archkit-stop-hook.mjs, a separate process spawned at every turn-end in every session. Two sessions ending a turn together both delete files and the second write clobbers the first's entries, which are unrecoverable from goals/ because the sources are already gone. The digest is a log being maintained as a rendered document.

## Exit criteria
- [ ] Consolidation no longer read-modify-writes the digest; entries are appended, so a concurrent consolidation cannot clobber another's entries
- [ ] Archive-then-delete ordering is preserved and made crash-safe: a goal file is never removed before its raw copy is durable
- [ ] Consolidation is idempotent — the existing already-consolidated slug check still holds under concurrency, with no duplicate entries
- [ ] A test spawns genuinely concurrent consolidations and proves every entry survives and no goal file is lost
- [ ] Existing digest format stays readable by listGoalDigests and archkit_goal_list

