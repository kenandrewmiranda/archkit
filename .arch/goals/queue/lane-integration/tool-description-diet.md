---
slug: tool-description-diet
title: Cut the oversized MCP tool descriptions down to the same contract
status: pending
created: 2026-08-02
order: 11
project: lane-integration
exit-criteria:
  - Every tool description leads with one line stating what the tool does, with detail following only where it changes how the tool is called
  - Rationale, history and cross-references move out of descriptions into the ADRs and docs that already hold them, leaving a pointer rather than the prose
  - Total description bytes across the tool surface drop by at least half, measured before and after
  - Each description still names its distinguishing trigger, so tools that are easy to confuse stay separable — the conductor and session-state pair is the reference case
  - A test asserts a per-description ceiling so the surface cannot silently regrow
files-to-touch:
  - src/mcp/tools.mjs
  - tests/
required-reading: 
depends-on:
  - terse-output-contract
  - conflict-reconcile-escalation
owns:
  - src/mcp/tools.mjs
feature: output-contract
verify-command: npm test
source-ask: Append the three intake defects found while queuing the lane-integration batch, plus terse-output work. Defects — (1) exit criteria containing a colon-space are re-emitted as unindented list items after the exit-criteria block, corrupting goal frontmatter and rendering phantom duplicate criteria in payloads; (2) the auto-appended finalize barrier does not inherit the batch's `project`, so its payload instructs a different branch than the work it documents; (3) payload "Read first" paths point at .arch/goals/<slug>.md while files are written to .arch/goals/queue/<project>/<slug>.md. Output work — make MCP tool output terse and high-level using graph notation and a small symbol vocabulary instead of prose paragraphs, to cut agent-context tokens and make the feedback legible to end users. Color via markdown emphasis and symbols, NOT ANSI (ANSI does not render in MCP tool results). Scope is MCP output only, not the CLI.
lane: lane-frontmatter-colon-escaping
---


# Cut the oversized MCP tool descriptions down to the same contract

## Why
Several tool descriptions in tools.mjs exceed 1500 characters of dense prose, and they are loaded into agent context whether or not the tool is ever called. They are the single largest fixed token cost archkit imposes on a session, and their length actively hurts tool selection.

## Exit criteria
- [ ] Every tool description leads with one line stating what the tool does, with detail following only where it changes how the tool is called
- [ ] Rationale, history and cross-references move out of descriptions into the ADRs and docs that already hold them, leaving a pointer rather than the prose
- [ ] Total description bytes across the tool surface drop by at least half, measured before and after
- [ ] Each description still names its distinguishing trigger, so tools that are easy to confuse stay separable — the conductor and session-state pair is the reference case
- [ ] A test asserts a per-description ceiling so the surface cannot silently regrow

