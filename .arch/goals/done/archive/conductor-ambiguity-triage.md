---
slug: conductor-ambiguity-triage
title: Generalize routeNextGoal into an ambiguity-gated triage decision (pure lib)
status: completed
created: 2026-07-19
order: 1
exit-criteria:
  - routeNextGoal (or a new sibling e.g. triageNextGoal) classifies board state into `single` (exactly one obvious thing -> auto-pick as today) vs `choice` (mixed/ambiguous -> caller should ask), covering all dimensions: multiple tracks, non-empty testing backlog, on-hold work, and empty/blocked queue
  - The `choice` return carries the board slices needed to render the question: queue slugs + next, per-project slugs + next, testing count + slugs, on-hold count + slugs, and an explicit `empty` signal when nothing is eligible (so the caller can offer a plan/intake path)
  - Single-track-with-no-notable-debt still returns `single` so the frictionless /clear -> /conductor loop is preserved for the trivial case; in-progress resume still pre-empts any choice
  - A `cgr.triageMode` config knob (values: `ambiguity` default | `always` | `off`) is resolved from .arch/config.json via the existing readCgrConfig/backlogThreshold pattern, tolerant of missing/invalid config, so `always` forces a choice every pass and `off` restores pure auto-pick
  - Unit tests cover: single-track auto-pick, multi-track choice, testing-debt-present choice, only-on-hold, empty-queue signal, in-progress pre-emption, and each triageMode value
  - routeNextGoal (or a new sibling e.g. triageNextGoal) classifies board state into `single` (exactly one obvious thing -> auto-pick as today) vs `choice` (mixed/ambiguous -> caller should ask), covering all dimensions: multiple tracks, non-empty testing backlog, on-hold work, and empty/blocked queue
  - The `choice` return carries the board slices needed to render the question: queue slugs + next, per-project slugs + next, testing count + slugs, on-hold count + slugs, and an explicit `empty` signal when nothing is eligible (so the caller can offer a plan/intake path)
  - A `cgr.triageMode` config knob (values: `ambiguity` default | `always` | `off`) is resolved from .arch/config.json via the existing readCgrConfig/backlogThreshold pattern, tolerant of missing/invalid config, so `always` forces a choice every pass and `off` restores pure auto-pick
  - Unit tests cover: single-track auto-pick, multi-track choice, testing-debt-present choice, only-on-hold, empty-queue signal, in-progress pre-emption, and each triageMode value
  - routeNextGoal (or a new sibling e.g. triageNextGoal) classifies board state into `single` (exactly one obvious thing -> auto-pick as today) vs `choice` (mixed/ambiguous -> caller should ask), covering all dimensions: multiple tracks, non-empty testing backlog, on-hold work, and empty/blocked queue
  - The `choice` return carries the board slices needed to render the question: queue slugs + next, per-project slugs + next, testing count + slugs, on-hold count + slugs, and an explicit `empty` signal when nothing is eligible (so the caller can offer a plan/intake path)
  - A `cgr.triageMode` config knob (values: `ambiguity` default | `always` | `off`) is resolved from .arch/config.json via the existing readCgrConfig/backlogThreshold pattern, tolerant of missing/invalid config, so `always` forces a choice every pass and `off` restores pure auto-pick
  - Unit tests cover: single-track auto-pick, multi-track choice, testing-debt-present choice, only-on-hold, empty-queue signal, in-progress pre-emption, and each triageMode value
  - routeNextGoal (or a new sibling e.g. triageNextGoal) classifies board state into `single` (exactly one obvious thing -> auto-pick as today) vs `choice` (mixed/ambiguous -> caller should ask), covering all dimensions: multiple tracks, non-empty testing backlog, on-hold work, and empty/blocked queue
  - The `choice` return carries the board slices needed to render the question: queue slugs + next, per-project slugs + next, testing count + slugs, on-hold count + slugs, and an explicit `empty` signal when nothing is eligible (so the caller can offer a plan/intake path)
  - A `cgr.triageMode` config knob (values: `ambiguity` default | `always` | `off`) is resolved from .arch/config.json via the existing readCgrConfig/backlogThreshold pattern, tolerant of missing/invalid config, so `always` forces a choice every pass and `off` restores pure auto-pick
  - Unit tests cover: single-track auto-pick, multi-track choice, testing-debt-present choice, only-on-hold, empty-queue signal, in-progress pre-emption, and each triageMode value
- routeNextGoal (or a new sibling e.g. triageNextGoal) classifies board state into `single` (exactly one obvious thing -> auto-pick as today) vs `choice` (mixed/ambiguous -> caller should ask), covering all dimensions: multiple tracks, non-empty testing backlog, on-hold work, and empty/blocked queue
- The `choice` return carries the board slices needed to render the question: queue slugs + next, per-project slugs + next, testing count + slugs, on-hold count + slugs, and an explicit `empty` signal when nothing is eligible (so the caller can offer a plan/intake path)
- A `cgr.triageMode` config knob (values: `ambiguity` default | `always` | `off`) is resolved from .arch/config.json via the existing readCgrConfig/backlogThreshold pattern, tolerant of missing/invalid config, so `always` forces a choice every pass and `off` restores pure auto-pick
- Unit tests cover: single-track auto-pick, multi-track choice, testing-debt-present choice, only-on-hold, empty-queue signal, in-progress pre-emption, and each triageMode value
files-to-touch:
  - src/lib/goals.mjs
  - tests/
required-reading: 
depends-on: 
owns:
  - src/lib/goals.mjs
verify-command: npm test
source-ask: As I develop with archkit, what gets pulled in next is a clear issue — the conductor just mindlessly picks the next queue number and runs it. We should make the workflow ask the user whether to work the queue, projects, testing, or help set up a plan on what to tackle next — being more project-aware / aware of what's been going on. Review how influential the board is at startup and the overall selection business logic.
lane: lane-conductor-ambiguity-triage
started: 2026-07-19T17:56:34.078Z
on-hold-since: 2026-07-19
completed: 2026-07-19T18:03:27.526Z
completion-notes: Added pure-lib triageNextGoal + triageMode (cgr.triageMode: ambiguity|always|off) to src/lib/goals.mjs — generalizes routeNextGoal into a full-board single/choice/none/resume classification across all dimensions (tracks, testing backlog, on-hold, empty). routeNextGoal left unchanged for back-compat (prompt wiring is the separate queued goal). New suite tests/cgr-triage/run.mjs (18 tests). ADR 0019 logged. 62/62 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---





# Generalize routeNextGoal into an ambiguity-gated triage decision (pure lib)

## Why
Today routeNextGoal only surfaces a choice when BOTH an ungrouped queue AND a project track are live; every other mixed state (accumulating testing debt, only-project goals, on-hold work, empty queue) is silently auto-picked. This is the root of "mindlessly picking the next queue number".

## Exit criteria
- [ ] routeNextGoal (or a new sibling e.g. triageNextGoal) classifies board state into `single` (exactly one obvious thing -> auto-pick as today) vs `choice` (mixed/ambiguous -> caller should ask), covering all dimensions: multiple tracks, non-empty testing backlog, on-hold work, and empty/blocked queue
- [ ] The `choice` return carries the board slices needed to render the question: queue slugs + next, per-project slugs + next, testing count + slugs, on-hold count + slugs, and an explicit `empty` signal when nothing is eligible (so the caller can offer a plan/intake path)
- [ ] Single-track-with-no-notable-debt still returns `single` so the frictionless /clear -> /conductor loop is preserved for the trivial case; in-progress resume still pre-empts any choice
- [ ] A `cgr.triageMode` config knob (values: `ambiguity` default | `always` | `off`) is resolved from .arch/config.json via the existing readCgrConfig/backlogThreshold pattern, tolerant of missing/invalid config, so `always` forces a choice every pass and `off` restores pure auto-pick
- [ ] Unit tests cover: single-track auto-pick, multi-track choice, testing-debt-present choice, only-on-hold, empty-queue signal, in-progress pre-emption, and each triageMode value

