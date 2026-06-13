---
slug: windows-self-exec-guard-sweep
title: Replace the Windows-broken `file://${process.argv[1]}` self-exec guard with a cross-platform check across all 19 CLI entrypoints
status: completed
created: 2026-06-13
exit-criteria:
  - Every file using `import.meta.url === `file://${process.argv[1]}`` (19 files: src/scaffold.mjs + src/commands/*.mjs) uses a cross-platform equivalent — `import.meta.url === pathToFileURL(process.argv[1]).href` (pathToFileURL from node:url), ideally via one shared helper in src/lib/shared.mjs rather than 19 inline imports
  - The `|| process.env.ARCHKIT_RUN` fallback is preserved so the bin/archkit.mjs dispatch path is unchanged
  - Behavior is identical on POSIX (the new check is a no-op-shaped equivalent) and correct on Windows
  - npm test stays green on both ubuntu and windows CI legs
  - Every file using `import.meta.url === `file: //${process.argv[1]}`` (19 files: src/scaffold.mjs + src/commands/*.mjs) uses a cross-platform equivalent — `import.meta.url === pathToFileURL(process.argv[1]).href` (pathToFileURL from node:url), ideally via one shared helper in src/lib/shared.mjs rather than 19 inline imports
- Every file using `import.meta.url === `file: //${process.argv[1]}`` (19 files: src/scaffold.mjs + src/commands/*.mjs) uses a cross-platform equivalent — `import.meta.url === pathToFileURL(process.argv[1]).href` (pathToFileURL from node:url), ideally via one shared helper in src/lib/shared.mjs rather than 19 inline imports
files-to-touch:
  - src/lib/shared.mjs
  - src/scaffold.mjs
  - src/commands/init.mjs
  - src/commands/goal.mjs
  - src/commands/review.mjs
  - src/commands/resolve.mjs
  - src/commands/drift.mjs
  - src/commands/doctor.mjs
  - src/commands/stats.mjs
  - src/commands/decisions.mjs
  - src/commands/gotcha.mjs
  - src/commands/sync.mjs
  - src/commands/update.mjs
  - src/commands/market.mjs
  - src/commands/export.mjs
  - src/commands/prd.mjs
  - src/commands/worklog.mjs
  - src/commands/boundary.mjs
  - src/commands/migrate.mjs
  - src/commands/wizard.mjs
required-reading:
  - src/lib/shared.mjs
depends-on: 
verify-command: npm test
source-ask: (1) Add the file://${process.argv[1]} self-exec guard sweep as a CGR. (2) Separately: make the interactive new-project wizard part of the MCP toolkit — the interactive (inquirer) wizard is likely unused since it requires software-architecture experience.
started: 2026-06-13T13:20:08.803Z
completed: 2026-06-13T13:23:06.424Z
completion-notes: Added isMainModule(importMetaUrl) helper to src/lib/shared.mjs using pathToFileURL from node:url (with the ARCHKIT_RUN fallback folded in), and swept all 19 entrypoints (src/scaffold.mjs + 18 src/commands/*.mjs) to use it in place of the Windows-broken file://${process.argv[1]} guard. POSIX behavior unchanged (verified direct exec); correct on Windows by construction.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-13
---



# Replace the Windows-broken `file://${process.argv[1]}` self-exec guard with a cross-platform check across all 19 CLI entrypoints

## Why
On Windows import.meta.url is `file:///D:/...` while the guard builds `file://D:\...`, so the guard never matches — a latent correctness bug currently masked everywhere by the `|| process.env.ARCHKIT_RUN` fallback (bin/archkit.mjs sets it). Direct `node src/commands/X.mjs` execution is broken on Windows. Completes the v1.11.1 Windows port.

## Exit criteria
- [ ] Every file using `import.meta.url === `file://${process.argv[1]}`` (19 files: src/scaffold.mjs + src/commands/*.mjs) uses a cross-platform equivalent — `import.meta.url === pathToFileURL(process.argv[1]).href` (pathToFileURL from node:url), ideally via one shared helper in src/lib/shared.mjs rather than 19 inline imports
- [ ] The `|| process.env.ARCHKIT_RUN` fallback is preserved so the bin/archkit.mjs dispatch path is unchanged
- [ ] Behavior is identical on POSIX (the new check is a no-op-shaped equivalent) and correct on Windows
- [ ] npm test stays green on both ubuntu and windows CI legs

