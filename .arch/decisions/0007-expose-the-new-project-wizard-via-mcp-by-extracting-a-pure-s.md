# 0007. Expose the new-project wizard via MCP by extracting a pure scaffold core, not extending archkit_init

- **Date**: 2026-06-13
- **Status**: Accepted
- **Tags**: mcp, wizard, scaffold, init, greenfield, refactor

## Context

The interactive new-project wizard (src/scaffold.mjs + src/wizard/*) is inquirer/TTY-based and requires software-architecture expertise to answer, so it was effectively unused. The actual scaffold-generation logic (genSystemMd/genIndexMd/genGraph/... orchestration that writes .arch/) lived inside `generateFiles(state)` in src/wizard/generate.mjs, interleaved with console output, inquirer prompts (cleanup/launch), clipboard, and process.on("exit") side effects — unreachable without a terminal. The existing `archkit_init` MCP tool only INSTRUCTS: it returns wizardInstructions + archetype skeletons + PRD signal for the agent to follow, but writes nothing. There was no MCP surface that actually GENERATES the scaffold from answers the LLM has chosen.

Forces: (1) keep the interactive wizard working for CLI users; (2) avoid duplicating the large body of generation logic + literal templates (lenses, CLAUDE.md, .claude/rules, superpowers/explore rules, protocol skill, settings hooks, git hook); (3) give the LLM a clean, validated, non-TTY entry point; (4) preserve archkit_init's instruct-only role (it is the discovery/teaching surface).

## Decision

Extract a pure, TTY-free core `generateScaffold(answers, opts)` into a new module src/wizard/scaffold-core.mjs (plus `normalizeAnswers` for archetype-default application + coded-error validation). It owns ALL file writing — the .arch/ scaffold, optional Claude-Code-native files (claudeMode, default on), and the git pre-commit hook — with no console.log, no inquirer, no clipboard, no exit hooks. It takes an optional `onWrite(relPath,size,meta)` callback and an explicit `projectRoot`.

The interactive wizard's `generateFiles(state)` becomes a THIN WRAPPER over this core: it passes the wizard state straight through, supplies an onWrite that prints per-file progress, and keeps only presentation (previews, token-budget report, summary, cleanup/launch prompts). The static templates moved verbatim from generate.mjs into the core (single source of truth — no duplication/drift).

ADD a NEW MCP tool `archkit_init_generate` (runner: src/commands/init-generate.mjs) rather than overloading `archkit_init`. archkit_init stays instruct-only (the teaching/discovery surface); init_generate is the acting counterpart that takes structured answers and writes the scaffold. Input schema: { appName (required), appType (required enum of the 8 archetypes), stack? ({layer:tool} map), features? ([{id,name?,keywords?}]), skills? (validated against catalog), crossRefs? ("ai" | [{from,to,reason}]), claudeMode? (default true), outDir? (default ".arch"), overwrite? (default false) }. Everything except appName/appType has archetype-derived defaults. It REFUSES to clobber an existing .arch/ unless overwrite:true, and translates normalizeAnswers' coded errors (invalid_app_type/invalid_skills/missing_app_name/no_features) into structured MCP error envelopes (valid lists folded into `suggestion`, since the envelope only carries code/message/suggestion/docsUrl). Success envelope carries ok/archDir/appType/features/skills(+skillsNote when empty)/filesWritten/written/nextStep.

The inquirer wizard is KEPT (not deprecated) as the thin CLI wrapper over the shared core.

## Consequences

Easier: an LLM can now drive greenfield scaffold generation end-to-end (archkit_init to learn archetypes → decide answers with the user → archkit_init_generate to write files) without a TTY. The wizard and MCP path are guaranteed identical output because they share one core. Adding/changing generated files happens in exactly one place.

Constrained/harder: the interactive wizard's per-file console messages are now uniform (generic "✓ path (bytes)") instead of the bespoke per-section log lines it printed before — a cosmetic change to a rarely-used path. claudeMode defaults ON for the MCP tool, so archkit_init_generate writes CLAUDE.md/.claude/* and a git pre-commit hook by default (idempotent: skips an existing pre-commit hook, writes CLAUDE.archkit.md if CLAUDE.md exists, merges into existing .claude/settings.json) — callers wanting .arch/-only must pass claudeMode:false. Tool count is now 37 (mcp-server + silent-success-audit registry tests updated). New coverage in tests/mcp-init-generate exercises both the pure core and the MCP runner (defaults, claudeMode on/off, CLAUDE.md rename, overwrite guard, coded errors).
