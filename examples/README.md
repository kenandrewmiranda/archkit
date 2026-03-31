# archkit Examples

Three demo projects that test archkit across different architecture patterns. Each contains intentional code violations to evaluate what `archkit review` catches and misses.

## Demos

| Demo | App Type | Pattern | Files | Violations |
|------|----------|---------|-------|------------|
| [task-manager](./task-manager/) | SaaS | Layered (C→S→R) | 4 source files | 5 intentional violations |
| [chat-app](./chat-app/) | Realtime | Event-Driven + Gateway | 3 source files | 4 intentional violations |
| [doc-qa](./doc-qa/) | AI | Hexagonal + Pipeline | 3 source files | 6 intentional violations |

## Running

From the archkit project root:

```bash
# Generate .arch/ for a demo (already pre-generated)
node examples/task-manager/generate.mjs

# Review demo files
cd examples/task-manager && node ../../bin/archkit.mjs review src/features/tasks/tasks.controller.ts

# Run resolve commands
cd examples/task-manager && node ../../bin/archkit.mjs resolve warmup --pretty
cd examples/task-manager && node ../../bin/archkit.mjs resolve context "add task assignment" --pretty
```

## Results Summary

See each demo's `RESULTS.md` for detailed findings. High-level:

| Demo | Violations Planted | Caught | Missed | Detection Rate |
|------|-------------------|--------|--------|----------------|
| task-manager | 5 | 4 | 1 | 80% |
| chat-app | 4 | 0 | 4 | 0% |
| doc-qa | 6 | 0 | 6 | 0% |

**Key finding:** `archkit review` catches SaaS/layered architecture violations well (gotcha patterns, cross-feature imports, DB-in-controller, business logic leak) but has no checks for realtime or AI architecture violations. The review command needs app-type-aware checks.
