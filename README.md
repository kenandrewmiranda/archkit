<div align="center">

<pre>
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║                  ▄▀█ █▀█ █▀▀ █ █ █▄▀ █ ▀█▀                   ║
║                  █▀█ █▀▄ █▄▄ █▀█ █ █ █  █                    ║
║                                                              ║
║             ◆ Context Engineering for AI Agents              ║
║            Give AI the blueprint, then the task.             ║
╚══════════════════════════════════════════════════════════════╝
</pre>

**Context Engineering for AI Agents**

AI agents write better code when they understand your architecture.<br>
archkit generates a `.arch/` directory -- architecture graphs, package skills,<br>
API contracts, guardrails, and rules -- so every line fits your system.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)]()
[![Version](https://img.shields.io/badge/version-1.1.0-cyan.svg)]()

[Website](https://thearchkit.com) &bull; [Marketplace](https://market.thearchkit.com) &bull; [Issues](https://github.com/kenandrewmiranda/archkit/issues)

</div>

---

## The Problem

AI coding agents generate code that works in isolation -- but doesn't fit your system. They don't know your layer boundaries, naming conventions, package gotchas, or API contracts. You end up reviewing and rewriting what was supposed to save you time.

**archkit fixes this.** One command generates a machine-readable blueprint of your architecture. The agent reads it before writing a single line.

```
  +--------------+        +---------------------------+        +---------------+
  |              |        |         .arch/            |        |               |
  |  Your        | -----> |  SYSTEM.md    rules       | -----> |  AI Agent     |
  |  Codebase    |        |  INDEX.md     routing     |        |  writes code  |
  |              |        |  clusters/    graphs      |        |  that fits    |
  |              |        |  skills/      gotchas     |        |               |
  +--------------+        |  apis/        contracts   |        +---------------+
                          |  lenses/      overlays    |
                          +---------------------------+
```

---

## Quick Start

```bash
# Install
git clone https://github.com/kenandrewmiranda/archkit.git
cd archkit && npm install

# New project -- interactive 7-step wizard
archkit

# Existing project -- auto-detect from code
archkit init

# With Claude Code native integration
archkit --claude
```

> [!TIP]
> `archkit --claude` generates CLAUDE.md, `.claude/rules/`, `.claude/skills/`, pre-commit hooks, and warmup nudges -- fully integrated out of the box.

---

## How It Works

archkit commands return structured JSON on stdout, making them callable by any AI agent. Human-readable logs go to stderr.

```
  +----------------------------------------------------------------------+
  |                          Agent Workflow                               |
  |                                                                      |
  |   1. WARMUP        archkit resolve warmup                            |
  |      |               \-- health check, blockers, warnings            |
  |      v                                                               |
  |   2. CONTEXT       archkit resolve context "add notifications"       |
  |      |               \-- features, skills, files, rules              |
  |      v                                                               |
  |   3. PLAN          archkit resolve plan "add notifications"          |
  |      |               \-- ordered steps, dependencies, gotchas        |
  |      v                                                               |
  |   4. CODE          write implementation...                           |
  |      |                                                               |
  |      v                                                               |
  |   5. REVIEW        archkit review --staged --agent                   |
  |      |               \-- violations, autofixes, suggestions          |
  |      v                                                               |
  |   6. LEARN         archkit gotcha --json postgres "..." "..." "..."  |
  |                      \-- captured for next session                   |
  +----------------------------------------------------------------------+
```

---

## What Gets Generated

### `.arch/` Directory

```
.arch/
|-- SYSTEM.md              # Rules, reserved words, session management       ~800-1200 tokens
|-- BOUNDARIES.md          # Hard NEVER rules (universal + app-type)         ~300-500 tokens
|-- CONTEXT.compact.md     # 500-token injectable for cheap models           ~500 tokens
|-- INDEX.md               # Keyword -> node/skill routing + cross-refs     ~400-800 tokens
|-- clusters/
|   \-- *.graph            # Architecture graphs (Key-Rel-Dep v2)           ~100 each
|-- skills/
|   \-- *.skill            # Package gotchas -- WRONG / RIGHT / WHY         ~200 each
|-- apis/
|   \-- *.api              # API contract digest stubs                      ~100 each
\-- lenses/
    \-- *.md               # Research / Implement / Review overlays         ~150 each
```

### Claude Code Native (`--claude`)

```
CLAUDE.md                              # Auto-loaded every session (<200 lines)
.claude/
|-- rules/
|   |-- architecture.md                # alwaysApply -- architecture rules
|   \-- [feature].md                   # Path-targeted -- loads per feature
|-- skills/
|   |-- [package]/SKILL.md             # On-demand package knowledge
|   \-- archkit-protocol/SKILL.md      # Workflow -> archkit command mapping
\-- settings.json                      # Pre-commit review hook + warmup nudge
```

---

## 8 Architecture Patterns

archkit understands your application type and tailors rules, reviews, and defaults accordingly.

| Type | Pattern | Review Focus |
|------|---------|-------------|
| **SaaS / B2B** | Layered + Modular Monolith | DB-in-controller, cross-feature imports, tenant scoping, money floats |
| **E-Commerce** | Layered + Event-Driven | + inventory locking, payment idempotency |
| **Real-Time** | Event-Driven + Gateway | DB-in-handler, I/O-in-domain, handler complexity |
| **Data / Analytics** | CQRS (Pipeline -> Semantic -> API) | Direct DB in API layer, pipeline side effects |
| **AI-Powered** | Hexagonal + Pipeline Chains | Hardcoded LLM providers, inline prompts, missing guardrails |
| **Mobile** | MVVM (Screen -> Hook -> Service) | Logic-in-screens, direct API calls in views |
| **Internal Tools** | Simple Layered | Destructive actions without audit, unmasked PII |
| **Content / CMS** | Static Gen + Islands | Unoptimized images, client JS in static pages, missing SEO |

---

## Commands

<details>
<summary><b>Scaffold & Setup</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit` | Interactive wizard with save/load/back/exit |
| `archkit --claude` | + CLAUDE.md, .claude/rules/, .claude/skills/, hooks |
| `archkit init [src-dir]` | Auto-detect architecture from codebase |
| `archkit init src --json` | Detection only, no file generation |
| `archkit migrate` | Upgrade 1.0 -> 1.1 without data loss |
| `archkit update` | Self-update from GitHub |

</details>

<details>
<summary><b>Context Resolution</b> -- JSON, agent-callable</summary>

| Command | What it does |
|---------|--------------|
| `archkit resolve warmup [--deep]` | Pre-session health check (blockers = stop) |
| `archkit resolve context "<prompt>"` | Map prompt -> features, skills, files, rules |
| `archkit resolve preflight <feature> <layer>` | Verify target before generating code |
| `archkit resolve scaffold <feature>` | New feature checklist with embedded gotchas |
| `archkit resolve lookup <id>` | Look up any node, skill, or cluster |
| `archkit resolve plan "<prompt>"` | Ordered implementation plan |
| `archkit resolve verify-wiring [src-dir]` | Detect dead code / unwired components |
| `archkit resolve audit-spec <spec.md> [src-dir]` | Check spec requirement coverage |

</details>

<details>
<summary><b>Code Review</b> -- app-type-aware</summary>

| Command | What it does |
|---------|--------------|
| `archkit review <file>` | Review file against rules + gotchas |
| `archkit review --staged` | Review git staged files |
| `archkit review --diff` | Review modified (unstaged) files |
| `archkit review --dir src/` | Review entire directory |
| `archkit review --agent` | JSON output with autofix fields + gotcha suggestions |
| `archkit review --verify` | Re-check only previously flagged files |

</details>

<details>
<summary><b>Knowledge Capture</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit gotcha <skill> "wrong" "right" "why"` | Direct gotcha capture |
| `archkit gotcha --interactive` | Guided gotcha wizard |
| `archkit gotcha --debrief` | 4-question session debrief |
| `archkit gotcha --list` | All skills + gotcha counts (JSON) |
| `archkit gotcha --json <skill> "wrong" "right" "why"` | JSON output (agent-callable) |
| `archkit gotcha --debrief --json '{...}'` | Non-interactive debrief (agent-callable) |

</details>

<details>
<summary><b>Health & Maintenance</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit stats` | Health dashboard (0-100 score) |
| `archkit stats --compact` | One-line health summary |
| `archkit drift [--json]` | Detect stale/orphaned .arch/ files |
| `archkit sync [src-dir]` | Detect code changes needing .arch/ updates |

</details>

<details>
<summary><b>Export to Other Tools</b></summary>

| Command | Output |
|---------|--------|
| `archkit export cursor` | `.cursorrules` |
| `archkit export windsurf` | `.windsurfrules` |
| `archkit export copilot` | `.github/copilot-instructions.md` |
| `archkit export aider` | `.aider-conventions.md` |
| `archkit export all` | All of the above |

</details>

<details>
<summary><b>Extensions & Security</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit extend create` | Interactive extension builder |
| `archkit extend create --from-preset <name>` | Install from preset |
| `archkit extend run <name> [args]` | Run an extension |
| `archkit extend list` | List installed extensions |
| `archkit guard validate <file>` | Validate extension (22-rule security gate) |
| `archkit guard audit` | Full .arch/ security audit |

</details>

<details>
<summary><b>Marketplace</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit market search <query>` | Search community configs |
| `archkit market install <config>` | Install a community config |
| `archkit market login` | Authenticate for publishing |

</details>

---

## Key Features

**Built-in Gotcha Database** -- Skills come pre-populated with real WRONG/RIGHT/WHY entries for PostgreSQL, Prisma, Stripe, BullMQ, Valkey, Keycloak, Docker, and JWT. No empty skeletons on day 1.

**Synonym Expansion** -- Context resolution expands prompts across 24 synonym groups. "payment" matches "billing", "authenticate" matches "auth", "database" matches "db".

**Token Budgeting** -- Every generated file shows its token cost. Always-loaded context is monitored:

| | Tokens | |
|---|---|---|
| EFFICIENT | < 1,000 | Minimal overhead |
| MODERATE | 1,000 - 2,000 | Good for always-loaded |
| HIGH | 2,000 - 3,000 | Consider trimming |
| OVER BUDGET | > 3,000 | Use CONTEXT.compact.md |

**Works Everywhere** -- Export to Cursor, Windsurf, Copilot, Aider, or use natively with Claude Code.

---

## Upgrading from 1.0

```bash
archkit update              # Get latest code
archkit migrate --dry-run   # Preview changes (safe)
archkit migrate             # Apply upgrade
```

Migration preserves all user content (gotchas, rules, cross-refs) while adding BOUNDARIES.md, CONTEXT.compact.md, built-in gotchas, session management, and archkit-protocol skill.

---

<div align="center">

[Website](https://thearchkit.com) &bull; [Marketplace](https://market.thearchkit.com) &bull; [GitHub Issues](https://github.com/kenandrewmiranda/archkit/issues)

MIT License

</div>
