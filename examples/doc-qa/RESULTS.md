# doc-qa — Review Results

## What Was Tested

AI-powered document Q&A app with Hexagonal + Pipeline pattern. 3 source files (2 chains, 1 prompt template) with 6 intentional violations.

## Violations Planted vs Caught

| # | Violation | File | Caught? | Why Not? |
|---|-----------|------|---------|----------|
| 1 | Hardcoded LLM provider (direct Anthropic import) | qa.chain.ts:2 | No | No check for direct provider imports vs port interface |
| 2 | Inline prompt string (not in src/prompts/) | qa.chain.ts:8 | No | No check for string literal prompts in chain files |
| 3 | Missing guardrails (no input/output filtering) | qa.chain.ts | No | No check for guardrail wrapper presence |
| 4 | Missing Langfuse tracing | qa.chain.ts | No | No check for tracing decorator/wrapper |
| 5 | Missing source citations in response | qa.chain.ts:24 | No | No check for citation fields in return type |
| 6 | Hardcoded LLM provider in summarize chain | summarize.chain.ts:2 | No | Same as #1 |

## Review Output

```
0 errors
0 warnings
2 clean files — All clean! No issues found.
```

## What Worked

- Review loaded the correct `.arch/` context (10 rules, 6 skills, 3 graphs)
- The prompt template file (qa_system.md) was correctly skipped (not a .ts/.js file)
- Built-in gotchas for postgres/valkey were loaded but irrelevant to these files

## What Didn't Work

- **All 6 violations missed** — No AI-specific architecture checks exist:
  - No check for direct LLM provider imports (should use port interface)
  - No check for inline prompt strings in chain files
  - No check for missing guardrail wrappers
  - No check for missing observability/tracing
  - No check for missing citations in RAG responses

## Gap: AI Architecture Review Checks

The review command needs pattern checks for AI apps:

**AI checks needed:**
- Chain files importing provider SDKs directly (Anthropic, OpenAI) → error
- String literals > 100 chars in chain files → warning (likely inline prompts)
- Chain files without `guard`/`guardrail` import → warning
- Chain files without `trace`/`langfuse` import → warning
- RAG chain responses without `sources`/`citations` field → warning
