---
slug: native-swift-swiftui-archetype
title: Add a decision-aware native Swift/SwiftUI iOS archetype to archkit (annotated stack/storage options, not a hardcoded default)
status: completed
created: 2026-06-13
exit-criteria:
  - A new archetype (key e.g. `ios-swift`) is added to src/data/app-types.mjs with a SwiftUI/MVVM pattern (View → ViewModel → Service → API/LocalStore), Swift-idiomatic reserved words, Swift folder/naming conventions (PascalCase Swift files, Views/ViewModels/Services/Models), and rules with ZERO React/.tsx/FlashList/WatermelonDB leakage
  - Instead of a single hardcoded defaultStack, the archetype carries annotated option sets: serverStackOptions (Vapor | Hono | FastAPI) and storageOptions (MinIO | local-disk+Caddy | Postgres-only), each option as {id,label,pros[],cons[]} metadata; a sensible fallback default is still selected for non-interactive callers
  - The interactive wizard AND archkit_init_generate surface these option sets with their pros/cons so the user/AI can choose; the chosen rationale + an AI-assigned recommended % per option (weighted to stated project needs) is recorded in the generated output (SYSTEM.md decision section or a generated ADR/decision note)
  - Generators (genSystemMd/genGraph/genIndexMd and the CLAUDE.md/.claude rules block) emit Swift-correct output for this archetype: Swift naming, app-layout paths, and no JS-only verify-wiring guidance (hasJsTsStack already gates this — confirm it returns false for the Swift stack)
  - npm test stays green and includes a new test asserting the ios-swift archetype scaffolds a .arch/ with no JS/React-specific leakage and with the option-set metadata present
  - Instead of a single hardcoded defaultStack, the archetype carries annotated option sets: serverStackOptions (Vapor | Hono | FastAPI) and storageOptions (MinIO | local-disk+Caddy | Postgres-only), each option as {id,label,pros[],cons[]} metadata; a sensible fallback default is still selected for non-interactive callers
  - Generators (genSystemMd/genGraph/genIndexMd and the CLAUDE.md/.claude rules block) emit Swift-correct output for this archetype: Swift naming, app-layout paths, and no JS-only verify-wiring guidance (hasJsTsStack already gates this — confirm it returns false for the Swift stack)
- Instead of a single hardcoded defaultStack, the archetype carries annotated option sets: serverStackOptions (Vapor | Hono | FastAPI) and storageOptions (MinIO | local-disk+Caddy | Postgres-only), each option as {id,label,pros[],cons[]} metadata; a sensible fallback default is still selected for non-interactive callers
- Generators (genSystemMd/genGraph/genIndexMd and the CLAUDE.md/.claude rules block) emit Swift-correct output for this archetype: Swift naming, app-layout paths, and no JS-only verify-wiring guidance (hasJsTsStack already gates this — confirm it returns false for the Swift stack)
files-to-touch:
  - src/data/app-types.mjs
  - src/lib/generators.mjs
  - src/lib/stack-detect.mjs
  - src/wizard/scaffold-core.mjs
  - src/wizard/generate.mjs
  - src/commands/init-generate.mjs
  - tests/mcp-init-generate/run.mjs
required-reading:
  - src/data/app-types.mjs
  - src/wizard/scaffold-core.mjs
  - src/lib/generators.mjs
depends-on: 
verify-command: npm test
source-ask: User builds personal native iOS apps (Swift/SwiftUI) with a Hetzner VPS for the API/storage backend. archkit has no native-Swift archetype (the only mobile one is React Native). Wants (1) a Swift/SwiftUI archetype, and (2) Hetzner VPS setup integration as a separate CGR. Key design note: don't hardcode the server stack or storage — present all options (server: Vapor/Hono/FastAPI; storage: MinIO/local-disk+Caddy/Postgres) with pros/cons, and have the AI weight a recommended % per the specific project's needs. Hetzner scope = full IaC.
started: 2026-06-13T17:05:28.235Z
completed: 2026-06-13T17:16:00.727Z
completion-notes: Added ios-swift archetype (SwiftUI/MVVM) with decision-aware serverStackOptions (Vapor/Hono/FastAPI) + storageOptions (MinIO/local-disk+Caddy/Postgres) as {id,label,pros,cons}; stackDecision (rationale + AI-weighted %) recorded in SYSTEM.md via genStackDecisionSection; wizard + archkit_init_generate both surface options; hasJsTsStack short-circuits false for the Swift stack; new tests assert zero React/.tsx leakage + option metadata.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-13
---



# Add a decision-aware native Swift/SwiftUI iOS archetype to archkit (annotated stack/storage options, not a hardcoded default)

## Why
The only mobile archetype is React Native (Screen/Hook/Service, .tsx, FlashList, WatermelonDB) — there is nothing that scaffolds a correct .arch/ for a native Swift/SwiftUI app. The user builds these regularly. Per their guidance the archetype must not hardcode one backend/storage; it should surface options with pros/cons so the AI can recommend a weighted % per project.

## Exit criteria
- [ ] A new archetype (key e.g. `ios-swift`) is added to src/data/app-types.mjs with a SwiftUI/MVVM pattern (View → ViewModel → Service → API/LocalStore), Swift-idiomatic reserved words, Swift folder/naming conventions (PascalCase Swift files, Views/ViewModels/Services/Models), and rules with ZERO React/.tsx/FlashList/WatermelonDB leakage
- [ ] Instead of a single hardcoded defaultStack, the archetype carries annotated option sets: serverStackOptions (Vapor | Hono | FastAPI) and storageOptions (MinIO | local-disk+Caddy | Postgres-only), each option as {id,label,pros[],cons[]} metadata; a sensible fallback default is still selected for non-interactive callers
- [ ] The interactive wizard AND archkit_init_generate surface these option sets with their pros/cons so the user/AI can choose; the chosen rationale + an AI-assigned recommended % per option (weighted to stated project needs) is recorded in the generated output (SYSTEM.md decision section or a generated ADR/decision note)
- [ ] Generators (genSystemMd/genGraph/genIndexMd and the CLAUDE.md/.claude rules block) emit Swift-correct output for this archetype: Swift naming, app-layout paths, and no JS-only verify-wiring guidance (hasJsTsStack already gates this — confirm it returns false for the Swift stack)
- [ ] npm test stays green and includes a new test asserting the ios-swift archetype scaffolds a .arch/ with no JS/React-specific leakage and with the option-set metadata present

