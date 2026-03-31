# task-manager — Review Results

## What Was Tested

SaaS app with layered architecture (Controller → Service → Repository). 4 source files with 5 intentional violations.

## Violations Planted vs Caught

| # | Violation | File | Caught? | Finding |
|---|-----------|------|---------|---------|
| 1 | Cross-feature import (tasks → billing) | tasks.controller.ts:5 | Yes | `import-boundary` error at line 5 |
| 2 | Direct DB call in controller (`prisma.task.findMany()`) | tasks.controller.ts:11 | Yes | `architecture` warning — "Possible direct database call in controller" |
| 3 | Business logic in controller (6 conditionals) | tasks.controller.ts:16-21 | Yes | `architecture` warning at line 19 — "6 conditional branches" |
| 4 | `new PrismaClient()` per module (not singleton) | tasks.controller.ts:8, tasks.repository.ts:4 | Yes | `gotcha` error — caught in both files via built-in prisma gotcha |
| 5 | Missing tenant scoping in repository queries | tasks.repository.ts:10 | No | Not caught — tenant check requires `$tenant` reserved word AND repo filename match |

## Review Output

```
3 errors (must fix)
2 warnings (should fix)
2 clean files
```

## What Worked

- **Gotcha matching** — `new PrismaClient()` caught immediately from built-in gotcha DB
- **Cross-feature import detection** — `import-checks.mjs` correctly flagged `tasks → billing`
- **Controller complexity** — 6 `if` branches flagged as business logic leak
- **DB-in-controller** — `prisma.` pattern detected in controller file
- **Clean files pass clean** — service and auth files correctly reported as clean

## What Didn't Work

- **Tenant scoping check** — The check at review.mjs:180 requires BOTH a repo filename AND `$tenant` in reserved words AND missing "tenant" in code. The conditions are too tightly coupled — it didn't fire because the operator precedence fix may need the reservedWords to be loaded from this project's SYSTEM.md.

## Gotchas That Fired

- `prisma: new PrismaClient()` → `globalThis.prisma ??= new PrismaClient()` (from built-in gotcha DB)
