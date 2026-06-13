# 0005. Add intentional CGR goal sequencing via order + epic frontmatter, not folders

- **Date**: 2026-06-13
- **Status**: Accepted
- **Tags**: cgr, goals, lifecycle, mcp

## Context

CGR goals are flat `.md` files at `.arch/goals/<slug>.md`, and ADR 0003 made `status:` frontmatter (not the directory) the source of truth for lifecycle state. But `nextEligibleGoal` had no intentional sequencing among same-bucket, deps-satisfied goals: after the in-progress resume, the depends-on gate, and the testing-backlog threshold, it returned `bucket[0]` of `listGoals`, whose array came straight from `fs.readdirSync` with no sort. In practice that is alphabetical-by-slug — so a decomposed batch was worked in incidental filename order, not the order the agent intended. Users reached for folders-per-objective or manual numbered prefixes (A1-A10) to recover both grouping and sequence. Folders would re-introduce the directory-as-meaning that ADR 0003 deliberately removed and break the flat slug namespace; manual prefixes are brittle (renumber-on-insert, collide with slugify, opaque slugs). The only sequencing lever was chaining goals with depends-on edges.

## Decision

Add two optional frontmatter fields instead of any filesystem coupling, consistent with ADR 0003's "state lives in frontmatter": `order` (numeric relay sort key, lower runs first) and `epic` (group label, slugified on write). `listGoals` now sorts by `compareGoals` — order ascending, then epic, then slug — so every consumer (`nextEligibleGoal`, `runGoalList`) sees queue order; the depends-on gate and testing-threshold bucketing are unchanged and still take precedence. `runGoalIntake` auto-stamps `order` from each goal's position in the decomposition batch, offset past existing live goals via `nextOrderBase`, so `/goal_next` honors intake order with zero manual numbering; an explicit `order` on a goal always wins. Goals with no `order` sort last (Infinity), preserving alpha-by-slug among them — fully backward compatible with goals written before this. `goal_list` gains an `epics` map (epic -> slugs in queue order) as the project-space segmentation view, emitted only when some goal carries an epic. The `archkit_goal_intake` MCP schema gains optional `epic`/`order` per goal.

## Consequences

Easier: a decomposed batch is now worked in intended order by default with no ceremony; epics give a lightweight "project space" view without folders; manual `order`/`epic` overrides pin sequence or regroup when needed. Constrained/unchanged: depends-on remains the hard gate and outranks `order`; the threshold knob still governs pending-vs-testing draining; `order` is a soft sort only within an eligible bucket. Migration: none — both fields are additive and absent on legacy goals, which fall back to alpha-by-slug exactly as before. Note: `order` is global across the queue (not per-epic); per-objective numbering is achieved by assigning each epic its own order range. Covered by 8 tests in tests/cgr-goals (round-trip incl. order=0, sort precedence, nextEligibleGoal, nextOrderBase, intake auto-stamp + offset, epics view).
