---
slug: cgr-relay-mcp-prompts
title: Expose CGR relay steps as MCP prompts (first-class slash commands)
status: done
created: 2026-06-06
exit-criteria:
  - The MCP server registers prompts for the core relay steps (at minimum goal_next; consider goal_intake) via the MCP prompts capability
  - Each prompt returns the correct relay payload/instruction when invoked
  - A test asserts prompt registration and the returned payload shape
  - npm test is green
files-to-touch:
  - src/mcp/server.mjs
  - src/mcp/tools.mjs
  - tests/mcp-server/run.mjs
required-reading:
  - .arch/INDEX.md
depends-on: 
verify-command: npm test
source-ask: Turn the explored archkit MCP improvements into a CGR queue reasonable for a 1.9X version bump. Scope (confirmed): include portable hook paths, drift precision, scoped caching, MCP prompts, and PreToolUse blocking as a 1.9 feature; defer plugin distribution to 2.0.
started: 2026-06-06
completed: 2026-06-06
completion-notes: CGR relay prompts (goal_next/resume/review/status) were already registered via server.registerPrompt in src/mcp/server.mjs from src/mcp/prompts.mjs. The missing piece was test coverage: added 3 tests in tests/mcp-server/run.mjs asserting prompts/list registration, goal_next payload shape (relay header + rendered payload + in-progress side effect), and the empty-queue notice.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Expose CGR relay steps as MCP prompts (first-class slash commands)

## Why
CGR currently relies on the user typing /mcp__archkit__goal_next; exposing relay steps via the MCP prompts capability makes the loop discoverable and reduces copy-paste friction.

## Exit criteria
- [ ] The MCP server registers prompts for the core relay steps (at minimum goal_next; consider goal_intake) via the MCP prompts capability
- [ ] Each prompt returns the correct relay payload/instruction when invoked
- [ ] A test asserts prompt registration and the returned payload shape
- [ ] npm test is green

