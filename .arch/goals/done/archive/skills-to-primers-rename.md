---
slug: skills-to-primers-rename
title: Rename archkit "skills" to resolve the Claude Skills collision
status: completed
created: 2026-06-23
epic: cgr2-orchestration
order: 6
exit-criteria:
  - Operator confirms the new name (candidates: Primer / Lore / Playbook) BEFORE any rename — capture the choice in an ADR
  - Run as an exclusive/barrier goal: rename touches many files; no other CGR runs concurrently
  - All .skill files, MCP tool ids/strings, wizard, migrate, and docs updated to the new vocabulary with a back-compat alias for existing .skill files
  - Optionally emit each renamed unit ALSO as a native Claude Skill for on-demand loading
  - Tests green and warmup/stats report no broken skill references
  - Operator confirms the new name (candidates: Primer / Lore / Playbook) BEFORE any rename — capture the choice in an ADR
  - Run as an exclusive/barrier goal: rename touches many files; no other CGR runs concurrently
- Operator confirms the new name (candidates: Primer / Lore / Playbook) BEFORE any rename — capture the choice in an ADR
- Run as an exclusive/barrier goal: rename touches many files; no other CGR runs concurrently
files-to-touch:
  - src/mcp/tools.mjs
  - src/wizard/scaffold-core.mjs
  - src/commands/wizard.mjs
  - src/commands/migrate.mjs
required-reading: 
depends-on: 
verify-command: npm test
source-ask: Build CGR 2.0: conductor/worker parallel-lane orchestration with a persistent append-only board, fission-based resume, attention-gradient wind-down, plus AGENTS.md export and skills rename. See ADRs 0013-0015.
started: 2026-06-23T23:17:34.066Z
completed: 2026-06-23T23:54:09.679Z
completion-notes: Renamed archkit "skills" → "playbooks" (ADR 0016, operator-confirmed name=Playbook). Single resolver src/lib/playbooks.mjs reads both .arch/playbooks/*.playbook and legacy .arch/skills/*.skill (back-compat alias); every reader refactored onto it (incl. 3 beyond the planned set: review.loadSkills, doctor.checkEmptySkills, resolve.cmdLookup). Writers emit .playbook; INDEX.md parser accepts both Playbooks/Skills headers; migrate consolidates skills→playbooks. New archkit://playbook/{id} resource + warmup `playbooks` count (old archkit://skill + `skills` kept as aliases). Machine contract (JSON keys, params, --skills flag) deliberately kept stable. Repo dogfooded (3 units renamed). New suite tests/migrate-playbooks; 59/59 suites green. Criterion 4 (native Claude Skill per unit) already satisfied by scaffold-core. examples/ left as legacy on purpose (back-compat fixtures).
tests-passed: true
tests-command: npm test
tests-at: 2026-06-23
---



# Rename archkit "skills" to resolve the Claude Skills collision

## Why
archkit "skills" (package gotchas) now namespace-collide with first-class Claude Code Agent Skills. NAME NOT YET FINALIZED — operator must confirm before the broad rename.

## Exit criteria
- [ ] Operator confirms the new name (candidates: Primer / Lore / Playbook) BEFORE any rename — capture the choice in an ADR
- [ ] Run as an exclusive/barrier goal: rename touches many files; no other CGR runs concurrently
- [ ] All .skill files, MCP tool ids/strings, wizard, migrate, and docs updated to the new vocabulary with a back-compat alias for existing .skill files
- [ ] Optionally emit each renamed unit ALSO as a native Claude Skill for on-demand loading
- [ ] Tests green and warmup/stats report no broken skill references

