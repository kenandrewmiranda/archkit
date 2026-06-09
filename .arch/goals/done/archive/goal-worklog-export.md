---
slug: goal-worklog-export
title: archkit_worklog: render a date/range worklog from digests + archive for Jira
status: completed
created: 2026-06-09
exit-criteria:
  - A worklog renderer reads completed-goal data (done/digest + done/archive + any completed-but-not-yet-consolidated goals) for a given date or date range
  - Each entry shows title, outcome, and time — explicit effort when set, otherwise derived elapsed tagged '(elapsed)' so it is never misrepresented as effort — plus completion notes
  - Exposed as both a CLI command (archkit worklog [--from <date>] [--to <date>]) and an MCP tool
  - Default range is today; a date range is supported; output is copy-pasteable markdown
  - Tests cover rendering, range filtering, and the effort-vs-elapsed labeling
files-to-touch:
  - src/lib/goals.mjs
  - src/commands/goal.mjs
required-reading: 
depends-on:
  - goal-time-capture
verify-command: npm test
source-ask: In the goal_next→clear→goal_next loop users lose track of what's done. Add a consolidated day-by-day worklog they can post to Jira (time logging minimal; ticket linking is backlog). Capture time spent per goal — it's important to understand how long something took. Synthesis approved: ISO datetime transition stamps → derived elapsed, with an explicit effort override; worklog export over existing digests; plus an in-loop "done today" breadcrumb and a one-line goal restatement.
started: 2026-06-09
completed: 2026-06-09
completion-notes: Added archkit worklog: renderWorklog/collectWorklogEntries/effortToMs in src/lib/goals.mjs render a copy-pasteable day-by-day markdown log of completed goals over a date/range, reading done/ root + done/archive/ + done/digest/ (deduped, full-frontmatter sources preferred). Each entry shows title, outcome, completion notes, and time — explicit time-spent verbatim, else derived started→completed wall-clock tagged '(elapsed)', else nothing for legacy date-only goals. Default range is today; --from/--to (from-alone runs through today, to-alone open-started). New CLI command src/commands/worklog.mjs (runWorklog) wired in bin; MCP tool archkit_worklog in tools.mjs. New tests/cgr-worklog suite (14 tests); updated mcp-server + silent-success-audit fixtures for the new tool. Full suite 50/50 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-09
---



# archkit_worklog: render a date/range worklog from digests + archive for Jira

## Why
The actual deliverable users asked for — a copy-pasteable day-by-day log of what was accomplished and how long it took, built as a report over data that already exists (digests + archive).

## Exit criteria
- [ ] A worklog renderer reads completed-goal data (done/digest + done/archive + any completed-but-not-yet-consolidated goals) for a given date or date range
- [ ] Each entry shows title, outcome, and time — explicit effort when set, otherwise derived elapsed tagged '(elapsed)' so it is never misrepresented as effort — plus completion notes
- [ ] Exposed as both a CLI command (archkit worklog [--from <date>] [--to <date>]) and an MCP tool
- [ ] Default range is today; a date range is supported; output is copy-pasteable markdown
- [ ] Tests cover rendering, range filtering, and the effort-vs-elapsed labeling

