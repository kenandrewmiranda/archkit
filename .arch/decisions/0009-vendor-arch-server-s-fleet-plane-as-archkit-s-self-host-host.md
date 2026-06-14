# 0009. Vendor arch-server's fleet plane as archkit's Self-host hosting branch

- **Date**: 2026-06-13
- **Status**: Accepted
- **Tags**: hosting, self-host, vendoring, generators, infrastructure

## Context

archkit's ios-swift archetype carries a shared `hostingOptions` decision-set (Cloud=Hetzner | Self-host=local rig). The Cloud branch already emits full Hetzner IaC. Users also run iOS-app backends on a local server/rig. arch-server already encodes a working self-host model (per-app YAML descriptor, Caddy reverse-proxy/TLS, Prometheus/Loki/Grafana, ntfy, backups, rsync+compose deploy), but it is a separate repo. We needed the Self-host branch to be standalone — archkit cannot take a runtime dependency on the arch-server repo.

## Decision

Vendor arch-server's full fleet plane into `src/lib/generators.mjs` (no runtime import of arch-server). Selecting hosting="self-host" gates `genSelfHostArtifacts(cfg)` in scaffold-core, mirroring the Cloud gate. The fleet-app descriptor schema (registry/apps/<app>.yaml) is re-expressed as a real zod schema (`appDescriptorSchema`) so the emitted descriptor is built+validated via `buildSelfHostDescriptor(cfg)`; a tiny purpose-built YAML emitter serializes it (no YAML dep). Infra templates (Caddy `tls internal` edge, monitoring stack, ntfy + Alertmanager→ntfy bridge, backup engine + systemd timer, rsync→`docker compose up -d` deploy) are vendored as parameterized generators keyed off the same server-stack + storage choices the Hetzner branch uses. A `.arch/skills/self-host.skill` runbook and a `selfhost-edge` infra.graph slice (Caddy/Api/DB/Store/Mon/Backup) mirror the Hetzner branch's shape so the two hosting branches are structurally comparable.

## Consequences

archkit can scaffold a full local-rig backend end to end with zero dependency on the arch-server repo. The two hosting branches now share one decision-set and a comparable graph shape. Cost: the vendored templates are a point-in-time copy — fixes/ADRs that land in arch-server's infra/ won't propagate automatically and must be re-vendored. The Alertmanager path was genericized to route to the ntfy bridge (dropping the live config's Pushover/SMTP secrets) to stay self-contained. Backup.sh is a faithful condensed port (not byte-identical) authored with template-literal escaping; `bash -n` validates it at generation time via tests.
