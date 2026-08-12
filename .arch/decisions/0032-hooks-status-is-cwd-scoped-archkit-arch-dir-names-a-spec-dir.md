# 0032. hooks-status is cwd-scoped: ARCHKIT_ARCH_DIR names a spec dir, not a project root

- **Date**: 2026-08-11
- **Status**: Accepted
- **Tags**: archdir, hooks, doctor, worktree, mcp

## Context

ADR 0031 collapsed 20 private `findArchDir` walkers onto one resolver and made `ARCHKIT_ARCH_DIR` the explicit signal for "which `.arch/` does this call touch?". It also added a shape-based anti-regression guard (`tests/archdir-resolution/run.mjs` §8) that fails the suite if any shipped file joins `".arch"` onto a directory and then steps to that directory's parent.

`src/lib/hooks-status.mjs`'s `projectClaudeDir(cwd)` matches that shape. It walks up from cwd for a directory containing `.arch/` **or** `.claude/`, and returns `<that dir>/.claude`. It ignores `ARCHKIT_ARCH_DIR` entirely. The lane that landed ADR 0031 did not own `src/lib/hooks-status.mjs`, so it allowlisted the file in `WALKER_EXCEPTIONS` with a one-line reason and filed a follow-up rather than silently changing behavior. This ADR is that follow-up: the exception is either justified permanently or removed.

Two surfaces consume it, both through `gatherHooksStatus(cwd)`:

- `src/commands/doctor.mjs:314` — the `D-HOOKS` check, which answers "are the guardrail hooks wired?";
- `src/commands/hooks.mjs:22,33` — `archkit_install_hooks`, which uses `status.projectSettingsPath` as the **write target** for `apply:true`, and derives the `$CLAUDE_PROJECT_DIR` portable command form from `path.dirname(path.dirname(settingsPath))`.

So this is not only a reporting path. It is also where archkit decides which repository's checked-in `.claude/settings.json` it edits.

## Decision

**`projectClaudeDir` stays cwd-scoped. `ARCHKIT_ARCH_DIR` does not move it, and the `WALKER_EXCEPTIONS` entry stays** — expanded to say why, and now backed by tests that fail if someone "fixes" it to follow the variable.

This is a **scope clarification of ADR 0031, not an exemption from it**. ADR 0031's contract governs *which `.arch/` a call reads and writes*. `projectClaudeDir` neither reads nor writes an `.arch/`; it resolves a `.claude/` directory belonging to a Claude Code **checkout**, and consults `.arch/` only as one of two project-root marker files. The two resolutions answer different questions and are allowed to disagree.

Three reasons, in order of force.

**1. `ARCHKIT_ARCH_DIR` makes no promise about its parent directory.** The contract says the variable "names the `.arch` directory itself". Nothing requires the named directory to sit inside a git checkout, or beside a `.claude/`, or inside anything a Claude Code session ever opened. `ARCHKIT_ARCH_DIR=/shared/specs/.arch` is a legal value under ADR 0031. Deriving `projectClaudeDir` from it would yield `/shared/specs/.claude` — a path no Claude Code session will ever load, that `archkit doctor` would report on and `archkit_install_hooks --apply` would happily create and write hook config into. Following the contract here would not relocate the answer to a *different* project; it would relocate it to a *non-project*.

**2. Hooks are a property of the checkout you are standing in, and that is the question being asked.** `D-HOOKS` exists to answer "will the SessionStart digest, the CGR Stop-guard, and review-on-edit actually fire for me?". What fires is determined by the `.claude/settings.json` Claude Code loaded for the session, next to the checkout — plus the user file and the plugin registry, both of which `gatherHooksStatus` already reads from `$HOME` and neither of which is archDir-scoped either. Re-pointing the check at the named spec directory would make `doctor` report the wiring of a session that is not running. A worktree worker with `ARCHKIT_ARCH_DIR` set at the conductor's `.arch/` correctly shares the conductor's board, goals, and locks — that is shared *state*. It does not thereby acquire the conductor's hook wiring; hooks are *configuration of a checkout*, not shared state, and the guardrails that will or will not fire in the worker are the worker's.

**3. Making it follow the variable would add an implicit coupling, not remove one.** ADR 0031's purpose is that resolution be chosen rather than accidental. `ARCHKIT_ARCH_DIR`'s documented meaning is "which spec directory". Giving it a second, undocumented meaning — "and also which repository's `.claude/settings.json` archkit may write to" — makes the destination of a settings write implicit in a variable nobody set for that purpose, most dangerously when it is simply left exported in a shell. That is the *class* of bug ADR 0031 removes, reintroduced one level up.

**The strongest argument against, and why it loses.** `archkit doctor` becomes a chimera: with the variable set in a worktree, `D-INTENT-*` describes the conductor's goals while `D-HOOKS` describes the worktree's settings, in one report, with no marker saying so. A user reading "1 guardrail hook not wired" beside the conductor's goal list would reasonably go and edit the conductor's `settings.json`. That is a real coherence cost and this ADR accepts it rather than denying it.

It loses because the alternative is worse in kind, not merely in degree. A chimeric report is *incomplete* — every path involved is already in the payload (`projectSettingsPath`, `userSettingsPath`, `perSource[].path`), so the cure is disclosure, which is additive and cheap. Forcing alignment makes the report *wrong*: it would state that hooks are wired when the ones that will fire are not, and it would point a write at another repository. A confusing true answer is recoverable; a confident false one is not. Note too that `doctor` already treats the two as separate inputs — `src/commands/doctor.mjs:465` calls `runDoctorJson({ archDir, cwd: process.cwd() })`, resolving archDir through ADR 0031 and passing cwd alongside it. The divergence is already in the shipped signature; this ADR names it as intended.

**Deliberately NOT done.**

- *No conditional "follow the variable when its parent happens to contain a `.claude/`".* That is resolution by coincidence of directory layout — exactly ADR 0031's "no git-worktree auto-detection" rejection, in a new costume. It would also be unpredictable from the user's side: the same command would answer about different projects depending on whether an unrelated directory exists.
- *No second variable (`ARCHKIT_PROJECT_DIR`).* Nothing has asked for one. Claude Code already supplies `$CLAUDE_PROJECT_DIR`, and the hook bins already prefer the harness-supplied `event.cwd`; adding a third notion of "root" before there is a caller for it is speculative surface.
- *No change to the walk itself.* The 10-parent bound and the `.arch`-or-`.claude` marker pair stay exactly as they are. This ADR settles *whether the walk is legitimate*, not how it is tuned; changing the bound here would be a silent behavior change smuggled in under a decision goal.

## Consequences

Easier: the `WALKER_EXCEPTIONS` entry for `src/lib/hooks-status.mjs` is now a decision with a citation rather than a note, and the guard keeps working as designed — the file still matches the walker shape, so the "every exception still matches the rule" assertion still covers it and the list still cannot be padded in advance. `archkit_install_hooks --apply` is now pinned to write inside the checkout it was called from, which is the only tree whose `settings.json` is safe to edit.

Harder / constrained: the chimera stands. `archkit doctor` run in a worktree with `ARCHKIT_ARCH_DIR` set can report goals from one project and hook wiring from another. The mitigation is this ADR plus the tests: `tests/archdir-resolution/run.mjs` §9 pins the divergence as intended, so a future reader who assumes it is a bug finds a red test naming the reason instead of a silent behavior change.

**Follow-up: DISCHARGED (2026-08-11) — the chimera is now disclosed, not silent.** This ADR originally left one item open: nothing in the human-readable `D-HOOKS` detail named the `settings.json` it read, so the path lived in the JSON payload and nowhere in the terminal output. That is now fixed on `src/commands/doctor.mjs`, which this decision did not own and deliberately did not touch.

- `src/commands/doctor.mjs` → `hooksScopeDisclosure()` computes the checkout root D-HOOKS answered about, the resolved archDir's parent, and whether they diverge; `runDoctorJson`'s D-HOOKS branches append the result to the detail line, and the same values ship structurally as the payload's `hooks` block (`projectSettingsPath`, `projectRoot`, `archProjectRoot`, `divergedFromArchDir`).
- When the two roots **agree**, the detail names the file and stops: `All guardrail hooks wired. Project settings: .claude/settings.json.` — a path segment, not a sentence. The `[hooks]` warning text is byte-identical to what it was before.
- When they **diverge**, the detail switches to absolute paths and states the split outright — it names the checkout it read, names the `.arch/` every other check describes, says they are a DIFFERENT project, cites this ADR, and points the fix at the checkout's `settings.json` rather than the other tree. `ARCHKIT_ARCH_DIR` is named only when it is actually what moved the archDir, since a nested cwd can diverge with the variable unset.
- Divergence is disclosed, never escalated: `pass` is unchanged and no extra check row or warning appears. Symlinked routes to the same project (`/var` → `/private/var`) are compared by real path, because a false "two different projects" notice would teach the reader to ignore the true one.
- Pinned end-to-end through the real CLI in `tests/doctor-hooks-path/run.mjs` — both cases as exact strings, plus a one-fixture/variable-flipped comparison asserting every row but `D-HOOKS` stays byte-identical, so the agreeing case cannot be made noisier by accident.

Also constrained: `projectClaudeDir` is now *contractually* cwd-scoped, so it may not later be quietly routed through `src/lib/archdir.mjs` for tidiness. Doing so is a behavior change that supersedes this ADR, not a refactor.
