---
slug: windows-path-portability
title: Fix the Windows path-separator bug failing reconcile on CI
status: completed
created: 2026-08-10
order: 0
project: lane-integration
exit-criteria:
  - The failing cgr-reconcile duplicate-slug assertion passes on Windows path separators (reproduce by asserting against a normalized path, not by loosening the assertion)
  - Every path comparison and path-derived report value in reconcileGoalsLayout is separator-normalized, not just the one the test caught
  - A regression guard covers the separator case so a future path comparison cannot silently regress on Windows only
  - "Full suite green locally; the windows-latest check on PR #29 goes green"
files-to-touch:
  - src/lib/goals.mjs
  - tests/cgr-reconcile/run.mjs
required-reading: 
depends-on: 
owns:
  - src/lib/goals.mjs
  - tests/cgr-reconcile/**
feature: portability
verify-command: npm test
source-ask: "since we have multiple lanes, we do have some race issues on multiple fronts, can we evaluate our current strategy and how we can properly address this? — Evaluation found: CGR state is split across two stores with opposite concurrency models. The board (.arch/board/events.ndjson, gitignored) is a correct append-only log with a pure fold. Goal frontmatter (.arch/goals/**, git-tracked) is ADR 0003's declared source of truth but is mutated by lock-free read-modify-write, with zero locking anywhere in the codebase. Sharpest edges: consolidateGoals (RMW on the digest that also deletes source goal files) is called from the Stop hook, a separate process spawned at every turn-end in every session; stampGoalFields is lock-free RMW on the authoritative store; archDir is resolved from process.cwd() at ~40 MCP sites, so worktree sharing is accidental rather than contractual."
lane: lane-windows-path-portability
started: 2026-08-10T20:49:17.875Z
completed: 2026-08-10T20:57:04.940Z
completion-notes: "Routed every path-derived report value and every path ORDERING compare in reconcileGoalsLayout through toPosixPath (new relGoalPath helper, normalized sortKey for the duplicate keeper tie-break, POSIX-normalized unsafe-slug basename check). Duplicate-slug assertions are now exact forward-slash comparisons instead of endsWith(path.join(...)); four regression guards (incl. a source audit rejecting any unwrapped path.relative in the region) fail on every platform, not just Windows. 77/77 suites green locally; PR #29 is now green on BOTH legs — windows-latest 1m37s pass, the last red check on the lane-integration batch."
tests-passed: true
tests-command: npm test
tests-at: 2026-08-10
---




# Fix the Windows path-separator bug failing reconcile on CI

## Why
tests/cgr-reconcile 'a duplicate slug collapses to the copy whose location matches its status' fails on windows-latest with AssertionError: goals\testing\dup.md — a backslash path compared against a forward-slash expectation. Pre-existing on main from ADRs 0020/0021; it is the only red check on PR #29 (ubuntu passes, 76/77 pass on Windows), so the lane-integration batch cannot land until it is fixed.

## Exit criteria
- [ ] The failing cgr-reconcile duplicate-slug assertion passes on Windows path separators (reproduce by asserting against a normalized path, not by loosening the assertion)
- [ ] Every path comparison and path-derived report value in reconcileGoalsLayout is separator-normalized, not just the one the test caught
- [ ] A regression guard covers the separator case so a future path comparison cannot silently regress on Windows only
- [ ] Full suite green locally; the windows-latest check on PR #29 goes green

