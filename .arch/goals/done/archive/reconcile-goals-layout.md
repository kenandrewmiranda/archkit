---
slug: reconcile-goals-layout
title: Placement reconciliation lib: re-file every goal to the folder its status dictates
status: completed
created: 2026-07-19
order: 0
exit-criteria:
  - Export reconcileGoalsLayout(archDir,{apply}) in goals.mjs that walks the ENTIRE goals tree at any depth, reads each file's status, and computes the canonical folder (pending->queue/ or queue/<project>/, in-progress|on-hold->root, testing->testing/, completed->done/)
  - Returns a structured report: {moved:[{slug,from,to,status}], duplicates:[{slug,kept,removed}], quarantined:[{file,reason}], outOfPlaceCount}
  - apply:false is a pure dry-run (no writes); apply:true performs the moves, resolves zombie duplicate slugs by keeping the copy whose location matches its status, and quarantines unparseable/status-less .md files (e.g. move to goals/quarantine/ or flag)
  - Never throws — a reconcile hiccup must not block the relay (mirror migratePendingGoalsToQueue's tolerance); idempotent on re-run
  - New test suite tests/cgr-reconcile/ covers: 2-level-deep pending (invisible->skipped), completed-in-queue, in-progress-in-queue, duplicate slug across dirs, junk .md file
  - Returns a structured report: {moved:[{slug,from,to,status}], duplicates:[{slug,kept,removed}], quarantined:[{file,reason}], outOfPlaceCount}
  - apply: false is a pure dry-run (no writes); apply:true performs the moves, resolves zombie duplicate slugs by keeping the copy whose location matches its status, and quarantines unparseable/status-less .md files (e.g. move to goals/quarantine/ or flag)
  - New test suite tests/cgr-reconcile/ covers: 2-level-deep pending (invisible->skipped), completed-in-queue, in-progress-in-queue, duplicate slug across dirs, junk .md file
  - Returns a structured report: {moved:[{slug,from,to,status}], duplicates:[{slug,kept,removed}], quarantined:[{file,reason}], outOfPlaceCount}
  - apply: false is a pure dry-run (no writes); apply:true performs the moves, resolves zombie duplicate slugs by keeping the copy whose location matches its status, and quarantines unparseable/status-less .md files (e.g. move to goals/quarantine/ or flag)
  - New test suite tests/cgr-reconcile/ covers: 2-level-deep pending (invisible->skipped), completed-in-queue, in-progress-in-queue, duplicate slug across dirs, junk .md file
- Returns a structured report: {moved:[{slug,from,to,status}], duplicates:[{slug,kept,removed}], quarantined:[{file,reason}], outOfPlaceCount}
- apply: false is a pure dry-run (no writes); apply:true performs the moves, resolves zombie duplicate slugs by keeping the copy whose location matches its status, and quarantines unparseable/status-less .md files (e.g. move to goals/quarantine/ or flag)
- New test suite tests/cgr-reconcile/ covers: 2-level-deep pending (invisible->skipped), completed-in-queue, in-progress-in-queue, duplicate slug across dirs, junk .md file
files-to-touch:
  - src/lib/goals.mjs
  - tests/cgr-reconcile/run.mjs
required-reading: 
depends-on: 
owns:
  - src/lib/goals.mjs
  - tests/cgr-reconcile/**
feature: goal-hygiene
verify-command: npm test
source-ask: After working multiple projects, CGR files end up in random places in the goals folder/subfolders — causing CGRs to be skipped or the next goal to get mixed up. Build a cleanup/startup workflow that runs on archkit call, auto-fixes placement when the scan detects too much out of place, and does a lightweight staleness check against chat/board for cross-project cruft. Decision: both tiers now; auto-fix inside warmup (moves reported, not silent); Tier 2 staleness stays advisory.
lane: goal-hygiene
started: 2026-07-19T20:01:06.982Z
completed: 2026-07-19T20:07:50.095Z
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---




# Placement reconciliation lib: re-file every goal to the folder its status dictates

## Why
Status is the source of truth; the folder is a derived cache. Files drift out of the narrow scan's blind spots (queue one-level-deep, root top-level only) and get skipped. A deterministic full-tree reconcile fixes the whole bug class safely.

## Exit criteria
- [ ] Export reconcileGoalsLayout(archDir,{apply}) in goals.mjs that walks the ENTIRE goals tree at any depth, reads each file's status, and computes the canonical folder (pending->queue/ or queue/<project>/, in-progress|on-hold->root, testing->testing/, completed->done/)
- [ ] Returns a structured report: {moved:[{slug,from,to,status}], duplicates:[{slug,kept,removed}], quarantined:[{file,reason}], outOfPlaceCount}
- [ ] apply:false is a pure dry-run (no writes); apply:true performs the moves, resolves zombie duplicate slugs by keeping the copy whose location matches its status, and quarantines unparseable/status-less .md files (e.g. move to goals/quarantine/ or flag)
- [ ] Never throws — a reconcile hiccup must not block the relay (mirror migratePendingGoalsToQueue's tolerance); idempotent on re-run
- [ ] New test suite tests/cgr-reconcile/ covers: 2-level-deep pending (invisible->skipped), completed-in-queue, in-progress-in-queue, duplicate slug across dirs, junk .md file

