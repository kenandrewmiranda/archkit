---
slug: api-registry-lib
title: API-doc registry lib + manifest: the clearance source of truth
status: pending
created: 2026-07-19
order: 1
project: api-doc-gate
exit-criteria:
  - New src/lib/api-registry.mjs reads/writes .arch/apis.json — a list of { id, kind:'doc'|'sdk'|'override', ref (url|path|package|null), reason, addedAt, status:'referenced'|'override'|'pending' }; atomic writes; tolerant of a missing/empty/corrupt manifest (never throws, treats as empty)
  - Exports isApiCleared(archDir, apiId) -> true ONLY when that API has a proper doc/sdk reference OR an explicit override; false (blocking) for pending/unknown APIs
  - Exports registerApi(archDir,{id,kind,ref}), overrideApi(archDir,{id,reason}), listApis(archDir) — pure mutators/readers, no side effects beyond the manifest
  - Gate config lives in .arch/config.json under apiGate (enabled: default true; internalHosts allowlist: sane defaults incl. localhost/127.0.0.1) and is read tolerantly (missing -> defaults)
  - New tests/api-registry/ covers: unregistered id -> NOT cleared; doc-referenced -> cleared; override -> cleared; missing manifest tolerated; corrupt manifest tolerated
- New src/lib/api-registry.mjs reads/writes .arch/apis.json — a list of { id, kind: 'doc'|'sdk'|'override', ref (url|path|package|null), reason, addedAt, status:'referenced'|'override'|'pending' }; atomic writes; tolerant of a missing/empty/corrupt manifest (never throws, treats as empty)
- Gate config lives in .arch/config.json under apiGate (enabled: default true; internalHosts allowlist: sane defaults incl. localhost/127.0.0.1) and is read tolerantly (missing -> defaults)
- New tests/api-registry/ covers: unregistered id -> NOT cleared; doc-referenced -> cleared; override -> cleared; missing manifest tolerated; corrupt manifest tolerated
files-to-touch:
  - src/lib/api-registry.mjs
  - .arch/config.json
  - tests/api-registry/run.mjs
required-reading: 
depends-on: 
owns:
  - src/lib/api-registry.mjs
  - tests/api-registry/**
feature: api-registry
verify-command: npm test
source-ask: If an API is involved, the user must validate whether an API doc or SDK exists and whether it's provided. This is a hard gate (no-op): archkit blocks further development/direction until the API doc/SDK is given OR the API documentation is referenced properly before coding starts. The user must explicitly override to proceed without docs; otherwise it stays gated.
lane: api-registry
---


# API-doc registry lib + manifest: the clearance source of truth

## Why
The gate needs a durable record of which external APIs have a proper doc/SDK reference (or an explicit user override). Everything else keys off isApiCleared().

## Exit criteria
- [ ] New src/lib/api-registry.mjs reads/writes .arch/apis.json — a list of { id, kind:'doc'|'sdk'|'override', ref (url|path|package|null), reason, addedAt, status:'referenced'|'override'|'pending' }; atomic writes; tolerant of a missing/empty/corrupt manifest (never throws, treats as empty)
- [ ] Exports isApiCleared(archDir, apiId) -> true ONLY when that API has a proper doc/sdk reference OR an explicit override; false (blocking) for pending/unknown APIs
- [ ] Exports registerApi(archDir,{id,kind,ref}), overrideApi(archDir,{id,reason}), listApis(archDir) — pure mutators/readers, no side effects beyond the manifest
- [ ] Gate config lives in .arch/config.json under apiGate (enabled: default true; internalHosts allowlist: sane defaults incl. localhost/127.0.0.1) and is read tolerantly (missing -> defaults)
- [ ] New tests/api-registry/ covers: unregistered id -> NOT cleared; doc-referenced -> cleared; override -> cleared; missing manifest tolerated; corrupt manifest tolerated

