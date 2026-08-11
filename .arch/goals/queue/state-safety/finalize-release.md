---
slug: finalize-release
title: "Finalize: changelog, docs, commits + release"
status: pending
created: 2026-08-11
order: 8
project: state-safety
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - archdir-command-walker-residual
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: "Conductor follow-up from the explicit-archdir-resolution lane: the ARCHKIT_ARCH_DIR contract (ADR 0031) landed for the MCP server, all six hook bins and the CLI mainline, but two command modules kept verbatim private walkers in their CLI paths and therefore silently ignore the variable. Filed by the conductor rather than patched into the archdir merge, so the recorded green is not overstated."
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

