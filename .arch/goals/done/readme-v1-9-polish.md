---
slug: readme-v1-9-polish
title: Polish README for v1.9 — stale counts, version badge, footprint
status: done
created: 2026-06-05
exit-criteria:
  - Highlights section: '25 tools' -> '28 tools', and it mentions the v1.9 test gate + deferred-goal proposals
  - Version badge updated from 1.8.0 to 1.9.0
  - Plugin install section: 'all 25 archkit_* tools' -> '28' (and any other '25 tools' mentions)
  - 'Lean footprint' line updated to current actuals — compute with `find src -name '*.mjs' | wc -l` (source modules) and `ls tests/*/run.mjs | wc -l` (test suites)
  - No remaining '25 tools' / '1.8' version references in README.md (grep to confirm)
  - npm test passes
  - Highlights section: '25 tools' -> '28 tools', and it mentions the v1.9 test gate + deferred-goal proposals
  - Plugin install section: 'all 25 archkit_* tools' -> '28' (and any other '25 tools' mentions)
- Highlights section: '25 tools' -> '28 tools', and it mentions the v1.9 test gate + deferred-goal proposals
- Plugin install section: 'all 25 archkit_* tools' -> '28' (and any other '25 tools' mentions)
files-to-touch:
  - README.md
required-reading:
  - README.md
  - CHANGELOG.md
depends-on: 
verify-command: npm test
source-ask: setup cgr goals to setup the readme, github repo, and documentation for 1.9 and ultimately push 1.9 when all is done
started: 2026-06-06
completed: 2026-06-06
completion-notes: Updated README for v1.9: version badge 1.8.0→1.9.0, Highlights tool count 25→28 with a new v1.9 line on the test gate + deferred-goal proposals, plugin section 25→28 tools / 3→4 prompts, and Lean footprint to current actuals (82 source modules, 43 test suites). Remaining 1.8 mentions are accurate feature-provenance history. npm test: 43/43 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Polish README for v1.9 — stale counts, version badge, footprint

## Why
The 'Available tools (28)' section and CGR test-gate/deferred-goal subsections are already updated, but the rest of the README still reads v1.8: Highlights says '25 tools', the version badge shows 1.8.0, the footprint line shows 79 modules / 40 suites, and the plugin section says 'all 25 tools'. Bring every figure current so the README is internally consistent for the 1.9 release.

## Exit criteria
- [ ] Highlights section: '25 tools' -> '28 tools', and it mentions the v1.9 test gate + deferred-goal proposals
- [ ] Version badge updated from 1.8.0 to 1.9.0
- [ ] Plugin install section: 'all 25 archkit_* tools' -> '28' (and any other '25 tools' mentions)
- [ ] 'Lean footprint' line updated to current actuals — compute with `find src -name '*.mjs' | wc -l` (source modules) and `ls tests/*/run.mjs | wc -l` (test suites)
- [ ] No remaining '25 tools' / '1.8' version references in README.md (grep to confirm)
- [ ] npm test passes

