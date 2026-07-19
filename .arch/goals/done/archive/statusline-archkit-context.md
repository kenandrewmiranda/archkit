---
slug: statusline-archkit-context
title: Surface archkit CGR context in the Claude Code status line
status: completed
created: 2026-07-19
order: 4
exit-criteria:
  - Decide the data source: read .arch/ goal state files directly (fast, no server) vs. a dedicated `archkit statusline` CLI subcommand that emits a compact string
  - Status line segment shows the active/in-progress goal slug and pending-queue depth (e.g. `⛏ fix-conductor-triage (3 queued)`), and stays silent/omitted when outside an archkit project or when no goal is active
  - Segment degrades gracefully: no crash/garbage when .arch/ is absent, malformed, or the queue is empty
  - Colors match the existing bright dark-mode scheme and the segment slots cleanly into the current layout without breaking other segments
  - Documented in the appropriate place (statusline command comment or archkit docs) so the mapping is reproducible
  - Decide the data source: read .arch/ goal state files directly (fast, no server) vs. a dedicated `archkit statusline` CLI subcommand that emits a compact string
  - Segment degrades gracefully: no crash/garbage when .arch/ is absent, malformed, or the queue is empty
  - Decide the data source: read .arch/ goal state files directly (fast, no server) vs. a dedicated `archkit statusline` CLI subcommand that emits a compact string
  - Segment degrades gracefully: no crash/garbage when .arch/ is absent, malformed, or the queue is empty
  - Decide the data source: read .arch/ goal state files directly (fast, no server) vs. a dedicated `archkit statusline` CLI subcommand that emits a compact string
  - Segment degrades gracefully: no crash/garbage when .arch/ is absent, malformed, or the queue is empty
- Decide the data source: read .arch/ goal state files directly (fast, no server) vs. a dedicated `archkit statusline` CLI subcommand that emits a compact string
- Segment degrades gracefully: no crash/garbage when .arch/ is absent, malformed, or the queue is empty
files-to-touch:
  - ~/.claude/settings.json
required-reading: 
depends-on: 
verify-command: npm test
source-ask: While configuring the Claude Code status line, explored whether an MCP server like archkit could feed context into the status line. Conclusion: not via MCP protocol (status line is a plain shell subprocess, not an MCP client), but it can read .arch/ state on disk or shell out to an archkit CLI. User asked to capture this as a net-new CGR to explore later rather than build now.
lane: lane-statusline-archkit-context
started: 2026-07-19T18:07:37.422Z
handoff: .arch/board/handoff/statusline-archkit-context.md
completed: 2026-07-19T18:12:32.214Z
completion-notes: Added `archkit statusline` CLI subcommand (reads .arch/ goal state off disk) emitting a compact CGR segment (active goal slug + pending-queue depth) for the Claude Code status-line subprocess. Plain-text output colored by the wrapper; silent + graceful outside a project / on malformed .arch/. settings.json snippet documented (not auto-applied). 15 new tests, 62/62 suites green.
time-spent: 35m
tests-passed: true
tests-command: npm test
tests-at: 2026-07-19
---





# Surface archkit CGR context in the Claude Code status line

## Why
The status line runs as a plain shell subprocess and can't call archkit MCP tools, but it CAN read .arch/ state on disk or shell out to an archkit CLI. Surfacing the active goal + queue depth in the status line would give an at-a-glance CGR heads-up display.

## Exit criteria
- [ ] Decide the data source: read .arch/ goal state files directly (fast, no server) vs. a dedicated `archkit statusline` CLI subcommand that emits a compact string
- [ ] Status line segment shows the active/in-progress goal slug and pending-queue depth (e.g. `⛏ fix-conductor-triage (3 queued)`), and stays silent/omitted when outside an archkit project or when no goal is active
- [ ] Segment degrades gracefully: no crash/garbage when .arch/ is absent, malformed, or the queue is empty
- [ ] Colors match the existing bright dark-mode scheme and the segment slots cleanly into the current layout without breaking other segments
- [ ] Documented in the appropriate place (statusline command comment or archkit docs) so the mapping is reproducible

