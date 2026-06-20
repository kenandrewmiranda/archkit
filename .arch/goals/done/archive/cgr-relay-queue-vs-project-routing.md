---
slug: cgr-relay-queue-vs-project-routing
title: Relay routes between queue and projects; ungrouped queue gets a dated branch
status: completed
created: 2026-06-20
epic: parallel-cgr-workflow
order: 4
exit-criteria:
  - When the live queue contains BOTH project-grouped goals AND ungrouped (no-project) goals, the relay (goal_next selection / prompt) SURFACES A CHOICE to the user — advance the queue or pick a project — instead of silently auto-picking; when only one bucket is non-empty it auto-picks as today (no extra prompt)
  - Ungrouped queue goals get branch guidance for a SINGLE shared dated branch named cgr-queue-<YYYY-MM-DD>; the branch name is recorded once (state/config) when first minted so every queue goal in the current batch REUSES it rather than creating a new branch per pick
  - renderPayload prework: if no current-queue branch is recorded, instruct `git switch -c cgr-queue-<date>`; if one is recorded, instruct switching to it — mirroring goal 0's feat/<project> guidance, and the two schemes never collide
  - in-progress resume and depends-on resolution still take precedence over the routing prompt (a genuinely active goal is never interrupted by the choice)
  - archkit only EMITS guidance and records branch state — it never runs git (consistent with the goal 0 ADR); date is stamped by archkit
  - Unit tests cover: choice surfaced when both buckets non-empty, single-bucket auto-pick, queue-branch name derivation + reuse across multiple queue goals; full suite green
  - renderPayload prework: if no current-queue branch is recorded, instruct `git switch -c cgr-queue-<date>`; if one is recorded, instruct switching to it — mirroring goal 0's feat/<project> guidance, and the two schemes never collide
  - Unit tests cover: choice surfaced when both buckets non-empty, single-bucket auto-pick, queue-branch name derivation + reuse across multiple queue goals; full suite green
- renderPayload prework: if no current-queue branch is recorded, instruct `git switch -c cgr-queue-<date>`; if one is recorded, instruct switching to it — mirroring goal 0's feat/<project> guidance, and the two schemes never collide
- Unit tests cover: choice surfaced when both buckets non-empty, single-bucket auto-pick, queue-branch name derivation + reuse across multiple queue goals; full suite green
files-to-touch:
  - src/lib/goals.mjs
  - src/mcp/prompts.mjs
  - src/mcp/tools.mjs
required-reading:
  - .arch/decisions/0003-lock-the-expanded-cgr-lifecycle-state-model-and-rename-the-s.md
  - .arch/decisions/0005-add-intentional-cgr-goal-sequencing-via-order-epic-frontmatt.md
  - src/lib/goals.mjs
  - src/mcp/prompts.mjs
depends-on:
  - cgr-project-branch-grouping
verify-command: npm test
source-ask: In addition: if there are multiple projects AND items in the queue, ask the user whether they prefer to tackle the queue or the projects. If there isn't a branch already established for the current queue, set up a new branch called cgr-queue-<current-date> (e.g. today = cgr-queue-2026-06-20).
started: 2026-06-20T16:08:29.585Z
completed: 2026-06-20T16:23:37.124Z
completion-notes: Added routeNextGoal (resume/single/choice/none) layered over nextEligibleGoal; goal_next surfaces a queue-vs-project choice via relayRoutingChoice when both tracks have eligible work, else auto-picks. New archkit_goal_start tool/CLI begins a specific chosen goal. Ungrouped queue goals share one dated cgr-queue-<date> branch recorded once in .queue-state.json (ensureQueueBranch), reused across the batch, cleared on drain; renderPayload emits create-then-switch guidance gated on the project regime. instruct-not-act preserved. ADR 0012. 12 new tests; 52/52 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-20
---



# Relay routes between queue and projects; ungrouped queue gets a dated branch

## Why
Makes the relay ask the user which track to advance when both exist, and gives ungrouped queue goals their own shared dated branch (cgr-queue-<date>) so plain queue work is still branch-isolated from project feature sets — the queue-side complement to goal 0's feat/<project> guidance.

## Exit criteria
- [ ] When the live queue contains BOTH project-grouped goals AND ungrouped (no-project) goals, the relay (goal_next selection / prompt) SURFACES A CHOICE to the user — advance the queue or pick a project — instead of silently auto-picking; when only one bucket is non-empty it auto-picks as today (no extra prompt)
- [ ] Ungrouped queue goals get branch guidance for a SINGLE shared dated branch named cgr-queue-<YYYY-MM-DD>; the branch name is recorded once (state/config) when first minted so every queue goal in the current batch REUSES it rather than creating a new branch per pick
- [ ] renderPayload prework: if no current-queue branch is recorded, instruct `git switch -c cgr-queue-<date>`; if one is recorded, instruct switching to it — mirroring goal 0's feat/<project> guidance, and the two schemes never collide
- [ ] in-progress resume and depends-on resolution still take precedence over the routing prompt (a genuinely active goal is never interrupted by the choice)
- [ ] archkit only EMITS guidance and records branch state — it never runs git (consistent with the goal 0 ADR); date is stamped by archkit
- [ ] Unit tests cover: choice surfaced when both buckets non-empty, single-bucket auto-pick, queue-branch name derivation + reuse across multiple queue goals; full suite green

