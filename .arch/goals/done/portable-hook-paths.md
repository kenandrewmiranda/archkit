---
slug: portable-hook-paths
title: Make archkit_install_hooks emit portable, committable hook commands
status: done
created: 2026-06-06
exit-criteria:
  - archkit_install_hooks emits hook commands using $CLAUDE_PROJECT_DIR (or an npx/bin-resolved form) instead of absolute /Users/... node paths
  - A settings.json generated from a fresh checkout contains zero absolute home-directory filesystem paths and resolves the hook binaries correctly
  - A test under tests/ (e.g. extend hooks-status or add install-hooks) asserts the emitted hook commands contain no absolute filesystem paths
  - Update README/docs note that .claude/settings.json is now portable/committable (and reconcile the .gitignore entry added this session)
  - npm test is green
files-to-touch:
  - src/mcp/tools.mjs
  - src/commands/install-hooks.mjs
  - bin/archkit-session-start.mjs
  - tests/hooks-status/run.mjs
  - .gitignore
  - README.md
required-reading:
  - .arch/SYSTEM.md
  - .arch/INDEX.md
depends-on: 
verify-command: npm test
source-ask: Turn the explored archkit MCP improvements into a CGR queue reasonable for a 1.9X version bump. Scope (confirmed): include portable hook paths, drift precision, scoped caching, MCP prompts, and PreToolUse blocking as a 1.9 feature; defer plugin distribution to 2.0.
started: 2026-06-06
completed: 2026-06-06
completion-notes: Guardrail hooks now emit a portable command form: node $CLAUDE_PROJECT_DIR/bin/archkit-*.mjs when archkit's bins live in the project tree (threaded projectDir through renderGuardrailHooks/addGuardrailHooks/hooks.mjs), else bare bin via PATH — never an absolute /Users path. Regenerated this repo's .claude/settings.json to the portable form, un-gitignored it (kept settings.local.json ignored), added portable-command tests to tests/hooks-status, and documented committability in README.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Make archkit_install_hooks emit portable, committable hook commands

## Why
The generated .claude/settings.json hardcodes machine-specific absolute node paths (we had to gitignore it this session), which blocks a team from committing one shared guardrail config and breaks on a fresh clone.

## Exit criteria
- [ ] archkit_install_hooks emits hook commands using $CLAUDE_PROJECT_DIR (or an npx/bin-resolved form) instead of absolute /Users/... node paths
- [ ] A settings.json generated from a fresh checkout contains zero absolute home-directory filesystem paths and resolves the hook binaries correctly
- [ ] A test under tests/ (e.g. extend hooks-status or add install-hooks) asserts the emitted hook commands contain no absolute filesystem paths
- [ ] Update README/docs note that .claude/settings.json is now portable/committable (and reconcile the .gitignore entry added this session)
- [ ] npm test is green

