---
slug: archdir-command-walker-residual
title: Retire the last two private archDir walkers so the CLI honors the contract everywhere
status: pending
created: 2026-08-11
order: 6
project: state-safety
exit-criteria:
  - src/commands/decisions.mjs and src/commands/prd.mjs resolve archDir through src/lib/archdir.mjs instead of their own private findArchDir, and both private walkers are deleted
  - "`archkit decisions list --json` and `archkit prd check --json` run from a worktree with ARCHKIT_ARCH_DIR set answer against the named .arch/, proved by a test that spawns the real CLI"
  - With the variable unset, both subcommands behave exactly as before — asserted, not assumed
  - A repo-wide guard fails the suite if any new private archDir walker is reintroduced outside src/lib/archdir.mjs, so this cannot silently regress a third time
  - Full suite green
files-to-touch:
  - src/commands/decisions.mjs
  - src/commands/prd.mjs
  - tests/archdir-resolution/run.mjs
required-reading:
  - .arch/decisions/0031-archdir-resolution-contract-archkit-arch-dir-is-the-explicit.md
  - src/lib/archdir.mjs
depends-on: 
owns:
  - src/commands/decisions.mjs
  - src/commands/prd.mjs
feature: archdir
verify-command: npm test
source-ask: "Conductor follow-up from the explicit-archdir-resolution lane: the ARCHKIT_ARCH_DIR contract (ADR 0031) landed for the MCP server, all six hook bins and the CLI mainline, but two command modules kept verbatim private walkers in their CLI paths and therefore silently ignore the variable. Filed by the conductor rather than patched into the archdir merge, so the recorded green is not overstated."
lane: archdir
---


# Retire the last two private archDir walkers so the CLI honors the contract everywhere

## Why
ADR 0031 makes ARCHKIT_ARCH_DIR the explicit archDir signal, and explicit-archdir-resolution collapsed 8 duplicate walkers onto src/lib/archdir.mjs. Two survive: src/commands/decisions.mjs:198 and src/commands/prd.mjs:330 each define an identical private findArchDir used by their CLI mode, so `archkit decisions list/search` and `archkit prd check` resolve from cwd and silently ignore the variable. That is a hole in a contract readers will otherwise trust — a worktree worker running those subcommands answers against the wrong .arch/. The archdir lane did not own src/commands/, so it correctly declined to reach in.

## Exit criteria
- [ ] src/commands/decisions.mjs and src/commands/prd.mjs resolve archDir through src/lib/archdir.mjs instead of their own private findArchDir, and both private walkers are deleted
- [ ] `archkit decisions list --json` and `archkit prd check --json` run from a worktree with ARCHKIT_ARCH_DIR set answer against the named .arch/, proved by a test that spawns the real CLI
- [ ] With the variable unset, both subcommands behave exactly as before — asserted, not assumed
- [ ] A repo-wide guard fails the suite if any new private archDir walker is reintroduced outside src/lib/archdir.mjs, so this cannot silently regress a third time
- [ ] Full suite green

