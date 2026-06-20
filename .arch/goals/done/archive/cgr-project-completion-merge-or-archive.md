---
slug: cgr-project-completion-merge-or-archive
title: At end of a project/queue, prompt to merge the branch or archive to done
status: completed
created: 2026-06-20
epic: parallel-cgr-workflow
order: 5
exit-criteria:
  - A pure function detects when a goal completion DRAINS the last live goal of its project (or the current queue batch) — i.e. no pending/in-progress/testing goals remain for that bucket; tolerates ungrouped goals and never throws
  - On end-of-bucket, archkit_goal_complete / the relay SURFACES A CHOICE: merge the project/queue branch into a mainline branch, or archive only (send the project's CGRs to the done folder as today)
  - On 'merge': archkit EMITS git guidance (e.g. `git switch <mainline> && git merge <branch>`) with the mainline target configurable (.arch/config.json) and defaulting to a detected main/master — archkit never runs git itself (consistent with the goal 0 ADR)
  - On 'archive only': the completed CGRs consolidate into the done folder as today, the branch is left unmerged, and NO git guidance is emitted
  - The prompt fires ONLY at end-of-bucket (last goal drained), never after an ordinary mid-project completion
  - Unit tests cover: last-goal-of-project triggers the prompt, a non-last completion does not, the merge-guidance string + mainline config/detection, and the archive-only path; full suite green
  - On end-of-bucket, archkit_goal_complete / the relay SURFACES A CHOICE: merge the project/queue branch into a mainline branch, or archive only (send the project's CGRs to the done folder as today)
  - On 'merge': archkit EMITS git guidance (e.g. `git switch <mainline> && git merge <branch>`) with the mainline target configurable (.arch/config.json) and defaulting to a detected main/master — archkit never runs git itself (consistent with the goal 0 ADR)
  - On 'archive only': the completed CGRs consolidate into the done folder as today, the branch is left unmerged, and NO git guidance is emitted
  - Unit tests cover: last-goal-of-project triggers the prompt, a non-last completion does not, the merge-guidance string + mainline config/detection, and the archive-only path; full suite green
- On end-of-bucket, archkit_goal_complete / the relay SURFACES A CHOICE: merge the project/queue branch into a mainline branch, or archive only (send the project's CGRs to the done folder as today)
- On 'merge': archkit EMITS git guidance (e.g. `git switch <mainline> && git merge <branch>`) with the mainline target configurable (.arch/config.json) and defaulting to a detected main/master — archkit never runs git itself (consistent with the goal 0 ADR)
- On 'archive only': the completed CGRs consolidate into the done folder as today, the branch is left unmerged, and NO git guidance is emitted
- Unit tests cover: last-goal-of-project triggers the prompt, a non-last completion does not, the merge-guidance string + mainline config/detection, and the archive-only path; full suite green
files-to-touch:
  - src/lib/goals.mjs
  - src/mcp/tools.mjs
  - src/mcp/prompts.mjs
required-reading:
  - .arch/decisions/0003-lock-the-expanded-cgr-lifecycle-state-model-and-rename-the-s.md
  - src/lib/goals.mjs
depends-on:
  - cgr-project-branch-grouping
  - cgr-relay-queue-vs-project-routing
verify-command: npm test
source-ask: At the end of a queue or project list (when all its goals are done), ask the user if they would like to merge to main or any mainline branch; otherwise send the project to the done folder.
started: 2026-06-20T16:29:44.236Z
completed: 2026-06-20T16:36:58.295Z
completion-notes: Added pure detectBucketDrain (last-live-goal-of-bucket detection, tolerates ungrouped, never throws), detectMainline (config cgr.mainline → detected main/master via .git refs/packed-refs without running git → default main), bucketBranch, bucketMergeGuidance, and bucketCompletion to goals.mjs. Wired into runGoalComplete: surfaces a merge-or-archive choice (bucketCompletion field + nextStep) only at end-of-bucket, consolidates CGRs on drain, emits git guidance but never runs git. 17 new tests; full suite 52/52 green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-20
---



# At end of a project/queue, prompt to merge the branch or archive to done

## Why
Teardown counterpart to branch-isolated work: when the LAST goal of a project or the current queue batch completes, ask whether to land the feature branch into a mainline or just shelve it. Closes the parallel-work loop — branches don't pile up unmerged and unowned.

## Exit criteria
- [ ] A pure function detects when a goal completion DRAINS the last live goal of its project (or the current queue batch) — i.e. no pending/in-progress/testing goals remain for that bucket; tolerates ungrouped goals and never throws
- [ ] On end-of-bucket, archkit_goal_complete / the relay SURFACES A CHOICE: merge the project/queue branch into a mainline branch, or archive only (send the project's CGRs to the done folder as today)
- [ ] On 'merge': archkit EMITS git guidance (e.g. `git switch <mainline> && git merge <branch>`) with the mainline target configurable (.arch/config.json) and defaulting to a detected main/master — archkit never runs git itself (consistent with the goal 0 ADR)
- [ ] On 'archive only': the completed CGRs consolidate into the done folder as today, the branch is left unmerged, and NO git guidance is emitted
- [ ] The prompt fires ONLY at end-of-bucket (last goal drained), never after an ordinary mid-project completion
- [ ] Unit tests cover: last-goal-of-project triggers the prompt, a non-last completion does not, the merge-guidance string + mainline config/detection, and the archive-only path; full suite green

