# 0006. Make CGR goal ordering epic-primary (drain an epic before the next), superseding ADR 0005's order-primary precedence

- **Date**: 2026-06-13
- **Status**: Accepted
- **Tags**: cgr, goals, lifecycle

## Context

ADR 0005 shipped intentional CGR sequencing in v1.11.0 with ORDER-primary precedence: listGoals sorted by order, then epic, then slug, and explicitly noted `order` was global across the queue (not per-epic), so goal_next interleaved epics by raw order number rather than finishing one objective before starting the next. Dogfooding the feature, the desired behavior is the opposite: when goals are grouped into objectives via `epic`, you want to finish objective X before starting Y, not ping-pong between them by global order.

## Decision

Switch to EPIC-primary ordering via a new `sortGoals(goals)` whole-list sorter (replacing the pairwise `compareGoals`, which couldn't express cross-goal grouping). Each epic is ranked by the MINIMUM `order` among its goals; goals are sequenced by group rank, then — within a group — by epic label, order, and slug. So an epic runs to completion before the next begins, epics are sequenced by where they started (earliest order), and within an epic by order. Ungrouped goals each form their own singleton group ranked by their own order, so a lone goal slots among the epics by its order rather than being forced ahead of or behind all of them. With no epics anywhere, group rank IS each goal's own order, collapsing exactly to ADR 0005's order-ascending (and to alpha-by-slug for goals predating the fields). depends-on gate and the testing-threshold bucketing are unchanged and still take precedence over this sort.

## Consequences

Supersedes the precedence detail of ADR 0005: ordering is now epic-primary, and the "order is global, not per-epic" note in 0005 no longer holds — per-objective numbering is the natural model (each epic's goals stay contiguous and ordered, epics sequenced by their earliest goal). Easier: grouping goals by epic now means goal_next drains that objective fully before moving on. Unchanged: no-epic projects behave identically to v1.11.0; depends-on still outranks the sort; the auto-stamped intake order still drives a single ungrouped batch. Mechanism change: consumers that imported `compareGoals` must use `sortGoals` (only listGoals + tests did). Covered by 3 new/replaced tests in tests/cgr-goals (epic-drains-before-next, within-epic contiguity/order, no-epic collapse-to-order); full suite green.
