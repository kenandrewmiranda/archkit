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

archkit compiles your architecture into a machine-readable blueprint — graphs, playbooks, API contracts, and guardrails — so AI agents produce code that fits your system instead of fighting it.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)]()
[![Version](https://img.shields.io/badge/version-1.10.1-cyan.svg)]()
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
  |              |        |  playbooks/   gotchas     |        |               |
  +--------------+        |  apis/        contracts   |        +---------------+
                          |  lenses/      overlays    |
                          +---------------------------+
```

---

## Highlights

- **Clear Goal Run (CGR)** *(v1.7+)* — decompose a sprawling ask into discrete, one-per-fresh-context goals, then advance the queue with a single keystroke. A goal-aware Stop hook keeps the agent on the current goal until its exit-criteria are met. [See below](#clear-goal-run-cgr).
- **Full MCP server** — **31 tools** (review, resolve, drift, doctor, boundaries, decisions, goals…), **5 prompts** (the CGR relay slash commands), and **MCP resources** (`@archkit:` handles for `.arch/` source). Native for Claude Code, Cursor, Continue.
- **CGR test gate + deferred-goal proposals** *(v1.9)* — every goal carries an auto-detected `verify-command`, and `archkit_goal_complete` refuses to finish a goal whose tests are red. Follow-up work spotted mid-goal is captured as a **proposed** goal (`archkit_goal_defer` + Stop-hook auto-drafting) and reviewed later instead of lost. [See below](#the-test-gate-v19).
- **Continuous-guardrail hooks** *(v1.6+)* — SessionStart, UserPromptSubmit, PostToolUse, and a goal-aware Stop hook fire every turn so archkit stays in working memory even on long sessions. Self-installing via `archkit_install_hooks` or the plugin.
- **Static review engine** — categorized check modules (imports, DB, API, frontend, event, cache/queue, production, completeness, app-specific) with required-justification suppression and language gating.
- **Live runtime signal** — `preflight` surfaces recent commits, scoped gotchas, active drift, and **related ADRs** per feature/layer, so agents see current state and prior decisions, not yesterday's snapshot.
- **Institutional memory** — log architectural decisions (`archkit_log_decision`) and read them back (`archkit_decisions_search`) so settled choices survive context resets.
- **Lean footprint** — 1 runtime dependency (`inquirer`), 82 source modules, 49 integration test suites.

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

### Install — Claude Code plugin (recommended)

If you use Claude Code, install archkit as a plugin so the MCP server, SessionStart hook, and `/archkit-init` wizard land as one atomic unit. Plugin install handles MCP registration for you — no `claude mcp add` step.

```bash
# In Claude Code (slash commands):
/plugin marketplace add kenandrewmiranda/archkit
/plugin install archkit@thearchkit

# …or from your shell:
claude plugin marketplace add kenandrewmiranda/archkit
claude plugin install archkit@thearchkit
```

> The GitHub-repo source above always works. The branded URL `https://market.thearchkit.com/marketplace.json` resolves to the same manifest once the marketplace is deployed — add it the same way (note: it must be the full `.json` URL; a bare domain is interpreted as a git repo).

Then restart Claude Code (or run `/plugin`) so the MCP server, four guardrail hooks, and `/archkit-init` wizard load.

The plugin includes:

- **MCP server** — all 31 `archkit_*` tools, the 5 CGR relay prompts, and `@archkit:` resources
- **Four guardrail hooks** — SessionStart, UserPromptSubmit, PostToolUse, and the goal-aware Stop hook (wired automatically; no `archkit_install_hooks` step needed)
- **`/archkit-init` wizard** + bundled archetype skeletons — nine archetypes (saas, internal, content, ecommerce, ai, mobile, realtime, data) plus a generic fallback

### Install — npm (Cursor, Continue, CI, or Claude Code without plugins)

```bash
# From GitHub (recommended — always the latest release):
npm install -g github:kenandrewmiranda/archkit
# …or pin a tag:  npm install -g github:kenandrewmiranda/archkit#v1.17.0

# From the npm registry (currently pinned at 1.15.0 — see note):
npm install -g @kenandrewmiranda/archkit
```

> **Install from GitHub for the latest version.** npm registry publishing is paused on an unresolved account-side hold, so the registry sits at **1.15.0** while GitHub tracks the current release. archkit is pure ESM with no build step, so `npm i -g github:kenandrewmiranda/archkit` installs the `archkit` CLI and all hook bins directly from the repo. (Claude Code **plugin** users are unaffected — the plugin already installs from GitHub.)

> The npm package is scoped (`@kenandrewmiranda/archkit`) because the bare name `archkit` collides with an existing package — but it still installs the `archkit` CLI command.

Registers seven bins on your `PATH`: `archkit` (CLI), `archkit-mcp` (MCP server), and the hook executables `archkit-session-start`, `archkit-stop-hook`, `archkit-posttooluse-hook`, `archkit-userpromptsubmit-hook`, and the legacy `archkit-claude-hook`.

### Wire it up to Claude Code (npm install path)

```bash
cd <your-project>
archkit init --install-hooks --claude --mcp
```

This does three things:

1. Generates `.arch/` from an interactive wizard (or reverse-engineers it from your existing repo).
2. Writes `.claude/settings.json` with the legacy SessionStart + PreToolUse hooks. **For the full v1.6+ guardrail set (including the CGR Stop relay guard), then call `archkit_install_hooks` once the MCP server is connected** — `archkit init --install-hooks` predates those hooks.
3. Registers archkit as an MCP server via `claude mcp add archkit archkit-mcp --scope user` so Claude Code starts the server on every session.

**Restart Claude Code after running this** — it picks up the MCP server on session start, not mid-session. After restart, `/mcp` should show `archkit ✓ Connected`.

(Skip this step entirely if you installed via the Claude Code plugin — the plugin manifest registers the MCP server and hook automatically.)

### What the hooks do

archkit ships four hooks. The first names archkit; the next three are what v1.6 calls the **continuous-guardrail layer** — they fire on every prompt, every tool call, and every assistant turn so the agent's habits get nudged toward archkit even on long-running sessions where the SessionStart context has decayed out of working memory.

- **SessionStart** — on attach to a project that has `.arch/SYSTEM.md`, injects a tools digest pointing the agent at `archkit_resolve_warmup` as the first call for spec/structure questions. Greenfield projects (no `.arch/`) get a setup nudge to call `archkit_init`.
- **UserPromptSubmit** *(v1.6)* — before each user prompt is processed, keyword-matches the prompt against `.arch/INDEX.md`. If two or more keywords hit a feature node or skill, prepends a routing reminder and a specific call-to-action (`archkit_resolve_lookup` with the matched symbol). Highest-leverage hook for the v1.6 utilization goal because it fires before the agent reasons.
- **PostToolUse** *(v1.6)* — after every tool call, increments the session-stats counter (the data behind the utilization metric). For Edit/Write/MultiEdit on source files inside `src/`, runs `archkit_review` inline and surfaces the top findings as additional context.
- **Stop** *(v1.6, extended v1.8)* — after every assistant turn, surfaces the current archkit utilization rate (per-task primary + per-session secondary), re-injects a compact form of `.arch/BOUNDARIES.md` (NEVER lines only) to keep rules fresh after Claude Code's context compression, scans the response for boundary violations (SQL string concat, hardcoded credentials, unvalidated `req.body`), and auto-drafts proposed ADRs from decision-language to `.arch/decisions/proposed/<hash>.json` for human review. **v1.8 adds the CGR relay guard:** when a goal is in-progress, the hook blocks stopping (with the unmet exit-criteria as the reason) until the agent calls `archkit_goal_complete` — with question-to-user detection and a per-goal turn cap so it never traps the agent.

> **Installing the guardrail hooks:** the Claude Code **plugin** bundles all four automatically. On an npm install, call **`archkit_install_hooks`** (or `apply:true`) to wire them into your project's `.claude/settings.json`. Note: `archkit init --install-hooks` predates the v1.6 set and only wires SessionStart + the legacy PreToolUse guard — use `archkit_install_hooks` for the full set including the Stop relay guard. `archkit_doctor` flags when they're missing.

> **`.claude/settings.json` is portable and committable** *(v1.9+)*. `archkit_install_hooks` emits hook commands in portable form — `node $CLAUDE_PROJECT_DIR/bin/archkit-*.mjs` when archkit's bins live in the project tree, otherwise the bare bin name resolved via PATH — never a machine-specific absolute path like `node /Users/you/.../bin/x.mjs`. That means you can **commit `.claude/settings.json`** and the whole team shares one guardrail config that resolves correctly on a fresh clone. Keep `.claude/settings.local.json` gitignored for per-machine overrides.

The v1.6 utilization goal — agents should consult `archkit_resolve_preflight` or `archkit_resolve_lookup` *before* the first edit on a task. Compound metric:

- **Per-task** (primary, target ≥75%): of editing tasks in a session, what fraction called preflight/lookup before the first Edit? A task starts on each user prompt; it's "instrumented" only if the preflight call happens *before* the first edit, not after.
- **Per-session** (secondary): archkit MCP calls divided by the count of Edit + Read + Glob + Grep calls. Noisier signal that scales with session length.

Both numbers are surfaced by the Stop hook every turn. Below target → the hook adds a specific reminder pointing at the next preflight to call.

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

### Available tools (31)

**Resolve & scaffold**
- `archkit_init` — greenfield setup; returns the wizard inline
- `archkit_resolve_warmup` — pre-session health check
- `archkit_resolve_preflight` — verify a feature/layer before coding (recent commits, scoped gotchas, drift, **related ADRs**, required-reading playbooks)
- `archkit_resolve_scaffold` — new-feature checklist
- `archkit_resolve_lookup` — look up a node, playbook, or cluster by id

**Review & boundaries**
- `archkit_review` / `archkit_review_staged` — review files / git-staged files against rules + gotchas
- `archkit_boundary_check` — enforce `BAN: source -> target` directives from `BOUNDARIES.md`
- `archkit_boundary_propose` — queue a new BAN for human review (capture-symmetry with gotchas)

**Health**
- `archkit_drift` — detect stale/orphaned `.arch/` files
- `archkit_stats` — health dashboard data
- `archkit_doctor` — workflow logistic gauge (is `.arch/` actually load-bearing? are the hooks installed?)

**Knowledge & decisions**
- `archkit_gotcha_propose` / `archkit_gotcha_list` — propose / list package gotchas
- `archkit_log_decision` — append an ADR to `.arch/decisions/`
- `archkit_decisions_search` — read/search past ADRs (closes the institutional-memory loop)
- `archkit_prd_check` — detect a PRD and check it against `.arch/SYSTEM.md`

**Clear Goal Run (CGR)**
- `archkit_goal_intake` — decompose an ask into discrete goals
- `archkit_goal_list` / `archkit_goal_show` / `archkit_goal_payload` — inspect the queue
- `archkit_goal_testing` — park an edited goal as **testing** (edits applied, verification pending — stays guarded, not done)
- `archkit_goal_hold` — set a goal aside as **on-hold** (deliberately parked, guard released, resumable)
- `archkit_goal_verify` — evidence a goal is done (no auto-complete)
- `archkit_goal_complete` / `archkit_goal_abandon` — finish / drop a goal, advance the queue
- `archkit_goal_consolidate` — fold completed goals into a dated digest, archiving raw CGRs verbatim
- `archkit_goal_defer` — stash a follow-up you spotted mid-session as a **proposed** goal (out of scope now, reviewed later)
- `archkit_goal_promote` / `archkit_goal_dismiss` — promote selected proposals into planned goals, or reject them

**Setup**
- `archkit_install_hooks` — detect + install the four guardrail hooks into `.claude/settings.json`

### Prompts (slash commands)

The CGR relay surfaces as **user-typed** slash commands (prompts are user-initiated; the agent can't invoke them — which is exactly why they pair with `/clear`). The **day-to-day loop is just three commands**:

- `/mcp__archkit__intake` — decompose a sprawling ask into discrete goals + parallel lanes
- `/clear` — reset the context window (built-in)
- `/mcp__archkit__conductor` — **the one relay command.** Folds the board and auto-picks: works the next single goal in the foreground, or orchestrates parallel lanes (spawn workers, merge queue) when the board has them

Secondary (not part of the core loop):

- `/mcp__archkit__goal_resume` — re-inject the active goal without changing state
- `/mcp__archkit__goal_status` — queue orientation
- `/mcp__archkit__goal_review` — review follow-up goals proposed in prior sessions and choose which to promote

### Resources

`.arch/` artifacts as `@archkit:` handles — referenced by URI, no tool round-trip:

- `archkit://system`, `archkit://index`, `archkit://boundaries`
- `archkit://playbook/{id}` (alias `archkit://skill/{id}`), `archkit://decision/{number}`

All tools return structured JSON in MCP `text` content with a `nextStep` field naming the next action. Empty results carry a `<field>Note` explaining what was checked. Errors flow through `isError: true` with the standard archkit envelope (`code`, `message`, `suggestion`, `docsUrl`).

---

## Clear Goal Run (CGR)

A long agent session accumulates context, drifts off-task, and re-litigates settled decisions. CGR is archkit's answer: **decompose a sprawling ask into discrete goals, run each in a fresh context, and let archkit keep the agent honest.**

```
  you: <a big, multi-part ask>
   |
   v
  /mcp__archkit__intake      decompose into goals/<slug>.md (exit-criteria) + lanes
   |
   v
  you: /clear                fresh context window
  you: /mcp__archkit__conductor   <- one command: works the next goal, or
   |                                  orchestrates parallel lanes if the board has them
   v
  agent works the goal ...
  Stop hook: exit-criteria unmet? -> keep going.   met? -> release.
   |
   v
  archkit_goal_complete      archive, advance the queue
   |
   '--> /clear + /mcp__archkit__conductor  (repeat until the queue is empty)
```

- **Fresh context per goal.** Each goal starts in a `/clear`'d window, so the agent isn't dragging an entire session's noise into focused work.
- **One command to advance.** `/mcp__archkit__conductor` marks the next goal in-progress and injects its payload (or, when independent lanes exist, runs the orchestration pass) — replacing the old copy-paste-after-`/goal` step (still available as a fallback).
- **A goal-aware Stop hook** blocks stopping while a goal's exit-criteria are unmet, and releases when the agent calls `archkit_goal_complete`. It won't trap a genuine question to you, and a per-goal turn cap prevents runaway loops. It only fires for relay-started goals — plain sessions are untouched.
- **Verify before you finish.** `archkit_goal_verify` reports objective evidence (which planned files changed, what a staged review finds) so "done" isn't just a vibe. `archkit_goal_abandon` drops a mis-scoped goal without marking it complete.
- **Finalization goal** *(cgr.finalize)*. Once configured, intake auto-appends a wrap-up goal that runs **last and solo** — update the changelog, refresh docs, finalize commits, and the opt-in push / release / deploy-to-dev — so a sprawling ask closes out its release chores in a fresh context. A project's first intake asks you once which steps to enable (saved to `.arch/config.json` → `cgr.finalize`); reconfigure or opt out anytime with `archkit_finalize_config` or `archkit finalize`. Defaults: changelog/docs/commit on, outward steps off. archkit emits the steps as exit-criteria — it never runs git/deploy itself.

### The goal lifecycle

A goal moves through a small, explicit set of states (the `status:` field in the goal file is the single source of truth — see ADR 0003):

```
  pending ──▶ in-progress ──▶ testing ──▶ completed
                  │              ▲            │
                  │ (set aside)  │ (resume)   ▼
                  └──▶ on-hold ──┘        consolidation
                       │                  (dated digest +
                       └──▶ abandoned      raw archive)
```

- **pending** — decomposed and queued, not started. (Existing goal files using `planned` keep working — it's an accepted alias.)
- **in-progress** — actively being worked; the Stop-hook relay guard is engaged.
- **testing** *(v1.10.0)* — edits applied, **verification still pending**. This is the antidote to premature completion: instead of `archkit_goal_complete`-ing the moment a fast mass-edit lands (hiding unverified work in `done/`), call `archkit_goal_testing` to park it as **visible debt** in `.arch/goals/testing/`. A testing goal survives `/clear` and stays guarded — it is *not* done until a later session runs its `verify-command` green and completes it.
- **completed** — terminal success, archived to `.arch/goals/done/`. (Internally `done`; reconciled to `completed` in the lifecycle vocabulary.)
- **on-hold** *(v1.10.0)* — a real, queued goal **deliberately set aside** via `archkit_goal_hold`. Unlike `testing`, parking *releases* the guard so the session can end, and the goal isn't auto-selected ahead of pending/testing work — `/mcp__archkit__conductor` resumes it (back to in-progress) only once nothing live is left. Distinct from a **proposed** follow-up (`archkit_goal_defer`), which isn't a queued goal at all.
- **abandoned** — terminal drop without success (`archkit_goal_abandon`).

**Scan ordering.** `/mcp__archkit__conductor` resumes an in-progress goal first, then prefers **pending** work until the testing backlog crosses a configurable threshold (`.arch/config.json` → `cgr.backlogThreshold`, default 5 items / 7 days), at which point it switches to **draining testing** before the verification debt grows unbounded. On-hold goals are offered last.

**Consolidation.** At queue-drain (after `archkit_goal_complete`) and session-end (the Stop hook) — or on demand via `archkit_goal_consolidate` — terminal goals are folded into a dated per-day **digest** (`.arch/goals/done/digest/<date>.md`) and each raw CGR is preserved verbatim under `.arch/goals/done/archive/<slug>.md` so full context stays recoverable. Digests are discoverable through `archkit_goal_list`.

### The test gate (v1.9)

"Done" should provably mean **tests pass**, not just that the agent says so. CGR bakes a test confirmation into every goal:

- **Auto-detected verify-command.** At `archkit_goal_intake`, archkit detects the project's test command — it reads `package.json` → `scripts.test` and picks the runner from the lockfile (`pnpm` / `yarn` / `bun` / `npm test`) — and stamps it onto every goal as `verify-command`. You can override it per goal in the goal's frontmatter, or it's skipped entirely for projects with no real test script (so they aren't blocked on a command that can't run).
- **Hard gate on completion.** `archkit_goal_complete` re-runs the `verify-command` and **refuses to complete a goal whose tests are red** (or whose command can't run). A failing gate returns the failing output tail so the agent knows what to fix; the escape hatch for a genuinely-obsolete goal is `archkit_goal_abandon`, not completion.
- **Cheap preview.** `archkit_goal_verify` runs the same command as a non-authoritative dry run, so you can see green/red before calling complete.

### Deferred-goal proposals (v1.9)

Worthwhile work you notice mid-goal shouldn't derail the current goal or get lost in a code TODO. CGR captures it as a **proposed** goal that survives context resets and is surfaced for explicit confirmation later:

- **Propose.** Two sources feed `.arch/goals/proposed/`: the agent calls `archkit_goal_defer` the moment it spots out-of-scope follow-up work (supplying a real title + exit-criteria), and the Stop hook auto-drafts proposals when it detects deferral language in a turn ("out of scope for this PR", "follow-up: wire up retries", "in a separate goal"). Detection is high-precision — exploratory "should we…?" questions are filtered out. Neither is a real goal yet; the active goal and queue are untouched.
- **Review.** In a later session, `/mcp__archkit__goal_review` lists the pending proposals and drives a multi-select so you pick which to act on.
- **Promote / dismiss.** `archkit_goal_promote` turns the selected proposals into planned goals the CGR queue will pick up; `archkit_goal_dismiss` rejects the rest. Anything you neither promote nor dismiss stays pending for next time.

> CGR works best with the guardrail hooks installed (so the Stop guard fires). Install via the Claude Code plugin, or call `archkit_install_hooks` in your project.

---

## How It Works

Within a single goal, archkit's agent workflow is a six-step loop, each step exposed as an agent-callable command.

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
|-- INDEX.md               # Keyword -> node/playbook routing + cross-refs   ~400-800 tokens
|-- clusters/*.graph       # Architecture graphs (Key-Rel-Dep v2)            ~100 each
|-- playbooks/*.playbook   # Package gotchas — WRONG / RIGHT / WHY           ~200 each
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

**Live runtime lens.** `preflight` merges three perspectives at query time: recent git activity on the feature path, gotchas scoped to the affected playbook, and active drift. The agent sees a 1-second view of current repository state rather than the stale snapshot a compiled file would provide.

**Token budgeting.** Every generated file declares its cost; the `stats` command enforces ceilings on always-loaded context. `CONTEXT.compact.md` (500-token) is a cost-downgrade for cheap models.

**Extension safety.** Third-party extensions pass a 22-rule security gate (`archkit guard validate`) that enforces sandbox invariants — no `process.exit`, no network writes, no path traversal, no shell eval. `archkit guard audit` runs the full `.arch/` audit.

**Knowledge feedback loop.** Agents propose gotchas via `gotcha --propose`, which queue for human review (`gotcha --review`) before entering the canonical playbook. This prevents noise without blocking capture.

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
| `archkit init --skills <a,b,c>` | Override auto-detected playbooks (flag name kept for back-compat) |
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
| `archkit resolve lookup <id>` | Look up any node, playbook, or cluster |
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
| `archkit boundary-check [--staged\|--diff\|<files>]` | Enforce `BAN: source -> target` directives from `BOUNDARIES.md` |

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
| `archkit gotcha --list [--json]` | All playbooks + counts |
| `archkit gotcha --propose --skill <pkg> ...` | Agent-queued proposal |
| `archkit gotcha --list-proposals [--json]` | List pending proposals |
| `archkit gotcha --review` | Interactive accept/edit/reject |

</details>

<details>
<summary><b>Clear Goal Run (CGR)</b> — one goal per fresh context</summary>

| Command | What it does |
|---------|--------------|
| `archkit goal list` | Show active + done goals |
| `archkit goal show <slug>` | Print a goal's full markdown |
| `archkit goal payload <slug>` | Print the copy-paste payload (fallback for the relay prompt) |
| `archkit goal complete <slug> [--notes X]` | Mark done, archive, advance the queue |
| `archkit goal intake --json '<json>'` | Accept a decomposed-goals payload (agent driver) |

Most CGR usage is via MCP: `/mcp__archkit__intake` to decompose, then `/clear` + `/mcp__archkit__conductor` to advance, plus `archkit_goal_verify` / `archkit_goal_abandon`. See [Clear Goal Run](#clear-goal-run-cgr).

</details>

<details>
<summary><b>Decisions (ADRs)</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit decisions log --json '<json>'` | Append an ADR to `.arch/decisions/` (MCP: `archkit_log_decision`) |
| `archkit decisions list [--json]` | List recent ADRs |
| `archkit decisions search <terms> [--json]` | Keyword-rank ADRs (MCP: `archkit_decisions_search`) |

</details>

<details>
<summary><b>Health, drift &amp; export</b></summary>

| Command | What it does |
|---------|--------------|
| `archkit stats [--compact] [--json]` | Health dashboard (0–100 score) |
| `archkit drift [--json]` | Detect stale/orphaned `.arch/` files |
| `archkit doctor [--json]` | Workflow logistic gauge — warmup + drift + intent + hook-install checks |
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
