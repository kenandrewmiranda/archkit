---
slug: finalize-release
title: "Finalize: changelog, docs, commits + release"
status: completed
created: 2026-08-12
order: 16
project: state-safety
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - proposal-config-json-under-lock
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: "Conductor residual from the board-json-mutations-under-lock lane: that lane closed the loop-state, queue-branch and chat-board write paths, but three lock-free read-modify-writes over JSON remain outside its named scope."
lane: barrier-finalize-release
started: 2026-08-13T03:37:32.625Z
completed: 2026-08-13T03:42:05.475Z
completion-notes: CHANGELOG Unreleased grew from three bodies of work to four — the shared-state write contract (fslock primitive, atomic replace, advisory lock, 30s stale TTL, appendEvent deliberately unwrapped), the five race families it closed, the ARCHKIT_ARCH_DIR resolution contract incl. its one intended divergence, and doctor's D-HOOKS path disclosure. README gained a Highlights bullet, a "Shared state under concurrency" section, an Environment table documenting ARCHKIT_ARCH_DIR as public interface per ADR 0031, and a refreshed footprint (109 modules / 84 suites; tool count re-verified at 49). Committed d5420a8 with the Co-Authored-By trailer and pushed to origin/feat/state-safety. 84/84 suites green. PR to main not opened — PR-gated landing is the user's call.
---




# Finalize: changelog, docs, commits + release

## Why
Auto-appended by archkit (cgr.finalize) so this batch ends with its release chores in a fresh context: update the changelog, update documentation, finalize commits with notes/comments, push to remote. CI/CD: github-actions. archkit never runs git/deploy itself — do the local steps and instruct the user for push/release/deploy. Adjust or opt out with archkit_finalize_config (or `archkit finalize`).

## Exit criteria
- [ ] CHANGELOG updated with an entry covering this batch's changes
- [ ] Docs (README / docs/) updated to match the changes
- [ ] Work committed with descriptive messages and the project's commit trailer
- [ ] Branch pushed to the remote

