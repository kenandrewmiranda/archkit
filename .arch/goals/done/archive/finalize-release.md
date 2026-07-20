---
slug: finalize-release
title: Finalize: changelog, docs, commits + release
status: completed
created: 2026-07-19
order: 10
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - api-registry-lib
  - api-detect-lib
  - api-registry-tools
  - api-doc-gate-hook
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: If an API is involved, the user must validate whether an API doc or SDK exists and whether it's provided. This is a hard gate (no-op): archkit blocks further development/direction until the API doc/SDK is given OR the API documentation is referenced properly before coding starts. The user must explicitly override to proceed without docs; otherwise it stays gated.
lane: barrier-finalize-release
started: 2026-07-20T01:14:09.184Z
completed: 2026-07-20T01:18:26.211Z
completion-notes: Documented the api-doc-gate batch (ADR 0022): CHANGELOG Unreleased section headlines the API-doc hard gate alongside the goals-layout reconcile; README gains an API-doc gate section, a highlight bullet, the three new MCP tools (archkit_api_register/override/list), and a tool-count bump 32->35. Committed (2288451) with the Co-Authored-By trailer and pushed to origin/main (901f91c..2288451). 69/69 suites green. Finalize itself touched no external API, so the API-doc hard gate was not triggered.
---




# Finalize: changelog, docs, commits + release

## Why
Auto-appended by archkit (cgr.finalize) so this batch ends with its release chores in a fresh context: update the changelog, update documentation, finalize commits with notes/comments, push to remote. CI/CD: github-actions. archkit never runs git/deploy itself — do the local steps and instruct the user for push/release/deploy. Adjust or opt out with archkit_finalize_config (or `archkit finalize`).

## Exit criteria
- [ ] CHANGELOG updated with an entry covering this batch's changes
- [ ] Docs (README / docs/) updated to match the changes
- [ ] Work committed with descriptive messages and the project's commit trailer
- [ ] Branch pushed to the remote

