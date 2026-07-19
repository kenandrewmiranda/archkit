---
slug: api-registry-tools
title: MCP tools: archkit_api_register / archkit_api_override / archkit_api_list
status: pending
created: 2026-07-19
order: 3
project: api-doc-gate
exit-criteria:
  - archkit_api_register(id, doc|sdk ref) records a proper reference (status referenced); archkit_api_override(id, reason) records an explicit override (status override, audit-stamped); archkit_api_list reports referenced/overridden/pending — all delegate to src/lib/api-registry.mjs
  - Tool descriptions state the hard-gate contract: edits are BLOCKED until an involved API is referenced or explicitly overridden, and the manifest status is the source of truth
  - Handlers in src/commands/api.mjs (runApiRegister/runApiOverride/runApiList); registered in the src/mcp/tools.mjs tool table; tool-count assertions bumped (tests/mcp-server + tests/silent-success-audit)
  - New tests/api-tools/ covers each handler (register clears, override clears with reason, list buckets correctly) plus a structured error when id/ref is missing
- Tool descriptions state the hard-gate contract: edits are BLOCKED until an involved API is referenced or explicitly overridden, and the manifest status is the source of truth
files-to-touch:
  - src/commands/api.mjs
  - src/mcp/tools.mjs
  - tests/mcp-server/run.mjs
  - tests/silent-success-audit/run.mjs
  - tests/api-tools/run.mjs
required-reading: 
depends-on:
  - api-registry-lib
owns:
  - src/commands/api.mjs
  - tests/api-tools/**
feature: api-tools
verify-command: npm test
source-ask: If an API is involved, the user must validate whether an API doc or SDK exists and whether it's provided. This is a hard gate (no-op): archkit blocks further development/direction until the API doc/SDK is given OR the API documentation is referenced properly before coding starts. The user must explicitly override to proceed without docs; otherwise it stays gated.
lane: api-tools
---


# MCP tools: archkit_api_register / archkit_api_override / archkit_api_list

## Why
These are how the user clears the gate — provide a doc/SDK link, or explicitly override to proceed without one. Without them the hard gate has no escape hatch.

## Exit criteria
- [ ] archkit_api_register(id, doc|sdk ref) records a proper reference (status referenced); archkit_api_override(id, reason) records an explicit override (status override, audit-stamped); archkit_api_list reports referenced/overridden/pending — all delegate to src/lib/api-registry.mjs
- [ ] Tool descriptions state the hard-gate contract: edits are BLOCKED until an involved API is referenced or explicitly overridden, and the manifest status is the source of truth
- [ ] Handlers in src/commands/api.mjs (runApiRegister/runApiOverride/runApiList); registered in the src/mcp/tools.mjs tool table; tool-count assertions bumped (tests/mcp-server + tests/silent-success-audit)
- [ ] New tests/api-tools/ covers each handler (register clears, override clears with reason, list buckets correctly) plus a structured error when id/ref is missing

