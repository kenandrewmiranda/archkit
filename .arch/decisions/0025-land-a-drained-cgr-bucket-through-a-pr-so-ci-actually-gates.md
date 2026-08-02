# 0025. Land a drained CGR bucket through a PR so CI actually gates the merge

- **Date**: 2026-08-02
- **Status**: Accepted
- **Tags**: cgr, ci, landing, instruct-not-act

## Context

The terminal step of a CGR batch is the merge-or-archive choice `bucketCompletion` composes when a bucket (a `feat/<project>` feature set, or the shared `cgr-queue-<date>` branch) drains. Its `mergeGuidance` was unconditionally a DIRECT merge to mainline:

```
git switch <mainline> && git merge <branch>
```

That contradicts the project's own gate on both ends. `.github/workflows/ci.yml` has a `pull_request` trigger — the ubuntu+windows suite and `check:versions` run on PRs — and RELEASING.md step 3 explicitly documents "Commit, open a PR, merge to `main` (CI runs `check:versions` + the full test suite on ubuntu and windows)". So the CGR workflow's final instruction told the agent to bypass the exact gate the docs promise. A batch could land on mainline having never been through CI.

The constraint is that archkit does not know whether a project HAS CI, and must not assume one: a local-only repo with no remote and no provider is a legitimate archkit user, and pushing/opening a PR there is nonsense. But archkit already records the answer — `cgr.finalize.ciCd` (none | github-actions | custom), captured during the one-time `archkit_finalize_config` setup, exists precisely to describe a project's CI/CD.

## Decision

Make landing CI-AWARE, gated on `cgr.finalize.ciCd`.

`hasCiProvider(ciCd)` in src/lib/goals.mjs is the single predicate: absent, empty or "none" means no CI; any other value names a provider. `bucketLandingStrategy(archDir)` resolves it into `pull-request` or `direct-merge`, and `bucketMergeGuidance({ branch, mainline, ciCd })` emits accordingly:

- **No provider** — unchanged, byte for byte: `git switch <mainline> && git merge <branch>`. Projects without CI are unaffected, and the guidance's default (no `ciCd` argument at all) is the direct merge, so any caller that has not been taught about CI keeps the old behavior.
- **github-actions** — `git push -u origin <branch> && gh pr create --base <mainline> --head <branch>  # then WAIT for the required github-actions checks to pass on the PR before merging it — do NOT merge to <mainline> locally, the PR IS the gate`.
- **Any other provider** — the push, plus an instruction to open the PR however that provider does it, with the same WAIT clause. The `gh` CLI is only assumed for GitHub Actions.

The WAIT instruction rides in a trailing shell comment deliberately: `bucketCompletion.mergeGuidance` is relayed verbatim as a single line by the goal-complete relay, so the "don't merge before the checks are green" half must survive inside the string itself rather than living in a sibling field a caller might drop. `bucketCompletion` also gained structured `landing` and `ciCd` fields so consumers can branch on the decision without parsing prose.

archkit does not run git, gh, or anything else. Only the emitted string and its config gating changed (instruct-not-act, ADR 0010): the agent presents the guidance, the user runs it.

## Consequences

Easier: a CGR batch on a CI-enabled project now lands the way the project documents, and the gate that already exists actually runs before the merge. Turning the behavior on is the existing one-time finalize setup — no new config surface.

Harder / constrained:

- The landing is only as correct as `cgr.finalize.ciCd`. A project with CI that never ran `archkit_finalize_config` (or answered "none") still gets direct-merge guidance. That is the deliberate safe default — inventing a push/PR flow for a project that may have no remote is worse than under-promising.
- The PR path assumes a remote named `origin` and, for GitHub, the `gh` CLI. Non-GitHub providers get provider-agnostic prose instead of a command.
- The merge is no longer a single step the user completes immediately: they must wait for checks, which turns the batch's terminal action into something asynchronous. The guidance says so explicitly rather than pretending otherwise.
- `mergeGuidance` is no longer a fixed string, so anything asserting its exact text must now account for the configured provider (tests/cgr-goals asserts the no-CI form, which is still exact).
