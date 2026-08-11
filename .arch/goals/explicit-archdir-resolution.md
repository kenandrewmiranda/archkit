---
slug: explicit-archdir-resolution
title: Make archDir an explicit contract instead of inherited cwd
status: dispatched
created: 2026-08-10
order: 5
project: state-safety
exit-criteria:
  - ARCHKIT_ARCH_DIR is honored as the explicit archDir signal by the MCP server, the CLI, and every hook bin, with process.cwd() as the documented fallback so existing single-tree usage is byte-identical
  - archDir resolution happens in ONE place that all surfaces call, rather than being re-derived per handler
  - The rendered dispatch step tells the conductor to set ARCHKIT_ARCH_DIR for each spawned worker, so a worktree worker's sharing of the main .arch/ is deliberate and visible
  - Running the CLI from a worktree with the variable set reports the same board as the conductor — a test proves the worktree-divergence case
  - Full suite green
files-to-touch:
  - src/mcp/tools.mjs
  - src/mcp/server.mjs
  - src/lib/format.mjs
  - bin/archkit-stop-hook.mjs
  - bin/archkit-session-start.mjs
  - bin/archkit-mcp.mjs
  - tests/archdir-resolution/run.mjs
required-reading: 
depends-on:
  - adr-shared-state-contracts
owns:
  - src/mcp/**
  - bin/**
  - tests/archdir-resolution/**
feature: archdir
verify-command: npm test
source-ask: "since we have multiple lanes, we do have some race issues on multiple fronts, can we evaluate our current strategy and how we can properly address this? — Evaluation found: CGR state is split across two stores with opposite concurrency models. The board (.arch/board/events.ndjson, gitignored) is a correct append-only log with a pure fold. Goal frontmatter (.arch/goals/**, git-tracked) is ADR 0003's declared source of truth but is mutated by lock-free read-modify-write, with zero locking anywhere in the codebase. Sharpest edges: consolidateGoals (RMW on the digest that also deletes source goal files) is called from the Stop hook, a separate process spawned at every turn-end in every session; stampGoalFields is lock-free RMW on the authoritative store; archDir is resolved from process.cwd() at ~40 MCP sites, so worktree sharing is accidental rather than contractual."
lane: archdir
started: 2026-08-10T21:10:25.109Z
lease: "{\"worker\":\"worker-archdir\",\"expires\":\"2026-08-11T21:10:25.109Z\"}"
dispatched-since: 2026-08-10T21:10:25.110Z
dispatched-to: worker-archdir
---





# Make archDir an explicit contract instead of inherited cwd

## Why
Every MCP handler resolves archDir from process.cwd() (~40 sites in tools.mjs). Worktree workers therefore share the main tree's .arch/ by accident, not by contract. .arch/board/ is gitignored so a worktree has no board at all, while goal files are tracked and fork at the base commit — so an archkit CLI run from a worktree answers against a freshly-created empty board and a stale goal copy. ADR 0028 already flags a symptom of this in its Consequences.

## Exit criteria
- [ ] ARCHKIT_ARCH_DIR is honored as the explicit archDir signal by the MCP server, the CLI, and every hook bin, with process.cwd() as the documented fallback so existing single-tree usage is byte-identical
- [ ] archDir resolution happens in ONE place that all surfaces call, rather than being re-derived per handler
- [ ] The rendered dispatch step tells the conductor to set ARCHKIT_ARCH_DIR for each spawned worker, so a worktree worker's sharing of the main .arch/ is deliberate and visible
- [ ] Running the CLI from a worktree with the variable set reports the same board as the conductor — a test proves the worktree-divergence case
- [ ] Full suite green

