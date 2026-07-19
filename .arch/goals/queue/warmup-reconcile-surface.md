---
slug: warmup-reconcile-surface
title: Wire auto-fix + advisory triage into resolve_warmup (moves reported, threshold-gated)
status: pending
created: 2026-07-19
order: 2
exit-criteria:
  - archkit_resolve_warmup calls reconcileGoalsLayout(apply:true); moved/quarantined/duplicate items are REPORTED in the warmup checks/actions output (never a silent move)
  - A configurable threshold gates escalation: when outOfPlaceCount crosses it, warmup emits a prominent warning; below it, a quiet informational note
  - Warmup calls detectStaleGoals and surfaces findings as an ADVISORY action ('N pending goals look like other-project cruft — hold/dismiss/keep?') — never auto-acted
  - Warmup stays never-throw and the reconcile/triage additions don't regress its <200ms structural-check budget materially
  - tests/mcp-server assertion covers the new warmup slices (moved report + stale advisory)
- archkit_resolve_warmup calls reconcileGoalsLayout(apply: true); moved/quarantined/duplicate items are REPORTED in the warmup checks/actions output (never a silent move)
- A configurable threshold gates escalation: when outOfPlaceCount crosses it, warmup emits a prominent warning; below it, a quiet informational note
files-to-touch:
  - src/mcp/tools.mjs
  - tests/mcp-server/run.mjs
required-reading: 
depends-on:
  - reconcile-goals-layout
  - goal-staleness-triage
owns:
  - src/mcp/tools.mjs
feature: warmup-surface
verify-command: npm test
source-ask: After working multiple projects, CGR files end up in random places in the goals folder/subfolders — causing CGRs to be skipped or the next goal to get mixed up. Build a cleanup/startup workflow that runs on archkit call, auto-fixes placement when the scan detects too much out of place, and does a lightweight staleness check against chat/board for cross-project cruft. Decision: both tiers now; auto-fix inside warmup (moves reported, not silent); Tier 2 staleness stays advisory.
lane: warmup-surface
---


# Wire auto-fix + advisory triage into resolve_warmup (moves reported, threshold-gated)

## Why
Warmup already runs at SessionStart and gates debt (W014/W015 pattern). Fold reconcile+triage in: auto-fix placement but REPORT the moves (not silent), and surface Tier 2 as an advisory prompt.

## Exit criteria
- [ ] archkit_resolve_warmup calls reconcileGoalsLayout(apply:true); moved/quarantined/duplicate items are REPORTED in the warmup checks/actions output (never a silent move)
- [ ] A configurable threshold gates escalation: when outOfPlaceCount crosses it, warmup emits a prominent warning; below it, a quiet informational note
- [ ] Warmup calls detectStaleGoals and surfaces findings as an ADVISORY action ('N pending goals look like other-project cruft — hold/dismiss/keep?') — never auto-acted
- [ ] Warmup stays never-throw and the reconcile/triage additions don't regress its <200ms structural-check budget materially
- [ ] tests/mcp-server assertion covers the new warmup slices (moved report + stale advisory)

