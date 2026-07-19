# 0022. API-doc hard gate at PreToolUse — detect-then-clearance, doc-or-override only, no-op when disabled

- **Date**: 2026-07-19
- **Status**: Accepted
- **Tags**: api-doc-gate, hooks, pretooluse, enforcement, cgr

## Context

If an API is involved in a change, the developer must validate that an API doc or SDK exists and is referenced BEFORE coding against it — otherwise work proceeds against an undocumented/guessed API surface. A post-hoc lint or review flag is too late: the edit has already landed and the wrong mental model is baked in. We needed enforcement at the moment of the edit, but one that never impedes non-API work or documentation, and that can be turned off per project.

This is the enforcement half of the api-doc-gate feature set (project api-doc-gate): the api-registry lib (manifest + isApiCleared/register/override) and the api-detect lib (detectApis heuristic) landed first; the MCP tools (archkit_api_register/override/list) provide the escape hatches; this decision covers the gate that ties them together.

## Decision

Enforce the API-doc requirement as a HARD GATE at PreToolUse (src/hooks/pretooluse.mjs), riding archkit's already-installed PreToolUse guardrail bin (bin/archkit-pretooluse-hook.mjs, wired idempotently via src/lib/claude-settings.mjs — one hook per event).

Model:
1. Hard gate at PreToolUse. On an Edit/Write/MultiEdit the gate runs BEFORE the edit lands and returns permissionDecision 'deny' (nothing is written) when any involved API is uncleared. It runs before the boundary gate and fails open, so it fires even without a BOUNDARIES.md.
2. Detect -> clearance. detectApis scans the post-edit content for API involvement; each detected API is checked with isApiCleared. Any single uncleared API blocks the whole edit.
3. Doc-or-explicit-override are the ONLY clearances. An API clears one of two ways: a registered real doc/SDK reference (archkit_api_register <id> --doc <ref>) or an explicit human override with a reason (archkit_api_override <id> --reason). Unknown/pending stays blocked. The deny message names each uncleared API and prints both unblock commands verbatim.
4. No-op when disabled + source-only + fail-open. When apiGate.enabled is false the gate is a complete no-op. Only code source files are gated (extension allowlist); docs, .arch/**, config, and lockfiles are never blocked. Any error in the gate fails open to preserve trust in the hook.

Ownership note: the goal predicted a src/commands/install-hooks.mjs shared edit, but that file does not exist — the install path is src/commands/hooks.mjs + src/lib/claude-settings.mjs and already registers the PreToolUse hook idempotently. Adding a second PreToolUse entry would violate the one-hook-per-event model (asserted by the hooks-status tests), so the gate rides the existing guardrail rather than adding a duplicate.

## Consequences

Easier:
- No coding starts against an undocumented API — the requirement is enforced at the keystroke, not caught later in review.
- Two clear, self-documenting escape hatches surfaced in the deny message itself; the manifest status is the single source of truth for what is cleared.
- Docs, spec (.arch/**), and config edits are never impeded; disabling per project is a one-flag no-op; a gate bug fails open rather than bricking edits.

Harder / constrained:
- apiGate defaults enabled:true (inherited from the api-registry lib). On merge, every archkit project that has the PreToolUse hook installed begins enforcing immediately. Whether default-on is right for the release vs. opt-in for existing users is an open product question flagged for the maintainer — this ADR records the mechanism, not the rollout default.
- Detection is heuristic (detectApis): false positives are possible; the override-with-reason path is the intended relief valve, and an in-repo-head heuristic treats bare imports of existing top-level project dirs as local paths (not external APIs) to reduce noise.
- Gating logic lives in the shared PreToolUse bin, so future PreToolUse guardrails must compose with (run alongside) the api-gate rather than replace it.
