# 0016. Rename archkit "skills" to "playbooks" to resolve Claude Agent Skills collision

- **Date**: 2026-06-23
- **Status**: Accepted
- **Tags**: vocabulary, rename, mcp, claude-code, breaking-change, back-compat

## Context

archkit's "skills" — package-scoped knowledge/gotcha files (`.skill`) injected as context during preflight/scaffold — now namespace-collide with Claude Code's first-class Agent Skills (the `/skill` system, SKILL.md). The collision is confusing in docs, MCP tool names (archkit_gotcha_*, skill counts in warmup/stats), and the wizard/migrate vocabulary. The name was NOT finalized at intake; the operator was given candidates Primer / Lore / Playbook and had to confirm before any broad rename (this was an explicit exit-criterion and barrier gate).

## Decision

Adopt **"playbook"** as the new vocabulary for archkit's package-knowledge units, replacing "skill". The operator selected Playbook over Primer and Lore. Scope: `.skill` file extension → `.playbook`; `.arch/skills/` directory → `.arch/playbooks/`; MCP tool ids/strings, warmup/stats counts, wizard, migrate, and docs updated to "playbook"/"playbooks". A back-compat alias MUST keep reading existing `.skill` files and `.arch/skills/` directories so already-initialized projects don't break. Optionally each renamed unit may ALSO be emitted as a native Claude Skill for on-demand loading. The choice is captured here per the goal's barrier requirement.

## Consequences

Easier: the two concepts (archkit package-knowledge vs Claude Agent Skills) are no longer namespace-ambiguous; docs and tool output read clearly. Harder/constrained: this is a broad, exclusive/barrier rename touching many files (loaders, wizard, migrate, MCP server, tests, docs); back-compat alias code paths add a small maintenance surface that must persist until a future major version drops `.skill` support. Existing projects keep working via the alias. A deprecation note should point users to migrate `.arch/skills/` → `.arch/playbooks/`.
