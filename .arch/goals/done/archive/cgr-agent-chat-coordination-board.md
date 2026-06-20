---
slug: cgr-agent-chat-coordination-board
title: Add a shared (gitignored) chat.md coordination board for parallel agents
status: completed
created: 2026-06-20
epic: parallel-cgr-workflow
order: 2
exit-criteria:
  - A coordination board file (e.g. .arch/goals/chat.md) is created/appended via a helper; the path is added to .gitignore so it stays shared and never commits into a feature branch
  - An append helper stamps entries with goal slug + project/branch + timestamp + files-touched, and a read helper returns recent entries
  - renderPayload prework instructs the agent to READ the board and APPEND an announce-entry (its goal, branch, files-to-touch) before editing, and to check it when conflict detection flags overlap
  - Board read/append tolerate a missing file and never throw; board content is excluded from listGoals scanning
  - Unit tests cover append/read round-trip and gitignore wiring; full suite green
files-to-touch:
  - src/lib/goals.mjs
  - .gitignore
required-reading:
  - src/lib/goals.mjs
depends-on:
  - cgr-files-to-touch-conflict-detection
verify-command: npm test
source-ask: Review if the CGR workflow can include an actual Queue folder instead of pending goals sitting at the root. Introduce a net-new "projects" idea where relevant CGRs are set in a subfolder so the agent knows to start a new branch and commit each CGR to that branch, enabling agents to work on feature sets in parallel. If two agents cross each other in the codebase, add a chat.md the agents can use to communicate about potential conflicts, wired in as prework. Goal: make parallel work seamless.
started: 2026-06-20T15:33:26.242Z
completed: 2026-06-20T15:37:18.435Z
completion-notes: Added a shared, gitignored .arch/goals/chat.md coordination board: appendChatEntry (stamps slug+project/branch+timestamp+files, JSON-in-comment for exact round-trip) and readChatBoard (newest-first, limit, missing-file tolerant) in src/lib/goals.mjs; board excluded from listGoals by filename; renderPayload now emits READ+APPEND announce prework plus a check-on-conflict line; .gitignore ignores the path. 9 new unit tests, full suite green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-20
---



# Add a shared (gitignored) chat.md coordination board for parallel agents

## Why
Human-readable layer on top of structured overlap detection. Critical design constraint: the board must live in a SHARED, non-branch-isolated location (gitignored) — a chat.md committed per-branch is invisible across branches, defeating the purpose.

## Exit criteria
- [ ] A coordination board file (e.g. .arch/goals/chat.md) is created/appended via a helper; the path is added to .gitignore so it stays shared and never commits into a feature branch
- [ ] An append helper stamps entries with goal slug + project/branch + timestamp + files-touched, and a read helper returns recent entries
- [ ] renderPayload prework instructs the agent to READ the board and APPEND an announce-entry (its goal, branch, files-to-touch) before editing, and to check it when conflict detection flags overlap
- [ ] Board read/append tolerate a missing file and never throw; board content is excluded from listGoals scanning
- [ ] Unit tests cover append/read round-trip and gitignore wiring; full suite green

