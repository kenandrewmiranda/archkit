# BOUNDARIES.md

Architectural boundaries archkit enforces on itself. Prose rules are advisory;
`BAN:` directives are machine-enforceable by `archkit boundary-check`.

## Layering

The dependency direction is one-way: `commands` and `bin` may import `lib`, never
the reverse. Pure libraries in `src/lib/` must not reach back into the
side-effecting command/orchestration layer.

- NEVER import a command module from a pure library. (BAN: src/lib/* -> src/commands/*)

## MCP boundary

The MCP layer (`src/mcp/`) only wires SDK registration and adapts command JSON to
envelopes — business logic lives in `src/commands/`. New behavior goes in a command
module that both the CLI and an MCP tool can reuse.
