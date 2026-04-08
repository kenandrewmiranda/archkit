```
      ╔══════════════════════════════════════════════╗
      ║                                              ║
      ║     ▄▀█ █▀█ █▀▀ █ █ █▄▀ █ ▀█▀              ║
      ║     █▀█ █▀▄ █▄▄ █▀█ █ █ █  █               ║
      ║                                              ║
      ║   ◆ Context Engineering for AI Agents        ║
      ║     Give AI the blueprint, then the task     ║
      ╚══════════════════════════════════════════════╝
```

**Give AI the blueprint before you give it the task.**

archkit generates a `.arch/` directory — architecture graphs, package skills, API contracts, guardrails, and rules — so AI coding agents write code that fits your system, not just code that compiles.

**Website:** [thearchkit.com](https://thearchkit.com)
**Marketplace:** [market.thearchkit.com](https://market.thearchkit.com) — browse, share, and install community configs

---

## Install

```bash
# Clone (recommended)
git clone https://github.com/kenandrewmiranda/archkit.git
cd archkit && npm install

# Or global install
npm install -g github:kenandrewmiranda/archkit

# Or one-shot
npx github:kenandrewmiranda/archkit
```

## Quick Start

```bash
archkit                     # Interactive 7-step wizard → .arch/
archkit --claude            # + Claude Code native files (hooks, skills, rules)
archkit init                # Reverse-engineer .arch/ from existing codebase
```

---

## Commands

### Scaffold & Setup

| Command | What it does |
|---------|--------------|
| `archkit` | Interactive wizard with save/load/back/exit |
| `archkit --claude` | + CLAUDE.md, .claude/rules/, .claude/skills/, hooks |
| `archkit init [src-dir]` | Auto-detect architecture from codebase |
| `archkit init src --json` | Detection only, no file generation |
| `archkit migrate` | Upgrade 1.0 → 1.1 without data loss |
| `archkit update` | Self-update from GitHub |

### Context Resolution (JSON — agent-callable)

All resolve commands return structured JSON on stdout. Logs go to stderr — safe to pipe.

| Command | What it does |
|---------|--------------|
| `archkit resolve warmup [--deep]` | Pre-session health check (blockers = stop) |
| `archkit resolve context "<prompt>"` | Map prompt → features, skills, files, rules |
| `archkit resolve preflight <feature> <layer>` | Verify target before generating code |
| `archkit resolve scaffold <feature>` | New feature checklist with embedded gotchas |
| `archkit resolve lookup <id>` | Look up any node, skill, or cluster |
| `archkit resolve plan "<prompt>"` | Ordered implementation plan |
| `archkit resolve verify-wiring [src-dir]` | Detect dead code / unwired components |
| `archkit resolve audit-spec <spec.md> [src-dir]` | Check spec requirement coverage |

### Code Review (app-type-aware)

| Command | What it does |
|---------|--------------|
| `archkit review <file>` | Review file against rules + gotchas |
| `archkit review --staged` | Review git staged files |
| `archkit review --diff` | Review modified (unstaged) files |
| `archkit review --dir src/` | Review entire directory |
| `archkit review --agent` | JSON output with autofix fields + gotcha suggestions |
| `archkit review --verify` | Re-check only previously flagged files |

Review checks vary by app type — see [App-Type Checks](#review-checks-by-app-type) below.

### Knowledge Capture

| Command | What it does |
|---------|--------------|
| `archkit gotcha <skill> "wrong" "right" "why"` | Direct gotcha capture |
| `archkit gotcha --interactive` | Guided gotcha wizard |
| `archkit gotcha --debrief` | 4-question session debrief |
| `archkit gotcha --list` | All skills + gotcha counts (JSON) |
| `archkit gotcha --json <skill> "wrong" "right" "why"` | JSON output (agent-callable) |
| `archkit gotcha --debrief --json '{...}'` | Non-interactive debrief (agent-callable) |

### Health & Maintenance

| Command | What it does |
|---------|--------------|
| `archkit stats` | Health dashboard (0–100 score) |
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

### Extensions & Security

| Command | What it does |
|---------|--------------|
| `archkit extend create` | Interactive extension builder |
| `archkit extend create --from-preset <name>` | Install from preset |
| `archkit extend run <name> [args]` | Run an extension |
| `archkit extend list` | List installed extensions |
| `archkit guard validate <file>` | Validate extension (22-rule security gate) |
| `archkit guard audit` | Full .arch/ security audit |

### Marketplace

| Command | What it does |
|---------|--------------|
| `archkit market search <query>` | Search community configs |
| `archkit market install <config>` | Install a community config |
| `archkit market login` | Authenticate for publishing |

---

## What Gets Generated

### .arch/ Directory

| File | Purpose | ~Tokens |
|------|---------|---------|
| `SYSTEM.md` | Rules, reserved words, session management, On Generate protocol | 800–1200 |
| `BOUNDARIES.md` | Hard NEVER rules (universal + app-type-specific) | 300–500 |
| `CONTEXT.compact.md` | 500-token injectable for cheap-model calls | ~500 |
| `INDEX.md` | Keyword → node/skill routing + cross-references | 400–800 |
| `clusters/*.graph` | Architecture graphs (Key-Rel-Dep v2) | ~100 each |
| `skills/*.skill` | Package gotchas — pre-populated WRONG/RIGHT/WHY | ~200 each |
| `apis/*.api` | API contract digest stubs | ~100 each |
| `lenses/*.md` | Research / Implement / Review mode overlays | ~150 each |

### Claude Code Native (`--claude`)

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Auto-loaded every session (<200 lines) |
| `.claude/rules/architecture.md` | alwaysApply — architecture rules |
| `.claude/rules/[feature].md` | Path-targeted — loads when editing that feature |
| `.claude/skills/[package]/SKILL.md` | On-demand package knowledge |
| `.claude/skills/archkit-protocol/SKILL.md` | Maps every workflow step to archkit commands |
| `.claude/settings.json` | Pre-commit review hook + warmup nudge |

---

## How It Works

### Agent Workflow

```bash
archkit resolve warmup                              # 1. Health check
archkit resolve context "add user notifications"    # 2. Get relevant files/rules
archkit resolve plan "add user notifications"       # 3. Get implementation steps
# ... write code ...
archkit review --staged --agent                     # 4. Pre-commit gate
archkit gotcha --json postgres "wrong" "right" "why"  # 5. Capture learning
```

### Synonym Expansion

Context resolution expands prompts with 24 synonym groups — "payment" matches "billing", "authenticate" matches "auth", "database" matches "db".

### Token Budget

archkit shows token estimates for every generated file and warns when always-loaded context is too heavy:

| Rating | Tokens | Guidance |
|--------|--------|----------|
| EFFICIENT | <1000 | Minimal overhead |
| MODERATE | 1000–2000 | Good for always-loaded |
| HIGH | 2000–3000 | Consider trimming |
| OVER BUDGET | >3000 | Use CONTEXT.compact.md |

### Built-in Gotcha Database

Skills come pre-populated with real WRONG/RIGHT/WHY entries for: **PostgreSQL, Prisma, Stripe, BullMQ, Valkey, Keycloak, Docker, JWT**. No empty skeletons on day 1.

---

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

### Review Checks by App Type

| App Type | What Gets Checked |
|----------|-------------------|
| SaaS | DB-in-controller, cross-feature imports, tenant scoping, money floats, layer hierarchy |
| E-Commerce | SaaS checks + inventory locking, payment idempotency |
| Realtime | DB-in-handler, I/O-in-domain, handler complexity |
| Data | Direct ClickHouse in API, pipeline side effects |
| AI | Hardcoded LLM providers, inline prompts, missing guardrails/tracing |
| Mobile | Logic-in-screens, FlatList usage, direct API calls in screens |
| Internal | Destructive actions without audit log, primary DB for reads, unmasked PII |
| Content | Unoptimized images, client-side JS in static pages, missing SEO |

---

## Upgrading from 1.0

```bash
archkit update              # Get latest code
archkit migrate --dry-run   # Preview changes (safe)
archkit migrate             # Apply upgrade
```

Migration preserves all user content (gotchas, rules, cross-refs) while adding BOUNDARIES.md, CONTEXT.compact.md, built-in gotchas, session management, and archkit-protocol skill.

---

## Community

- **Website:** [thearchkit.com](https://thearchkit.com)
- **Marketplace:** [market.thearchkit.com](https://market.thearchkit.com) — share and install community configs
- **Issues:** [github.com/kenandrewmiranda/archkit/issues](https://github.com/kenandrewmiranda/archkit/issues)

## License

MIT
