---
slug: scoped-cache-warmup-drift
title: Add request-scoped caching to warmup/drift .arch parsing
status: done
created: 2026-06-06
exit-criteria:
  - Parsing of .arch/ within a single warmup/drift invocation is memoized at request/call scope (not module-global singleton state)
  - tests/cgr-context-refresh/ still passes — successive calls in one process still reflect on-disk .arch/ changes (no cross-goal staleness)
  - A test asserts the parse is performed once per file per invocation (redundant re-parse eliminated)
  - npm test is green
files-to-touch:
  - src/lib/parsers.mjs
  - src/commands/resolve/warmup.mjs
  - src/commands/drift.mjs
  - tests/cgr-context-refresh/run.mjs
required-reading:
  - .arch/decisions/0002-cgr-relay-keeps-arch-context-fresh-via-stateless-per-call-re.md
depends-on:
  - drift-precision-workspace
verify-command: npm test
source-ask: Turn the explored archkit MCP improvements into a CGR queue reasonable for a 1.9X version bump. Scope (confirmed): include portable hook paths, drift precision, scoped caching, MCP prompts, and PreToolUse blocking as a 1.9 feature; defer plugin distribution to 2.0.
started: 2026-06-06
completed: 2026-06-06
completion-notes: Added createArchReader() in parsers.mjs — a request-scoped memoizing reader (file reads + SYSTEM/INDEX parses) created fresh per warmup/drift invocation, never module-global (ADR 0002). Eliminated drift's duplicate INDEX.md parse by sharing one reader between detectFindings and the silent-success scan. New cgr-context-refresh test asserts INDEX.md/SYSTEM.md are each read+parsed exactly once per drift call.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Add request-scoped caching to warmup/drift .arch parsing

## Why
Per ADR 0002 every warmup/drift call re-parses .arch/ from disk; on a large spec that repeats parse work within a single invocation. Memoize per-call without reintroducing the cross-goal staleness the cgr-context-refresh test guards against.

## Exit criteria
- [ ] Parsing of .arch/ within a single warmup/drift invocation is memoized at request/call scope (not module-global singleton state)
- [ ] tests/cgr-context-refresh/ still passes — successive calls in one process still reflect on-disk .arch/ changes (no cross-goal staleness)
- [ ] A test asserts the parse is performed once per file per invocation (redundant re-parse eliminated)
- [ ] npm test is green

