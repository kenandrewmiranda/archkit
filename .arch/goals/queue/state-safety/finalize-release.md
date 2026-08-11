---
slug: finalize-release
title: "Finalize: changelog, docs, commits + release"
status: pending
created: 2026-08-11
order: 10
project: state-safety
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - hooks-status-archdir-alignment
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: "Conductor follow-up from the archdir-command-walker-residual lane: the worker disclosed that src/lib/hooks-status.mjs projectClaudeDir is a genuine sibling of the retired private walkers — it walks up looking for .arch/.claude as a root marker and ignores ARCHKIT_ARCH_DIR. It returns a .claude/ path rather than an archDir, so it was allowlisted in the new anti-regression guard with that reason rather than silently changed, since src/lib/hooks-status.mjs was outside that lane's ownership. Filed so the exception is revisited deliberately instead of hardening into permanent cover."
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

