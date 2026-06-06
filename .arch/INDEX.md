# INDEX.md

archkit's own architecture index — dogfooded so `archkit resolve warmup` and
`archkit doctor` run against a real spec instead of an empty skeleton. Four
clusters mirror the source tree: `bin/` (hooks + entrypoints), `src/commands/`
(one module per CLI/MCP command), `src/lib/` (pure libraries), and `src/mcp/`
(MCP server wiring).

## Keywords → Nodes
goal, cgr, intake, relay, complete → @cli
hook, sessionstart, stop, posttooluse, guard → @hooks
parser, generator, detector, pure, lib → @lib
mcp, tool, nextstep, server, envelope → @mcp

## Nodes → Clusters → Files
@cli → [cli] → src/commands/
@hooks → [hooks] → bin/
@lib → [lib] → src/lib/
@mcp → [mcp] → src/mcp/

## Cross-references
@cli → @lib (command modules import pure helpers from src/lib/)
@mcp → @cli (MCP tool handlers delegate to the same command modules the CLI runs)
@hooks → @cli (hooks shell out to CLI commands like review/warmup)
@hooks → @lib (the Stop hook reads goal state via src/lib/goals.mjs)
@mcp → @lib (tool handlers parse .arch/ via src/lib/parsers.mjs)

## Clusters
- [cli] : src/commands/ — CLI + MCP command modules (goal, resolve, review, drift, doctor, …)
- [hooks] : bin/ — Claude Code guardrail hooks + the CLI/MCP entrypoints
- [lib] : src/lib/ — pure libraries (parsers, goals, generators, detectors, test-runner)
- [mcp] : src/mcp/ — MCP server wiring (server, tools, prompts, resources, envelope)
