---
slug: mcp-interactive-wizard
title: Expose the interactive new-project wizard as MCP tooling so an LLM can drive greenfield scaffold generation without the inquirer TTY
status: completed
created: 2026-06-13
exit-criteria:
  - The wizard's scaffold-generation core (src/wizard/generate.mjs) and step/decision model are callable without inquirer — a function that accepts structured answers (archetype, stack, app name, etc.) and writes the .arch/ scaffold, decoupled from the interactive prompt layer
  - One or more MCP tools let an LLM run the full greenfield flow end-to-end — choose archetype/stack and GENERATE the .arch/ scaffold — extending or complementing archkit_init (which today only instructs, does not generate)
  - An ADR is logged (archkit_log_decision) recording the chosen approach: extend archkit_init vs add a new generation tool, the input schema for answers, and how the interactive inquirer wizard relates going forward (kept, deprecated, or thin wrapper over the shared core)
  - New MCP path has test coverage (e.g. tests/mcp-init or a new suite) asserting a scaffold is generated from structured answers; npm test green
  - An ADR is logged (archkit_log_decision) recording the chosen approach: extend archkit_init vs add a new generation tool, the input schema for answers, and how the interactive inquirer wizard relates going forward (kept, deprecated, or thin wrapper over the shared core)
- An ADR is logged (archkit_log_decision) recording the chosen approach: extend archkit_init vs add a new generation tool, the input schema for answers, and how the interactive inquirer wizard relates going forward (kept, deprecated, or thin wrapper over the shared core)
files-to-touch:
  - src/mcp/tools.mjs
  - src/wizard/generate.mjs
  - src/wizard/steps.mjs
  - src/scaffold.mjs
  - src/commands/init.mjs
required-reading:
  - src/mcp/tools.mjs
  - src/wizard/generate.mjs
  - src/wizard/steps.mjs
  - src/scaffold.mjs
depends-on: 
verify-command: npm test
source-ask: (1) Add the file://${process.argv[1]} self-exec guard sweep as a CGR. (2) Separately: make the interactive new-project wizard part of the MCP toolkit — the interactive (inquirer) wizard is likely unused since it requires software-architecture experience.
started: 2026-06-13T13:00:12.496Z
completed: 2026-06-13T13:10:49.953Z
completion-notes: Extracted a pure TTY-free core (src/wizard/scaffold-core.mjs::generateScaffold + normalizeAnswers); refactored the inquirer wizard's generateFiles into a thin wrapper over it; added MCP tool archkit_init_generate (runner src/commands/init-generate.mjs) that generates the .arch/ scaffold from structured answers, complementing instruct-only archkit_init; logged ADR 0007; added tests/mcp-init-generate (10 assertions). 52/52 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-13
---



# Expose the interactive new-project wizard as MCP tooling so an LLM can drive greenfield scaffold generation without the inquirer TTY

## Why
The interactive wizard (src/scaffold.mjs + src/wizard/*) is inquirer/TTY-based and requires software-architecture expertise to answer, so it is effectively unused. The existing archkit_init MCP tool only returns wizard INSTRUCTIONS inline — the actual step/decision model and scaffold generation (src/wizard/generate.mjs) stay locked behind inquirer. The value should be reachable through the MCP toolkit where Claude answers the architecture questions and performs the scaffold.

## Exit criteria
- [ ] The wizard's scaffold-generation core (src/wizard/generate.mjs) and step/decision model are callable without inquirer — a function that accepts structured answers (archetype, stack, app name, etc.) and writes the .arch/ scaffold, decoupled from the interactive prompt layer
- [ ] One or more MCP tools let an LLM run the full greenfield flow end-to-end — choose archetype/stack and GENERATE the .arch/ scaffold — extending or complementing archkit_init (which today only instructs, does not generate)
- [ ] An ADR is logged (archkit_log_decision) recording the chosen approach: extend archkit_init vs add a new generation tool, the input schema for answers, and how the interactive inquirer wizard relates going forward (kept, deprecated, or thin wrapper over the shared core)
- [ ] New MCP path has test coverage (e.g. tests/mcp-init or a new suite) asserting a scaffold is generated from structured answers; npm test green

