# 0001. Review suppression config schema

- **Date**: 2026-05-20
- **Status**: Accepted
- **Tags**: review, config, dx

## Context

`archkit review` ships with ~25 rule families (`http-client`, `db-efficiency`, `cache`, `queue`, `convention`, `architecture`, `gotcha`, `import-hierarchy`, …). v1.6.4's language gate stopped the JS-ecosystem checks from firing nonsense findings against Swift / Kotlin / Go / Python / etc. files, but it doesn't help projects whose stack does match: a Drizzle-on-PG codebase still gets `db-efficiency` warnings on legitimate `select().from(table)` patterns the team has consciously decided to allow, and a `fetch()`-everywhere codebase keeps getting `http-client` advice about `AbortSignal.timeout(5000)` long after the team has standardized on a different timeout strategy.

The existing inline-suppression mechanism (`// archkit: ignore <type> — <reason>`) handles per-line exceptions but is wrong for project-wide policy — sprinkling a hundred identical ignore comments across the codebase is noise, not signal.

The iOS-dev dogfood report on v1.6.2 (Swift / SwiftUI / SwiftData, ~30 reviews) named `http-client` and `db-efficiency` specifically as the two families they wanted to silence project-wide. Together with v1.6.4's language gate, project-level disables close the "review is too noisy" loop without losing the rules that are still load-bearing for that project.

## Decision

Add a project-level config file at `.arch/config.json` with a minimal schema:

```json
{
  "review": {
    "disable": ["http-client", "db-efficiency"]
  }
}
```

- **Where**: `.arch/config.json`, sibling of `SYSTEM.md` / `INDEX.md`. Lives in the existing `.arch/` directory because review config is .arch-scoped — there is no archkit without `.arch/`, and other tooling (drift, warmup) may grow knobs here too.
- **Identifiers**: the existing `type` field on each finding (e.g. `"http-client"`, `"db-efficiency"`, `"cache"`, `"queue"`, `"convention"`, `"gotcha"`). No new namespace, no renaming. If a finding `type` exists, it's a valid disable identifier; what you read in the review output is exactly what you put in the config.
- **Non-disablable families**: `import-hierarchy`, `import-boundary`, `boundary-violation`, `reserved-word`, `weak-suppression`. These are architecture-correctness checks; silencing them via config defeats the purpose of archkit. The loader strips them from `disable` rather than erroring — a config that includes them still parses, the entries are just ignored.
- **Malformed configs**: missing file, unparseable JSON, or wrong shape all degrade silently to "no disables." Review noise is not a reason to fail review.
- **Discoverability**: surfaced in `archkit_review` and `archkit_review_staged` MCP descriptions (so the LLM proposes editing `.arch/config.json` when the user complains about a specific rule family) and in the human-readable CLI log line at session start.

Stacks with v1.6.4 language gating: a Swift project gets the JS-ecosystem checks skipped automatically; a JS project that has standardized away from one of those families adds it to `disable`. Together they cover both "wrong language" and "right language, wrong rule for our codebase."

## Consequences

**Easier**:
- One-line policy edit silences a noisy family project-wide without touching code.
- Identifier == display name; users don't have to learn a parallel rule-id namespace.
- Future review knobs (`severity` overrides, `paths.exclude`, etc.) have a natural home — additive under `review.*`.

**Harder / constrained**:
- The `type` field on findings is now part of archkit's public surface. Renaming `http-client` → `network-client` later would silently break configs in the wild. Treat finding `type` as a stable identifier; renames go through a deprecation cycle with an alias map in the loader.
- A team can disable real gotchas (`gotcha`) globally. We document this as a footgun rather than preventing it — `gotcha` is project-defined, and a team that has decided their own gotchas are wrong should be free to turn them off.
- Architecture families are intentionally non-disablable. If a team genuinely needs to silence one of those, that's a stronger signal than a config knob can carry, and probably means SYSTEM.md / the .graph itself is wrong.

**Not done in this ADR** (deferred):
- Per-path disables. The `disable: [...]` form is sufficient for the dogfood feedback; per-path scoping is a real ask but a bigger schema commitment.
- Severity overrides (turn an error into a warning rather than dropping it). Same reasoning.
- A `.arch/config.schema.json` to validate the config. Worth doing once the schema grows beyond two leaves.
