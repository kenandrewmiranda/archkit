---
slug: graph-accept-tool
title: Add archkit_graph_accept — apply an authored node line to its cluster .graph and drop the consumed proposal
status: completed
created: 2026-06-09
exit-criteria:
  - New lib fn in src/lib/goals.mjs (e.g. acceptGraphProposal) appends an authored node line to .arch/clusters/<cluster>.graph for an undocumented-file gap, then removes the consumed proposal (or the resolved gap from it)
  - Accept validates the authored line parses as a node via loadGraphCluster before writing — a malformed line is rejected, never corrupts the .graph
  - A runGraphAccept entry is wired and registered as archkit_graph_accept in src/mcp/tools.mjs with a nextStep + silent-success note (passes the silent-success-audit suite)
  - unmapped-area gaps are handled or explicitly deferred with a clear message — no silent no-op
  - New tests cover: append to an existing .graph, proposal removal, and malformed-line rejection
  - npm test is green
  - New tests cover: append to an existing .graph, proposal removal, and malformed-line rejection
- New tests cover: append to an existing .graph, proposal removal, and malformed-line rejection
files-to-touch:
  - src/lib/goals.mjs
  - src/commands/goal.mjs
  - src/mcp/tools.mjs
  - tests/cgr-goals/run.mjs
required-reading:
  - src/lib/goals.mjs
  - src/lib/parsers.mjs
  - src/commands/boundary.mjs
  - .arch/decisions/0004-close-the-cgr-graph-flywheel-scoped-slice-in-at-goal-start-p.md
depends-on: 
verify-command: npm test
source-ask: After building the graph flywheel (slice-in + propose-out, ADR 0004), set the two open follow-ups as new CGRs to work next: #1 an archkit_graph_accept tool that closes the loop by applying an authored node line and dropping the proposal, and #2 surfacing pending graph-proposals at resolve_warmup so the debt is visible.
started: 2026-06-09
completed: 2026-06-09
completion-notes: Added archkit_graph_accept: acceptGraphProposal() in goals.mjs appends an authored, parse-validated (via loadGraphCluster probe) node line to a cluster .graph and drops the consumed gap/proposal; unmapped-area gaps are explicitly deferred (no silent no-op). Wired runGraphAccept + CLI graph-accept subcommand + MCP tool. Tests cover append/removal/partial-removal/malformed-rejection/deferral; 49/49 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-09
---



# Add archkit_graph_accept — apply an authored node line to its cluster .graph and drop the consumed proposal

## Why
Closes the write-back half of the graph flywheel (ADR 0004). Today detectGraphGaps persists a proposal but acceptance is a manual hand-edit of the .graph; this makes it one call, mirroring the boundary/gotcha propose→accept idiom.

## Exit criteria
- [ ] New lib fn in src/lib/goals.mjs (e.g. acceptGraphProposal) appends an authored node line to .arch/clusters/<cluster>.graph for an undocumented-file gap, then removes the consumed proposal (or the resolved gap from it)
- [ ] Accept validates the authored line parses as a node via loadGraphCluster before writing — a malformed line is rejected, never corrupts the .graph
- [ ] A runGraphAccept entry is wired and registered as archkit_graph_accept in src/mcp/tools.mjs with a nextStep + silent-success note (passes the silent-success-audit suite)
- [ ] unmapped-area gaps are handled or explicitly deferred with a clear message — no silent no-op
- [ ] New tests cover: append to an existing .graph, proposal removal, and malformed-line rejection
- [ ] npm test is green

