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

## Realtime-Specific Boundaries
- NEVER put business logic in the WebSocket gateway. Gateway handles connection lifecycle only.
- NEVER import WebSocket/framework modules in domain logic. Domain is pure functions.
- NEVER persist presence/typing state to the database. Use ephemeral Valkey TTL keys.
- NEVER assume single-server deployment. Cross-server communication via pub/sub only.
- NEVER block the event loop with synchronous operations in message handlers.
