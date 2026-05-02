# Changelog

## v1.4.2 — 2026-05-02

### Fixed
- `archkit init --mcp` now registers via `claude mcp add archkit archkit-mcp --scope user` instead of writing directly to `~/.claude/mcp.json`. Claude Code v2.x reads MCP config from `~/.claude.json` (managed by the `claude mcp` CLI), not from the legacy `~/.claude/mcp.json` path. v1.4.0 and v1.4.1 silently registered to the wrong file — `claude mcp list` did not show archkit, and the MCP tools were not available in sessions even when the installer claimed success.

### Behavior
- If the `claude` CLI is not on `PATH`, `archkit init --mcp` now warns clearly and prints the manual command to run.
- Idempotent: re-running detects an existing `archkit:` entry in `claude mcp list` and does nothing.

## v1.4.1 — 2026-05-02

### Added
- **SessionStart hook** (`archkit-session-start`): when Claude Code opens a session in an archkit project (detected by walking up from cwd to find `.arch/SYSTEM.md`), the hook emits `additionalContext` describing the available `archkit_*` MCP tools and how `.arch/` is structured. Wired up by `archkit init --install-hooks --claude` alongside the existing PreToolUse hook.

### Why
- Dogfood (2026-05-02) showed that tool descriptions and the skill template alone don't reliably nudge agents toward `archkit_*` MCP tools — invocation was inconsistent. A SessionStart hook injects factual project context before the agent picks its first tool, which lands at a higher trust posture than runtime PreToolUse deny-reason text (which was observed to trigger prompt-injection skepticism).

### Changed
- `archkit init --install-hooks --claude` now writes both a PreToolUse entry and a SessionStart entry to `.claude/settings.json`. Existing PreToolUse behavior is unchanged.

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
