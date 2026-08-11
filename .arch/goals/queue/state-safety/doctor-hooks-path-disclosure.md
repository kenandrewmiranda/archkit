---
slug: doctor-hooks-path-disclosure
title: Make archkit doctor name the settings.json D-HOOKS actually read
status: pending
created: 2026-08-11
order: 13
project: state-safety
exit-criteria:
  - D-HOOKS' human-readable detail names the project settings.json it actually read, so a reader can tell which checkout the hook verdict describes without dropping to --json
  - When the resolved archDir's parent and the cwd-derived project root DIVERGE, doctor says so explicitly rather than leaving the reader to notice — this is the case ADR 0032 accepts and therefore the case that must be disclosed
  - Output when the two agree is not made noisier — the disclosure earns its space only when it is load-bearing, asserted rather than assumed
  - A test pins the divergent-case output, and would fail if the path or the divergence notice were dropped again
  - ADR 0032's Consequences follow-up is marked as discharged, with a pointer to where the disclosure now lives
  - Full suite green
files-to-touch:
  - src/commands/doctor.mjs
required-reading:
  - .arch/decisions/0032-hooks-status-is-cwd-scoped-archkit-arch-dir-names-a-spec-dir.md
  - src/lib/hooks-status.mjs
depends-on: 
owns:
  - src/commands/doctor.mjs
feature: archdir
verify-command: npm test
source-ask: "Conductor follow-up from the hooks-status-archdir-alignment lane (ADR 0032). ADR 0032 settles that projectClaudeDir is deliberately cwd-scoped and does NOT follow ARCHKIT_ARCH_DIR, because the variable names a spec dir and promises nothing about its parent. The accepted cost, written into ADR 0032's Consequences as an explicit follow-up: `archkit doctor` run in a worktree with ARCHKIT_ARCH_DIR set becomes a chimera — D-INTENT-* describes the goals in the NAMED .arch/ while D-HOOKS describes the settings.json of the CHECKOUT the command ran in, in one report, with nothing saying so. A user could go edit the wrong repo's settings.json. Since every path involved is ALREADY in the returned JSON payload (projectSettingsPath, userSettingsPath, perSource[].path), the cure is disclosure in the human-readable output, not forced alignment. The lane worker could not do it because src/commands/doctor.mjs was outside its ownership, and recommended filing it with the concrete sites: doctor.mjs:318-336, roughly one line each at :318 and :326."
lane: archdir
---


# Make archkit doctor name the settings.json D-HOOKS actually read

## Why
ADR 0032 accepts that D-HOOKS is cwd-scoped while the rest of doctor is archDir-scoped. That divergence is correct but currently INVISIBLE in terminal output — the path is in the JSON payload and nowhere in the human-readable detail string, so a worktree run with ARCHKIT_ARCH_DIR set silently reports two different projects in one report.

## Exit criteria
- [ ] D-HOOKS' human-readable detail names the project settings.json it actually read, so a reader can tell which checkout the hook verdict describes without dropping to --json
- [ ] When the resolved archDir's parent and the cwd-derived project root DIVERGE, doctor says so explicitly rather than leaving the reader to notice — this is the case ADR 0032 accepts and therefore the case that must be disclosed
- [ ] Output when the two agree is not made noisier — the disclosure earns its space only when it is load-bearing, asserted rather than assumed
- [ ] A test pins the divergent-case output, and would fail if the path or the divergence notice were dropped again
- [ ] ADR 0032's Consequences follow-up is marked as discharged, with a pointer to where the disclosure now lives
- [ ] Full suite green

