---
slug: finalize-release
title: "Finalize: changelog, docs, commits + release"
status: pending
created: 2026-08-11
order: 12
project: state-safety
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - board-json-mutations-under-lock
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: "Conductor follow-up from the goal-mutations-under-lock lane: that lane routed every goal-FILE mutation through the ADR 0030 lock, but disclosed three lock-free read-modify-writes it did not own — writeLoopState/bumpLoopBlock and ensureQueueBranch over the JSON under .arch/board/, and appendChatEntry over the gitignored coordination board. ADR 0030's scope names the loop/queue JSON, but that lane's exit criteria did not, and half-fixing them (atomic write without the lock) would not close their lost-update window. Filed so the remaining exposure is closed deliberately rather than assumed closed."
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

