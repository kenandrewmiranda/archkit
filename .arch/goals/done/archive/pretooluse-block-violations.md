---
slug: pretooluse-block-violations
title: Add a PreToolUse hook that blocks spec/boundary violations before the edit lands
status: done
created: 2026-06-06
exit-criteria:
  - A new PreToolUse hook (e.g. bin/archkit-pretooluse-hook.mjs) evaluates Edit/Write/MultiEdit against boundary BAN rules (and optionally hard review rules) and blocks on violation with a clear, actionable reason
  - archkit_install_hooks registers the PreToolUse hook using the portable command form from goal portable-hook-paths
  - Non-violating edits pass through unblocked (no false blocks)
  - A test simulates a banned-import edit -> blocked, and a clean edit -> allowed
  - npm test is green
files-to-touch:
  - bin/archkit-pretooluse-hook.mjs
  - src/commands/install-hooks.mjs
  - src/mcp/tools.mjs
  - tests/pretooluse-hook/run.mjs
required-reading:
  - .arch/SYSTEM.md
  - .arch/INDEX.md
depends-on:
  - portable-hook-paths
verify-command: npm test
source-ask: Turn the explored archkit MCP improvements into a CGR queue reasonable for a 1.9X version bump. Scope (confirmed): include portable hook paths, drift precision, scoped caching, MCP prompts, and PreToolUse blocking as a 1.9 feature; defer plugin distribution to 2.0.
started: 2026-06-06
completed: 2026-06-06
completion-notes: Added bin/archkit-pretooluse-hook.mjs (fail-open) backed by pure src/lib/pretooluse-eval.mjs, which reconstructs post-edit content for Edit/Write/MultiEdit and blocks only NEWLY-introduced imports that violate a BOUNDARIES.md BAN rule (deny envelope with actionable reason). Registered as a 5th guardrail hook in ARCHKIT_GUARDRAIL_HOOKS (portable $CLAUDE_PROJECT_DIR form via the existing install_hooks path), wired into plugin hooks/hooks.json and this repo's .claude/settings.json, and covered by tests/pretooluse-hook/run.mjs (banned→deny, clean→allow, plus precision/fail-open cases). npm test 45/45 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Add a PreToolUse hook that blocks spec/boundary violations before the edit lands

## Why
Today hooks flag violations PostToolUse — after the edit is already written. A PreToolUse hook turns archkit from a reviewer into a guardrail by blocking a boundary/spec-violating Edit/Write up front. Additive and non-breaking (flagship 1.9 feature).

## Exit criteria
- [ ] A new PreToolUse hook (e.g. bin/archkit-pretooluse-hook.mjs) evaluates Edit/Write/MultiEdit against boundary BAN rules (and optionally hard review rules) and blocks on violation with a clear, actionable reason
- [ ] archkit_install_hooks registers the PreToolUse hook using the portable command form from goal portable-hook-paths
- [ ] Non-violating edits pass through unblocked (no false blocks)
- [ ] A test simulates a banned-import edit -> blocked, and a clean edit -> allowed
- [ ] npm test is green

