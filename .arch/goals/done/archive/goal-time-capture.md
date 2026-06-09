---
slug: goal-time-capture
title: Capture per-goal time: ISO-8601 transition stamps + derived elapsed + explicit effort override
status: completed
created: 2026-06-09
exit-criteria:
  - startGoal, markTesting, and completeGoal write full ISO-8601 datetimes (not date-only) to the started / testing-since / completed frontmatter keys
  - A helper derives elapsed wall-clock from started→completed and exposes it on the goal record (e.g. via the parsed goal object)
  - archkit_goal_complete accepts an optional explicit effort arg (e.g. timeSpent like '2h'/'90m') persisted as a time-spent frontmatter key; when present it takes precedence over derived elapsed
  - Goals carrying legacy date-only stamps degrade gracefully — no elapsed shown, no parse crash
  - Tests cover datetime stamping, elapsed derivation, explicit-override precedence, and the legacy date-only fallback
files-to-touch:
  - src/lib/goals.mjs
  - src/commands/goal.mjs
required-reading: 
depends-on: 
verify-command: npm test
source-ask: In the goal_next→clear→goal_next loop users lose track of what's done. Add a consolidated day-by-day worklog they can post to Jira (time logging minimal; ticket linking is backlog). Capture time spent per goal — it's important to understand how long something took. Synthesis approved: ISO datetime transition stamps → derived elapsed, with an explicit effort override; worklog export over existing digests; plus an in-loop "done today" breadcrumb and a one-line goal restatement.
started: 2026-06-09
completed: 2026-06-09
completion-notes: Transition stamps (started/testing-since/completed) now full ISO-8601 datetimes; added deriveElapsedMs/formatDuration/effortOf helpers (elapsedMs exposed on parsed goal record); completeGoal+MCP accept timeSpent override persisted as time-spent (precedence over derived); legacy date-only stamps degrade gracefully via stampDate + hasTimeComponent guard.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-09
---



# Capture per-goal time: ISO-8601 transition stamps + derived elapsed + explicit effort override

## Why
Foundation for the worklog. Today all goal timestamps are date-only (YYYY-MM-DD), so archkit cannot tell how long anything took. Upgrade to full datetime so elapsed is derivable, while keeping an honest user-entered override since wall-clock includes idle time.

## Exit criteria
- [ ] startGoal, markTesting, and completeGoal write full ISO-8601 datetimes (not date-only) to the started / testing-since / completed frontmatter keys
- [ ] A helper derives elapsed wall-clock from started→completed and exposes it on the goal record (e.g. via the parsed goal object)
- [ ] archkit_goal_complete accepts an optional explicit effort arg (e.g. timeSpent like '2h'/'90m') persisted as a time-spent frontmatter key; when present it takes precedence over derived elapsed
- [ ] Goals carrying legacy date-only stamps degrade gracefully — no elapsed shown, no parse crash
- [ ] Tests cover datetime stamping, elapsed derivation, explicit-override precedence, and the legacy date-only fallback

