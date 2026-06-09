---
slug: mcp-audit-spec
title: archkit_audit_spec MCP tool — expose the resolve audit-spec PRD requirement-coverage check to MCP
status: completed
created: 2026-06-09
exit-criteria:
  - The audit-spec logic is reachable via an exported run-style JSON function (e.g. runAuditSpecJson({ archDir, specFile, srcDir = 'src' })) — extract it into src/commands/resolve/audit-spec.mjs mirroring verify-wiring.mjs/warmup.mjs (or export from resolve.mjs); the resolve.mjs `audit-spec` CLI dispatch calls the same function (no logic fork)
  - archkit_audit_spec is registered in src/mcp/tools.mjs: zod inputSchema (required specFile path, optional srcDir default 'src'), a description that explicitly distinguishes it from archkit_prd_check (requirement coverage vs archetype/mode drift), handler via requireArchDir(cwd)
  - Missing spec file or a spec with no `- [ ] REQ-...` requirements returns a structured error envelope with a suggestion (never a throw or silent empty result); the success result carries a nextStep summarizing covered/uncovered counts
  - Both tool-registry guard fixtures updated: tests/mcp-server/run.mjs expected list + tests/silent-success-audit/run.mjs cases[] (provide a tiny fixture spec file with at least one REQ) + coverage assertion
  - npm test passes
  - archkit_audit_spec is registered in src/mcp/tools.mjs: zod inputSchema (required specFile path, optional srcDir default 'src'), a description that explicitly distinguishes it from archkit_prd_check (requirement coverage vs archetype/mode drift), handler via requireArchDir(cwd)
  - Both tool-registry guard fixtures updated: tests/mcp-server/run.mjs expected list + tests/silent-success-audit/run.mjs cases[] (provide a tiny fixture spec file with at least one REQ) + coverage assertion
- archkit_audit_spec is registered in src/mcp/tools.mjs: zod inputSchema (required specFile path, optional srcDir default 'src'), a description that explicitly distinguishes it from archkit_prd_check (requirement coverage vs archetype/mode drift), handler via requireArchDir(cwd)
- Both tool-registry guard fixtures updated: tests/mcp-server/run.mjs expected list + tests/silent-success-audit/run.mjs cases[] (provide a tiny fixture spec file with at least one REQ) + coverage assertion
files-to-touch:
  - src/commands/resolve.mjs
  - src/commands/resolve/audit-spec.mjs
  - src/mcp/tools.mjs
  - tests/mcp-server/run.mjs
  - tests/silent-success-audit/run.mjs
required-reading:
  - src/commands/resolve/verify-wiring.mjs
  - src/mcp/tools.mjs
depends-on: 
verify-command: npm test
source-ask: CLI/MCP parity audit: ~98% of archkit users only use the MCP surface and never touch the interactive CLI, so agent-shaped CLI-only commands are effectively dead features for them. The audit found three non-deprecated, non-interactive, JSON-emitting commands with no MCP counterpart that an agent would call mid-task: `resolve verify-wiring` (dead/unwired component scan), `resolve audit-spec` (PRD requirement coverage), and `sync` (detect .arch/ files stale vs src/). Expose each as a net-new MCP tool. Deliberately excluded as inherently human/terminal: update (self-update), market login/logout (interactive OAuth), wizard/interactive init/gotcha curation; and deprecated: resolve context/plan. Established pattern: extract logic into a run<Name>Json({archDir,...}) export (mirroring src/commands/resolve/{warmup,preflight,scaffold,verify-wiring}.mjs), register the tool in src/mcp/tools.mjs with a zod inputSchema + resolve-tool-style description + handler via requireArchDir, ensure a nextStep on the result (silent-success contract). NOTE: adding any tool to the registry breaks two guard suites unless their fixtures are updated — tests/mcp-server (expected tool-name list) and tests/silent-success-audit (cases[] + the missing-coverage assertion).
started: 2026-06-09
completed: 2026-06-09
completion-notes: Extracted audit-spec into src/commands/resolve/audit-spec.mjs as runAuditSpecJson({archDir,specFile,srcDir}); resolve.mjs CLI dispatch now calls it (no fork). Registered archkit_audit_spec MCP tool (zod schema, prd_check-distinguishing description, requireArchDir handler) returning structured error envelopes (missing file / no REQ) + covered/uncovered nextStep. Updated both guard fixtures (mcp-server 33-tool list, silent-success-audit case + fixture spec + coverage assertion).
tests-passed: true
tests-command: npm test
tests-at: 2026-06-09
---



# archkit_audit_spec MCP tool — expose the resolve audit-spec PRD requirement-coverage check to MCP

## Why
archkit_prd_check only checks archetype/mode drift vs SYSTEM.md — it does NOT verify requirement-by-requirement coverage of a spec against source. An agent finishing a goal can't self-check 'did I implement every REQ?' from MCP. The audit-spec logic (parseRequirements/checkCoverage/formatCoverageReport) exists inline in resolve.mjs but is unexported.

## Exit criteria
- [ ] The audit-spec logic is reachable via an exported run-style JSON function (e.g. runAuditSpecJson({ archDir, specFile, srcDir = 'src' })) — extract it into src/commands/resolve/audit-spec.mjs mirroring verify-wiring.mjs/warmup.mjs (or export from resolve.mjs); the resolve.mjs `audit-spec` CLI dispatch calls the same function (no logic fork)
- [ ] archkit_audit_spec is registered in src/mcp/tools.mjs: zod inputSchema (required specFile path, optional srcDir default 'src'), a description that explicitly distinguishes it from archkit_prd_check (requirement coverage vs archetype/mode drift), handler via requireArchDir(cwd)
- [ ] Missing spec file or a spec with no `- [ ] REQ-...` requirements returns a structured error envelope with a suggestion (never a throw or silent empty result); the success result carries a nextStep summarizing covered/uncovered counts
- [ ] Both tool-registry guard fixtures updated: tests/mcp-server/run.mjs expected list + tests/silent-success-audit/run.mjs cases[] (provide a tiny fixture spec file with at least one REQ) + coverage assertion
- [ ] npm test passes

