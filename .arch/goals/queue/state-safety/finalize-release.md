---
slug: finalize-release
title: "Finalize: changelog, docs, commits + release"
status: pending
created: 2026-08-11
order: 14
project: state-safety
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - doctor-hooks-path-disclosure
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: "Conductor follow-up from the hooks-status-archdir-alignment lane (ADR 0032). ADR 0032 settles that projectClaudeDir is deliberately cwd-scoped and does NOT follow ARCHKIT_ARCH_DIR, because the variable names a spec dir and promises nothing about its parent. The accepted cost, written into ADR 0032's Consequences as an explicit follow-up: `archkit doctor` run in a worktree with ARCHKIT_ARCH_DIR set becomes a chimera — D-INTENT-* describes the goals in the NAMED .arch/ while D-HOOKS describes the settings.json of the CHECKOUT the command ran in, in one report, with nothing saying so. A user could go edit the wrong repo's settings.json. Since every path involved is ALREADY in the returned JSON payload (projectSettingsPath, userSettingsPath, perSource[].path), the cure is disclosure in the human-readable output, not forced alignment. The lane worker could not do it because src/commands/doctor.mjs was outside its ownership, and recommended filing it with the concrete sites: doctor.mjs:318-336, roughly one line each at :318 and :326."
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

