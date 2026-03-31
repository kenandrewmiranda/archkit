# BOUNDARIES.md

> Hard prohibitions. The AI must NEVER violate these rules.
> These are non-negotiable constraints, not suggestions.

## Universal Boundaries
- NEVER commit secrets, API keys, or credentials to code. Use environment variables.
- NEVER use `any` type in TypeScript. Always define explicit types.
- NEVER catch errors silently. Log or re-throw with context.
- NEVER use string concatenation for SQL queries. Use parameterized queries.
- NEVER trust client-side input. Validate at the API boundary.
- NEVER store passwords in plain text. Use bcrypt/argon2 with salt.
- NEVER disable CORS in production. Configure allowed origins explicitly.
- NEVER return stack traces or internal errors to the client in production.

## Ai-Specific Boundaries
- NEVER inline prompt strings in chain code. Prompts live in src/prompts/ and are version-controlled.
- NEVER ship a prompt change without passing the Promptfoo eval suite.
- NEVER call an LLM without guardrails (input filtering, output validation, PII detection).
- NEVER hardcode the LLM provider. Use the $llm port interface — swap via adapter.
- NEVER skip Langfuse tracing on LLM calls. Every call is traced.
