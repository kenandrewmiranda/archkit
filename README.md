# archkit

**Give AI the blueprint before you give it the task.**

A context engineering system that makes AI coding agents dramatically more effective. Generates a `.arch/` directory with architecture graphs, package skills, API contracts, and rules — so the AI generates code that fits your system, not just code that works.

## Install

```bash
# Option 1: Clone (recommended)
git clone https://github.com/kenandrewmiranda/archkit.git
cd archkit && npm install

# Option 2: Global install
npm install -g github:kenandrewmiranda/archkit

# Option 3: One-shot
npx github:kenandrewmiranda/archkit
```

## Quick Start

```bash
# New project — interactive wizard
archkit                     # Scaffold .arch/ with 7-step wizard
archkit --claude            # + Claude Code native files (hooks, skills, rules)

# Existing project — auto-detect
archkit init                # Reverse-engineer .arch/ from codebase
archkit init src --json     # Detection only, no file generation

# Upgrade from 1.0
archkit update              # Self-update from GitHub
archkit migrate --dry-run   # Preview migration (safe)
archkit migrate             # Upgrade .arch/ without losing gotchas/rules
```

## Commands

### Scaffold & Setup

| Command | Purpose | Output |
|---------|---------|--------|
| `archkit` | Interactive 7-step wizard (save/load/back/exit) | `.arch/` directory |
| `archkit --claude` | + CLAUDE.md, .claude/rules/, .claude/skills/, hooks | Claude Code native |
| `archkit init [src-dir]` | Reverse-engineer .arch/ from existing codebase | `.arch/` directory |
| `archkit migrate` | Upgrade 1.0 .arch/ to 1.1 without data loss | Merged files |
| `archkit update` | Self-update from GitHub | Latest version |

### Context Resolution (JSON — agent-callable)

| Command | Purpose |
|---------|---------|
| `archkit resolve warmup [--deep]` | Pre-session health check (blockers = stop) |
| `archkit resolve context "<prompt>"` | Resolve prompt → nodes, skills, files, rules |
| `archkit resolve preflight <feature> <layer>` | Verify target before generating code |
| `archkit resolve scaffold <feature>` | Checklist for new feature with embedded gotchas |
| `archkit resolve lookup <id>` | Look up any node, skill, or cluster |
| `archkit resolve plan "<prompt>"` | Structured implementation plan with ordered steps |
| `archkit resolve verify-wiring [src-dir]` | Detect dead code / unwired components |
| `archkit resolve audit-spec <spec.md> [src-dir]` | Check spec requirement coverage |

### Code Review (app-type-aware)

| Command | Purpose |
|---------|---------|
| `archkit review <file>` | Review file against rules + gotchas |
| `archkit review --staged` | Review git staged files |
| `archkit review --diff` | Review modified (unstaged) files |
| `archkit review --dir src/` | Review entire directory |
| `archkit review --agent` | JSON output with autofix fields + gotcha suggestions |
| `archkit review --verify` | Re-check only previously flagged files |

### Knowledge Capture

| Command | Purpose |
|---------|---------|
| `archkit gotcha <skill> "wrong" "right" "why"` | Direct gotcha capture |
| `archkit gotcha --interactive` | Guided gotcha wizard |
| `archkit gotcha --debrief` | 4-question session debrief |
| `archkit gotcha --list` | JSON: all skills + gotcha counts |
| `archkit gotcha --json <skill> "wrong" "right" "why"` | JSON output (agent-callable) |
| `archkit gotcha --debrief --json '{...}'` | Non-interactive debrief (agent-callable) |

### Health & Maintenance

| Command | Purpose |
|---------|---------|
| `archkit stats` | Health dashboard (0-100 score) |
| `archkit stats --compact` | One-line health summary |
| `archkit drift [--json]` | Detect stale/orphaned .arch/ files |
| `archkit sync [src-dir]` | Detect code changes needing .arch/ updates |

### Multi-Tool Export

| Command | Output |
|---------|--------|
| `archkit export cursor` | `.cursorrules` |
| `archkit export windsurf` | `.windsurfrules` |
| `archkit export copilot` | `.github/copilot-instructions.md` |
| `archkit export aider` | `.aider-conventions.md` |
| `archkit export all` | All of the above |

### Extensions

| Command | Purpose |
|---------|---------|
| `archkit extend create` | Interactive extension builder |
| `archkit extend create --from-preset <name>` | Non-interactive preset install |
| `archkit extend run <name> [args]` | Execute an extension |
| `archkit extend list` | List installed extensions |
| `archkit guard validate <file>` | Validate extension (22-rule security gate) |
| `archkit guard audit` | Full .arch/ security audit |

## What Gets Generated

### .arch/ Directory

| File | Purpose | Token Weight |
|------|---------|-------------|
| `SYSTEM.md` | Rules, reserved words, decision-tree On Generate, session management | ~800-1200 |
| `BOUNDARIES.md` | Hard NEVER rules (universal + app-type-specific) | ~300-500 |
| `CONTEXT.compact.md` | ~500 token injectable for cheap-model calls | ~500 |
| `INDEX.md` | Keyword → node/skill routing + cross-references | ~400-800 |
| `clusters/*.graph` | Architecture graphs (Key-Rel-Dep v2 notation) | ~100 each |
| `skills/*.skill` | Package gotchas — pre-populated with built-in WRONG/RIGHT/WHY | ~200 each |
| `apis/*.api` | API contract digest stubs | ~100 each |
| `lenses/*.md` | Research / Implement / Review mode overlays | ~150 each |

### Claude Code Native (`--claude`)

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Auto-loaded every session (<200 lines) |
| `.claude/rules/architecture.md` | alwaysApply — rules + protocol mandate |
| `.claude/rules/[feature].md` | Path-targeted — loads when editing that feature |
| `.claude/skills/[package]/SKILL.md` | On-demand package knowledge |
| `.claude/skills/archkit-protocol/SKILL.md` | Workflow integration — maps every step to archkit commands |
| `.claude/settings.json` | Pre-commit review hook + warmup nudge (harness-enforced) |

## How It Works

### For AI Agents

All `resolve`, `review`, `gotcha --json`, `drift`, `sync` commands return structured JSON on stdout. Log output goes to stderr — safe to pipe.

```bash
# Agent workflow:
archkit resolve warmup                              # health check
archkit resolve context "add user notifications"    # get relevant files/rules
archkit resolve plan "add user notifications"       # get implementation steps
archkit review --staged --agent                     # pre-commit gate
archkit gotcha --json postgres "wrong" "right" "why"  # capture learning
```

### Token Budget

archkit shows token estimates for every generated file and warns when always-loaded context exceeds budget:
- **EFFICIENT** (<1000 tokens) — minimal overhead
- **MODERATE** (1000-2000) — good for always-loaded
- **HIGH** (2000-3000) — consider trimming
- **OVER BUDGET** (>3000) — use CONTEXT.compact.md for cheap-model calls

### Review Checks (All 8 App Types)

| App Type | What Gets Checked |
|----------|-------------------|
| SaaS | DB-in-controller, cross-feature imports, tenant scoping, money floats, layer hierarchy |
| E-Commerce | Same as SaaS + inventory locking, payment idempotency |
| Realtime | DB-in-handler, I/O-in-domain, handler complexity |
| Data | Direct ClickHouse in API, pipeline side effects |
| AI | Hardcoded LLM providers, inline prompts, missing guardrails/tracing |
| Mobile | Logic-in-screens, FlatList usage, direct API calls in screens |
| Internal | Destructive actions without audit log, primary DB for reads, unmasked PII |
| Content | Unoptimized images, client-side JS in static pages, missing SEO |

### Built-in Gotcha Database

Skills come pre-populated with real WRONG/RIGHT/WHY entries for: **PostgreSQL, Prisma, Stripe, BullMQ, Valkey, Keycloak, Docker, JWT**. No more empty skeletons on day 1.

### Synonym Expansion

Context resolution expands prompts with 24 synonym groups — "payment" matches "billing", "authenticate" matches "auth", "database" matches "db".

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

## Upgrading from 1.0

```bash
archkit update              # Get latest code
archkit migrate --dry-run   # Preview changes (safe)
archkit migrate             # Apply upgrade
```

Migration preserves all user content (gotchas, learned rules, cross-refs) while adding:
- BOUNDARIES.md, CONTEXT.compact.md
- Built-in gotchas merged into existing skills
- Session Management table (replaces rigid protocol)
- archkit-protocol skill + hooks (if --claude was used)

## License

MIT
