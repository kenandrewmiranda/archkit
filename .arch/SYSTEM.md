# SYSTEM.md

## Type: Internal

## Pattern: layered

## Stack: Node.js (ESM, no build step), MCP SDK, Zod

## Summary
archkit is a context-engineering scaffolder + MCP server for AI coding agents.
It ships the `archkit` CLI, the archkit MCP server (archkit_* tools), four
Claude Code guardrail hooks (SessionStart, Stop, PostToolUse, UserPromptSubmit),
and the CGR (Clear Goal Run) goal-relay prompts. This `.arch/` exists so archkit
can dogfood its own CGR loop.

## Layers
- bin/        — CLI + hook entrypoints (archkit.mjs, archkit-*-hook.mjs, archkit-mcp.mjs)
- src/commands/ — one module per CLI/MCP command (goal, review, drift, resolve, ...)
- src/lib/    — pure libraries (goals, test-runner, detectors, session-stats, ...)
- src/mcp/    — MCP server wiring (tools, prompts, resources, server)
- tests/      — standalone suites (tests/<name>/run.mjs), run by `npm test`

## Rules
- ESM only; no transpile step. Files are plain `.mjs`.
- Libraries in src/lib/ stay pure; side-effecting orchestration lives in src/commands/ and bin/.
- Every MCP tool result returns a `nextStep` string (silent-success contract).
- package.json and .claude-plugin/plugin.json versions ship as one unit — bump together.

## Reserved Words
$arch = the resolved .arch/ directory (found via findArchDir, passed into libs as archDir)
$run = the ARCHKIT_RUN env flag that tells a command module to self-fire main()
$next = the nextStep string every MCP tool result must carry (silent-success contract)
$err = archkitError, the typed-error factory used instead of bare `throw new Error`
$goal = the active CGR goal whose exit-criteria gate the Stop hook

## Naming
Files: kebab-case
