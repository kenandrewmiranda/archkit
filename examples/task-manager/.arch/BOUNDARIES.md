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

## Saas-Specific Boundaries
- NEVER query the database without tenant scoping. Every query includes tenant_id.
- NEVER import from another feature's internal modules. Use shared interfaces only.
- NEVER put business logic in controllers. Controllers validate, delegate, respond.
- NEVER access the database directly from controllers. Go through service → repository.
- NEVER use floating-point for money. Use integer cents via $money type.
- NEVER create a new PrismaClient/pool per request. Use a singleton or connection pool.
