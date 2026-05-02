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

### Context Engineering for AI Coding Agents

archkit compiles your architecture into a machine-readable blueprint — graphs, skills, API contracts, and guardrails — so AI agents produce code that fits your system instead of fighting it.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)]()
[![Version](https://img.shields.io/badge/version-1.3.0-cyan.svg)]()
[![Runtime deps](https://img.shields.io/badge/runtime%20deps-1-lightgrey.svg)]()

[Website](https://thearchkit.com) · [Marketplace](https://market.thearchkit.com) · [Issues](https://github.com/kenandrewmiranda/archkit/issues)

</div>

---

## The Problem

AI coding agents generate code that works in isolation but doesn't fit. They don't know your layer boundaries, naming conventions, package gotchas, or API contracts — so you end up reviewing and rewriting what was supposed to save you time.

archkit solves this by compiling your architecture into structured files the agent reads *before* writing a single line.

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

## Highlights

- **Agent-callable CLI** — every command returns structured JSON on stdout; human logs strictly on stderr. Drop-in for Claude, Cursor, Copilot, Aider, Windsurf.
- **8 application archetypes** — SaaS, e-commerce, real-time, data/analytics, AI-powered, mobile, internal tools, content/CMS. Each ships with tailored rules and review checks.
- **Static review engine** — 9 categorized check modules (imports, DB, API, frontend, event, cache/queue, production, completeness, app-specific) with required-justification suppression.
- **Live runtime signal** — `preflight` surfaces recent commits, scoped gotchas, and active drift per feature/layer so agents see current state, not yesterday's snapshot.
- **Token-budgeted output** — every generated file declares its token cost; always-loaded context stays under budget.
- **First-class Claude Code integration** — emits `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, a pre-commit review hook, and a PreToolUse guard.
- **Lean footprint** — 1 runtime dependency (`inquirer`), ~10k LOC across 54 modules, 16 integration test suites.

---

## Quick Start

```bash
git clone https://github.com/kenandrewmiranda/archkit.git
cd archkit && npm install
npm link                   # expose the archkit CLI globally

# Greenfield — 7-step interactive wizard
archkit

# Existing codebase — auto-detect architecture
archkit init

# With Claude Code native integration
archkit --claude
```

> `archkit --claude` emits `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, a pre-commit review hook, and a PreToolUse guard — fully integrated out of the box.

---

## MCP server (Claude Code, Cursor, Continue)

archkit ships a Model Context Protocol server so AI agents can call archkit's review/resolve/stats tools natively, without shell-outs.

### Install

```bash
npm install -g archkit
```

Registers four bins on your `PATH`: `archkit` (CLI), `archkit-mcp` (MCP server), `archkit-claude-hook` (PreToolUse drift guard), `archkit-session-start` (SessionStart context nudge).

### Wire it up to Claude Code

```bash
cd <your-project>
archkit init --install-hooks --claude --mcp
```

This does three things:

1. Generates `.arch/` from an interactive wizard (or reverse-engineers it from your existing repo).
2. Writes `.claude/settings.json` with PreToolUse + SessionStart hooks.
3. Registers archkit as an MCP server via `claude mcp add archkit archkit-mcp --scope user` so Claude Code starts the server on every session.

**Restart Claude Code after running this** — it picks up the MCP server on session start, not mid-session. After restart, `/mcp` should show `archkit ✓ Connected`.

### What the hooks do

- **SessionStart** — when Claude Code attaches to a project that has `.arch/SYSTEM.md`, the hook injects context naming `archkit_resolve_warmup` as the first call for spec/structure questions. Without this, agents tend to read `.arch/*.md` directly and miss the structured digest the MCP tools return.
- **PreToolUse** — when an Edit/Write/MultiEdit targets a path under `src/features/...` or similar, the hook runs `archkit resolve preflight` and surfaces drift findings to the agent before the edit lands.

### Manual MCP registration

If `archkit init --mcp` fails (e.g. `claude` CLI not on `PATH`), register manually:

```bash
claude mcp add archkit archkit-mcp --scope user
```

### Cursor / Continue

Other MCP-capable clients can run the server directly. Add to your client's MCP config:

```json
{
  "mcpServers": {
    "archkit": {
      "command": "archkit-mcp",
      "args": []
    }
  }
}
```

### Available tools

- `archkit_review` — review files against rules and gotchas
- `archkit_review_staged` — review git-staged files
- `archkit_resolve_warmup` — pre-session health check
- `archkit_resolve_preflight` — verify a feature/layer before coding
- `archkit_resolve_scaffold` — get a new-feature checklist
- `archkit_resolve_lookup` — look up a node, skill, or cluster by id
- `archkit_gotcha_propose` — queue a gotcha proposal
- `archkit_gotcha_list` — list skills with gotcha counts
- `archkit_stats` — health dashboard data
- `archkit_drift` — detect stale `.arch/` files

All tools return structured JSON in MCP `text` content. Errors flow through `isError: true` with the standard archkit envelope (`code`, `message`, `suggestion`, `docsUrl`).

---

## How It Works

archkit's agent workflow is a six-step loop, each step exposed as an agent-callable command.

```
  +----------------------------------------------------------------------+
  |                          Agent Workflow                              |
  |                                                                      |
  |   1. WARMUP        archkit resolve warmup                            |
  |      |               \-- health check, blockers, warnings            |
  |      v                                                               |
  |   2. PREFLIGHT     archkit resolve preflight <feature> <layer>       |
  |      |               \-- recent commits, scoped gotchas, drift       |
  |      v                                                               |
  |   3. SCAFFOLD      archkit resolve scaffold <feature>                |
  |      |               \-- source skeleton with AGENT-VALIDATION       |
  |      v                                                               |
  |   4. CODE          agent writes implementation                       |
  |      |                                                               |
  |      v                                                               |
  |   5. REVIEW        archkit review --staged --json                    |
  |      |               \-- violations, autofixes, suggestions          |
  |      v                                                               |
  |   6. LEARN         archkit gotcha --propose ...                      |
  |                      \-- captured as WRONG/RIGHT/WHY for next run    |
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
|-- INDEX.md               # Keyword -> node/skill routing + cross-refs      ~400-800 tokens
|-- clusters/*.graph       # Architecture graphs (Key-Rel-Dep v2)            ~100 each
|-- skills/*.skill         # Package gotchas — WRONG / RIGHT / WHY           ~200 each
|-- apis/*.api             # API contract digest stubs                       ~100 each
\-- lenses/*.md            # Research / Implement / Review overlays          ~150 each
```

### Claude Code Native (`--claude`)

```
CLAUDE.md                              # Auto-loaded every session (<200 lines)
.claude/
|-- rules/
|   |-- architecture.md                # alwaysApply — architecture rules
|   \-- [feature].md                   # Path-targeted — loads per feature
|-- skills/
|   |-- [package]/SKILL.md             # On-demand package knowledge
|   \-- archkit-protocol/SKILL.md      # Workflow → archkit command mapping
\-- settings.json                      # Pre-commit review hook + PreToolUse guard
```

---

## Architecture Archetypes

archkit detects or asks for your application type and tailors rules, review logic, and defaults.

| Type | Pattern | Review Focus |
|------|---------|-------------|
| **SaaS / B2B** | Layered + Modular Monolith | DB-in-controller, cross-feature imports, tenant scoping, money floats |
| **E-Commerce** | Layered + Event-Driven | + inventory locking, payment idempotency |
| **Real-Time** | Event-Driven + Gateway | DB-in-handler, I/O-in-domain, handler complexity |
| **Data / Analytics** | CQRS (Pipeline → Semantic → API) | Direct DB in API layer, pipeline side effects |
| **AI-Powered** | Hexagonal + Pipeline Chains | Hardcoded LLM providers, inline prompts, missing guardrails |
| **Mobile** | MVVM (Screen → Hook → Service) | Logic-in-screens, direct API calls in views |
| **Internal Tools** | Simple Layered | Destructive actions without audit, unmasked PII |
| **Content / CMS** | Static Gen + Islands | Unoptimized images, client JS in static pages, missing SEO |

---

## Technical Design

**Agent-first CLI.** stdout is exclusively structured data (JSON, NDJSON); human logs go to stderr. Every command is safely pipeable into agent tool loops without parsing human output.

**Static review engine.** Nine check modules apply rules to staged or arbitrary files and return findings with stable IDs (`floating-promise`, `boundary-violation`, `mock-data-leftover`, …). Architecture-critical rules are un-suppressible; others require a substantive reason — `// archkit: ignore <id> — <why>` — and vague reasons (`"fixed"`, `"n/a"`) are themselves flagged as `weak-suppression`.

**Live runtime lens.** `preflight` merges three perspectives at query time: recent git activity on the feature path, gotchas scoped to the affected skill, and active drift. The agent sees a 1-second view of current repository state rather than the stale snapshot a compiled file would provide.

**Token budgeting.** Every generated file declares its cost; the `stats` command enforces ceilings on always-loaded context. `CONTEXT.compact.md` (500-token) is a cost-downgrade for cheap models.

**Extension safety.** Third-party extensions pass a 22-rule security gate (`archkit guard validate`) that enforces sandbox invariants — no `process.exit`, no network writes, no path traversal, no shell eval. `archkit guard audit` runs the full `.arch/` audit.

**Knowledge feedback loop.** Agents propose gotchas via `gotcha --propose`, which queue for human review (`gotcha --review`) before entering the canonical skill. This prevents noise without blocking capture.

---

## Command Reference

<details>
<summary><b>Scaffold &amp; setup</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit` | Interactive wizard with save/load/back/exit |
| `archkit --claude` | + CLAUDE.md, `.claude/rules/`, `.claude/skills/`, hooks |
| `archkit init [src-dir]` | Auto-detect architecture from codebase |
| `archkit init --json` | Detection only, no file generation |
| `archkit init --agent-scaffold` | Stub `.arch/` with AI-fillable templates |
| `archkit init --install-hooks` | Install git pre-commit drift hook |
| `archkit init --install-hooks --claude` | Install git + Claude Code PreToolUse hooks |
| `archkit init --install-hooks --claude-only` | Install only Claude Code hook |
| `archkit init --app-type <type>` | Override auto-detected app type |
| `archkit init --skills <a,b,c>` | Override auto-detected skills |
| `archkit migrate` | Upgrade 1.0 → 1.1 in place |
| `archkit update` | Self-update from GitHub |

</details>

<details>
<summary><b>Context resolution</b> — agent-callable JSON</summary>

| Command | What it does |
|---------|--------------|
| `archkit resolve warmup [--deep]` | Pre-session health check (blockers = stop) |
| `archkit resolve preflight <feature> <layer>` | Live runtime view: recent commits, scoped gotchas, drift |
| `archkit resolve scaffold <feature> [--apply]` | Generate source skeleton with AGENT-VALIDATION blocks (dry-run by default) |
| `archkit resolve lookup <id>` | Look up any node, skill, or cluster |
| `archkit resolve verify-wiring [src-dir]` | Detect dead code / unwired components |
| `archkit resolve audit-spec <spec.md> [src-dir]` | Check spec requirement coverage |

</details>

<details>
<summary><b>Review</b> — app-type-aware</summary>

| Command | What it does |
|---------|--------------|
| `archkit review <file>` | Review file against rules + gotchas |
| `archkit review --staged` | Review git-staged files |
| `archkit review --diff` | Review modified (unstaged) files |
| `archkit review --dir src/` | Review directory |
| `archkit review --json [file]` | Structured output with autofixes (alias: `--agent`) |
| `archkit review --verify` | Re-check only previously flagged files |

**Production-readiness checks** (introduced 1.3):

| Rule ID | Catches |
|---------|---------|
| `floating-promise` | Async calls not awaited |
| `mock-data-leftover` | `// mock data`, fake names, `Math.random()` in production |
| `dead-error-handler` | Empty catch blocks, log-and-swallow |
| `untracked-todo` | TODO without ticket/owner/date |
| `incomplete-skeleton` | Generated stubs with unticked `AGENT-VALIDATION` |

**Suppression:** `// archkit: ignore <rule-id> — <reason>` on the line above or same line. Vague reasons produce `weak-suppression`. Architecture rules are un-suppressible.

</details>

<details>
<summary><b>Knowledge capture</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit gotcha <skill> "wrong" "right" "why"` | Direct capture |
| `archkit gotcha --interactive` | Guided wizard |
| `archkit gotcha --debrief` | 4-question session debrief |
| `archkit gotcha --list [--json]` | All skills + counts |
| `archkit gotcha --propose --skill <pkg> ...` | Agent-queued proposal |
| `archkit gotcha --list-proposals [--json]` | List pending proposals |
| `archkit gotcha --review` | Interactive accept/edit/reject |

</details>

<details>
<summary><b>Health, drift &amp; export</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit stats [--compact] [--json]` | Health dashboard (0–100 score) |
| `archkit drift [--json]` | Detect stale/orphaned `.arch/` files |
| `archkit sync [src-dir]` | Detect code changes needing `.arch/` updates |
| `archkit export cursor` | `.cursorrules` |
| `archkit export windsurf` | `.windsurfrules` |
| `archkit export copilot` | `.github/copilot-instructions.md` |
| `archkit export aider` | `.aider-conventions.md` |
| `archkit export all` | All of the above |

> **Husky users:** add `exec archkit drift --json > /dev/null` to your `.husky/pre-commit`.

</details>

<details>
<summary><b>Extensions, security &amp; marketplace</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit extend create` | Interactive extension builder |
| `archkit extend create --from-preset <name>` | Install from preset |
| `archkit extend run <name> [args]` | Run an extension |
| `archkit extend list` | List installed extensions |
| `archkit guard validate <file>` | 22-rule extension security gate |
| `archkit guard audit` | Full `.arch/` security audit |
| `archkit market search <query>` | Search community configs |
| `archkit market install <config>` | Install a community config |
| `archkit market login` | Authenticate for publishing |

</details>

<details>
<summary><b>Deprecated</b> — removed in 2.0</summary>

| Command | Replacement |
|---------|-------------|
| `archkit resolve context "<prompt>"` | Read `INDEX.md` directly |
| `archkit resolve plan "<prompt>"` | Use `preflight` or read `CONTEXT.compact.md` |

</details>

---

## Tooling Interop

archkit compiles config once from `.arch/` and emits it in each tool's native format.

| Tool | Output |
|------|--------|
| Claude Code | `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, `settings.json` |
| Cursor | `.cursorrules` |
| Windsurf | `.windsurfrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Aider | `.aider-conventions.md` |

---

## Upgrading from 1.x

```bash
archkit update              # Pull latest
archkit migrate --dry-run   # Preview changes
archkit migrate             # Apply
```

Migration preserves user content (gotchas, rules, cross-refs) while adding BOUNDARIES.md, CONTEXT.compact.md, built-in gotchas, session management, and the archkit-protocol skill.

---

<div align="center">

[Website](https://thearchkit.com) · [Marketplace](https://market.thearchkit.com) · [GitHub Issues](https://github.com/kenandrewmiranda/archkit/issues)

MIT License

</div>
