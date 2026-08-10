---
slug: finalize-release
title: "Finalize: changelog, docs, commits + release"
status: completed
created: 2026-08-02
order: 19
project: lane-integration
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - conductor-dispatch-claim-wiring
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: file the conductor-wiring follow-up — ADR 0027's `dispatched` state is implemented and tested but never reached in practice, because archkit_conductor's dispatch step still doesn't tell the conductor to claim each lane with archkit_goal_start {worker}. Until that wiring lands, conductors keep falling back to the archkit_goal_hold workaround, which misrepresents an actively-worked lane as deliberately parked. Observed six times across two sessions.
lane: barrier-finalize-release
started: 2026-08-03T01:19:54.489Z
completed: 2026-08-10T00:08:08.249Z
completion-notes: "All four exit-criteria met. CHANGELOG gained a third Unreleased body of work covering ADRs 0023-0029 (lane convergence, per-lane verify, PR-gated landing, graph output contract, dispatched state, claim-is-the-dispatch, gated completed event) plus the finalize version-bump step and the intake/test-isolation fixes. README corrected from a stale 35 tools to 49 with the 14 missing CGR 2.0 orchestration tools added, `dispatched` documented in the lifecycle, and a new dispatch->converge->verify->land section. Committed as 4bc5fee with the project trailer; branch pushed and landed through PR #29 per ADR 0025 (github-actions is configured, so the PR is the gate). 77/77 suites green."
---




# Finalize: changelog, docs, commits + release

## Why
Auto-appended by archkit (cgr.finalize) so this batch ends with its release chores in a fresh context: update the changelog, update documentation, finalize commits with notes/comments, push to remote. CI/CD: github-actions. archkit never runs git/deploy itself — do the local steps and instruct the user for push/release/deploy. Adjust or opt out with archkit_finalize_config (or `archkit finalize`).

## Exit criteria
- [ ] CHANGELOG updated with an entry covering this batch's changes
- [ ] Docs (README / docs/) updated to match the changes
- [ ] Work committed with descriptive messages and the project's commit trailer
- [ ] Branch pushed to the remote

