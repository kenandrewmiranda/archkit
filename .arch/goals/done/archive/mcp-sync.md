---
slug: mcp-sync
title: archkit_sync MCP tool — expose sync (detect .arch/ files stale vs src/) to MCP
status: completed
created: 2026-06-09
exit-criteria:
  - src/commands/sync.mjs exports a run-style JSON function (e.g. runSyncJson({ archDir, srcDir = 'src' })) returning the structured staleness report; main() is refactored to call it so the CLI and MCP share one code path (CLI behavior unchanged)
  - archkit_sync is registered in src/mcp/tools.mjs: zod inputSchema (optional srcDir, default 'src'), a description framing it as .arch/ context-freshness detection distinct from archkit_drift and archkit_doctor, handler via requireArchDir(cwd)
  - The result carries a nextStep:string summarizing how many .arch/ files are stale and the suggested action (clean case returns a useful nextStep, not a silent empty)
  - Both tool-registry guard fixtures updated: tests/mcp-server/run.mjs expected list + tests/silent-success-audit/run.mjs cases[] + coverage assertion
  - npm test passes
  - archkit_sync is registered in src/mcp/tools.mjs: zod inputSchema (optional srcDir, default 'src'), a description framing it as .arch/ context-freshness detection distinct from archkit_drift and archkit_doctor, handler via requireArchDir(cwd)
  - The result carries a nextStep: string summarizing how many .arch/ files are stale and the suggested action (clean case returns a useful nextStep, not a silent empty)
  - Both tool-registry guard fixtures updated: tests/mcp-server/run.mjs expected list + tests/silent-success-audit/run.mjs cases[] + coverage assertion
- archkit_sync is registered in src/mcp/tools.mjs: zod inputSchema (optional srcDir, default 'src'), a description framing it as .arch/ context-freshness detection distinct from archkit_drift and archkit_doctor, handler via requireArchDir(cwd)
- The result carries a nextStep: string summarizing how many .arch/ files are stale and the suggested action (clean case returns a useful nextStep, not a silent empty)
- Both tool-registry guard fixtures updated: tests/mcp-server/run.mjs expected list + tests/silent-success-audit/run.mjs cases[] + coverage assertion
files-to-touch:
  - src/commands/sync.mjs
  - src/mcp/tools.mjs
  - tests/mcp-server/run.mjs
  - tests/silent-success-audit/run.mjs
required-reading:
  - src/mcp/tools.mjs
  - src/commands/resolve/warmup.mjs
depends-on: 
verify-command: npm test
source-ask: CLI/MCP parity audit: ~98% of archkit users only use the MCP surface and never touch the interactive CLI, so agent-shaped CLI-only commands are effectively dead features for them. The audit found three non-deprecated, non-interactive, JSON-emitting commands with no MCP counterpart that an agent would call mid-task: `resolve verify-wiring` (dead/unwired component scan), `resolve audit-spec` (PRD requirement coverage), and `sync` (detect .arch/ files stale vs src/). Expose each as a net-new MCP tool. Deliberately excluded as inherently human/terminal: update (self-update), market login/logout (interactive OAuth), wizard/interactive init/gotcha curation; and deprecated: resolve context/plan. Established pattern: extract logic into a run<Name>Json({archDir,...}) export (mirroring src/commands/resolve/{warmup,preflight,scaffold,verify-wiring}.mjs), register the tool in src/mcp/tools.mjs with a zod inputSchema + resolve-tool-style description + handler via requireArchDir, ensure a nextStep on the result (silent-success contract). NOTE: adding any tool to the registry breaks two guard suites unless their fixtures are updated — tests/mcp-server (expected tool-name list) and tests/silent-success-audit (cases[] + the missing-coverage assertion).
started: 2026-06-09
completed: 2026-06-09
completion-notes: Extracted runSyncJson({archDir,srcDir}) from sync.mjs (main() now calls it; CLI output/exit unchanged), registered archkit_sync MCP tool with zod srcDir schema + drift/doctor-distinct description, added a nextStep summarizing stale-file count + action (useful in clean case too), and updated both guard fixtures (34-tool list + audit cases[]).
tests-passed: true
tests-command: npm test
tests-at: 2026-06-09
---



# archkit_sync MCP tool — expose sync (detect .arch/ files stale vs src/) to MCP

## Why
keeping .arch/ context fresh against the code is an agent-loop concern, but the src↔spec staleness detector is CLI-only. It is distinct from archkit_drift (graph reconciliation) and archkit_doctor (is the surface load-bearing). sync.mjs already has a --json path; it just needs an exported runnable + MCP wiring.

## Exit criteria
- [ ] src/commands/sync.mjs exports a run-style JSON function (e.g. runSyncJson({ archDir, srcDir = 'src' })) returning the structured staleness report; main() is refactored to call it so the CLI and MCP share one code path (CLI behavior unchanged)
- [ ] archkit_sync is registered in src/mcp/tools.mjs: zod inputSchema (optional srcDir, default 'src'), a description framing it as .arch/ context-freshness detection distinct from archkit_drift and archkit_doctor, handler via requireArchDir(cwd)
- [ ] The result carries a nextStep:string summarizing how many .arch/ files are stale and the suggested action (clean case returns a useful nextStep, not a silent empty)
- [ ] Both tool-registry guard fixtures updated: tests/mcp-server/run.mjs expected list + tests/silent-success-audit/run.mjs cases[] + coverage assertion
- [ ] npm test passes

