---
slug: cgr-backlog-ordering
title: Add the backlog-threshold ordering knob to nextEligibleGoal (drain testing before debt grows unbounded)
status: done
created: 2026-06-07
exit-criteria:
  - nextEligibleGoal prefers pending work until the testing backlog crosses a configurable threshold (N items or oldest-is-M-days), then prefers draining testing/
  - Threshold is a documented config knob with a sensible default; default behavior is the simple pending-first batch
  - Resume-in-progress and depends-on resolution still take precedence over the new ordering
  - Unit tests cover below-threshold (pending-first) and above-threshold (testing-first) selection, suite green
files-to-touch:
  - src/lib/goals.mjs
required-reading:
  - src/lib/goals.mjs
depends-on:
  - cgr-testing-state
verify-command: npm test
source-ask: Conference feedback on CGR flow: add more states. Proposed folders pending/deferred/testing/completed. MCP scans pending→testing→deferred; when empty, consolidate completed into a per-session/day summary. Note: keep the original raw CGR file in an archive folder within completed/ so an agent can still pull full context. Decided to extend the relay loop, not rebuild: add a `testing` (edit-applied/unverified) state, rename the set-aside state to avoid the existing `deferred`/proposed collision, add a backlog-threshold ordering knob, and add an incremental consolidation/digest phase.
started: 2026-06-07
completed: 2026-06-07
completion-notes: Added backlog-threshold ordering to nextEligibleGoal: in-progress resume and depends-on still take precedence, then pending-first until the testing backlog crosses .arch/config.json → cgr.backlogThreshold (default count 5 / ageDays 7), then testing-first to drain debt. New tests/cgr-backlog suite covers below/above threshold (count + age), config override, and precedence; all 48 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-07
---



# Add the backlog-threshold ordering knob to nextEligibleGoal (drain testing before debt grows unbounded)

## Why
Pure pending-first ordering optimizes for the exact failure mode reported (debt piles up mid-sprint). Hybrid: pending-first while testing backlog is small, force-drain testing once it crosses a configurable threshold (count or age).

## Exit criteria
- [ ] nextEligibleGoal prefers pending work until the testing backlog crosses a configurable threshold (N items or oldest-is-M-days), then prefers draining testing/
- [ ] Threshold is a documented config knob with a sensible default; default behavior is the simple pending-first batch
- [ ] Resume-in-progress and depends-on resolution still take precedence over the new ordering
- [ ] Unit tests cover below-threshold (pending-first) and above-threshold (testing-first) selection, suite green

