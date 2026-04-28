# Changelog

## v1.4.0 — 2026-04-28

### Added
- **MCP server** (`archkit-mcp` and `archkit mcp serve`): stdio MCP server exposing 10 typed tools that mirror the CLI surface. Lets AI agents call archkit natively in Claude Code, Cursor, and Continue.
- `archkit init --install-hooks --mcp`: idempotent registration of archkit in `~/.claude/mcp.json`.
- `ArchkitError` class and shared error envelope (`{ code, message, suggestion?, docsUrl? }`) used by both CLI `--json` output and MCP `isError` responses.
- Per-command `run*Json()` exports (review, warmup, preflight, scaffold, lookup, gotcha-list, gotcha-propose, stats, drift) for direct programmatic use.

### Changed
- `archkit-protocol` skill template now nudges agents toward MCP tools when available.

### Dependencies
- Added `@modelcontextprotocol/sdk@^1.29.0`
- Added `zod@^3`
