# 0008. Archetypes may carry decision-aware option sets (not just a hardcoded defaultStack)

- **Date**: 2026-06-13
- **Status**: Accepted
- **Tags**: archetype, stack, ios-swift, generators, mcp

## Context

The `ios-swift` native Swift/SwiftUI archetype's backend and storage are genuinely project-dependent: the same iOS app might pair with Vapor, Hono, or FastAPI, and MinIO, local-disk+Caddy, or Postgres-only. A single hardcoded `defaultStack` can't represent that without silently railroading the user. We needed a way to present the real options with tradeoffs and let the AI/user weight a recommendation to the project's stated needs, while still keeping non-interactive callers (archkit_init_generate without a decision) working.

## Decision

An archetype in src/data/app-types.mjs may now carry annotated option sets alongside `defaultStack`: `serverStackOptions` and `storageOptions`, each an array of `{id,label,pros[],cons[]}`, plus `defaultServerStack`/`defaultStorage` ids as the non-interactive fallback. A new optional `answers.stackDecision` ({ serverStack:{chosen,rationale,recommendations:[{id,pct}]}, storage:{...} }) threads through normalizeAnswers → cfg.stackDecision. `genStackDecisionSection()` (src/lib/generators.mjs) renders it into a SYSTEM.md `## Stack Decision` section with the chosen option, rationale, and AI-weighted recommended % per option; the chosen labels also fold into the stack map. The interactive wizard (stepStack → promptStackDecision) surfaces the options with pros/cons and records the choice; archkit_init_generate echoes the option sets + a re-run note in its envelope when no decision was passed, and records it when one is. hasJsTsStack() short-circuits false for non-JS archetypes (NON_JS_ARCHETYPES set) so verify-wiring guidance is stripped regardless of which backend is chosen. Naming is archetype-aware via namingLine() (PascalCase Swift files for ios-swift).

## Consequences

Adding a decision-aware archetype is now a data change plus a graphGen case — generators, INDEX paths, feature-rule globs, and CLAUDE.md naming already branch on appType. Future archetypes can reuse the option-set + stackDecision machinery for any genuinely-optional layer (not just server/storage) by following the same {id,label,pros,cons} + default* + genStackDecisionSection contract. Cost: app-types.mjs entries are larger, and callers that want the decision recorded must pass stackDecision (omitting it is safe — falls back to defaults and the envelope nudges a re-run). The z.enum in the archkit_init_generate MCP tool must be extended for each new archetype key.
