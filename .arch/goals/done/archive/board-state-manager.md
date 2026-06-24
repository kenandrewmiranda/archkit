---
slug: board-state-manager
title: Persistent board: append-only event log + derived session_state
status: completed
created: 2026-06-23
epic: cgr2-orchestration
order: 0
exit-criteria:
  - src/lib/board.mjs implements an append-only event log at .arch/board/events.ndjson with event types: claimed, completed, fissioned, merged, conflict, lease-expired
  - CGR record frontmatter is extended with: lane, owns (file globs), depends_on, exclusive, completion (full|partial), lease ({worker,expires}), lineage ({forked_from,supersedes,superseded_by}), per-criterion met flags, and a handoff pointer
  - A session_state MCP tool returns the FOLDED board: { lanes, frontier, blocked, in_flight, merge_queue, conflicts, leases_expired }
  - The board is purely derived — reconstituted by folding events + scanning cgr files, with NO separate mutable board file
  - Tests cover fold determinism and concurrent/parallel append safety
  - src/lib/board.mjs implements an append-only event log at .arch/board/events.ndjson with event types: claimed, completed, fissioned, merged, conflict, lease-expired
  - CGR record frontmatter is extended with: lane, owns (file globs), depends_on, exclusive, completion (full|partial), lease ({worker,expires}), lineage ({forked_from,supersedes,superseded_by}), per-criterion met flags, and a handoff pointer
  - A session_state MCP tool returns the FOLDED board: { lanes, frontier, blocked, in_flight, merge_queue, conflicts, leases_expired }
- src/lib/board.mjs implements an append-only event log at .arch/board/events.ndjson with event types: claimed, completed, fissioned, merged, conflict, lease-expired
- CGR record frontmatter is extended with: lane, owns (file globs), depends_on, exclusive, completion (full|partial), lease ({worker,expires}), lineage ({forked_from,supersedes,superseded_by}), per-criterion met flags, and a handoff pointer
- A session_state MCP tool returns the FOLDED board: { lanes, frontier, blocked, in_flight, merge_queue, conflicts, leases_expired }
files-to-touch:
  - src/lib/board.mjs
  - src/lib/goals.mjs
  - src/mcp/tools.mjs
required-reading:
  - .arch/decisions/0014-resume-by-cgr-fission-not-replay-board-as-append-only-event.md
depends-on: 
verify-command: npm test
source-ask: Build CGR 2.0: conductor/worker parallel-lane orchestration with a persistent append-only board, fission-based resume, attention-gradient wind-down, plus AGENTS.md export and skills rename. See ADRs 0013-0015.
started: 2026-06-23T21:51:18.594Z
completed: 2026-06-23T22:03:49.157Z
completion-notes: Added src/lib/board.mjs: append-only NDJSON event log (.arch/board/events.ndjson, 6 event types) with atomic O_APPEND appends, pure foldEvents, and sessionState() folding events+CGR files into {lanes,frontier,blocked,in_flight,merge_queue,conflicts,leases_expired} — no mutable board file. Extended CGR frontmatter in goals.mjs with lane/owns/depends_on/exclusive/completion/lease/lineage/criteria-met/handoff accessors (objects as inline JSON, no YAML dep) + stampGoalFields writer. Added archkit_session_state MCP tool. New tests/cgr-board (15 tests incl. fold determinism + 8-process parallel-append safety); updated mcp-server tool list (38) and silent-success audit. 53/53 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-23
---



# Persistent board: append-only event log + derived session_state

## Why
Keystone. Every other CGR-2.0 piece reads or appends to this. Must be fully on-disk and rehydration-safe because auto-compaction will summarize away anything held only in context.

## Exit criteria
- [ ] src/lib/board.mjs implements an append-only event log at .arch/board/events.ndjson with event types: claimed, completed, fissioned, merged, conflict, lease-expired
- [ ] CGR record frontmatter is extended with: lane, owns (file globs), depends_on, exclusive, completion (full|partial), lease ({worker,expires}), lineage ({forked_from,supersedes,superseded_by}), per-criterion met flags, and a handoff pointer
- [ ] A session_state MCP tool returns the FOLDED board: { lanes, frontier, blocked, in_flight, merge_queue, conflicts, leases_expired }
- [ ] The board is purely derived — reconstituted by folding events + scanning cgr files, with NO separate mutable board file
- [ ] Tests cover fold determinism and concurrent/parallel append safety

