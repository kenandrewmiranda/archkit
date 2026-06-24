# 0014. Resume by CGR fission, not replay; board as append-only event log

- **Date**: 2026-06-23
- **Status**: Accepted
- **Tags**: cgr, state-management, persistence, resume, architecture

## Context

A parallel, long-running conductor must survive context resets — both human /clear and Claude Code's automatic compaction (which fires near the context limit, ~33KB buffer, summarizing earlier turns generically and lossily). No hook or tool can trigger or prevent a clear; PreCompact only reacts. So state cannot live only in context, and resume cannot rely on the harness's generic summary.

Naive resume = replay: summarize the whole session and reload it. That drags the COMPLETED work's baggage into every fresh window. The need is to resume with only what remains, while preserving a full record of what was done.

## Decision

Two artifacts carry the system across resets.

**(1) The board is a derived projection over an append-only event log**, never a hand-maintained file. `.arch/board/events.ndjson` is the source of truth (events: claimed, completed, fissioned, merged, conflict, lease-expired); `.arch/board/cgr/<slug>.md` holds CGR records; the conductor reads a folded view via a `session_state` MCP tool. Append-only = parallel-safe without locks (workers only append; board = fold(events)) and rehydration-safe (a fresh conductor reconstitutes by folding). PreCompact flushes in-context state to events + handoff; SessionStart(clear|compact) folds the log and reconstitutes the conductor; leases older than the TTL are reclaimed as orphans.

**(2) Resume by fission, not replay.** At wind-down, a fully-met CGR closes normally. A partially-met CGR splits: the finished portion is closed as its own terminal record (completion: partial, full institutional trail preserved), and a LEAN successor CGR is forked containing only the unmet exit-criteria plus a compact carry-forward handoff. Lineage links both ways (forked_from / superseded_by). The fresh session loads the remainder, not the history — shedding completed work rather than compressing it. The scheduler prefers continuations (warm carry-forward) over cold pending work.

**The handoff artifact is the linchpin** (`.arch/board/handoff/<slug>.md`): it is simultaneously the worker→conductor return value, the PreCompact flush payload, the SessionStart rehydration input, the fission carry-forward, and the wind-down zone's output — one object, authored as minimum-to-continue (done + decisions + files-actual-vs-predicted + remaining + continuation-notes + verification-status). The actual-vs-predicted files block is the closed feedback loop measuring ownership-prediction accuracy.

## Consequences

Easier: the conductor survives both auto-compaction and /clear with no human bookkeeping; resume windows stay high-signal (only remaining work loads); every session's accomplishment becomes a dated, closed record; ownership-prediction accuracy becomes measurable per handoff.

Harder/constrained: the board MUST be fully on-disk and rehydratable — anything in context only WILL be summarized away; more entities and lineage to track than a flat queue; the handoff schema must be precise because five mechanisms depend on it.

Related: conductor/worker orchestration ADR (the consumer of the board) and the attention-gradient wind-down ADR (which authors the handoff).
