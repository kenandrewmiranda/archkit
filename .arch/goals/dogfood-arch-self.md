---
slug: dogfood-arch-self
title: Dogfood archkit's own .arch/ so warmup + doctor pass
status: in-progress
created: 2026-06-06
exit-criteria:
  - Decide whether archkit's .arch/ should be version-controlled; if yes, remove `.arch` from .gitignore and commit the built spec, and log the choice as an ADR via archkit_log_decision
  - Generate graph clusters + INDEX reflecting archkit's real structure (src/commands, src/lib, src/mcp, bin/) so `archkit resolve warmup` returns pass:true with no blockers (W003 graph clusters pass)
  - Author at least 2-3 real skills (WRONG/RIGHT/WHY) for archkit's own conventions (e.g. the ARCHKIT_RUN CLI-dispatch pattern, the MCP nextStep / silent-success contract)
  - `archkit doctor` reports .arch/ as load-bearing — no D-INTENT empty-skill or D-HOOKS blockers of note
  - npm test passes
- Generate graph clusters + INDEX reflecting archkit's real structure (src/commands, src/lib, src/mcp, bin/) so `archkit resolve warmup` returns pass: true with no blockers (W003 graph clusters pass)
files-to-touch:
  - .gitignore
  - .arch/INDEX.md
required-reading:
  - .arch/SYSTEM.md
  - .gitignore
  - src/mcp/tools.mjs
depends-on:
  - release-v1-9-0
verify-command: npm test
source-ask: (1) add a CGR goal to build out archkit's own .arch/ so the warmup/utilization metric is meaningful; (2) validate that nodes/graph and the arch system get refreshed after a goal completes so the next iteration is up to date — both after 1.9 ships.
started: 2026-06-06
---


# Dogfood archkit's own .arch/ so warmup + doctor pass

## Why
archkit's repo gitignores .arch/ and `archkit resolve warmup` currently FAILS (no graph clusters, no skills), so the v1.6 utilization metric and self-review have nothing to work against — the nudge to preflight before edits is meaningless here. Build a real, load-bearing .arch/ for archkit itself.

## Exit criteria
- [ ] Decide whether archkit's .arch/ should be version-controlled; if yes, remove `.arch` from .gitignore and commit the built spec, and log the choice as an ADR via archkit_log_decision
- [ ] Generate graph clusters + INDEX reflecting archkit's real structure (src/commands, src/lib, src/mcp, bin/) so `archkit resolve warmup` returns pass:true with no blockers (W003 graph clusters pass)
- [ ] Author at least 2-3 real skills (WRONG/RIGHT/WHY) for archkit's own conventions (e.g. the ARCHKIT_RUN CLI-dispatch pattern, the MCP nextStep / silent-success contract)
- [ ] `archkit doctor` reports .arch/ as load-bearing — no D-INTENT empty-skill or D-HOOKS blockers of note
- [ ] npm test passes

