# archkit MCP Server — Roadmap Note

**Date:** 2026-04-18
**Status:** Planned — archkit's next major feature after archapp v0.1 design lockdown
**Related:** archapp v0.1 design spec (sibling project at `/Users/kenmiranda/Desktop/Projects/archapp`)

## Context

archkit today exposes its capabilities through a CLI (`archkit review`, `archkit resolve preflight`, `archkit gotcha --propose`, etc.). Every command returns structured JSON on stdout and is therefore agent-callable. Agents like Claude Code shell out to archkit via hooks (pre-commit, PreToolUse) or via skill-driven prompts (`.arch/skills/archkit-protocol.skill`).

The observed problem: **agents use archkit less often than they should.** Specifically:

- Hooks are *reactive* — they fire after an agent has already chosen its tool, and after code has already been written.
- Skill-driven workflow depends on the agent *remembering* to shell out to archkit commands at the right moments.
- The CLI JSON output must be parsed and reasoned about before the agent can act on it. That's non-zero friction.

The result is archkit being used ~70% of where it *should* fire, not ~99%.

## Why MCP Is the Next Move

An MCP server exposes archkit's capabilities as typed tools in the agent's native tool list:

- Agents reach for tools that *feel native*. MCP tools appear next to the agent's built-in Read/Edit/Grep tools; CLI commands require recall.
- Tool selection is influenced *at the moment the agent is deciding what to do next*, not after the fact. That shifts archkit from reactive enforcement to proactive guidance.
- Typed tool contracts mean responses flow directly into the agent's next action — no intermediate JSON parsing.

This is the difference between "archkit fires when I remember to call it" and "archkit fires because it's the obvious thing to call."

## Proposed Tool Surface (initial set)

| MCP tool | Wraps CLI equivalent | Purpose |
|----------|---------------------|---------|
| `archkit.review` | `archkit review --json <file>` | Review a file against rules + gotchas |
| `archkit.review_staged` | `archkit review --staged --json` | Review git-staged files |
| `archkit.resolve.warmup` | `archkit resolve warmup --json` | Pre-session health check |
| `archkit.resolve.preflight` | `archkit resolve preflight <feature> <layer>` | Live runtime view for a feature path |
| `archkit.resolve.scaffold` | `archkit resolve scaffold <feature>` | Generate source skeleton |
| `archkit.resolve.lookup` | `archkit resolve lookup <id>` | Lookup node/skill/cluster |
| `archkit.gotcha.propose` | `archkit gotcha --propose ...` | Queue a gotcha proposal |
| `archkit.gotcha.list` | `archkit gotcha --list --json` | List all skills + counts |
| `archkit.stats` | `archkit stats --json` | Health dashboard data |
| `archkit.drift` | `archkit drift --json` | Detect stale `.arch/` files |

## Sequencing

1. ✅ archapp v0.1 design spec locked (2026-04-18)
2. ⏳ Build archkit MCP server (next — new package `@archkit/mcp` or `archkit/mcp` subdir)
3. ⏳ Implement archapp v0.1 — uses archkit MCP from day one

This ordering lets archapp inherit MCP-aware agent UX on its first release, instead of retrofitting later.

## Open Design Questions (for the MCP spec phase)

- Package layout: separate `@archkit/mcp` package vs. subcommand of main archkit (`archkit mcp serve`)?
- Transport: stdio (Claude Code native) first, HTTP/SSE later?
- Tool naming convention: `archkit.foo.bar` vs flat `archkit_foo_bar`?
- Authentication: none (local-only) in v1, bearer-token/scoped API keys in v2?
- Error surfaces: same `{ code, message, suggestion, docsUrl }` envelope the CLI uses?

These get resolved in a dedicated MCP spec before implementation starts.
