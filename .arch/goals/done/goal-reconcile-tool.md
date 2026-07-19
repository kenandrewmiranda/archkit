---
slug: goal-reconcile-tool
title: Explicit archkit_goal_reconcile MCP tool for on-demand dry-run/apply
status: completed
created: 2026-07-19
order: 3
exit-criteria:
  - New archkit_goal_reconcile MCP tool: dry-run by default (lists proposed moves/dups/quarantine), apply:true performs them, delegating to reconcileGoalsLayout
  - Tool description states status-is-source-of-truth and that placement is derived from it
  - Registered in the tool table and tool-count assertions updated
  - Handler in src/commands/goal.mjs (runGoalReconcile) with matching test coverage
  - New archkit_goal_reconcile MCP tool: dry-run by default (lists proposed moves/dups/quarantine), apply:true performs them, delegating to reconcileGoalsLayout
- New archkit_goal_reconcile MCP tool: dry-run by default (lists proposed moves/dups/quarantine), apply:true performs them, delegating to reconcileGoalsLayout
files-to-touch:
  - src/mcp/tools.mjs
  - src/commands/goal.mjs
required-reading: 
depends-on:
  - reconcile-goals-layout
owns:
  - src/commands/goal.mjs
feature: warmup-surface
verify-command: npm test
source-ask: After working multiple projects, CGR files end up in random places in the goals folder/subfolders — causing CGRs to be skipped or the next goal to get mixed up. Build a cleanup/startup workflow that runs on archkit call, auto-fixes placement when the scan detects too much out of place, and does a lightweight staleness check against chat/board for cross-project cruft. Decision: both tiers now; auto-fix inside warmup (moves reported, not silent); Tier 2 staleness stays advisory.
lane: warmup-surface
completed: 2026-07-19T20:21:53.650Z
completion-notes: archkit_goal_reconcile MCP tool merged (lane warmup-surface). Delegates to reconcileGoalsLayout; dry-run default, apply:true. Tool registry 41→42; mcp-server/silent-success-audit/cgr-reconcile tests updated. Base goals.mjs preserved (worker's byte-identical copy discarded during graft).
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---



# Explicit archkit_goal_reconcile MCP tool for on-demand dry-run/apply

## Why
Warmup auto-fixes, but a manual tool lets you preview (dry-run) and reconcile on demand mid-session without waiting for SessionStart.

## Exit criteria
- [ ] New archkit_goal_reconcile MCP tool: dry-run by default (lists proposed moves/dups/quarantine), apply:true performs them, delegating to reconcileGoalsLayout
- [ ] Tool description states status-is-source-of-truth and that placement is derived from it
- [ ] Registered in the tool table and tool-count assertions updated
- [ ] Handler in src/commands/goal.mjs (runGoalReconcile) with matching test coverage

