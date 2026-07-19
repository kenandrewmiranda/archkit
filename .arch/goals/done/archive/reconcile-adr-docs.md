---
slug: reconcile-adr-docs
title: ADR + docs: log the placement-derived-from-status reconcile invariant and auto-fix-at-warmup decision
status: completed
created: 2026-07-19
order: 4
exit-criteria:
  - archkit_log_decision ADR recording: (1) folder is a derived cache, status is source of truth; (2) warmup auto-fixes placement but reports moves; (3) staleness triage is advisory-only
  - CHANGELOG entry for the reconcile/triage feature + new archkit_goal_reconcile tool
  - README/docs mention the startup cleanup behavior and the manual tool
  - archkit_log_decision ADR recording: (1) folder is a derived cache, status is source of truth; (2) warmup auto-fixes placement but reports moves; (3) staleness triage is advisory-only
  - archkit_log_decision ADR recording: (1) folder is a derived cache, status is source of truth; (2) warmup auto-fixes placement but reports moves; (3) staleness triage is advisory-only
- archkit_log_decision ADR recording: (1) folder is a derived cache, status is source of truth; (2) warmup auto-fixes placement but reports moves; (3) staleness triage is advisory-only
files-to-touch:
  - CHANGELOG.md
  - README.md
required-reading: 
depends-on:
  - warmup-reconcile-surface
  - goal-reconcile-tool
owns:
  - src/.arch-docs-placeholder
  - CHANGELOG.md
  - README.md
feature: docs
verify-command: npm test
source-ask: After working multiple projects, CGR files end up in random places in the goals folder/subfolders — causing CGRs to be skipped or the next goal to get mixed up. Build a cleanup/startup workflow that runs on archkit call, auto-fixes placement when the scan detects too much out of place, and does a lightweight staleness check against chat/board for cross-project cruft. Decision: both tiers now; auto-fix inside warmup (moves reported, not silent); Tier 2 staleness stays advisory.
lane: docs
started: 2026-07-19T20:59:57.117Z
completed: 2026-07-19T21:13:07.128Z
completion-notes: ADR 0021 logged (cross-refs ADR 0020 deferred wiring + ADR 0003 status authority); CHANGELOG + README document warmup reconcile auto-fix and archkit_goal_reconcile. Deep-reviewed for cross-lane conflict with blocked finalize-release: edits are additive (new Unreleased section, tool-count bump) so the eventual release merge won't clash. Suite 67/67.
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---




# ADR + docs: log the placement-derived-from-status reconcile invariant and auto-fix-at-warmup decision

## Why
Non-trivial architectural choice (auto-mutating file moves at warmup) needs an ADR for the next context reset; docs/changelog surface the new behavior.

## Exit criteria
- [ ] archkit_log_decision ADR recording: (1) folder is a derived cache, status is source of truth; (2) warmup auto-fixes placement but reports moves; (3) staleness triage is advisory-only
- [ ] CHANGELOG entry for the reconcile/triage feature + new archkit_goal_reconcile tool
- [ ] README/docs mention the startup cleanup behavior and the manual tool

