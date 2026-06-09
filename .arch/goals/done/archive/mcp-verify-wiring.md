---
slug: mcp-verify-wiring
title: archkit_verify_wiring MCP tool — expose the resolve verify-wiring dead/unwired-component scan to MCP
status: completed
created: 2026-06-09
exit-criteria:
  - src/commands/resolve/verify-wiring.mjs exports a run-style JSON function (e.g. runVerifyWiringJson({ archDir, srcDir = 'src' })) returning the same structured report the CLI `archkit resolve verify-wiring` emits; the CLI dispatch in resolve.mjs is refactored to call it so there is a single source of truth (no logic fork)
  - archkit_verify_wiring is registered in src/mcp/tools.mjs with a zod inputSchema (optional srcDir, default 'src'), a resolve-tool-style description, and a handler that resolves archDir via requireArchDir(cwd)
  - The tool result carries a nextStep:string per the silent-success contract (add one in the runner if the raw report lacks it) — including the no-findings case (a clean scan still returns a useful nextStep, never a silent empty)
  - Both tool-registry guard fixtures are updated so the suite stays green: tests/mcp-server/run.mjs (alphabetical expected tool-name list) and tests/silent-success-audit/run.mjs (a cases[] entry exercising the tool + the missing-coverage assertion)
  - npm test passes
  - The tool result carries a nextStep: string per the silent-success contract (add one in the runner if the raw report lacks it) — including the no-findings case (a clean scan still returns a useful nextStep, never a silent empty)
  - Both tool-registry guard fixtures are updated so the suite stays green: tests/mcp-server/run.mjs (alphabetical expected tool-name list) and tests/silent-success-audit/run.mjs (a cases[] entry exercising the tool + the missing-coverage assertion)
- The tool result carries a nextStep: string per the silent-success contract (add one in the runner if the raw report lacks it) — including the no-findings case (a clean scan still returns a useful nextStep, never a silent empty)
- Both tool-registry guard fixtures are updated so the suite stays green: tests/mcp-server/run.mjs (alphabetical expected tool-name list) and tests/silent-success-audit/run.mjs (a cases[] entry exercising the tool + the missing-coverage assertion)
files-to-touch:
  - src/commands/resolve/verify-wiring.mjs
  - src/commands/resolve.mjs
  - src/mcp/tools.mjs
  - tests/mcp-server/run.mjs
  - tests/silent-success-audit/run.mjs
required-reading:
  - src/commands/resolve/warmup.mjs
  - src/mcp/tools.mjs
depends-on: 
verify-command: npm test
source-ask: CLI/MCP parity audit: ~98% of archkit users only use the MCP surface and never touch the interactive CLI, so agent-shaped CLI-only commands are effectively dead features for them. The audit found three non-deprecated, non-interactive, JSON-emitting commands with no MCP counterpart that an agent would call mid-task: `resolve verify-wiring` (dead/unwired component scan), `resolve audit-spec` (PRD requirement coverage), and `sync` (detect .arch/ files stale vs src/). Expose each as a net-new MCP tool. Deliberately excluded as inherently human/terminal: update (self-update), market login/logout (interactive OAuth), wizard/interactive init/gotcha curation; and deprecated: resolve context/plan. Established pattern: extract logic into a run<Name>Json({archDir,...}) export (mirroring src/commands/resolve/{warmup,preflight,scaffold,verify-wiring}.mjs), register the tool in src/mcp/tools.mjs with a zod inputSchema + resolve-tool-style description + handler via requireArchDir, ensure a nextStep on the result (silent-success contract). NOTE: adding any tool to the registry breaks two guard suites unless their fixtures are updated — tests/mcp-server (expected tool-name list) and tests/silent-success-audit (cases[] + the missing-coverage assertion).
started: 2026-06-09
completed: 2026-06-09
completion-notes: Added runVerifyWiringJson({archDir,srcDir}) to verify-wiring.mjs (with never-silent nextStep covering error/warning/clean/findings cases), refactored resolve.mjs CLI dispatch to call it (single source of truth), registered archkit_verify_wiring MCP tool with zod srcDir schema + requireArchDir handler, and updated both guard fixtures (mcp-server expected list + count, silent-success-audit cases[]).
tests-passed: true
tests-command: npm test
tests-at: 2026-06-09
---



# archkit_verify_wiring MCP tool — expose the resolve verify-wiring dead/unwired-component scan to MCP

## Why
post-implementation 'is it actually wired?' is exactly the CGR verify→complete question, but the codebase-wide unwired/dead-component scan is CLI-only. The logic already lives in src/commands/resolve/verify-wiring.mjs; it just isn't reachable as an MCP tool.

## Exit criteria
- [ ] src/commands/resolve/verify-wiring.mjs exports a run-style JSON function (e.g. runVerifyWiringJson({ archDir, srcDir = 'src' })) returning the same structured report the CLI `archkit resolve verify-wiring` emits; the CLI dispatch in resolve.mjs is refactored to call it so there is a single source of truth (no logic fork)
- [ ] archkit_verify_wiring is registered in src/mcp/tools.mjs with a zod inputSchema (optional srcDir, default 'src'), a resolve-tool-style description, and a handler that resolves archDir via requireArchDir(cwd)
- [ ] The tool result carries a nextStep:string per the silent-success contract (add one in the runner if the raw report lacks it) — including the no-findings case (a clean scan still returns a useful nextStep, never a silent empty)
- [ ] Both tool-registry guard fixtures are updated so the suite stays green: tests/mcp-server/run.mjs (alphabetical expected tool-name list) and tests/silent-success-audit/run.mjs (a cases[] entry exercising the tool + the missing-coverage assertion)
- [ ] npm test passes

