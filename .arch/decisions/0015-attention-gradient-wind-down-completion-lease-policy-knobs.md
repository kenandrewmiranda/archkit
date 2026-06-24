# 0015. Attention-gradient wind-down + completion/lease policy knobs

- **Date**: 2026-06-23
- **Status**: Accepted
- **Tags**: cgr, context-management, policy, verification

## Context

Riding a worker's context to a high fill percentage risks doing the hardest work (novel generation, conflict resolution) in the degraded tail of the window, where effective reasoning is worst. But the tail can't simply be left idle — the worker still needs to author its handoff, and that authoring is itself a context cost that has to be paid somewhere.

Three policy questions were left open by the design and resolved by the operator.

## Decision

**Schedule work by attention-sensitivity — the context window is a quality gradient.** The peak zone (first ~65%) is reserved for high-sensitivity work: novel code, logic, conflict resolution. The tail zone (remaining ~35%) is reserved for degradation-TOLERANT work: documenting completed work, extracting decisions, authoring the handoff. Tail tasks tolerate degradation because they are compression over RECENT, high-salience context (transcription, not reasoning). This also makes the wind-down a deliberate, model-authored handoff that beats the harness's generic auto-compaction summary — and it eliminates the "start a goal that balloons into the degraded tail" risk, because a worker stops ACCEPTING new goals at the threshold and never runs a goal into the tail.

Resolved knobs:
1. **Wind-down entry threshold `cgr.windDownAt` = 0.65** (config-driven, model-aware via `cgr.windDownAtByModel`). 65% is where several models show average degradation onset. Entry is early enough that the wind-down (documentation + handoff) reliably completes before auto-compaction's buffer triggers. The tail writes down; the next session's fresh head re-plans (reasoning-heavy re-planning of the remaining DAG is NOT done in the degraded tail).
2. **Partial-close blocks on unverifiable done-work.** At fission, the partial close runs the verify-command on the MET criteria. If verification cannot be isolated to those criteria OR is red, the fission BLOCKS and surfaces to attention (conductor → human) — it does NOT silently fork unverified debt into the successor. Partial completion inherits the same hard gate as full completion.
3. **Lease TTL `cgr.leaseTtlHours` = 24.** An in-flight CGR's reservation expires 24h after claim; past that it is a reclaimable orphan. Rationale: the human super-operator caps legitimate work well under 12h, so 24h is safely beyond any live worker — an expired lease is a true orphan, not a slow one.

## Consequences

Easier: the hardest work always runs in high-quality context; the wind-down turns the otherwise-wasted tail into productive handoff authoring; unverified work cannot masquerade as finished (block-on-partial); orphaned reservations self-clear after 24h.

Harder/constrained: the worker must detect context fill and switch modes at 0.65; the threshold needs per-model calibration; a blocked partial-close requires a human-attention path in the conductor loop. Config surface: `.arch/config.json` → cgr.windDownAt (0.65), cgr.windDownAtByModel ({}), cgr.leaseTtlHours (24), alongside existing cgr.backlogThreshold (5).

Related: fission-resume ADR (the handoff this authors) and conductor/worker orchestration ADR (which enforces the gates).
