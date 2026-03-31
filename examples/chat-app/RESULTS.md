# chat-app — Review Results

## What Was Tested

Realtime chat app with Gateway/Handler/Domain pattern. 3 source files with 4 intentional violations.

## Violations Planted vs Caught

| # | Violation | File | Caught? | Why Not? |
|---|-----------|------|---------|----------|
| 1 | DB access in message handler | chat.handler.ts:6 | No | Review only checks files matching `controller` or `Cont` patterns |
| 2 | Business logic in handler (validation, branching) | chat.handler.ts:11-16 | No | Conditional count check only applies to `controller` files |
| 3 | Synchronous DB persistence in handler | chat.handler.ts:19-23 | No | No check exists for "persist after acknowledge" pattern |
| 4 | Presence persisted to DB instead of ephemeral cache | presence.handler.ts:7 | No | No check for presence storage patterns |

## Review Output

```
0 errors
0 warnings
3 clean files — All clean! No issues found.
```

## What Worked

- Review loaded the correct `.arch/` context (9 rules, 5 skills, 3 graphs)
- Built-in postgres gotchas were loaded (3 gotchas) but none matched the code patterns used
- The review ran without errors

## What Didn't Work

- **All 4 violations missed** — The architecture checks in `review.mjs` are SaaS/layered-specific:
  - `checkArchitectureRules` only checks files matching `controller`/`Cont` for DB access
  - `checkArchitectureRules` only counts conditionals in `controller` files
  - No checks exist for handler/domain/persistence layer violations
  - No checks for realtime-specific anti-patterns (sync persistence, DB presence, framework imports in domain)

## Gap: App-Type-Aware Review Checks

The review command needs pattern checks for each architecture type:

**Realtime checks needed:**
- Handler files importing DB modules directly → error
- Domain files importing any I/O or framework modules → error
- Presence/typing state written to persistent DB → warning
- Missing message type validation in handlers → warning
