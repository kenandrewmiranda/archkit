---
slug: cgr-project-branch-grouping
title: Add project field + branch-per-feature payload guidance to CGR
status: completed
created: 2026-06-20
epic: parallel-cgr-workflow
order: 0
exit-criteria:
  - A `project:` frontmatter field is accepted at intake (alongside epic), slugified on write, parsed by parseGoal, and emitted by writeGoal/emitFrontmatter
  - renderPayload injects a prework block when a goal has a project: instruct the agent to `git switch -c feat/<project>` (or switch if it exists) before editing, and to commit each completed CGR to that branch
  - goal_intake tool schema exposes an optional `project` arg with a description distinguishing it from `epic` (epic = sequencing group; project = branch-isolated feature set)
  - archkit_goal_list surfaces a `projects` view (project label -> goal slugs) mirroring the existing epics view
  - An ADR is logged via archkit_log_decision recording the project=branch-scoped-feature-set decision and that git stays agent-driven (archkit emits guidance, never runs git)
  - New unit tests cover project parse/emit round-trip and the branch-guidance payload string; full suite green
  - A `project: ` frontmatter field is accepted at intake (alongside epic), slugified on write, parsed by parseGoal, and emitted by writeGoal/emitFrontmatter
  - renderPayload injects a prework block when a goal has a project: instruct the agent to `git switch -c feat/<project>` (or switch if it exists) before editing, and to commit each completed CGR to that branch
- A `project: ` frontmatter field is accepted at intake (alongside epic), slugified on write, parsed by parseGoal, and emitted by writeGoal/emitFrontmatter
- renderPayload injects a prework block when a goal has a project: instruct the agent to `git switch -c feat/<project>` (or switch if it exists) before editing, and to commit each completed CGR to that branch
files-to-touch:
  - src/lib/goals.mjs
  - src/mcp/tools.mjs
required-reading:
  - .arch/decisions/0005-add-intentional-cgr-goal-sequencing-via-order-epic-frontmatt.md
  - .arch/decisions/0006-make-cgr-goal-ordering-epic-primary-drain-an-epic-before-the.md
  - src/lib/goals.mjs
depends-on: 
verify-command: npm test
source-ask: Review if the CGR workflow can include an actual Queue folder instead of pending goals sitting at the root. Introduce a net-new "projects" idea where relevant CGRs are set in a subfolder so the agent knows to start a new branch and commit each CGR to that branch, enabling agents to work on feature sets in parallel. If two agents cross each other in the codebase, add a chat.md the agents can use to communicate about potential conflicts, wired in as prework. Goal: make parallel work seamless.
started: 2026-06-20T15:22:53.509Z
completed: 2026-06-20T15:26:37.863Z
completion-notes: Added optional `project:` frontmatter (slugified, round-trips via writeGoal/parseGoal), a branch-prework block in renderPayload (git switch -c feat/<project> + commit-per-CGR, instruct-not-act), a `projects` view in goal_list mirroring epics, and the goal_intake `project` arg distinguishing it from epic. ADR 0010 logged. 6 new tests; full suite 52/52.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-20
---



# Add project field + branch-per-feature payload guidance to CGR

## Why
The keystone for parallel work: a `project:` grouping that tells the agent to isolate each feature set on its own git branch. Keeps archkit instruct-not-act — archkit emits branch guidance text, the agent runs git.

## Exit criteria
- [ ] A `project:` frontmatter field is accepted at intake (alongside epic), slugified on write, parsed by parseGoal, and emitted by writeGoal/emitFrontmatter
- [ ] renderPayload injects a prework block when a goal has a project: instruct the agent to `git switch -c feat/<project>` (or switch if it exists) before editing, and to commit each completed CGR to that branch
- [ ] goal_intake tool schema exposes an optional `project` arg with a description distinguishing it from `epic` (epic = sequencing group; project = branch-isolated feature set)
- [ ] archkit_goal_list surfaces a `projects` view (project label -> goal slugs) mirroring the existing epics view
- [ ] An ADR is logged via archkit_log_decision recording the project=branch-scoped-feature-set decision and that git stays agent-driven (archkit emits guidance, never runs git)
- [ ] New unit tests cover project parse/emit round-trip and the branch-guidance payload string; full suite green

