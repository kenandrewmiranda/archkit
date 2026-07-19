---
slug: api-detect-lib
title: API-involvement detector: flag external-API-shaped dependencies in an edit
status: completed
created: 2026-07-19
order: 2
project: api-doc-gate
exit-criteria:
  - New src/lib/api-detect.mjs exports detectApis({ filePath, content, declaredApis }) -> [{ api, evidence:'sdk-import'|'external-url'|'declared' }] by heuristic scan of third-party SDK/package imports, external base-URLs / fetch(host) not in the internalHosts allowlist, and any goal-declared apis:
  - localhost / 127.0.0.1 / relative paths / internal hosts are NEVER flagged; the internalHosts allowlist is read from apiGate config (default sane set)
  - Pure and never-throws on unparseable/binary-ish content (best-effort; returns [] rather than erroring)
  - New tests/api-detect/ covers: a known SDK import flagged; an external fetch/base-URL flagged; localhost + relative import NOT flagged; a declared api surfaced as evidence:'declared'; empty/garbage content tolerated
  - New src/lib/api-detect.mjs exports detectApis({ filePath, content, declaredApis }) -> [{ api, evidence: 'sdk-import'|'external-url'|'declared' }] by heuristic scan of third-party SDK/package imports, external base-URLs / fetch(host) not in the internalHosts allowlist, and any goal-declared apis:
  - New tests/api-detect/ covers: a known SDK import flagged; an external fetch/base-URL flagged; localhost + relative import NOT flagged; a declared api surfaced as evidence:'declared'; empty/garbage content tolerated
  - New src/lib/api-detect.mjs exports detectApis({ filePath, content, declaredApis }) -> [{ api, evidence: 'sdk-import'|'external-url'|'declared' }] by heuristic scan of third-party SDK/package imports, external base-URLs / fetch(host) not in the internalHosts allowlist, and any goal-declared apis:
  - New tests/api-detect/ covers: a known SDK import flagged; an external fetch/base-URL flagged; localhost + relative import NOT flagged; a declared api surfaced as evidence:'declared'; empty/garbage content tolerated
- New src/lib/api-detect.mjs exports detectApis({ filePath, content, declaredApis }) -> [{ api, evidence: 'sdk-import'|'external-url'|'declared' }] by heuristic scan of third-party SDK/package imports, external base-URLs / fetch(host) not in the internalHosts allowlist, and any goal-declared apis:
- New tests/api-detect/ covers: a known SDK import flagged; an external fetch/base-URL flagged; localhost + relative import NOT flagged; a declared api surfaced as evidence:'declared'; empty/garbage content tolerated
files-to-touch:
  - src/lib/api-detect.mjs
  - tests/api-detect/run.mjs
required-reading: 
depends-on: 
owns:
  - src/lib/api-detect.mjs
  - tests/api-detect/**
feature: api-detect
verify-command: npm test
source-ask: If an API is involved, the user must validate whether an API doc or SDK exists and whether it's provided. This is a hard gate (no-op): archkit blocks further development/direction until the API doc/SDK is given OR the API documentation is referenced properly before coding starts. The user must explicitly override to proceed without docs; otherwise it stays gated.
lane: api-detect
started: 2026-07-19T20:59:56.795Z
completed: 2026-07-19T21:11:11.611Z
completion-notes: API-involvement detector lib. Self-contained per worker context (internalHosts via param; api-doc-gate-hook lane wires it to api-registry's readApiGateConfig). Full suite 67/67 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---




# API-involvement detector: flag external-API-shaped dependencies in an edit

## Why
The PreToolUse gate must decide 'does this edit involve an API?' deterministically — SDK imports, external base URLs, and goal-declared APIs — without false-flagging internal/relative calls.

## Exit criteria
- [ ] New src/lib/api-detect.mjs exports detectApis({ filePath, content, declaredApis }) -> [{ api, evidence:'sdk-import'|'external-url'|'declared' }] by heuristic scan of third-party SDK/package imports, external base-URLs / fetch(host) not in the internalHosts allowlist, and any goal-declared apis:
- [ ] localhost / 127.0.0.1 / relative paths / internal hosts are NEVER flagged; the internalHosts allowlist is read from apiGate config (default sane set)
- [ ] Pure and never-throws on unparseable/binary-ish content (best-effort; returns [] rather than erroring)
- [ ] New tests/api-detect/ covers: a known SDK import flagged; an external fetch/base-URL flagged; localhost + relative import NOT flagged; a declared api surfaced as evidence:'declared'; empty/garbage content tolerated

