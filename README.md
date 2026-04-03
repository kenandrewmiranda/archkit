# archkit

**Give AI the blueprint before you give it the task.**

A context engineering system that makes AI coding agents dramatically more effective. Generates a `.arch/` directory with architecture graphs, package skills, API contracts, and rules — so the AI generates code that fits your system, not just code that works.

## Install

```bash
# Option 1: Clone into your project (recommended)
git clone https://github.com/kenandrewmiranda/archkit.git
cd archkit && npm install

# Option 2: Install globally from GitHub
npm install -g github:kenandrewmiranda/archkit

# Option 3: Run without installing
npx github:kenandrewmiranda/archkit
```

## Usage

```bash
# New project — interactive wizard
archkit                     # Scaffold .arch/ directory
archkit --claude            # + Claude Code native files

# Existing project — auto-detect from codebase
archkit init                # Reverse-engineer .arch/ from src/
archkit init src --json     # Detection only, no file generation

# Export for other AI tools
archkit export cursor       # Generate .cursorrules
archkit export copilot      # Generate .github/copilot-instructions.md
archkit export all          # All tools at once

# Update to latest
archkit update              # Self-update from GitHub
archkit update --check      # Check for updates without installing
```

## Commands

| Command | Purpose | Output |
|---------|---------|--------|
| `archkit` | Scaffold `.arch/` directory | Interactive wizard |
| `archkit --claude` | + Generate CLAUDE.md, .claude/rules/, .claude/skills/ | Claude Code native |
| `archkit gotcha` | Capture bad AI patterns into .skill files | Interactive |
| `archkit gotcha -d` | Session debrief (4 guided questions) | Interactive |
| `archkit review` | Check code against rules and skills | Colored terminal |
| `archkit review --agent` | Same checks, machine-readable | JSON |
| `archkit stats` | Health dashboard with scores | Full dashboard |
| `archkit stats --compact` | One-line health summary | One line |
| `archkit extend` | Self-evolving extension system | Interactive / registry |
| `archkit guard` | Guardrails: validate, audit, enforce | Pass/fail |
| `archkit resolve warmup` | Pre-session readiness gate (NON-NEGOTIABLE) | JSON |
| `archkit resolve context "..."` | Resolve prompt → nodes + skills + files | JSON |
| `archkit resolve preflight <f> <l>` | Verify target before generating code | JSON |
| `archkit resolve scaffold <f>` | Deterministic checklist for new feature | JSON |
| `archkit resolve lookup <id>` | Look up any node, skill, or cluster | JSON |

## Claude Code Integration (`--claude`)

When you run `archkit --claude`, archkit generates Claude Code native files alongside `.arch/`:

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

**Non-negotiable warmup.** `archkit resolve warmup` runs before any code generation. Blockers = stop. Warnings = proceed with awareness.

## Session Protocol

```
1. Warmup    → archkit resolve warmup           (hard gate)
2. Context   → archkit resolve context "..."     (resolve prompt)
3. Scaffold  → archkit resolve scaffold <feat>   (if new feature)
4. Preflight → archkit resolve preflight <f> <l> (if existing)
5. Generate  → sub-agent implements from checklist
6. Test      → main agent writes failing test first (TDD)
7. Review    → archkit review --agent             (final gate)
8. Debrief   → archkit gotcha -d                  (capture learnings)
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
