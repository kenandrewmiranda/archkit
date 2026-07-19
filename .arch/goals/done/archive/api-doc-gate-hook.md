---
slug: api-doc-gate-hook
title: PreToolUse hard gate: deny edits that touch an uncleared API, wire into install-hooks + ADR
status: completed
created: 2026-07-19
order: 4
project: api-doc-gate
exit-criteria:
  - A PreToolUse hook handler runs detectApis on the target of an Edit/Write/MultiEdit and, for each detected API, checks isApiCleared; if ANY is uncleared it returns a DENY (permissionDecision 'deny') whose message names the API and the exact unblock actions (archkit_api_register <id> --doc <ref>  OR  archkit_api_override <id> --reason)
  - The gate is a no-op when apiGate.enabled is false, and NEVER blocks non-code edits (docs, .arch/**, config) — only source files
  - Wired into archkit_install_hooks so installing archkit hooks installs the PreToolUse gate; the emitted settings block is idempotent (re-install does not duplicate)
  - An ADR is logged via archkit_log_decision capturing: hard gate at PreToolUse, the detect->clearance model, doc-or-explicit-override as the only clearances, and no-op-when-disabled
  - New tests/api-gate/ covers: edit touching an uncleared API -> deny with actionable message; same edit after register OR override -> allow; disabled gate -> allow; a .arch/ or docs edit -> allow
  - An ADR is logged via archkit_log_decision capturing: hard gate at PreToolUse, the detect->clearance model, doc-or-explicit-override as the only clearances, and no-op-when-disabled
  - New tests/api-gate/ covers: edit touching an uncleared API -> deny with actionable message; same edit after register OR override -> allow; disabled gate -> allow; a .arch/ or docs edit -> allow
  - An ADR is logged via archkit_log_decision capturing: hard gate at PreToolUse, the detect->clearance model, doc-or-explicit-override as the only clearances, and no-op-when-disabled
  - New tests/api-gate/ covers: edit touching an uncleared API -> deny with actionable message; same edit after register OR override -> allow; disabled gate -> allow; a .arch/ or docs edit -> allow
  - An ADR is logged via archkit_log_decision capturing: hard gate at PreToolUse, the detect->clearance model, doc-or-explicit-override as the only clearances, and no-op-when-disabled
  - New tests/api-gate/ covers: edit touching an uncleared API -> deny with actionable message; same edit after register OR override -> allow; disabled gate -> allow; a .arch/ or docs edit -> allow
  - An ADR is logged via archkit_log_decision capturing: hard gate at PreToolUse, the detect->clearance model, doc-or-explicit-override as the only clearances, and no-op-when-disabled
  - New tests/api-gate/ covers: edit touching an uncleared API -> deny with actionable message; same edit after register OR override -> allow; disabled gate -> allow; a .arch/ or docs edit -> allow
- An ADR is logged via archkit_log_decision capturing: hard gate at PreToolUse, the detect->clearance model, doc-or-explicit-override as the only clearances, and no-op-when-disabled
- New tests/api-gate/ covers: edit touching an uncleared API -> deny with actionable message; same edit after register OR override -> allow; disabled gate -> allow; a .arch/ or docs edit -> allow
files-to-touch:
  - src/hooks/pretooluse.mjs
  - src/commands/install-hooks.mjs
  - tests/api-gate/run.mjs
required-reading: 
depends-on:
  - api-registry-lib
  - api-detect-lib
owns:
  - src/hooks/**
  - tests/api-gate/**
feature: api-gate-enforce
verify-command: npm test
source-ask: If an API is involved, the user must validate whether an API doc or SDK exists and whether it's provided. This is a hard gate (no-op): archkit blocks further development/direction until the API doc/SDK is given OR the API documentation is referenced properly before coding starts. The user must explicitly override to proceed without docs; otherwise it stays gated.
lane: api-gate-enforce
started: 2026-07-19T21:26:03.361Z
handoff: .arch/board/handoff/api-doc-gate-hook.md
testing-since: 2026-07-19T21:37:31.701Z
completed: 2026-07-19T21:41:20.462Z
completion-notes: Integrated lane api-gate-enforce via cherry-pick of worker commit 7db3873 onto main (1223bce) — clean apply, no conflicts. PreToolUse hard gate (src/hooks/pretooluse.mjs) rides the existing idempotent PreToolUse wiring in claude-settings.mjs (predicted install-hooks.mjs does not exist; one-hook-per-event model). ADR 0022 logged. Full suite 69/69 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---






# PreToolUse hard gate: deny edits that touch an uncleared API, wire into install-hooks + ADR

## Why
The actual enforcement — no coding starts against an undocumented API. Blocks Edit/Write at the keystroke until the API is registered with a doc/SDK or explicitly overridden.

## Exit criteria
- [ ] A PreToolUse hook handler runs detectApis on the target of an Edit/Write/MultiEdit and, for each detected API, checks isApiCleared; if ANY is uncleared it returns a DENY (permissionDecision 'deny') whose message names the API and the exact unblock actions (archkit_api_register <id> --doc <ref>  OR  archkit_api_override <id> --reason)
- [ ] The gate is a no-op when apiGate.enabled is false, and NEVER blocks non-code edits (docs, .arch/**, config) — only source files
- [ ] Wired into archkit_install_hooks so installing archkit hooks installs the PreToolUse gate; the emitted settings block is idempotent (re-install does not duplicate)
- [ ] An ADR is logged via archkit_log_decision capturing: hard gate at PreToolUse, the detect->clearance model, doc-or-explicit-override as the only clearances, and no-op-when-disabled
- [ ] New tests/api-gate/ covers: edit touching an uncleared API -> deny with actionable message; same edit after register OR override -> allow; disabled gate -> allow; a .arch/ or docs edit -> allow

