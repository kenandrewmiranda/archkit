// Agent scaffold stub templates — written to disk by `archkit init --agent-scaffold`.
// Each template is a plain string; no runtime file reads required.

export const TEMPLATES = {

  // ── BOUNDARIES ──────────────────────────────────────────────────────────
  // Written to: .arch/BOUNDARIES.md

  BOUNDARIES: `# Architectural Boundaries

<!--
AGENT-INSTRUCTIONS: START
Read the files in src/ and identify the architectural layers and module boundaries
of this project. Then:

1. Replace the format example below with real NEVER rules derived from the codebase.
   Use the pattern:  ### NEVER <imperative rule>
   Add a brief rationale under each rule.

2. Populate the section stubs with rules specific to this project.

3. Delete this AGENT-INSTRUCTIONS block when done.
AGENT-INSTRUCTIONS: END
-->

## Format Example

### NEVER import a repository directly from a controller
Controllers must go through a service. Direct repo access bypasses business logic
and validation layers.

### NEVER call an external API from a repository
Repositories handle data persistence only. External calls belong in services or
dedicated integration modules.

---

## Data Layer Boundaries

<!-- AGENT: populate with NEVER rules for data access patterns in this project -->

## I/O Boundaries

<!-- AGENT: populate with NEVER rules for I/O, external services, and side effects -->

## Error Handling Boundaries

<!-- AGENT: populate with NEVER rules for error propagation and exposure -->
`,

  // ── SYSTEM ──────────────────────────────────────────────────────────────
  // Written to: .arch/SYSTEM.md

  SYSTEM: `# System Architecture

<!--
AGENT-INSTRUCTIONS: START
Read the files in src/ and identify the top-level clusters (feature areas, layers,
or subsystems) of this project. Then:

1. Replace the format example below with a real architecture description.
   Fill in: App, Type, Stack, Clusters, Reserved Words, and Rules.

2. Reserved Words are tokens that have a specific, load-bearing meaning in this
   codebase (e.g. domain terms, naming conventions, status codes). List them so
   agents do not redefine or collide with them.

3. Delete this AGENT-INSTRUCTIONS block when done.
AGENT-INSTRUCTIONS: END
-->

## Format Example

**App:** my-service
**Type:** REST API
**Stack:** Node.js · Express · PostgreSQL · Redis

### Clusters

| Cluster | Responsibility |
|---------|---------------|
| auth | Session management, JWT issuance, permission checks |
| billing | Subscription lifecycle, payment processing, invoices |
| notifications | Email/push dispatch, delivery tracking |
| shared | Cross-cutting utilities: logging, config, error types |

### Reserved Words

\`UserId\`, \`TenantId\`, \`OrgId\`, \`$err\`, \`ServiceResult\`

### Rules

- Every cluster owns its own DB tables; no cross-cluster table access.
- \`shared\` may be imported by any cluster; clusters must not import each other.
- All monetary values use integer cents, never floats.

---

<!-- AGENT: replace the example above with the real system description -->
`,

  // ── SKILLS_README ────────────────────────────────────────────────────────
  // Written to: .arch/skills/README.md

  SKILLS_README: `# Skills

Skill files (\`.arch/skills/<package>.skill\`) capture package-specific gotchas:
things that look right but break at runtime, and the correct pattern to use instead.

## Format

Each gotcha entry uses three fields:

\`\`\`
WRONG: <the pattern that looks reasonable but causes problems>
RIGHT: <the correct pattern>
WHY:   <one-line rationale with a reference if available>
\`\`\`

Example:

\`\`\`
WRONG: jwt.decode(token)
RIGHT: jwt.verify(token, secret)
WHY:   decode() skips signature verification — anyone can forge a token. Ref: RFC 7519 §7.2.
\`\`\`

## Proposing Gotchas

**Via CLI:**

\`\`\`
archkit gotcha --propose --skill <pkg> --wrong "..." --right "..." --why "..."
\`\`\`

**Via JSON drop:**
Create a \`.json\` file in \`.arch/gotcha-proposals/\` with the shape:

\`\`\`json
{
  "skill": "<package-name>",
  "wrong": "...",
  "right": "...",
  "why": "..."
}
\`\`\`

## Reviewing Proposals

\`\`\`
archkit gotcha --review
\`\`\`

This lists all pending proposals and lets you accept or discard each one.

<!-- AGENT: as you encounter surprising runtime behaviors, edge cases, or vendor
quirks while working in this codebase, propose gotchas for the relevant package
so future sessions benefit from the discovery. -->
`,

  // ── CLAUDE_MD ────────────────────────────────────────────────────────────
  // Written to: CLAUDE.md (project root)

  CLAUDE_MD: `# Project Context

<!-- scaffolded by archkit init --agent-scaffold — fill in the sections below -->

## Architecture

Key documents:

- \`.arch/BOUNDARIES.md\` — NEVER rules for layer and module boundaries
- \`.arch/SYSTEM.md\` — system overview, clusters, reserved words, top-level rules
- \`.arch/skills/*.skill\` — package-specific gotchas (WRONG / RIGHT / WHY)

**Before writing code touching a package, check \`.arch/skills/<package>.skill\`**
for known gotchas specific to that dependency.

## Reserved Words

<!-- AGENT: after reading .arch/SYSTEM.md, copy the Reserved Words list here
so they are visible at session start without an extra file read. -->

## Session Protocol

Run these archkit commands at the start or end of a session as needed:

| Command | When to use |
|---------|-------------|
| \`archkit resolve warmup\` | Beginning of session — loads context into working memory |
| \`archkit resolve context\` | When context window is long and you need a compact re-anchor |
| \`archkit review --staged\` | Before committing — checks staged diff against BOUNDARIES rules |
| \`archkit gotcha --propose\` | When you discover a surprising runtime behavior or vendor quirk |
| \`archkit gotcha --list-proposals\` | To see pending gotcha proposals awaiting review |
| \`archkit drift\` | To detect files that have drifted from documented architecture |

## Index

<!-- AGENT: create \`.arch/INDEX.md\` on demand — a flat map of every meaningful
file in src/ with a one-line description. Regenerate whenever the file tree
changes significantly. Reference it here once created. -->
`,

};
