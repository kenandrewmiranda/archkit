# SYSTEM.md

## App: chat-app
## Type: Real-Time Application
## Stack: Server: Node.js WebSocket (ws) | Auth: Keycloak (JWT at connect) | Database: PostgreSQL | Real-time State: Valkey (pub/sub + ephemeral)
## Pattern: Event-Driven + Gateway Pattern (no controller/service/repo)

## Rules
- Gateway layer manages: handshake, auth, heartbeat, reconnection. NO business logic here.
- Handlers process ONE message type each. Typed message in → domain call → response/broadcast.
- Domain logic is framework-agnostic. Zero WebSocket imports. Pure functions: (state, action) → newState.
- Persistence is async and non-blocking. Acknowledge to user FIRST, write to DB AFTER.
- Cross-server communication ONLY through Valkey pub/sub. Never assume single-server.
- All messages: { type, payload, timestamp, senderId }. Defined in shared/protocol/.
- Presence (online/offline/typing) is ephemeral: Valkey TTL keys only. Never persisted.
- Max complexity: controllers ≤ 5 conditional branches, services ≤ 200 lines, functions ≤ 50 lines.
- Message handlers must complete within 100ms. Offload heavy work to async jobs.

## Reserved Words
$ws = WebSocket connection instance
$room = room/channel abstraction — join, leave, broadcast to members
$presence = online/offline/typing state via Valkey TTL keys + pub/sub
$pubsub = Valkey pub/sub for cross-server message fan-out
$protocol = message type definitions: { type, payload, ts, senderId }
$auth = JWT validated at WebSocket handshake, not per-message
$db = PostgreSQL for persistent data (messages, channels, users)
$cache = Valkey for ephemeral state (presence, typing, recent messages)

## Naming
Files: kebab-case | Types: PascalCase | Funcs: camelCase | Tables: snake_case | Env: SCREAMING_SNAKE

## On Generate
0. BEFORE writing any file: verify the path matches the convention. State: "Target: <file path>"
1. State which layer this code belongs to and the file path
2. Reference $symbols for all dependencies
3. Throw $err on failure paths
4. Write the corresponding test

## Session Protocol (NON-NEGOTIABLE)
- BEFORE any code generation in a new session: run `archkit resolve warmup`
- If warmup returns blockers: FIX THEM before writing any code. No exceptions.
- If warmup returns warnings: ACKNOWLEDGE them and proceed with awareness.
- BEFORE generating a new feature: run `archkit resolve scaffold <featureId>` for the checklist.
- BEFORE generating code for an existing feature: run `archkit resolve preflight <feature> <layer>`
- When the prompt is ambiguous: run `archkit resolve context "<prompt>"` to resolve to specific nodes and files.
- AT SESSION END: suggest running `archkit gotcha --debrief` to capture learnings.

## Delegation Principle
Delegate everything deterministic to sub-agents and CLI tools first. The main agent finalizes with judgment.

### Sub-agent first (70-80% of the work, cheap tokens):
- Scaffolding files and boilerplate: `archkit resolve scaffold` + sub-agent generates from checklist
- Resolving context and dependencies: `archkit resolve context` + `archkit resolve preflight`
- Checking code against rules: `archkit review --agent` (sub-agent reads JSON, reports findings)
- Looking up patterns and gotchas: `archkit resolve lookup` (sub-agent applies, not re-derives)
- Repetitive CRUD: sub-agent clones patterns from existing features, doesn't reason from scratch

### Main agent finalizes (20-30% of the work, expensive tokens):
- Review sub-agent output with TDD approach: write failing test FIRST, then verify the generated code passes
- Handle edge cases, error paths, and security concerns that require judgment
- Make architectural decisions (should this be a new feature or extend an existing one?)
- Resolve ambiguity in requirements
- Final code review: does this fit the system, not just work in isolation?

### The TDD finalization loop:
1. Sub-agent generates implementation from scaffold/checklist
2. Main agent writes a failing test that captures the REAL requirement
3. Main agent verifies sub-agent code passes (or fixes the delta)
4. Main agent runs `archkit review --agent` as final gate
5. If review passes: done. If not: fix findings, re-run.
