---
slug: finalize-release
title: Finalize: changelog, docs, commits + release
status: pending
created: 2026-08-02
order: 13
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - stop-hook-test-cwd-isolation
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: Discovered during the lane-integration dispatch pass: both worktree workers independently found that `npm test` mutates the repository's own .arch/ directory. tests/stop-hook/run.mjs spawns the Stop hook via spawnSync without a cwd option, so the hook child inherits the test runner's cwd (the repo root) even though the payload names a temp project; the queue-drain consolidation then fires against the LIVE board, archiving real CGRs into done/archive/ and writing a digest. The conductor reproduced this a third time by running npm test in a worker's worktree.
lane: barrier-finalize-release
---


# Finalize: changelog, docs, commits + release

## Why
Auto-appended by archkit (cgr.finalize) so this batch ends with its release chores in a fresh context: update the changelog, update documentation, finalize commits with notes/comments, push to remote. CI/CD: github-actions. archkit never runs git/deploy itself — do the local steps and instruct the user for push/release/deploy. Adjust or opt out with archkit_finalize_config (or `archkit finalize`).

## Exit criteria
- [ ] CHANGELOG updated with an entry covering this batch's changes
- [ ] Docs (README / docs/) updated to match the changes
- [ ] Work committed with descriptive messages and the project's commit trailer
- [ ] Branch pushed to the remote

