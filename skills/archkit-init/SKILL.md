---
name: archkit-init
description: Initialize a new archkit project. Walks the user through picking an archetype (saas/internal/content/ecommerce/ai/mobile/realtime/data/_generic), choosing a deployment mode (managed or self-hosted), confirming category-by-category defaults, resolving current package versions via WebSearch, and writing the `.arch/` seed (SYSTEM.md, BOUNDARIES.md, INDEX.md, decisions/0001-foundation.md). Use this skill whenever the user runs `/archkit-init`, says "set up archkit" / "initialize archkit" / "scaffold a new project", or has just installed archkit and is asking how to start. Do not skip this skill in favor of writing files directly — the wizard's job is the deliberation, not just the file output.
---

# archkit-init — project foundation wizard

This skill is the entry point to archkit. Your job is to help the user pick the right architectural foundation for their project and write a `.arch/` seed they can grow into. The output is intentionally a *seed*, not a complete spec — stickiness comes from accumulated additions over time, not the initial scaffold.

The eight canonical archetype skeletons live at `${CLAUDE_PLUGIN_ROOT}/skills/archkit-init/skeletons/<archetype>.md`. Each skeleton is the source of truth for that archetype's defaults — read the relevant one in full before writing files.

## Pre-flight check

Before anything else:

1. Check whether `.arch/SYSTEM.md` already exists in the user's project root.
2. If it does, ask the user: "I see you already have a `.arch/` directory. Are you re-initializing (start over and overwrite), augmenting (skip writing files I'd overwrite), or did you mean to do something else?"
3. Only proceed past this point with explicit confirmation. Do not silently overwrite an existing `.arch/`.

If the user is genuinely starting fresh, proceed.

## Step 1 — Pick the archetype

The eight canonical archetypes plus `_generic`:

- **saas** — Multi-tenant subscription product (login, billing, dashboards, tenant isolation)
- **internal** — Admin console / ops tool for your team (SSO, audit log, sensitive data)
- **content** — Marketing site, blog, documentation, brochure (SEO-driven, mostly anonymous)
- **ecommerce** — Storefront with cart, checkout, orders, inventory
- **ai** — LLM is the core product (chat, RAG, agent) — token cost is real, evals replace unit tests
- **mobile** — iOS/Android app via Expo or native (App Store distribution)
- **realtime** — Multi-client realtime (chat, collab editing, live dashboards) with WebSockets/CRDTs
- **data** — Pipelines, warehouse, BI, embedded analytics — orchestrator-centric
- **_generic** — Fallback when shape isn't clear yet or the project is a hybrid

Use the AskUserQuestion tool (or a numbered chat list) to let the user pick. For each option, show a one-line description from above. If the user is unsure, ask 2-3 clarifying questions about what they're building before steering them.

If the user describes a hybrid (e.g. "a SaaS with an AI chatbot inside it"), pick the *dominant* archetype and treat the secondary as a feature inside it. SaaS-with-AI-feature is `saas`, not `ai`. Internal-tool-with-embedded-charts is `internal`, not `data`. Only pick `_generic` when no single archetype dominates.

## Step 2 — Read the chosen skeleton

Read the full file at `${CLAUDE_PLUGIN_ROOT}/skills/archkit-init/skeletons/<archetype>.md`. Everything you need for the rest of the wizard is in there:

- `useWhen` and `redFlags` — confirm the user is in the right archetype
- `deploymentModes` — the next decision
- The eight category blocks (`stack`, `hosting`, `auth`, `networking`, `ui`, `jobs`, `observability`, `testing`) — each has `primary[]` (some entries tagged with `mode:`), `why`, `tradeoffs`
- `boundariesRef` and `recommendedSkills` — used when writing BOUNDARIES.md and INDEX.md
- The markdown body — explains the archetype in plain language; quote selectively when explaining choices to the user

Do not summarize the skeleton to the user. Use it to inform what you say next.

## Step 3 — Pick the deployment mode

From the skeleton's `deploymentModes` block, present each mode (`id`, `label`, `why` paragraph). Ask the user to pick. Both modes are first-class — do not steer toward managed by default. The `why` paragraphs explain when each is right; let them speak.

If the user is unsure, ask:
- "Do you already operate infrastructure (your own servers, K8s cluster, etc.)?"
- "Is shipping speed your constraint, or cost-at-scale?"
- "Is data residency a hard requirement?"

Use answers to recommend a mode but let the user pick.

## Step 4 — Walk the 8 categories

For each of `stack`, `hosting`, `auth`, `networking`, `ui`, `jobs`, `observability`, `testing` (in that order):

1. **Filter** the `primary[]` list by the chosen `mode` — entries with no `mode` tag apply in both modes; entries with `mode: managed` only apply if the user picked managed; same for `selfHosted`.
2. **Present the resolved primary picks** with their `role` text. Show as a short bulleted list.
3. **Show the `why` paragraph** verbatim (it's the thought-layer voiceover the user is paying for).
4. **Ask: "Accept these defaults, or override?"** Most users will accept. If they want to override, walk through entries one at a time:
   - Show the entry's `alt` line (the documented alternatives)
   - Let them pick from `alt`, name something else entirely, or drop the entry
   - Track every override; you'll surface them in the foundation ADR
5. **Don't show `tradeoffs` unless the user pushes back** on the defaults. The tradeoffs paragraph is "when to override" content — surface it when override is on the table.

Keep this phase fast. Eight categories × forty seconds is five minutes; eight categories × five minutes of debate is forty minutes and the user bounces. If the user accepts defaults the first time, accept them.

## Step 5 — Resolve current package versions

Per the no-version-strings-in-skeletons rule, the skeleton names packages but does not pin versions. Before writing SYSTEM.md, resolve each named package/framework to its current latest stable version using WebSearch.

Process:
1. Collect the resolved packages (everything in `primary[]` after filtering and overrides, across all eight categories).
2. For each, run a WebSearch query like `"<package name> latest stable version"` or visit the package's documentation/npm page.
3. Capture both the version number and the install command (e.g. `npm install next@15.x`, `pip install dagster==1.10.0`).
4. If a package's "current" answer is ambiguous (e.g. multiple major versions are actively maintained), ask the user.

Do not skip this step. Versions in SYSTEM.md should reflect what's current today, not what was current at training cutoff.

## Step 6 — Write the .arch/ seed

Create `.arch/` and write four files. Use the templates in the appendix below. Fill in placeholders from the resolved choices in steps 3-5.

### 6a. `.arch/SYSTEM.md`

The foundation document. Narrative + bullets. See the SYSTEM.md template in the appendix. Replace `{placeholders}` with the user's resolved choices, including current versions from step 5.

### 6b. `.arch/BOUNDARIES.md`

Hard prohibitions — non-negotiable rules the AI must never violate. See the BOUNDARIES.md template in the appendix. The universal section is constant; the archetype-specific section should be derived from the chosen archetype's `redFlags` field plus the "concerns that dominate" section in the skeleton's markdown body. Translate each concern into a `NEVER ...` rule in active voice.

### 6c. `.arch/INDEX.md`

Table of contents pointing to expandable directories. See the INDEX.md template in the appendix. Initial `Skills →` entries should be drawn from the skeleton's `recommendedSkills` list. Other sections start mostly empty and grow over time as the user adds clusters, APIs, and gotchas.

### 6d. `.arch/decisions/0001-foundation.md` — **via the MCP tool, not by writing the file directly**

This is the most important step. Call the `archkit_log_decision` MCP tool with the foundation decision. The tool writes the file in the canonical ADR format and assigns the `0001` number.

Call it like this:

```
archkit_log_decision({
  title: "Foundation: <archetype> architecture in <mode> mode",
  context: "<3-5 sentences explaining what the project is and the constraints we considered>",
  decision: "<bulleted summary of the resolved stack across all 8 categories, with versions>",
  consequences: "<3-5 sentences on what this commits us to, what becomes easier, what becomes harder>",
  status: "accepted",
  tags: ["foundation", "<archetype>", "<mode>"]
})
```

After the tool returns, **tell the user about the precedent it sets**: from this point forward, every non-trivial architectural decision (changing a database, adopting a new library, moving to a new auth provider) should be logged via `archkit_log_decision`. The `.arch/decisions/` directory is the project's institutional memory across LLM context resets — it's how future sessions know *why* we made the choices we did.

If `archkit_log_decision` is not available (e.g. the user has installed only the CLI without the MCP server), fall back to writing the file directly using the template in the appendix.

## Step 7 — Optional CLAUDE.md augmentation

Ask: "I can append a short archkit session protocol to your `CLAUDE.md` so every Claude Code session starts by warming up archkit context. Recommended but optional. Append?"

If yes, append the block from the CLAUDE.md augmentation template in the appendix. If `CLAUDE.md` doesn't exist yet, create it with just that block. If it exists, append at the bottom with a leading `---` separator.

Do not modify other parts of an existing `CLAUDE.md`.

## Step 8 — Confirmation and next steps

Tell the user what was written:

- `.arch/SYSTEM.md` (the living foundation)
- `.arch/BOUNDARIES.md` (immutable safety net)
- `.arch/INDEX.md` (table of contents — grows over time)
- `.arch/decisions/0001-foundation.md` (first ADR — sets the precedent)
- `CLAUDE.md` augmentation (if accepted)

Then explain the loop they're now in:

- **New feature**: call `archkit_resolve_scaffold` for a checklist
- **Editing an existing feature**: call `archkit_resolve_preflight` first
- **Discovered a bad pattern**: call `archkit_gotcha_propose`
- **Made a non-trivial decision**: call `archkit_log_decision`
- **Before each commit**: call `archkit_review_staged`

Suggest restarting Claude Code so the SessionStart hook picks up the new `.arch/SYSTEM.md` and starts injecting the archkit session protocol on every future session.

---

## Appendix: templates

### SYSTEM.md template

```markdown
# SYSTEM.md

## App: {project-name}
## Type: {Archetype displayName}
## Mode: {managed | selfHosted}
## Stack: {one-line summary of resolved stack picks with versions}
## Pattern: {primary architecture pattern, e.g. "Layered (Cont→Ser→Repo) + Modular Monolith" for saas}

## Resolved choices

### Stack
{bulleted list — name @ version, role}

### Hosting
{bulleted list — name, role}

### Auth
{bulleted list — name, role}

### Networking
{bulleted list — name, role}

### UI
{bulleted list — name, role}

### Jobs
{bulleted list — name, role}

### Observability
{bulleted list — name, role}

### Testing
{bulleted list — name, role}

## Rules
{archetype-specific rules derived from the skeleton's body — e.g. for saas: "All DB queries include $tenant. RLS is the safety net, not the primary filter." Pull these from the relevant archetype's prose body, especially the "patterns that matter" section.}

## Reserved Words
{archetype-specific symbols — e.g. for saas: "$tenant, $auth, $err, $bus, $cache, $db, $zod, $rls, $queue". Define each.}

## Naming
Files: kebab-case | Types: PascalCase | Funcs: camelCase | Tables: snake_case | Env: SCREAMING_SNAKE

## On Generate
Before writing any file:
1. State the file path you intend to write to.
2. State which layer this code belongs to (controller / service / repo / etc.).
3. Reference $symbols for all dependencies.
4. Throw archetype-typed errors on failure paths.
5. Write the corresponding test.

## Session Protocol
- BEFORE any code generation in a new session: call `archkit_resolve_warmup`.
- If warmup returns blockers: FIX THEM before writing any code.
- BEFORE generating code for an existing feature: call `archkit_resolve_preflight <feature> <layer>`.
- BEFORE generating a new feature: call `archkit_resolve_scaffold <featureId>`.
- WHENEVER a non-trivial architectural choice is made: call `archkit_log_decision`.
- BEFORE each commit: call `archkit_review_staged`.
- WHEN you discover a pattern the AI gets wrong: call `archkit_gotcha_propose`.
```

### BOUNDARIES.md template

```markdown
# BOUNDARIES.md

> Hard prohibitions. The AI must NEVER violate these rules.
> These are non-negotiable constraints, not suggestions.

## Universal Boundaries
- NEVER commit secrets, API keys, or credentials to code. Use environment variables.
- NEVER use `any` type in TypeScript without a written justification comment.
- NEVER catch errors silently. Log or re-throw with context.
- NEVER use string concatenation for SQL queries. Use parameterized queries.
- NEVER trust client-side input. Validate at every untrusted edge with Zod (or equivalent).
- NEVER store passwords in plain text. Use bcrypt/argon2 with salt, or use a managed auth provider.
- NEVER disable CORS in production. Configure allowed origins explicitly.
- NEVER return stack traces or internal errors to the client in production.
- NEVER make a non-trivial architectural decision without calling `archkit_log_decision`.

## {Archetype}-Specific Boundaries
{Derive these from the chosen skeleton's `redFlags` and the "concerns that dominate" section of the skeleton body. Translate each concern into a NEVER rule in active voice. Example for saas:}
{- NEVER query the database without tenant scoping. Every query includes the tenant ID.}
{- NEVER use Row-Level Security as the primary filter. RLS is the safety net underneath explicit scoping.}
{- NEVER put business logic in controllers. Controllers validate, delegate, respond.}
{- NEVER access the database directly from controllers. Go through service → repository.}
{- NEVER create a new database client per request in serverless. Use a singleton.}
{etc.}
```

### INDEX.md template

```markdown
# INDEX.md

## Conv: {convention for feature file paths, derived from archetype}
## Shared: src/shared/{name}/index.ts | Jobs: src/jobs/{name}.ts (if applicable)

## Keywords → Skills
{For each entry in the skeleton's `recommendedSkills`, write one line:}
{<package-keywords> → $<package-name>}

## Skills → Files
{For each entry in the skeleton's `recommendedSkills`, write one line:}
{$<package-name> → .arch/skills/<package-name>.skill}

## Nodes → Clusters → Files
{Empty initially — grows as the user adds features.}

## Cross-Refs
{Empty initially — grows as the user adds inter-feature dependencies.}
```

### CLAUDE.md augmentation template

```markdown
## archkit Session Protocol (NON-NEGOTIABLE)

This project is managed by archkit. Before answering any question about project structure, conventions, or where code should go, call the archkit MCP tools — reading `.arch/*.md` directly returns raw markdown and partial context.

- **Session start**: call `archkit_resolve_warmup`. Fix any blockers before writing code.
- **New feature**: call `archkit_resolve_scaffold <featureId>` for the checklist.
- **Editing an existing feature**: call `archkit_resolve_preflight <feature> <layer>` before changes.
- **Non-trivial architectural decision**: call `archkit_log_decision` to record the ADR.
- **Bad pattern discovered**: call `archkit_gotcha_propose`.
- **Before commit**: call `archkit_review_staged`.

The `.arch/` directory holds this project's architecture spec. `.arch/decisions/` is the institutional memory across LLM context resets — when in doubt about why we made a choice, read the relevant ADR there.
```

### 0001-foundation.md fallback template (only if `archkit_log_decision` MCP tool is not available)

```markdown
# 0001. Foundation: {Archetype displayName} architecture in {mode} mode

- **Date**: {YYYY-MM-DD}
- **Status**: Accepted
- **Tags**: foundation, {archetype}, {mode}

## Context
{3-5 sentences explaining what the project is and the constraints we considered.}

## Decision
{Bulleted summary of the resolved stack across all 8 categories, with versions.}

## Consequences
{3-5 sentences on what this commits us to, what becomes easier, what becomes harder.}
```
