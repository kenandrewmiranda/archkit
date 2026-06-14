---
slug: hetzner-vps-iac-integration
title: Introduce the hosting decision-support option-set (Cloud vs Self-host) + implement the Cloud/Hetzner full-IaC branch (Terraform/hcloud + cloud-init + deploy skill + infra graph)
status: completed
created: 2026-06-13
exit-criteria:
  - Introduce a `hostingOptions` decision-support option-set (Cloud = Hetzner VPS | Self-host = local server/rig) with {id,label,pros[],cons[]} metadata + an AI-weighted recommended %, surfaced by the wizard AND archkit_init_generate — same pattern as the stack/storage option-sets. This goal implements the Cloud branch; the Self-host branch is its own goal (self-host-arch-server-stack) that plugs into this same layer
  - archkit can generate Terraform/hcloud config that provisions a Hetzner VPS (server + SSH key + firewall + primary IP), with the API stack and storage choice as inputs
  - A cloud-init / setup.sh bootstrap is generated: Docker, Caddy (automatic-TLS reverse proxy), firewall + fail2ban, and a non-root deploy user
  - A .arch/skills/hetzner.skill deploy runbook is generated (build → push image → compose up → Caddy reload) with WRONG/RIGHT/WHY gotchas, plus infra.graph nodes covering the API + DB + storage + Caddy TLS edge
  - The generated IaC + infra graph are parameterized by the server stack (Vapor/Hono/FastAPI) and all three storage options (MinIO / local-disk+Caddy / Postgres-only) so they stay consistent with what the Swift archetype selected
  - Wired into scaffold generation so `archkit init` / archkit_init_generate can emit the Hetzner artifacts (behind a feature/flag or skill); npm test stays green with a test covering the Hetzner generation for at least one stack+storage combo
  - A cloud-init / setup.sh bootstrap is generated: Docker, Caddy (automatic-TLS reverse proxy), firewall + fail2ban, and a non-root deploy user
- A cloud-init / setup.sh bootstrap is generated: Docker, Caddy (automatic-TLS reverse proxy), firewall + fail2ban, and a non-root deploy user
files-to-touch:
  - src/data/app-types.mjs
  - src/lib/generators.mjs
  - src/wizard/scaffold-core.mjs
  - src/commands/init-generate.mjs
  - tests/mcp-init-generate/run.mjs
required-reading:
  - src/wizard/scaffold-core.mjs
  - src/lib/generators.mjs
depends-on:
  - native-swift-swiftui-archetype
verify-command: npm test
source-ask: User builds personal native iOS apps (Swift/SwiftUI) with a Hetzner VPS for the API/storage backend. archkit has no native-Swift archetype (the only mobile one is React Native). Wants (1) a Swift/SwiftUI archetype, and (2) Hetzner VPS setup integration as a separate CGR. Key design note: don't hardcode the server stack or storage — present all options (server: Vapor/Hono/FastAPI; storage: MinIO/local-disk+Caddy/Postgres) with pros/cons, and have the AI weight a recommended % per the specific project's needs. Hetzner scope = full IaC.
started: 2026-06-13T17:20:58.852Z
completed: 2026-06-13T17:30:09.975Z
completion-notes: Added a hostingOptions decision set (cloud/self-host) to the ios-swift archetype, surfaced by the wizard + archkit_init_generate + SYSTEM.md, same pattern as serverStack/storage. Implemented the Cloud/Hetzner branch: gated on hosting=cloud, generateScaffold emits full IaC — infra/terraform (hcloud server+ssh_key+firewall+primary_ip), infra/cloud-init.yaml (Docker, ufw, fail2ban, non-root deploy user), infra/Caddyfile (automatic-TLS reverse proxy), infra/docker-compose.yml + .env.example, and .arch/skills/hetzner.skill deploy runbook with WRONG/RIGHT/WHY. infra.graph gains a hetzner-edge slice (Caddy→Api→DB+Store). All parameterized by the recorded server stack (Vapor/Hono/FastAPI) and all three storage options (MinIO/local-disk+Caddy/Postgres-only). New tests cover vapor+minio and hono+local-disk-caddy plus the self-host gate.
tests-passed: true
tests-command: npm test
tests-at: 2026-06-13
---



# Introduce the hosting decision-support option-set (Cloud vs Self-host) + implement the Cloud/Hetzner full-IaC branch

## Why
The user's personal iOS apps run their API/storage on a Hetzner VPS (cloud) OR a local server/rig (self-host). Per the unify-as-an-option-set decision, "where does the backend run" is itself a decision-support choice — Cloud vs Self-host — presented with pros/cons + an AI-weighted %, the same pattern as the stack/storage options. This goal establishes that shared `hostingOptions` layer and implements the Cloud branch (Hetzner full IaC); the Self-host branch (vendoring arch-server's infra plane) is a sibling goal that reuses this layer.

## Exit criteria
- [ ] Introduce a `hostingOptions` decision-support option-set (Cloud = Hetzner VPS | Self-host = local server/rig) with {id,label,pros[],cons[]} metadata + an AI-weighted recommended %, surfaced by the wizard AND archkit_init_generate — same pattern as the stack/storage option-sets. This goal implements the Cloud branch; the Self-host branch plugs into this same layer
- [ ] archkit can generate Terraform/hcloud config that provisions a Hetzner VPS (server + SSH key + firewall + primary IP), with the API stack and storage choice as inputs
- [ ] A cloud-init / setup.sh bootstrap is generated: Docker, Caddy (automatic-TLS reverse proxy), firewall + fail2ban, and a non-root deploy user
- [ ] A .arch/skills/hetzner.skill deploy runbook is generated (build → push image → compose up → Caddy reload) with WRONG/RIGHT/WHY gotchas, plus infra.graph nodes covering the API + DB + storage + Caddy TLS edge
- [ ] The generated IaC + infra graph are parameterized by the server stack (Vapor/Hono/FastAPI) and all three storage options (MinIO / local-disk+Caddy / Postgres-only) so they stay consistent with what the Swift archetype selected
- [ ] Wired into scaffold generation so `archkit init` / archkit_init_generate can emit the Hetzner artifacts (behind a feature/flag or skill); npm test stays green with a test covering the Hetzner generation for at least one stack+storage combo

