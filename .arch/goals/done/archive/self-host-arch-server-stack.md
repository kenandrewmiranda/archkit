---
slug: self-host-arch-server-stack
title: Add the Self-host (local server/rig) hosting branch by vendoring arch-server's full fleet plane (registry descriptor + Caddy + monitoring + ntfy + backups + deploy) into archkit's generators
status: completed
created: 2026-06-13
exit-criteria:
  - The Self-host branch plugs into the shared `hostingOptions` decision-support option-set (Cloud=Hetzner | Self-host=local rig, with pros/cons + AI %) introduced in hetzner-vps-iac-integration — selecting Self-host drives this generator path
  - archkit vendors arch-server's fleet-app descriptor format (the registry/apps/<app>.yaml schema: name/source/serverPath/compose/containers/domain/aliases/expose/port/health/notify/tags) into its generators and emits a valid descriptor for the iOS-backend app, parameterized by the chosen API stack (Vapor/Hono/FastAPI) and storage (MinIO/local+Caddy/Postgres)
  - archkit generates the FULL self-host bootstrap for a fresh local rig by vendoring arch-server's infra templates: Caddy reverse-proxy + automatic-TLS (local domain), Prometheus/Loki/Grafana monitoring, ntfy notifications, a backups job, and an rsync→`docker compose up -d` deploy flow
  - A .arch/skills/self-host.skill runbook is generated (provision rig → bootstrap infra → register app descriptor → deploy → health/backup) with WRONG/RIGHT/WHY gotchas, plus infra.graph nodes covering the rig: API + DB + storage + Caddy TLS edge + monitoring, mirroring the Hetzner branch's graph shape so the two hosting branches are structurally comparable
  - Vendored templates are self-contained — no runtime import of the arch-server repo; npm test stays green with a test covering self-host generation for at least one stack+storage combo and asserting the emitted descriptor matches the vendored schema
  - archkit vendors arch-server's fleet-app descriptor format (the registry/apps/<app>.yaml schema: name/source/serverPath/compose/containers/domain/aliases/expose/port/health/notify/tags) into its generators and emits a valid descriptor for the iOS-backend app, parameterized by the chosen API stack (Vapor/Hono/FastAPI) and storage (MinIO/local+Caddy/Postgres)
  - archkit generates the FULL self-host bootstrap for a fresh local rig by vendoring arch-server's infra templates: Caddy reverse-proxy + automatic-TLS (local domain), Prometheus/Loki/Grafana monitoring, ntfy notifications, a backups job, and an rsync→`docker compose up -d` deploy flow
  - A .arch/skills/self-host.skill runbook is generated (provision rig → bootstrap infra → register app descriptor → deploy → health/backup) with WRONG/RIGHT/WHY gotchas, plus infra.graph nodes covering the rig: API + DB + storage + Caddy TLS edge + monitoring, mirroring the Hetzner branch's graph shape so the two hosting branches are structurally comparable
- archkit vendors arch-server's fleet-app descriptor format (the registry/apps/<app>.yaml schema: name/source/serverPath/compose/containers/domain/aliases/expose/port/health/notify/tags) into its generators and emits a valid descriptor for the iOS-backend app, parameterized by the chosen API stack (Vapor/Hono/FastAPI) and storage (MinIO/local+Caddy/Postgres)
- archkit generates the FULL self-host bootstrap for a fresh local rig by vendoring arch-server's infra templates: Caddy reverse-proxy + automatic-TLS (local domain), Prometheus/Loki/Grafana monitoring, ntfy notifications, a backups job, and an rsync→`docker compose up -d` deploy flow
- A .arch/skills/self-host.skill runbook is generated (provision rig → bootstrap infra → register app descriptor → deploy → health/backup) with WRONG/RIGHT/WHY gotchas, plus infra.graph nodes covering the rig: API + DB + storage + Caddy TLS edge + monitoring, mirroring the Hetzner branch's graph shape so the two hosting branches are structurally comparable
files-to-touch:
  - src/data/app-types.mjs
  - src/lib/generators.mjs
  - src/wizard/scaffold-core.mjs
  - src/commands/init-generate.mjs
  - tests/mcp-init-generate/run.mjs
required-reading:
  - src/wizard/scaffold-core.mjs
  - src/lib/generators.mjs
  - ../arch-server/README.md
  - ../arch-server/packages/core/src/schema.ts
depends-on:
  - native-swift-swiftui-archetype
  - hetzner-vps-iac-integration
verify-command: npm test
source-ask: User has an arch-server project (AI-driven home-server fleet manager for a NUC: MCP + arch CLI + dashboard; per-app YAML descriptors in registry/apps/, a core package with ssh/docker/caddy/prometheus/loki clients + zod schema, and infra/ templates for Caddy, monitoring, ntfy, backups). Wants to repurpose it as archkit's self-host scaffolding option for users with a local server/rig — the second branch of the hosting decision (the first being Hetzner cloud). Decisions: FULL self-host stack (bootstrap a fresh rig end-to-end), VENDOR arch-server's templates into archkit (standalone, no runtime dep), and UNIFY hosting as a decision-support option-set shared with the Hetzner CGR.
started: 2026-06-13T18:16:47.049Z
completed: 2026-06-13T18:28:13.812Z
completion-notes: Vendored arch-server's full fleet plane into generators.mjs as the Self-host hosting branch: zod-validated registry descriptor (buildSelfHostDescriptor), app compose, Caddy tls-internal edge, Prometheus/Loki/Grafana, ntfy + Alertmanager bridge, backup engine + systemd timer, rsync→compose deploy, self-host.skill runbook, and a selfhost-edge infra.graph slice mirroring the Hetzner branch. No runtime dep on arch-server; 52/52 suites green. ADR 0009.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-13
---



# Add the Self-host (local server/rig) hosting branch by vendoring arch-server's full fleet plane (registry descriptor + Caddy + monitoring + ntfy + backups + deploy) into archkit's generators

## Why
The user runs personal iOS-app backends on a local server/rig as well as on cloud VPS. arch-server already encodes a working self-host model (per-app YAML descriptor, Caddy reverse-proxy/TLS, Prometheus/Loki/Grafana monitoring, ntfy notify, backups, rsync+compose deploy). Per the unify decision this becomes the Self-host branch of the shared hostingOptions decision-support layer (defined in hetzner-vps-iac-integration), and per the scope decisions archkit generates the FULL self-host stack and VENDORS arch-server's templates so archkit stays standalone (no runtime dependency on the arch-server repo).

## Exit criteria
- [ ] The Self-host branch plugs into the shared `hostingOptions` decision-support option-set (Cloud=Hetzner | Self-host=local rig, with pros/cons + AI %) introduced in hetzner-vps-iac-integration — selecting Self-host drives this generator path
- [ ] archkit vendors arch-server's fleet-app descriptor format (the registry/apps/<app>.yaml schema: name/source/serverPath/compose/containers/domain/aliases/expose/port/health/notify/tags) into its generators and emits a valid descriptor for the iOS-backend app, parameterized by the chosen API stack (Vapor/Hono/FastAPI) and storage (MinIO/local+Caddy/Postgres)
- [ ] archkit generates the FULL self-host bootstrap for a fresh local rig by vendoring arch-server's infra templates: Caddy reverse-proxy + automatic-TLS (local domain), Prometheus/Loki/Grafana monitoring, ntfy notifications, a backups job, and an rsync→`docker compose up -d` deploy flow
- [ ] A .arch/skills/self-host.skill runbook is generated (provision rig → bootstrap infra → register app descriptor → deploy → health/backup) with WRONG/RIGHT/WHY gotchas, plus infra.graph nodes covering the rig: API + DB + storage + Caddy TLS edge + monitoring, mirroring the Hetzner branch's graph shape so the two hosting branches are structurally comparable
- [ ] Vendored templates are self-contained — no runtime import of the arch-server repo; npm test stays green with a test covering self-host generation for at least one stack+storage combo and asserting the emitted descriptor matches the vendored schema

