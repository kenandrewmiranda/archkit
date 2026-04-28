# archkit MCP Server — Design Spec

**Date:** 2026-04-28
**Status:** Approved (design phase complete; implementation plan to follow)
**Related:** `docs/roadmap/mcp-server.md` (roadmap note, 2026-04-18)
**Target version:** archkit v1.4.0

---

## 1. Overview & Goals

archkit today exposes its capabilities through a CLI. Every command emits structured JSON via `--json` and is therefore agent-callable. Agents reach archkit through two paths:

1. **Hooks** — `.arch/` skill files wire pre-commit and PreToolUse hooks that fire `archkit review` automatically.
2. **Skill prompts** — the `archkit-protocol` skill nudges agents to shell out to archkit commands at planning, scaffolding, and review checkpoints.

Observed gap: **agents reach for archkit ~70% of the time they should, not ~99%.** The skill-driven path depends on the agent remembering to shell out. The hook path is reactive — it fires after the agent has already picked its tool and written code. Neither influences the agent at the moment it's deciding what to do next.

An MCP server exposes archkit's capabilities as typed tools that appear next to the agent's built-in Read/Edit/Grep tools. Tool selection is influenced *at the moment the agent is deciding*, not after the fact. This is the difference between "archkit fires when I remember to call it" and "archkit fires because it's the obvious thing to call."

**Goal:** ship `archkit mcp serve` as a stdio MCP server exposing 10 tools that mirror archkit's existing CLI surface.

**Non-goals (v1):**
- HTTP/SSE transport — stdio only
- Authentication — stdio inherits process-level trust; v1 is local-only
- Remote `.arch/` access — server reads the local working directory's `.arch/`
- MCP resources or prompts — tools only in v1
- Multi-root workspace selection
- Telemetry on tool usage

**Success criterion:** dogfooding shows archkit usage moves from "~70% of where it should fire" to "~99% because it's the obvious thing to call." Verified by:
- Claude Code with archkit MCP installed reaches for `archkit_review` and `archkit_resolve_preflight` proactively during coding sessions
- Hooks remain in place but become a safety net rather than the primary trigger

---

## 2. Architecture

### 2.1 Process Model

```
┌──────────────┐  stdio  ┌─────────────────────┐
│ Claude Code  │ ◄─────► │ archkit-mcp (Node)  │
│ (MCP client) │  JSON-  │ McpServer + tools   │
└──────────────┘   RPC   └──────────┬──────────┘
                                    │ direct import
                                    ▼
                         ┌─────────────────────┐
                         │ src/commands/*.mjs  │
                         │ (exports *Json fns) │
                         └──────────┬──────────┘
                                    ▼
                         ┌─────────────────────┐
                         │ .arch/, src/, .git  │
                         │ (local fs, read-    │
                         │  mostly)            │
                         └─────────────────────┘
```

### 2.2 Repository Layout

The MCP server lives inside the existing `archkit` package — no new npm package, no monorepo split.

```
bin/
  archkit.mjs              # existing — gains `mcp serve` subcommand route
  archkit-claude-hook.mjs  # existing
  archkit-mcp.mjs          # NEW — entrypoint (forwards to src/mcp/server.mjs)

src/
  commands/                # existing — each gains a `run*Json()` export
    review.mjs
    resolve.mjs
    resolve/
      warmup.mjs
      preflight.mjs
      scaffold.mjs
    gotcha.mjs
    stats.mjs
    drift.mjs
  lib/
    errors.mjs             # NEW — ArchkitError class + error helpers
  mcp/                     # NEW — transport layer only, no business logic
    server.mjs             # McpServer wiring, lifecycle
    tools.mjs              # tool registry: name → { description, schema, handler }
    envelope.mjs           # error → MCP isError envelope mapping

package.json
  bin: { archkit, archkit-claude-hook, archkit-mcp }
  dependencies:
    inquirer: ^9.2.12                        # existing
    "@modelcontextprotocol/sdk": "^1.29.0"   # NEW
    zod: "^3"                                # NEW (input schemas for MCP tools)
```

### 2.3 Why This Shape

- **Reuses archkit's constraints:** pure Node ESM, no build step, single existing dep
- **One install for users:** they already have archkit; upgrade gives them MCP automatically
- **Two invocation paths, one implementation:** `archkit mcp serve` (subcommand) and `archkit-mcp` (bin) both load the same entrypoint
- **`src/mcp/` is thin:** transport, schema validation, and error wrapping only. All logic stays in `src/commands/` where existing tests cover it
- **Two new runtime deps:** `@modelcontextprotocol/sdk` (~1MB, pure ESM, stable) and `zod` (~50KB, pure ESM). Both load lazily — pure-CLI users pay no startup cost.

### 2.4 Versioning

- Pin to `@modelcontextprotocol/sdk@^1.29.0` (current stable as of 2026-04-28)
- v2 of the SDK is alpha-only (`2.0.0-alpha.2` shipped 2026-04-01); migration is a future task once stable
- archkit MCP ships as part of archkit v1.4.0

---

## 3. Tool Surface

Ten tools, all `archkit_<verb>` snake_case, registered in `src/mcp/tools.mjs`. Naming matches Claude Code's built-in tool convention (Read, Edit, Grep) so agent tool-picking heuristics treat them as native.

### 3.1 Tool Catalog

| Tool name | Wraps CLI | Inputs | Returns (success) |
|---|---|---|---|
| `archkit_review` | `review --json <files>` | `{ files: string[] }` | `{ files, errors, warnings, infos, clean, pass, findings, gotchaSuggestions? }` |
| `archkit_review_staged` | `review --staged --json` | `{}` | same shape as `archkit_review` |
| `archkit_resolve_warmup` | `resolve warmup --json` | `{ deep?: boolean }` | `{ pass, blockers, warnings, actions, checks }` |
| `archkit_resolve_preflight` | `resolve preflight <feature> <layer>` | `{ feature: string, layer: string }` | live runtime view (existing schema) |
| `archkit_resolve_scaffold` | `resolve scaffold <feature>` | `{ feature: string }` | scaffolding checklist |
| `archkit_resolve_lookup` | `resolve lookup <id>` | `{ id: string }` | node/skill/cluster details |
| `archkit_gotcha_propose` | `gotcha --propose ...` | `{ skill, wrong, right, why, appType? }` | `{ queued: true, proposalPath }` |
| `archkit_gotcha_list` | `gotcha --list --json` | `{}` | `{ skills: [...] }` |
| `archkit_stats` | `stats --json` | `{}` | `{ health, system, index, skills, graphs, apis, recommendations }` |
| `archkit_drift` | `drift --json` | `{}` | `{ stale, summary }` |

Output schemas exactly match the existing CLI `--json` shapes — no transformation. This means existing CLI documentation, fixtures, and tests are reusable.

### 3.2 Tool Description Discipline

Each tool's MCP `description` field is the field the agent reads at tool-pick time. It must be one sentence describing what the tool does, plus a "When to use" hint that nudges proactive usage. Examples:

```
archkit_resolve_preflight: Verify a feature/layer combination
exists and is correctly wired before generating code.
When to use: BEFORE writing or modifying code in a feature path.

archkit_review: Review one or more files against archkit rules
and gotchas, returning structured findings with severities.
When to use: AFTER editing code, BEFORE committing.

archkit_resolve_warmup: Run pre-session health checks on the
.arch/ context system. Returns blockers, warnings, and actions.
When to use: At the START of a coding session, or whenever
the agent suspects context drift.
```

Description prose is treated as production code — it's iterated on after dogfooding because reach-rate depends heavily on it.

### 3.3 Input Validation

Each tool defines a schema in `src/mcp/tools.mjs` using the MCP SDK's Standard Schema integration. Zod is the chosen schema library (specific version pinned during implementation; any modern Zod compatible with Standard Schema works). Validation happens before the handler runs. Failure surfaces as the standard error envelope with `code: "invalid_input"` (see §5).

```javascript
import { z } from "zod";

const reviewInput = z.object({
  files: z.array(z.string().min(1)).min(1, "at least one file required"),
});
```

Zod becomes a second runtime dep (alongside `inquirer` and `@modelcontextprotocol/sdk`). It's small (~50KB) and pure ESM.

### 3.4 Tool Output Format

Per MCP spec, every tool returns:

```javascript
{ content: [{ type: "text", text: JSON.stringify(result) }] }
```

The agent receives `text` as a single JSON-encoded string. This matches existing CLI `--json` output shape exactly. No multi-content responses in v1.

---

## 4. Data Flow & Refactor Plan

### 4.1 Per-Tool Execution Flow

```
client → MCP request (tools/call, name="archkit_review", args={files: [...]})
  → src/mcp/server.mjs receives
  → src/mcp/tools.mjs dispatches by name
  → validate input (Zod schema)
  → handler imports { runReviewJson } from "../commands/review.mjs"
  → const result = await runReviewJson({ files, archDir: process.cwd() })
  → src/mcp/envelope.mjs wraps: { content: [{ type:"text", text: JSON.stringify(result) }] }
  → return to client
```

On error, the handler catches and `src/mcp/envelope.mjs` produces an `isError: true` response (see §5).

### 4.2 Refactor Pattern

Today, `src/commands/review.mjs:521` already builds the JSON object inline before `console.log(JSON.stringify(...))` and `process.exit()`. The refactor extracts the build step into a pure function:

**Before:**
```javascript
// src/commands/review.mjs ~520
console.log(JSON.stringify({
  files: files.length, errors: totalErrors, warnings: totalWarnings,
  findings: allFindings, gotchaSuggestions, ...
}));
process.exit(totalErrors > 0 ? 1 : 0);
```

**After:**
```javascript
// src/commands/review.mjs
export async function runReviewJson({ files, archDir }) {
  // ...all existing logic, no console.log, no process.exit...
  return {
    files: files.length,
    errors: totalErrors,
    warnings: totalWarnings,
    infos: totalInfos,
    clean: cleanFiles,
    pass: totalErrors === 0,
    findings: allFindings,
    gotchaSuggestions: gotchaSuggestions.length > 0 ? gotchaSuggestions : undefined,
  };
}

// CLI path inside main():
if (jsonMode) {
  const result = await runReviewJson({ files, archDir });
  console.log(JSON.stringify(result));
  process.exit(result.errors > 0 ? 1 : 0);
}
```

### 4.3 Critical Constraints on `run*Json()` Functions

- **Never call `process.exit()`** — return or throw
- **Never write to stdout** — return data; CLI wrapper handles `console.log`
- **May write to stderr** for progress logging (e.g., `log.review("Reviewing...")`) — both CLI and MCP allow stderr; MCP reserves stdout for JSON-RPC
- **Throw `ArchkitError`** for known failure modes (see §5)
- **Async-safe** — even if logic is sync today, declare `async` so MCP handlers can `await` consistently

### 4.4 Refactor Sequence

Each step is one PR's worth of work, independently testable. Steps 2–9 follow the same pattern with command-specific input/output shapes.

| # | File | New export(s) |
|---|---|---|
| 1 | `src/lib/errors.mjs` | `ArchkitError` class, `archkitError(code, message, opts)` helper |
| 2 | `src/commands/review.mjs` | `runReviewJson({ files, archDir, staged?, dir? })` |
| 3 | `src/commands/resolve/warmup.mjs` | `runWarmupJson({ archDir, deep? })` |
| 4 | `src/commands/resolve/preflight.mjs` | `runPreflightJson({ archDir, feature, layer })` |
| 5 | `src/commands/resolve/scaffold.mjs` | `runScaffoldJson({ archDir, feature })` |
| 6 | `src/commands/resolve.mjs` (lookup branch) | `runLookupJson({ archDir, id })` |
| 7 | `src/commands/gotcha.mjs` | `runGotchaListJson({ archDir })`, `runGotchaProposeJson({ archDir, skill, wrong, right, why, appType? })` |
| 8 | `src/commands/stats.mjs` | `runStatsJson({ archDir })` |
| 9 | `src/commands/drift.mjs` | `runDriftJson({ archDir })` |
| 10 | `src/mcp/server.mjs` + `src/mcp/tools.mjs` + `bin/archkit-mcp.mjs` | Wire everything |

### 4.5 Backwards Compatibility

CLI behavior is unchanged. Every `archkit <cmd> --json` call produces the same stdout, same exit code, same stderr. Existing tests in `tests/review-json/`, `tests/stats-json/`, `tests/drift-fix/`, etc. continue to pass without modification.

---

## 5. Error Handling

### 5.1 Canonical Error Envelope

```typescript
type ArchkitErrorEnvelope = {
  code: string;        // machine-readable (e.g. "no_arch_dir")
  message: string;     // human-readable
  suggestion?: string; // actionable next step
  docsUrl?: string;    // anchor in archkit docs
};
```

This is the same envelope the existing CLI's JSON error paths emit. Reusing it means no new contract for agents to learn.

### 5.2 ArchkitError Class

```javascript
// src/lib/errors.mjs
export class ArchkitError extends Error {
  constructor(code, message, { suggestion, docsUrl, cause } = {}) {
    super(message, { cause });
    this.name = "ArchkitError";
    this.code = code;
    this.suggestion = suggestion;
    this.docsUrl = docsUrl;
  }
}

export function archkitError(code, message, opts) {
  return new ArchkitError(code, message, opts);
}
```

Throw site (inside a `run*Json()` function):

```javascript
throw archkitError(
  "no_arch_dir",
  "No .arch/ directory found in working directory",
  {
    suggestion: "Run `archkit init` in your project root.",
    docsUrl: "https://github.com/kenandrewmiranda/archkit#getting-started",
  }
);
```

### 5.3 MCP Handler Wrapping

```javascript
// src/mcp/envelope.mjs
import { ArchkitError } from "../lib/errors.mjs";

export function toMcpError(err) {
  const envelope = err instanceof ArchkitError
    ? {
        code: err.code,
        message: err.message,
        suggestion: err.suggestion,
        docsUrl: err.docsUrl,
      }
    : { code: "internal_error", message: err.message };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(envelope) }],
  };
}

export function toMcpResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
```

Tool handler in `src/mcp/tools.mjs`:

```javascript
async function callTool(toolName, rawInput) {
  const tool = tools[toolName];
  const parseResult = tool.schema.safeParse(rawInput);
  if (!parseResult.success) {
    return toMcpError(archkitError(
      "invalid_input",
      formatZodError(parseResult.error),
      { suggestion: "Check the tool's input schema." }
    ));
  }
  try {
    const data = await tool.handler(parseResult.data);
    return toMcpResult(data);
  } catch (err) {
    return toMcpError(err);
  }
}
```

### 5.4 Error Code Taxonomy (v1)

| Code | When |
|---|---|
| `no_arch_dir` | `.arch/` not found in `archDir` |
| `invalid_input` | Zod schema rejected input |
| `file_not_found` | Review target file missing |
| `git_not_available` | `--staged` requested outside a git repo |
| `git_no_staged` | `--staged` and no files staged |
| `feature_not_found` | preflight/scaffold target unknown |
| `node_not_found` | lookup id has no match in any cluster |
| `proposal_invalid` | gotcha_propose missing required fields |
| `internal_error` | uncaught — should never escape in practice |

New error codes added during refactor are documented in this taxonomy. Codes are additive only — never removed or renamed without a major version bump.

### 5.5 No Partial Success

If any required step fails, throw. Don't return `{ ok: false, partial: ... }`. The agent's branching stays simple: `isError` is the single signal, and the envelope tells it what went wrong and what to try next.

### 5.6 Logging vs. Errors

Stderr remains the channel for progress logging in both CLI and MCP modes. Existing `log.review(...)`, `log.resolve(...)`, etc. calls inside `run*Json()` functions are kept — they go to stderr, never stdout, so they don't corrupt MCP JSON-RPC or CLI JSON output.

---

## 6. Distribution & Registration

### 6.1 Install

Users already have archkit. Upgrading to v1.4.0+ delivers the MCP server automatically:

```bash
npm install -g archkit          # or pnpm/yarn equivalent
# or per-project:
npm install --save-dev archkit
```

Both `archkit-mcp` (new bin) and `archkit mcp serve` (subcommand) become available immediately. No separate package installation.

### 6.2 Claude Code Registration

Manual registration adds an entry to the user's MCP config (`~/.claude/mcp.json` for global, or project-local `.mcp.json`):

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

The `archkit-mcp` bin must be on the user's `PATH` (it is, after npm install).

### 6.3 Automated Registration via `archkit init`

The existing `archkit init --install-hooks` flow already wires Claude Code hooks (v1.3 added `--claude` and `--claude-only`). v1.4 extends it with `--mcp`:

```bash
archkit init --install-hooks --claude --mcp
```

Behavior of `--mcp`:
1. Detects user's Claude Code MCP config path (`~/.claude/mcp.json` first, then project `.mcp.json` if `--project` flag is also set)
2. Reads existing config (or creates minimal `{ mcpServers: {} }`)
3. If `mcpServers.archkit` already exists with the same command, no-op (idempotent)
4. If different command exists, prints warning and skips (doesn't overwrite user customization)
5. Otherwise adds the entry and writes the config back
6. Reports the path written and what was added

Errors during MCP wiring don't block hook installation. Both `--claude` and `--mcp` can run independently or together.

### 6.4 Server Lifecycle

`archkit mcp serve` (and `archkit-mcp`) lifecycle:

- **Transport:** `StdioServerTransport` from `@modelcontextprotocol/sdk`
- **Working directory:** uses `process.cwd()` — the directory the agent spawns the server in. Each tool call resolves `.arch/` from this cwd.
- **Logging:** stderr only. Stdout is reserved for MCP JSON-RPC traffic. The existing `log.*` helpers already write to stderr.
- **State:** none. No PID files, no caches, no databases. Restart-safe.
- **Shutdown:** graceful on SIGTERM and SIGINT. Close transport, flush stderr, exit 0.
- **Errors at boot:** if MCP SDK fails to load or transport fails to attach, exit 1 with a stderr message — Claude Code surfaces this in its MCP server status panel.

### 6.5 Discoverability

The existing `archkit-protocol` skill template (in `.arch/skills/`) gets one new line:

> If `archkit_*` MCP tools are available in your tool list, prefer them over CLI shell-outs. Both produce identical JSON, but MCP avoids subprocess overhead and surfaces structured errors.

This nudges agents that loaded the skill but might still default to bash.

---

## 7. Testing Strategy

Three test layers, each with a clear scope. All use the existing Node `test` runner pattern (`tests/<topic>/run.mjs`) — no new test framework.

### 7.1 Per-Function Tests — `tests/mcp-runners/`

For each `run*Json()` function, write a test that:

1. Sets up a fixture `.arch/` directory in a tmp dir
2. Calls the function with known inputs
3. Asserts return value shape and key values
4. Asserts no `process.exit` was called (test wrapper traps it)
5. For error paths, asserts `ArchkitError` is thrown with expected `code`

Example structure:

```
tests/mcp-runners/
  review/
    run.mjs              # imports runReviewJson, exercises happy + error paths
    fixtures/.arch/      # minimal but realistic fixture
  warmup/run.mjs
  preflight/run.mjs
  ...
```

These are faster and more precise than the existing subprocess-based tests in `tests/review-json/`. The subprocess tests stay in place — they verify the CLI wrapper.

### 7.2 Envelope Tests — `tests/mcp-envelope/`

Unit tests for `src/mcp/envelope.mjs` and Zod validation:

- `ArchkitError` → MCP envelope with `isError: true`, content carries code/message/suggestion/docsUrl
- Unknown `Error` subclass → `internal_error` envelope (no leaking of stack traces or implementation details)
- Successful result → `{ content: [{ type: "text", text: <JSON> }] }`
- Zod validation failure → `invalid_input` envelope with field-level message

### 7.3 End-to-End MCP Transport Tests — `tests/mcp-server/`

Spawn `archkit-mcp` as a subprocess and talk to it via the MCP SDK's client over stdio. This is the only place subprocess overhead is acceptable — it verifies the transport, not the logic.

Assertions:

- `initialize` handshake succeeds with expected server name and version
- `tools/list` returns all 10 tools with correct names, descriptions, and input schemas
- For each tool: one happy-path `tools/call` + one error-path call
- Server exits cleanly on SIGTERM (no zombie processes)
- Server doesn't write to stdout outside JSON-RPC frames (regression guard against stray `console.log`)

### 7.4 CI Integration

The existing test runner (`tests/run-all.mjs` or equivalent) gets the new directories added to its discovery list. CI passes only when all three layers pass.

### 7.5 Coverage Targets

- 100% of `run*Json()` functions exercised (both happy and at least one error path)
- 100% of error codes from §5.4 exercised at least once across the suite
- 100% of tools from §3.1 covered by at least one E2E call

---

## 8. Definition of Done (v1.4.0 Release)

- [ ] `src/lib/errors.mjs` implemented with `ArchkitError` class and helper
- [ ] All nine command files refactored to export `run*Json()` functions
- [ ] CLI behavior verified unchanged via existing CLI test suites
- [ ] `src/mcp/server.mjs`, `src/mcp/tools.mjs`, `src/mcp/envelope.mjs` implemented
- [ ] `bin/archkit-mcp.mjs` entrypoint wired
- [ ] `archkit mcp serve` subcommand routes to the same entrypoint
- [ ] `archkit init --install-hooks --mcp` writes Claude Code MCP config idempotently
- [ ] All ten tools register with descriptions including "When to use" prose
- [ ] All three test layers pass in CI
- [ ] `@modelcontextprotocol/sdk` pinned at `^1.29.0`
- [ ] `archkit-protocol` skill template includes the MCP-preference line
- [ ] README updated with MCP install/registration section
- [ ] CHANGELOG entry for v1.4.0
- [ ] `package.json` version bumped to 1.4.0
- [ ] Dogfooding session: open Claude Code in the archkit repo with MCP enabled, observe at least one proactive tool call (review, preflight, or warmup) without explicit prompting

---

## 9. Open Questions & Deferred Work

### 9.1 Resolved by This Spec

| Question | Resolution |
|---|---|
| Package layout | Subcommand + bin in main archkit package |
| Tool naming | `archkit_*` snake_case |
| Implementation approach | Direct import via per-command `*Json()` exports |
| Transport | stdio only |
| Authentication | None (local-only) |
| Error envelope | `{ code, message, suggestion?, docsUrl? }` inside MCP `isError` |
| Refactor structure | Export from existing command files; no `src/core/` layer |
| Tool surface | All 10 from roadmap |

### 9.2 Deferred to v1.5+ or v2

| Item | Why deferred |
|---|---|
| HTTP/SSE transport | No remote use case yet; stdio covers Claude Code, Cursor, and Continue |
| MCP resources & prompts | `.arch/SYSTEM.md` as resource, `archkit-protocol` as prompt — useful but not load-bearing for the reach-rate goal |
| Multi-root workspaces | Current design assumes one `.arch/` per process; multi-root needs explicit project selection |
| Telemetry on tool usage | Privacy-sensitive; needs explicit opt-in design |
| `archkit_version` tool | Trivial to add — defer until requested |
| MCP SDK v2 migration | v2 is alpha-only as of 2026-04-28; migrate when stable |

### 9.3 Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Refactor regression — extracting `run*Json()` touches working commands | One command per PR; existing CLI tests gate each merge |
| Tool description quality directly affects reach-rate | Treat descriptions as code; iterate after dogfooding |
| MCP SDK v2 breaking changes (unknown-tool errors become JSON-RPC -32602) | All tools registered statically; agents can't call unregistered tools, so the v2 break doesn't affect us. Migration is a small follow-up |
| Stdout pollution corrupts MCP JSON-RPC | E2E test §7.3 includes a stdout-purity assertion |
| `process.exit` accidentally called inside `run*Json()` | Per-function tests trap exit; PR review checklist item |

---

## 10. Glossary

- **MCP** — Model Context Protocol; spec for connecting LLM agents to tools, resources, and prompts via JSON-RPC.
- **Tool** — In MCP, a typed function the agent can call. Has a name, description, input schema, and handler.
- **`run*Json()` function** — A pure function in a command module that returns the JSON-shaped result an MCP handler or CLI `--json` path emits. Never writes to stdout, never calls `process.exit`.
- **Envelope** — The structured `{ code, message, suggestion?, docsUrl? }` shape used for both CLI error JSON and MCP `isError` content.
- **Reach-rate** — Informal metric for how often agents call archkit at moments where they should. Goal of MCP: move from ~70% to ~99%.
