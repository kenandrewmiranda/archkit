// Skill templates for Claude Code skills/* slot.
// archkit-protocol replaces the prose-only original with a substantive,
// command-wrapping skill that returns live runtime data.

export const ARCHKIT_PROTOCOL_SKILL = `---
name: archkit-protocol
description: Use BEFORE editing or creating files in an archkit-governed project. Returns live state for the targeted feature/layer — recent commits, pending gotcha proposals, drift findings in scope. Skipping this means writing code blind to recent changes, known issues, and architectural drift.
---

# archkit Protocol

Before editing files in this project, invoke this skill with the feature
and layer you're about to touch.

## How to use

- If \\\`archkit_*\\\` MCP tools appear in your tool list, prefer them over CLI shell-outs. Both produce the same JSON; MCP tools are typed, faster, and surface structured errors directly.

## Required step

Run: \\\`archkit resolve preflight <feature> <layer> --json\\\`

Parse the output for:
- \\\`recentCommits\\\`: was someone else just here? Coordinate or merge.
- \\\`pendingGotchas\\\`: are there reviewed-but-not-yet-merged warnings about this code?
- \\\`driftFindings\\\`: is the .arch/ map already inconsistent with the code? Don't add more divergence.

If \\\`passWithoutAction\\\` is \\\`true\\\`, proceed. Otherwise, address the surfaced
issues OR explicitly justify ignoring them in your work plan.

## Why this exists

archkit's static \\\`.arch/\\\` files describe intent. This skill surfaces *current
state* — what changed recently, what's broken right now, what's queued for
review. Without it you're working from a snapshot that may be days old.
`;
