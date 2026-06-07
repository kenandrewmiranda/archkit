---
slug: github-repo-v1-9
title: Update GitHub repo metadata + marketplace manifest for v1.9
status: done
created: 2026-06-05
exit-criteria:
  - .claude-plugin/marketplace.json plugin description updated: '25 tools' -> '28 tools' (and any other stale figures)
  - GitHub repo topics reviewed via `gh repo view --json repositoryTopics` and relevant ones added if missing (e.g. mcp, model-context-protocol, ai-agents) with `gh repo edit`
  - GitHub repo description reviewed via `gh repo view` and confirmed accurate for v1.9 (update with `gh repo edit --description` if needed)
  - npm run check:versions still passes (package.json + plugin.json in sync at 1.9.0)
  - npm test passes
  - .claude-plugin/marketplace.json plugin description updated: '25 tools' -> '28 tools' (and any other stale figures)
  - npm run check: versions still passes (package.json + plugin.json in sync at 1.9.0)
- .claude-plugin/marketplace.json plugin description updated: '25 tools' -> '28 tools' (and any other stale figures)
- npm run check: versions still passes (package.json + plugin.json in sync at 1.9.0)
files-to-touch:
  - .claude-plugin/marketplace.json
required-reading:
  - .claude-plugin/marketplace.json
  - .claude-plugin/plugin.json
depends-on: 
verify-command: npm test
source-ask: setup cgr goals to setup the readme, github repo, and documentation for 1.9 and ultimately push 1.9 when all is done
started: 2026-06-06
completed: 2026-06-06
completion-notes: marketplace.json updated '25 tools'->'28 tools' (verified 28 tool entries in src/mcp/tools.mjs); added GitHub topics mcp, model-context-protocol, ai-agents, architecture, scaffolder, claude; repo description 'Context Engineering for AI Agents' confirmed accurate; versions in sync at 1.9.0; npm test 43/43 suites green.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-06
---



# Update GitHub repo metadata + marketplace manifest for v1.9

## Why
The Claude Code plugin marketplace manifest still advertises '25 tools', and the repo's GitHub description/topics should reflect v1.9's MCP-tool surface so the listing is accurate at release.

## Exit criteria
- [ ] .claude-plugin/marketplace.json plugin description updated: '25 tools' -> '28 tools' (and any other stale figures)
- [ ] GitHub repo topics reviewed via `gh repo view --json repositoryTopics` and relevant ones added if missing (e.g. mcp, model-context-protocol, ai-agents) with `gh repo edit`
- [ ] GitHub repo description reviewed via `gh repo view` and confirmed accurate for v1.9 (update with `gh repo edit --description` if needed)
- [ ] npm run check:versions still passes (package.json + plugin.json in sync at 1.9.0)
- [ ] npm test passes

