# archkit

**Give AI the blueprint before you give it the task.**

A context engineering system that makes AI coding agents dramatically more effective. Generates a `.arch/` directory with architecture graphs, package skills, API contracts, and rules — so the AI generates code that fits your system, not just code that works.

## Install & Run

```bash
npm install
node index.mjs            # Interactive wizard
node index.mjs --claude    # Also generates Claude Code native files
```

## Commands

| Command | Purpose | Output |
|---------|---------|--------|
| `node index.mjs` | Scaffold `.arch/` directory | Interactive wizard |
| `node index.mjs --claude` | + Generate CLAUDE.md, .claude/rules/, .claude/skills/ | Claude Code native |
| `node gotcha.mjs` | Capture bad AI patterns into .skill files | Interactive |
| `node gotcha.mjs -d` | Session debrief (4 guided questions) | Interactive |
| `node review.mjs` | Check code against rules and skills | Colored terminal |
| `node review.mjs --agent` | Same checks, machine-readable | JSON |
| `node stats.mjs` | Health dashboard with scores | Full dashboard |
| `node stats.mjs --compact` | One-line health summary | One line |
| `node extend.mjs` | Self-evolving extension system | Interactive / registry |
| `node guard.mjs` | Guardrails: validate, audit, enforce | Pass/fail |
| `node resolve.mjs warmup` | Pre-session readiness gate (NON-NEGOTIABLE) | JSON |
| `node resolve.mjs context "..."` | Resolve prompt → nodes + skills + files | JSON |
| `node resolve.mjs preflight <f> <l>` | Verify target before generating code | JSON |
| `node resolve.mjs scaffold <f>` | Deterministic checklist for new feature | JSON |
| `node resolve.mjs lookup <id>` | Look up any node, skill, or cluster | JSON |

## Claude Code Integration (`--claude`)

When you run `node index.mjs --claude`, archkit generates Claude Code native files alongside `.arch/`:

```
project-root/
  CLAUDE.md                     # Auto-loaded every session (<200 lines)
  .claude/
    rules/
      architecture.md           # alwaysApply: true — core rules
      [feature].md              # Path-targeted — loads when editing that feature
    skills/
      [package]/SKILL.md        # On-demand — loads when that package is relevant
  .arch/                        # Full archkit context system
    SYSTEM.md                   # Rules + $reserved words + session protocol
    INDEX.md                    # Keyword → node + skill routing table
    clusters/*.graph            # Architecture graphs (Key-Rel-Dep v2)
    skills/*.skill              # Package gotchas (WRONG/RIGHT/WHY)
    apis/*.api                  # API contract digests
    lenses/                     # Context mode overlays
    extensions/                 # Self-built automation
```

Claude Code auto-loads `CLAUDE.md` and `.claude/rules/` every session. Path-targeted rules only activate when Claude touches files in that feature's directory. Skills load on demand.

## What `.arch/` Contains

| Directory | Contents | Purpose |
|-----------|----------|---------|
| `SYSTEM.md` | Rules, $reserved words, session protocol, delegation principle | The AI's operating constraints |
| `INDEX.md` | Keyword → @node + $skill routing | Context resolution table |
| `clusters/*.graph` | Key-Rel-Dep v2 architecture nodes | Where code lives, what connects to what |
| `skills/*.skill` | WRONG → RIGHT → WHY per package | What the AI gets wrong and how to fix it |
| `apis/*.api` | Type-signature endpoint digests | Real API contracts, not training data guesses |
| `lenses/` | Research / Implement / Review modes | Shifts AI focus without changing rules |
| `extensions/` | Self-built automation tools | Codified workflows the AI or team creates |

## Core Principles

**Token-efficient.** Three-tier lazy loading: ~540 tokens per prompt vs ~1,800 for flat context.

**Delegation-first.** Sub-agents handle 70-80% (scaffolding, lookup, review) via deterministic CLI. Main agent spends expensive tokens on TDD finalization and judgment.

**Self-improving.** Every session debrief, every gotcha captured, every stale skill flagged by warmup makes the system permanently smarter.

**Non-negotiable warmup.** `resolve.mjs warmup` runs before any code generation. Blockers = stop. Warnings = proceed with awareness.

## Session Protocol

```
1. Warmup    → node resolve.mjs warmup           (hard gate)
2. Context   → node resolve.mjs context "..."     (resolve prompt)
3. Scaffold  → node resolve.mjs scaffold <feat>   (if new feature)
4. Preflight → node resolve.mjs preflight <f> <l> (if existing)
5. Generate  → sub-agent implements from checklist
6. Test      → main agent writes failing test first (TDD)
7. Review    → node review.mjs --agent             (final gate)
8. Debrief   → node gotcha.mjs -d                  (capture learnings)
```

## Supported App Types

| Type | Architecture Pattern |
|------|---------------------|
| SaaS / B2B | Layered (Cont→Ser→Repo) + Modular Monolith |
| E-Commerce / Marketplace | Layered + Event-Driven |
| Real-Time (Chat/Collab/Gaming) | Event-Driven + Gateway |
| Data-Intensive / Analytics | CQRS (Pipelines → Semantic → API) |
| AI-Powered Product | Hexagonal (Ports + Adapters) + Pipeline Chains |
| Consumer Mobile | MVVM (Screen → Hook → Service → DB) |
| Internal Tools | Simple Layered |
| Content Site (CMS/Blog) | Static Generation + Interactive Islands |

## Guardrails

22 validation rules enforce extension safety across 4 categories: Structure (7), Boundaries (6), Safety (6), Conventions (3). Extensions that fail are rejected or deregistered.

## License

MIT
