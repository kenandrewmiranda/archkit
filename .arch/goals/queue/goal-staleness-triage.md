---
slug: goal-staleness-triage
title: Staleness triage lib: flag correctly-placed pending goals that look like cross-project cruft
status: pending
created: 2026-07-19
order: 1
exit-criteria:
  - New src/lib/goal-triage.mjs exports detectStaleGoals(archDir,{branch}) that scans live+pending goals and scores staleness by: no event in .arch/board/events.ndjson, no mention in goals/chat.md, old created: date, and project/branch mismatch vs the current git branch
  - Returns advisory findings only: [{slug,reasons:[...],suggestion:'hold'|'dismiss'|'keep'}] — NEVER moves or mutates any file
  - Age threshold and branch-match are configurable (read from .arch/config.json with sane defaults)
  - New test suite tests/cgr-triage/ covers: orphaned pending (no board/chat, old, other branch) flagged; active recent goal NOT flagged; missing board/chat files tolerated
- New src/lib/goal-triage.mjs exports detectStaleGoals(archDir,{branch}) that scans live+pending goals and scores staleness by: no event in .arch/board/events.ndjson, no mention in goals/chat.md, old created: date, and project/branch mismatch vs the current git branch
- Returns advisory findings only: [{slug,reasons:[...],suggestion:'hold'|'dismiss'|'keep'}] — NEVER moves or mutates any file
- New test suite tests/cgr-triage/ covers: orphaned pending (no board/chat, old, other branch) flagged; active recent goal NOT flagged; missing board/chat files tolerated
files-to-touch:
  - src/lib/goal-triage.mjs
  - tests/cgr-triage/run.mjs
required-reading:
  - src/lib/board.mjs
depends-on:
  - reconcile-goals-layout
owns:
  - src/lib/goal-triage.mjs
  - tests/cgr-triage/**
feature: goal-hygiene
verify-command: npm test
source-ask: After working multiple projects, CGR files end up in random places in the goals folder/subfolders — causing CGRs to be skipped or the next goal to get mixed up. Build a cleanup/startup workflow that runs on archkit call, auto-fixes placement when the scan detects too much out of place, and does a lightweight staleness check against chat/board for cross-project cruft. Decision: both tiers now; auto-fix inside warmup (moves reported, not silent); Tier 2 staleness stays advisory.
lane: goal-hygiene
---


# Staleness triage lib: flag correctly-placed pending goals that look like cross-project cruft

## Why
Placement reconcile can't catch a genuinely-pending goal from ANOTHER project sitting in the queue — it's correctly placed, wrong context. Cross-reference board/chat/git/age to surface it as an advisory question, never an auto-move.

## Exit criteria
- [ ] New src/lib/goal-triage.mjs exports detectStaleGoals(archDir,{branch}) that scans live+pending goals and scores staleness by: no event in .arch/board/events.ndjson, no mention in goals/chat.md, old created: date, and project/branch mismatch vs the current git branch
- [ ] Returns advisory findings only: [{slug,reasons:[...],suggestion:'hold'|'dismiss'|'keep'}] — NEVER moves or mutates any file
- [ ] Age threshold and branch-match are configurable (read from .arch/config.json with sane defaults)
- [ ] New test suite tests/cgr-triage/ covers: orphaned pending (no board/chat, old, other branch) flagged; active recent goal NOT flagged; missing board/chat files tolerated

