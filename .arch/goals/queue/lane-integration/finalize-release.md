---
slug: finalize-release
title: Finalize: changelog, docs, commits + release
status: pending
created: 2026-08-02
order: 17
project: lane-integration
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - dispatched-lifecycle-state
  - board-guard-concurrent-write
  - test-cwd-audit-remainder
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: file all three, then dispatch finalize-version-bump with corrected owns — the three findings from the lane-integration dispatch pass: (1) Stop-hook guard is session-scoped but goal ownership is subagent-scoped, so every conductor pass gets told to work criteria belonging to a worker in another worktree; (2) the new .arch/ board-immutability guard false-positives on concurrent worker MCP writes and blames an innocent suite; (3) ten cwd-less spawns remain in test suites neither lane owned, plus migrate-playbooks resolves the archkit bin off process.cwd().
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

