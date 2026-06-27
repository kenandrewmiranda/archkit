# 0018. Auto-append a configurable finalization goal to every CGR batch

- **Date**: 2026-06-27
- **Status**: Accepted
- **Tags**: cgr, intake, release, ci-cd, config, dx

## Context

Beta testers asked that every CGR batch always end with the release chores — update the changelog, refresh docs, finalize commits with notes, push, set up a release, deploy to development — done in a fresh, focused context rather than tacked onto the last feature goal while the window is full. These steps vary per project and per CI/CD setup, so they must be configurable (opt in/out per step) and asked ONCE, not re-prompted every intake.

## Decision

Add a synthesized "finalization" goal that archkit_goal_intake auto-appends to a batch. It is an exclusive barrier that dependsOn every batch goal, so the lane partition schedules it LAST and SOLO; its exit-criteria are exactly the enabled steps. Config lives in .arch/config.json → cgr.finalize (extending the existing cgr.* block, not a new file): { enabled, configured, steps:{changelog,docs,commit,push,release,deployDev}, ciCd, deployCommand }. Defaults: changelog/docs/commit ON, push/release/deployDev OFF (outward-facing steps are a deliberate opt-in). The append is GATED on configured:true — a project's first intake appends nothing and instead surfaces a one-time setup nudge (finalize.setup) that the agent presents via AskUserQuestion and persists with a new archkit_finalize_config tool (also an `archkit finalize` CLI). Enabling back-fills the finalize goal onto the already-queued batch so the first run loses nothing. archkit never runs git/deploy itself — the goal carries steps as exit-criteria; the agent does the local ones and instructs the user for push/release/deploy, consistent with the existing branch-guidance principle. runFinalizeConfig lives in lib/goals.mjs (not the self-executing goal command) so the CLI can call it without triggering goal.mjs's main().

## Consequences

Easier: sprawling asks reliably end with changelog/docs/commits/release done in a clean context; the policy is set once per project and flexible per step + CI/CD. Harder/constrained: intake output now varies with config (an extra goal once configured) — tests and any count-based assertions must account for it; the gate-on-configured plus back-fill adds a small amount of intake/config coupling. Outward steps default OFF, so a project wanting full automation must opt in. The finalize goal has no test gate (verify-command empty) since it is a meta wrap-up. A second intake without draining re-writes finalize-release over the prior one (single slug) — acceptable since it is regenerated against the current batch.
