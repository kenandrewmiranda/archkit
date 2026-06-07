---
slug: release-v1-9-0
title: Release v1.9.0 — merge to main, tag, publish, GitHub Release
status: done
created: 2026-06-05
exit-criteria:
  - feat/v1.9-test-gate-deferred-goals merged into main (fast-forward if possible), version 1.9.0 in sync (npm run check:versions passes on main)
  - npm test passes on main before tagging
  - Annotated tag v1.9.0 created and pushed; the release.yml run completes successfully (gh run watch)
  - npm shows @kenandrewmiranda/archkit@1.9.0 as the latest published version
  - GitHub Release v1.9.0 created via `gh release create v1.9.0` with notes drawn from the CHANGELOG 1.9.0 entry
  - feat/v1.9-test-gate-deferred-goals merged into main (fast-forward if possible), version 1.9.0 in sync (npm run check: versions passes on main)
- feat/v1.9-test-gate-deferred-goals merged into main (fast-forward if possible), version 1.9.0 in sync (npm run check: versions passes on main)
files-to-touch: 
required-reading:
  - .github/workflows/release.yml
  - CHANGELOG.md
depends-on:
  - readme-v1-9-polish
  - docs-v1-9
  - github-repo-v1-9
verify-command: npm test
source-ask: setup cgr goals to setup the readme, github repo, and documentation for 1.9 and ultimately push 1.9 when all is done
started: 2026-06-06
completed: 2026-06-06
completion-notes: Merged feat/v1.9-test-gate-deferred-goals to main (fast-forward), version 1.9.0 in sync, 43/43 test suites pass. Tag v1.9.0 pushed; release.yml published @kenandrewmiranda/archkit@1.9.0 (npm latest=1.9.0). GitHub Release v1.9.0 created.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Release v1.9.0 — merge to main, tag, publish, GitHub Release

## Why
Once README, docs, and repo metadata are current, ship v1.9.0: merge feat/v1.9-test-gate-deferred-goals into main, push the v1.9.0 tag to trigger the OIDC npm publish (.github/workflows/release.yml fires on v* tags), verify npm, and create the GitHub Release from the CHANGELOG.

## Exit criteria
- [ ] feat/v1.9-test-gate-deferred-goals merged into main (fast-forward if possible), version 1.9.0 in sync (npm run check:versions passes on main)
- [ ] npm test passes on main before tagging
- [ ] Annotated tag v1.9.0 created and pushed; the release.yml run completes successfully (gh run watch)
- [ ] npm shows @kenandrewmiranda/archkit@1.9.0 as the latest published version
- [ ] GitHub Release v1.9.0 created via `gh release create v1.9.0` with notes drawn from the CHANGELOG 1.9.0 entry

