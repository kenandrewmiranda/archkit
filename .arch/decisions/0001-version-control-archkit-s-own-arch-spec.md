# 0001. Version-control archkit's own .arch/ spec

- **Date**: 2026-06-06
- **Status**: Accepted
- **Tags**: dogfood, tooling, git, arch-spec

## Context

archkit's repo gitignored `.arch/` wholesale, so `archkit resolve warmup` and `archkit doctor` ran against an empty skeleton — the v1.6 utilization metric, the SessionStart digest, and review-on-edit had nothing to work against here. archkit ships a tool that tells *other* projects to treat .arch/ as load-bearing institutional memory, yet excluded its own. The CGR goal `dogfood-arch-self` forced the question: should the built spec be committed?

## Decision

Version-control archkit's own `.arch/`. Removed the blanket `.arch/` (and the now-redundant `!examples/**/.arch/` exception) from `.gitignore`, leaving only the transient per-session review cache `.arch/.last-review.json` ignored. The committed spec is real, not a skeleton: 4 graph clusters (cli, hooks, lib, mcp) mirroring bin/ + src/{commands,lib,mcp}/, an INDEX.md mapping 4 nodes→clusters→real paths with 5 cross-references, 5 reserved words, 3 skills carrying 9 real WRONG/RIGHT/WHY gotchas (cli-dispatch ARCHKIT_RUN pattern, mcp-contract nextStep/silent-success, lib-purity), and a BOUNDARIES.md BAN encoding the one-way commands→lib dependency.

## Consequences

Easier: warmup and doctor now run green against a meaningful spec, so archkit dogfoods its own CGR loop and contributors get the SessionStart digest + review-on-edit. The .arch/ spec becomes institutional memory that survives context resets, and drift between INDEX.md and the source tree is now caught in CI-able checks. Harder/constrained: the spec must be kept current as src/ evolves — `archkit drift` will flag orphaned nodes or missing paths; adding a new top-level source layer means adding a matching cluster + INDEX node. The decision aligns archkit's self-treatment with the advice it gives users.
