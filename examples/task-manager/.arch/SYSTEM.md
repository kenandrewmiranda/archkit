# SYSTEM.md

## App: task-manager
## Type: SaaS / B2B Platform
## Stack: Frontend: Next.js + Tailwind + shadcn/ui | API Framework: Hono | Auth: Keycloak | Database: PostgreSQL (with RLS) | Cache: Valkey | Job Queue: BullMQ
## Pattern: Layered (Cont→Ser→Repo) + Modular Monolith

## Rules
- Layered: C→S→R. Controllers thin (validate, delegate, respond). Services own logic. Repos own DB.
- Features NEVER import across boundaries. Cross-feature communication = shared interface only.
- All DB queries include $tenant. RLS is the safety net, not the primary filter.
- Errors: throw $err types (NotFound, Validation, Forbidden). Centralized handler formats response.
- Validation: $zod schemas shared between frontend and API.
- Events: async via $bus. All subscribers must be idempotent.
- Max complexity: controllers ≤ 5 conditional branches, services ≤ 200 lines, functions ≤ 50 lines.
- Every service method must have a corresponding test. No exceptions.

## Reserved Words
$tenant = tenant context — ID from JWT, injected by middleware, scopes all DB operations
$auth = authenticated user context — JWT validated, permissions attached to request
$err = typed error classes — NotFoundError, ValidationError, ForbiddenError, ConflictError
$bus = domain event bus — emit() and on() via Valkey pub/sub. Async, decoupled.
$cache = Valkey cache layer — sessions, rate limiting counters, query result cache
$db = PostgreSQL — primary for writes, read replica for dashboards
$zod = Zod validation schemas — defined once, shared between frontend and API
$rls = Row-Level Security — PostgreSQL policies enforcing tenant isolation at DB level
$queue = BullMQ job queue — async tasks like email, exports, webhooks

## Naming
Files: kebab-case | Types: PascalCase | Funcs: camelCase | Tables: snake_case | Env: SCREAMING_SNAKE

## On Generate
0. BEFORE writing any file: verify the path matches the convention. State: "Target: <file path>"
1. State which layer this code belongs to and the file path
2. Reference $symbols for all dependencies
3. Include $tenant in all DB operations
4. Throw $err on failure paths
5. Write the corresponding test

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
