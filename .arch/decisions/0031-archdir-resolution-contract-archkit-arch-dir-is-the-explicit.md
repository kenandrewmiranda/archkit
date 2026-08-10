# 0031. archDir resolution contract: ARCHKIT_ARCH_DIR is the explicit signal, cwd is the documented fallback

- **Date**: 2026-08-10
- **Status**: Accepted
- **Tags**: archdir, concurrency, cgr, worktree, mcp

## Context

Nothing in archkit resolves archDir once. There are 18 separate `findArchDir` implementations across `src/` and `bin/`, with three different signatures and two different existence checks:

- `src/lib/shared.mjs:76` — `findArchDir(opts)` walks up from `process.cwd()` for at most 10 levels and IGNORES any positional argument a caller passes;
- `src/mcp/tools.mjs:159` — a local `findArchDir(cwd)` that walks up unboundedly from the passed cwd and requires `.arch/SYSTEM.md`;
- each hook bin (stop, session-start, pretooluse, posttooluse, userpromptsubmit, precompact) — its own `findArchDir(start)` copy;
- most of `src/commands/*` — a zero-arg wrapper onto shared.mjs's.

The divergence is not cosmetic. shared.mjs's version accepts a bare `.arch/` directory while the MCP and hook copies require `SYSTEM.md` inside it; shared.mjs caps the walk at 10 parents while the others walk to the filesystem root; and because shared.mjs ignores its argument, a caller that carefully computed a cwd does not get resolution against it. The hooks compute `event.cwd || process.cwd()` — the harness-supplied cwd — and pass it to their own copies, which do honor it, but there is no single place where that decision is made, documented, or testable. The MCP surface re-derives archDir per handler at 49 `process.cwd()` sites in `tools.mjs` alone.

So WHICH `.arch/` a call touches is a function of where the process happened to be started, and a caller has no way to say. `ARCHKIT_ARCH_DIR` does not exist today — zero references in the tree.

For a single tree that is right by accident. For the conductor's worktree workers (ADR 0013) it is wrong in a specific and silent way. `.arch/board/` is gitignored, so a worktree contains no board at all: an archkit run inside one creates a fresh empty `events.ndjson` and answers against it, reporting an empty in-flight set and an empty merge queue. Goal files ARE tracked, so the worktree carries a copy forked at its base commit — the stale-base behavior already known for worktree workers. A worker therefore reads a stale goal tree and writes a board nobody else will ever read. ADR 0028's Consequences already flags a symptom of this. Today's sharing of the main tree's `.arch/` is not a contract; it holds only while a worker's cwd happens to be the main tree.

## Decision

archDir is resolved in exactly ONE place that the MCP server, the CLI, and every hook bin call. No handler re-derives it; the 18 copies collapse onto that resolver. Precedence, highest first:

1. **An explicit argument** — a `--arch-dir` on the CLI, or an explicit parameter — for callers that already know.
2. **`ARCHKIT_ARCH_DIR`** — the explicit signal. When set it wins over cwd entirely and no walk-up happens. It names the `.arch` directory itself, matching the `archDir` parameter already threaded through every lib function; a relative value resolves against cwd. A value pointing at something that does not exist is an ERROR, not a fallback: a caller that set the variable meant it, and silently degrading to cwd would recreate exactly the accidental resolution this ADR removes.
3. **`process.cwd()`, walked upward to the nearest `.arch/`** — the documented fallback, and the behavior existing single-tree usage already has, so that case stays byte-identical. Hooks keep preferring the harness-supplied `event.cwd` over their own process cwd, and that preference now genuinely takes effect at the single resolver instead of depending on which copy a given bin happens to hold. The divergences collapse to one answer: one existence check, one walk bound.

**What a worktree worker is guaranteed to see.** A worker spawned with `ARCHKIT_ARCH_DIR` pointing at the conductor's `.arch/` reads and writes the conductor's board, the conductor's goal tree, and the conductor's locks — regardless of its own cwd, and regardless of its checkout carrying a stale tracked copy of `.arch/goals/`. That is the intended dispatch mode, and the rendered dispatch step says so, so the sharing is deliberate and visible at the point of spawn. A worker spawned WITHOUT it gets its own tree: still a legal mode (an isolated experiment), but a chosen one rather than an accident of cwd, and its board is visibly its own.

**This contract is a prerequisite for ADR 0030, not a sibling.** The advisory lock in the shared-state write contract is scoped to a *resolved* archDir. Two processes mutually exclude only if they resolve to the SAME one; a worker that silently resolves to its own worktree `.arch/` takes a lock nobody contends for, and the mutual exclusion is vacuous. Explicit resolution is what makes the lock mean anything across worktrees.

**Deliberately NOT done.**

- *No git-worktree auto-detection.* Asking git for the main worktree and redirecting `.arch/` there would make the single-tree behavior implicit again, and would silently override a caller that deliberately wanted the worktree's own state. The variable is the signal; repo layout is not.
- *No full event-sourcing of status transitions.* The other tempting fix for worktree divergence is to move goal status into the append-only board — where divergent copies could in principle be merged rather than clobbering each other — leaving frontmatter as a derived cache. Rejected for the reasons set out in ADR 0030: it rewrites ADR 0003's contract that CGR state is git-tracked and human-editable, and the board is gitignored per-machine scratch (ADR 0014), so it cannot hold truth that must survive a clone. It also would not solve *this* problem: a worktree with its own board diverges whether or not the board is authoritative. Pointing the worker at one archDir closes the divergence directly; event-sourcing would close it only as a side effect of a much larger rewrite, for races ADR 0030's Tier 1 already closes.

## Consequences

Easier: "which `.arch/` did that touch?" has one answer, settable by the caller and testable — a CLI run from a worktree with the variable set reports the same board as the conductor, which becomes a test rather than a hope. Eighteen resolvers collapsing to one also ends the quiet inconsistency where the MCP surface required `SYSTEM.md` while the CLI accepted a bare `.arch/`, and where a passed cwd was honored on some paths and dropped on others.

Harder / constrained: `ARCHKIT_ARCH_DIR` becomes part of archkit's public interface — it has to be documented, honored on every surface, and it becomes a way to point archkit at the wrong project by leaving it exported in a shell. Treating a set-but-nonexistent path as an error means a stale exported value fails loudly instead of degrading; that is deliberate, but it will surface as a new class of error report. The dispatch step now carries an environment requirement, so a conductor that spawns a worker by hand without it gets isolated state and has to notice. And collapsing the resolvers is a behavior change at the edges: paths that previously stopped after 10 parents now walk to the root (or the reverse), and one existence check replaces two. That is intended, but it is not a pure refactor — any test pinning the old asymmetry has to be updated deliberately, not silently.
