---
slug: finalize-release
title: "Finalize: changelog, docs, commits + release"
status: pending
created: 2026-08-10
order: 6
project: state-safety
exit-criteria:
  - CHANGELOG updated with an entry covering this batch's changes
  - Docs (README / docs/) updated to match the changes
  - Work committed with descriptive messages and the project's commit trailer
  - Branch pushed to the remote
files-to-touch: 
required-reading: 
depends-on:
  - adr-shared-state-contracts
  - fslock-primitive
  - goal-mutations-under-lock
  - digest-append-only
  - explicit-archdir-resolution
owns:
  - CHANGELOG.md
  - CHANGELOG
  - README.md
  - docs/**
feature: finalize
exclusive: true
verify-command: 
source-ask: "since we have multiple lanes, we do have some race issues on multiple fronts, can we evaluate our current strategy and how we can properly address this? — Evaluation found: CGR state is split across two stores with opposite concurrency models. The board (.arch/board/events.ndjson, gitignored) is a correct append-only log with a pure fold. Goal frontmatter (.arch/goals/**, git-tracked) is ADR 0003's declared source of truth but is mutated by lock-free read-modify-write, with zero locking anywhere in the codebase. Sharpest edges: consolidateGoals (RMW on the digest that also deletes source goal files) is called from the Stop hook, a separate process spawned at every turn-end in every session; stampGoalFields is lock-free RMW on the authoritative store; archDir is resolved from process.cwd() at ~40 MCP sites, so worktree sharing is accidental rather than contractual."
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

