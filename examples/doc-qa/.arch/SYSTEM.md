# SYSTEM.md

## App: doc-qa
## Type: AI-Powered Product
## Stack: API: Hono | LLM: Anthropic Claude (via SDK) | Database: PostgreSQL + pgvector | Cache: Valkey (semantic cache) | LLM Observability: Langfuse
## Pattern: Hexagonal (ports + adapters) + Pipeline chains

## Rules
- LLM provider is an ADAPTER. Chains call PortLLM interface. Swap provider = new adapter, zero chain changes.
- Prompts are version-controlled in src/prompts/. Never inline prompt strings in chain code.
- Every chain has a Promptfoo eval suite in src/eval/. No prompt change ships without passing tests.
- All LLM calls are traced via Langfuse: prompt, response, latency, tokens, model, quality score.
- Guardrails (input filtering, output validation, PII detection) wrap EVERY chain. Not optional.
- RAG retrieval returns sources with relevance scores. Chains pass sources for citation in response.
- Streaming responses via Server-Sent Events. Frontend renders tokens progressively as they arrive.
- Semantic caching: check Valkey for semantically similar prior queries before calling LLM.
- Max complexity: controllers ≤ 5 conditional branches, services ≤ 200 lines, functions ≤ 50 lines.
- Every chain must have at least 3 eval test cases in its Promptfoo suite.

## Reserved Words
$llm = LLM port interface — adapters: OpenAI, vLLM, Ollama, Anthropic. Swap via LLM_PROVIDER env var.
$vec = Vector store port — adapters: pgvector, Qdrant. For embedding storage and similarity search.
$embed = Embedding generation — call $vec.embed(text) to generate vectors
$guard = Guardrails — input filter, output filter, PII detection. Wraps every chain.
$trace = Langfuse trace decorator — automatic LLM call observability
$prompt = Prompt template — loaded from src/prompts/, never inline strings in code
$eval = Promptfoo test suite — regression tests for prompt quality
$cache = Valkey semantic cache — deduplicate similar queries to avoid re-inference
$db = PostgreSQL — app state + pgvector extension for embeddings

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
