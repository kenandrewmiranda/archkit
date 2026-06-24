import fs from "fs";
import { z } from "zod";
import { ICONS } from "./shared.mjs";
import { APP_TYPES, SKILL_CATALOG } from "../data/app-types.mjs";
import { genBoundariesMd } from "../data/boundaries.mjs";
import { GOTCHA_DB } from "../data/gotcha-db.mjs";
import { PACKAGE_DOCS } from "../data/package-docs.mjs";
import { hasJsTsStack } from "./stack-detect.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

// Swift archetypes use PascalCase source files (FooView.swift), not kebab-case.
export function swiftNaming(cfg) {
  return cfg?.appType === "ios-swift";
}

// Naming convention line, archetype-aware. Shared by SYSTEM.md and CLAUDE.md.
export function namingLine(cfg) {
  return swiftNaming(cfg)
    ? `Files: PascalCase Swift (FooView.swift) | Types: PascalCase | Funcs/props: camelCase | Enum cases: camelCase | Env: SCREAMING_SNAKE`
    : `Files: kebab-case | Types: PascalCase | Funcs: camelCase | Tables: snake_case | Env: SCREAMING_SNAKE`;
}

// Render the decision-aware stack/storage section for archetypes that carry
// annotated option sets (serverStackOptions / storageOptions). When the caller
// (wizard or archkit_init_generate) recorded a choice in cfg.stackDecision, we
// emit the chosen option, its rationale, and the AI-assigned recommendation %
// per option. With no recorded decision we still surface every option's
// pros/cons so the decision is visible and can be recorded later.
export function genStackDecisionSection(cfg) {
  const at = APP_TYPES[cfg.appType];
  if (!at || (!at.serverStackOptions && !at.storageOptions && !at.hostingOptions)) return null;

  const decision = cfg.stackDecision || {};
  let o = `\n## Stack Decision\n`;
  o += decision.serverStack || decision.storage || decision.hosting
    ? `> Backend stack, storage, and hosting are NOT hardcoded. Recorded choice + AI-weighted recommendation per option.\n`
    : `> Backend stack, storage, and hosting are NOT hardcoded — decide and record below. Defaults shown are fallbacks for non-interactive setup.\n`;

  const groups = [
    { key: "serverStack", title: "Server Stack", options: at.serverStackOptions, fallback: at.defaultServerStack },
    { key: "storage", title: "Storage", options: at.storageOptions, fallback: at.defaultStorage },
    { key: "hosting", title: "Hosting", options: at.hostingOptions, fallback: at.defaultHosting },
  ];

  for (const g of groups) {
    if (!g.options) continue;
    const choice = decision[g.key] || {};
    const recById = {};
    for (const r of choice.recommendations || []) recById[r.id] = r.pct;
    const chosenId = choice.chosen || g.fallback;
    const chosenOpt = g.options.find(opt => opt.id === chosenId);

    o += `\n### ${g.title}: ${chosenOpt ? chosenOpt.label : chosenId}`;
    o += choice.chosen ? ` (chosen)\n` : ` (default — not yet decided)\n`;
    if (choice.rationale) o += `Rationale: ${choice.rationale}\n`;
    o += `\nOptions:\n`;
    for (const opt of g.options) {
      const pct = recById[opt.id];
      const mark = opt.id === chosenId ? "✓ " : "  ";
      o += `- ${mark}${opt.label}${pct != null ? ` — recommended ${pct}%` : ""}\n`;
      o += `    Pros: ${opt.pros.join("; ")}\n`;
      o += `    Cons: ${opt.cons.join("; ")}\n`;
    }
  }
  return o;
}

export function genSystemMd(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `# SYSTEM.md\n\n`;
  o += `## App: ${cfg.appName}\n`;
  o += `## Type: ${at.name}\n`;
  o += `## Stack: ${Object.entries(cfg.stack).map(([k,v]) => `${k}: ${v}`).join(" | ")}\n`;
  o += `## Pattern: ${at.pattern}\n\n`;
  o += `## Rules\n`;
  at.rules.forEach(r => o += `- ${r}\n`);
  o += `\n## Reserved Words\n`;
  for (const [k, v] of Object.entries(at.reservedWords)) o += `${k} = ${v}\n`;
  const decisionSection = genStackDecisionSection(cfg);
  if (decisionSection) o += decisionSection;
  o += `\n## Naming\n`;
  o += `${namingLine(cfg)}\n`;
  o += `\n## Structured I/O — Required Before and After Every Code Change\n\n`;
  o += `Before writing or modifying any file, output this PRE block:\n\n`;
  o += `\`\`\`\n`;
  o += `[PRE]\n`;
  o += `action: create | modify | delete\n`;
  o += `target: <exact file path>\n`;
  o += `feature: <feature id from INDEX.md>\n`;
  o += `layer: <controller | service | repository | types | validation | test | handler | domain | chain>\n`;
  o += `depends_on: <list of files/features this change depends on>\n`;
  o += `checked:\n`;
  o += `  preflight: <yes — ran archkit resolve preflight | no — reason>\n`;
  o += `  gotchas: <yes — checked .playbook file | no — no playbook for this package>\n`;
  o += `  boundaries: <yes — read BOUNDARIES.md | no — reason>\n`;
  if (at.reservedWords["$tenant"]) o += `  tenant_scoping: <yes — $tenant included | not applicable>\n`;
  o += `[/PRE]\n`;
  o += `\`\`\`\n\n`;
  o += `After completing the change, output this POST block:\n\n`;
  o += `\`\`\`\n`;
  o += `[POST]\n`;
  o += `files_changed: <list of files created or modified>\n`;
  o += `test: <written | updated | skipped — reason>\n`;
  o += `error_handling: <$err types used | not applicable>\n`;
  o += `gotchas_applied: <list of WRONG→RIGHT patterns avoided | none>\n`;
  o += `ready_for_review: <yes | no — what's still needed>\n`;
  o += `[/POST]\n`;
  o += `\`\`\`\n\n`;
  o += `These blocks are mandatory. Skipping them means the change was not properly considered.\n`;
  o += `\n## Definition of Done (Ref: Scrum Guide 2020 — Definition of Done)\n`;
  o += `A feature is NOT complete until:\n`;
  o += `- [ ] Unit tests cover service/domain logic (Ref: Martin Fowler — Test Pyramid)\n`;
  o += `- [ ] Integration test verifies component interaction through the API layer (Ref: Fowler — Integration Testing)\n`;
  o += `- [ ] Error responses use correct HTTP status codes: 400, 401, 403, 404, 409, 422 (Ref: RFC 7231 §6)\n`;
  o += `- [ ] \`archkit review --staged\` passes with zero errors\n`;
  o += `- [ ] Health check endpoint returns 200 when all dependencies are reachable (Ref: Kubernetes — Readiness Probes)\n`;
  o += `\n## Session Management\n`;
  o += `Maintain a running task list. Before starting work:\n`;
  o += `1. Run \`archkit resolve warmup\` — check system health (blockers = stop, warnings = note and proceed)\n`;
  o += `2. Break the task into steps. Write them down.\n`;
  o += `3. Check off each step as you complete it.\n\n`;
  o += `Available tools (use when relevant, not as a mandatory sequence):\n`;
  o += `| Tool | When to Use |\n`;
  o += `|------|-------------|\n`;
  o += `| \`archkit resolve context "<prompt>"\` | Unsure which files/features are involved |\n`;
  o += `| \`archkit resolve preflight <feature> <layer>\` | Before modifying an existing feature |\n`;
  o += `| \`archkit resolve scaffold <feature>\` | Creating a new feature from scratch |\n`;
  o += `| \`archkit resolve plan "<prompt>"\` | Need a structured implementation plan |\n`;
  o += `| \`archkit review --staged\` | Before committing — final quality gate |\n`;
  o += `| \`archkit gotcha --debrief\` | End of session — capture what you learned |\n`;
  o += `\n### External Skill Integration\n`;
  o += `If using external workflow skills (superpowers, custom skills, etc.):\n`;
  o += `- External skills do NOT replace archkit commands\n`;
  o += `- BEFORE any task execution: \`archkit resolve warmup\`\n`;
  o += `- BEFORE each feature task: \`archkit resolve preflight <feature> <layer>\`\n`;
  o += `- BEFORE each commit: \`archkit review --staged\`\n`;
  if (hasJsTsStack(cfg)) {
    o += `- AFTER completing a plan: \`archkit resolve verify-wiring src/\`\n`;
  }
  o += `- AT session end: \`archkit gotcha --debrief\` (or report via --json)\n`;
  if (cfg.includeDelegation !== false) {
    o += `\n## Delegation Principle\n`;
    o += `Delegate everything deterministic to sub-agents and CLI tools first. The main agent finalizes with judgment.\n\n`;
    o += `### Sub-agent first (70-80% of the work, cheap tokens):\n`;
    o += `- Scaffolding files and boilerplate: \`archkit resolve scaffold\` + sub-agent generates from checklist\n`;
    o += `- Resolving context and dependencies: \`archkit resolve context\` + \`archkit resolve preflight\`\n`;
    o += `- Checking code against rules: \`archkit review --agent\` (sub-agent reads JSON, reports findings)\n`;
    o += `- Looking up patterns and gotchas: \`archkit resolve lookup\` (sub-agent applies, not re-derives)\n`;
    o += `- Repetitive CRUD: sub-agent clones patterns from existing features, doesn't reason from scratch\n\n`;
    o += `### Main agent finalizes (20-30% of the work, expensive tokens):\n`;
    o += `- Review sub-agent output with TDD approach: write failing test FIRST, then verify the generated code passes\n`;
    o += `- Handle edge cases, error paths, and security concerns that require judgment\n`;
    o += `- Make architectural decisions (should this be a new feature or extend an existing one?)\n`;
    o += `- Resolve ambiguity in requirements\n`;
    o += `- Final code review: does this fit the system, not just work in isolation?\n\n`;
    o += `### The TDD finalization loop:\n`;
    o += `1. Sub-agent generates implementation from scaffold/checklist\n`;
    o += `2. Main agent writes a failing test that captures the REAL requirement\n`;
    o += `3. Main agent verifies sub-agent code passes (or fixes the delta)\n`;
    o += `4. Main agent runs \`archkit review --agent\` as final gate\n`;
    o += `5. If review passes: done. If not: fix findings, re-run.\n`;
  }
  return o;
}

export function genIndexMd(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `# INDEX.md\n\n`;
  o += `## Conv: ${at.folderConv}\n`;
  o += `## Shared: ${at.sharedConv}\n\n`;
  o += `## Keywords → Nodes\n`;
  cfg.features.forEach(f => o += `${f.keywords} → @${f.id}\n`);
  o += `\n`;
  if (cfg.skills.length > 0) {
    o += `## Keywords → Playbooks\n`;
    cfg.skills.forEach(sid => {
      const sk = SKILL_CATALOG.find(s => s.id === sid);
      if (sk) o += `${sk.keywords} → $${sk.id}\n`;
    });
    o += `\n`;
  }
  o += `## Nodes → Clusters → Files\n`;
  cfg.features.forEach(f => {
    let base;
    if (["saas","ecommerce","mobile"].includes(cfg.appType)) base = `src/features/${f.id}/`;
    else if (cfg.appType === "data") base = `pipelines/ + api/ + semantic/`;
    else if (cfg.appType === "realtime") base = `src/handlers/ + src/domain/`;
    else if (cfg.appType === "ai") base = `src/chains/ + src/prompts/`;
    else if (cfg.appType === "content") base = `src/pages/ + src/components/`;
    else if (cfg.appType === "ios-swift") {
      const Id = f.id.charAt(0).toUpperCase() + f.id.slice(1);
      base = `Sources/${Id}/Views/ + Sources/${Id}/ViewModels/ + Sources/Services/`;
    }
    else base = `src/${f.id}/`;
    o += `@${f.id} = [${f.id}] → ${base}\n`;
  });
  o += `\n`;
  if (cfg.skills.length > 0) {
    o += `## Playbooks → Files\n`;
    cfg.skills.forEach(s => o += `$${s} → .arch/playbooks/${s}.playbook\n`);
    o += `\n`;
  }
  o += `## Cross-Refs\n`;
  if (cfg.crossRefs === "ai") {
    o += `# AI-INFERRED: Analyze the features below and determine dependencies during code generation.\n`;
    o += `# The AI agent should map relationships between these features based on their capabilities:\n`;
    cfg.features.forEach(f => o += `# @${f.id} — ${f.name} (${f.keywords})\n`);
    o += `# Output format: @feature_a → @feature_b (reason)\n`;
  } else if (cfg.crossRefs && cfg.crossRefs.length > 0) {
    cfg.crossRefs.forEach(ref => o += `@${ref.from} → @${ref.to} (${ref.reason})\n`);
  } else {
    o += `# TODO: Map which features depend on which other features\n`;
    cfg.features.forEach((f, i) => {
      if (i < cfg.features.length - 1) o += `# @${f.id} → @${cfg.features[i+1].id} (describe relationship)\n`;
    });
  }
  return o;
}

export function genGraph(feature, cfg) {
  const at = APP_TYPES[cfg.appType];
  const id = feature.id;
  const Id = id.charAt(0).toUpperCase() + id.slice(1);
  let o = `--- ${id} [feature] ---\n`;
  switch (at.graphGen) {
    case "layered":
      o += `${Id}Cont  [C]    : ${feature.name} routes | $auth → THIS → ${Id}Ser\n`;
      o += `${Id}Ser   [S]    : ${feature.name} business logic | ${Id}Cont ← THIS → ${Id}Repo ⇒ Evt${Id}Changed\n`;
      o += `${Id}Repo  [R]    : ${id} tables${at.reservedWords["$rls"]?", RLS $tenant":""} | ${Id}Ser ← THIS → $db\n`;
      o += `${Id}Type  [T]    : ${Id}, Create${Id}Dto, Update${Id}Dto\n`;
      o += `${Id}Val   [V]    : Zod schemas for ${id} input | ${Id}Cont ← THIS\n`;
      o += `${Id}Test  [X]    : unit + integration tests\n`;
      break;
    case "realtime":
      o += `Hnd${Id}   [H]    : ${feature.name} message handler | GateConn ← THIS → Dom${Id},Pers${Id}\n`;
      o += `Dom${Id}   [D]    : ${feature.name} pure logic (no I/O) | Hnd${Id} ← THIS\n`;
      o += `Pers${Id}  [R~]   : ${feature.name} async persistence | Hnd${Id} ← THIS → $db\n`;
      break;
    case "data":
      o += `Pipe${Id}  [P]    : ${feature.name} pipeline | Upstream ← THIS → $ch\n`;
      o += `Sem${Id}   [U]    : ${feature.name} Cube metric/dim | $ch → THIS → APIQuery\n`;
      break;
    case "ai":
      o += `Chain${Id} [L]    : ${feature.name} chain | API ← THIS → $llm,$vec,$guard\n`;
      o += `Prompt${Id}Sys [T] : ${feature.name} system prompt | Chain${Id} ← THIS\n`;
      o += `Eval${Id}  [X]    : ${feature.name} eval suite | Chain${Id} ← THIS\n`;
      break;
    case "mobile":
      o += `Scr${Id}   [D]    : ${feature.name} screen (thin) | $nav ← THIS → Hook${Id}\n`;
      o += `Hook${Id}  [U]    : ${feature.name} hook | Scr${Id} ← THIS → Ser${Id}\n`;
      o += `Ser${Id}   [S]    : ${feature.name} service | Hook${Id} ← THIS → $api,DB${Id}\n`;
      o += `DB${Id}    [R]    : ${feature.name} local model | Ser${Id} ← THIS → $sync\n`;
      break;
    case "swift":
      o += `${Id}View  [D]    : ${feature.name} SwiftUI view (thin) | $route ← THIS → ${Id}VM\n`;
      o += `${Id}VM    [U]    : ${feature.name} ViewModel (@Observable, @MainActor) | ${Id}View ← THIS → ${Id}Svc\n`;
      o += `${Id}Svc   [S]    : ${feature.name} service (async/await) | ${Id}VM ← THIS → $api,${Id}Local\n`;
      o += `${Id}Local [R]    : ${feature.name} SwiftData store | ${Id}Svc ← THIS → $local\n`;
      o += `${Id}Model [T]    : ${Id}, ${Id}DTO (Codable)\n`;
      break;
    case "content":
      o += `Pg${Id}    [D]    : ${feature.name} page (static) | $cms → THIS → $seo,$img\n`;
      break;
    case "internal":
      o += `Pg${Id}    [C]    : ${feature.name} page | $auth → THIS → $replica/$primary → $audit\n`;
      break;
    default:
      o += `${Id}      [S]    : ${feature.name} | THIS → $db\n`;
  }
  o += `---\n`;
  return o;
}

export function genInfraGraph(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `--- infra [shared,critical] ---\n`;
  if (at.reservedWords["$db"]) o += `DB        [R#*]  : ${at.reservedWords["$db"].split("—")[0].trim()} | AllRepos → THIS\n`;
  if (at.reservedWords["$cache"]) o += `Cache     [R#*]  : ${at.reservedWords["$cache"].split("—")[0].trim()} | Sers → THIS\n`;
  if (at.reservedWords["$err"]) o += `Err       [U*]   : ${at.reservedWords["$err"].split("—")[0].trim()} | AllSers ← THIS\n`;
  if (at.reservedWords["$bus"]) o += `EvtBus    [U*~]  : ${at.reservedWords["$bus"].split("—")[0].trim()} | AllSers ↔ THIS\n`;
  o += `---\n`;
  if (["saas","ecommerce","mobile","data","ai","content"].includes(cfg.appType)) {
    o += `\n--- middleware [shared] ---\n`;
    o += `MidAuth   [M*$]  : JWT validate, attach user+perms | AllConts → THIS\n`;
    if (at.reservedWords["$tenant"]) o += `MidTen    [M*$]  : Extract tenant_id, set RLS var | AllConts → THIS → MidAuth\n`;
    o += `MidErr    [M*]   : Catch typed errors, return JSON | App → THIS → Err\n`;
    o += `---\n`;
  }
  if (cfg.appType === "realtime") {
    o += `\n--- gateway [connection-lifecycle] ---\n`;
    o += `GateConn     [G#!$] : WS handshake, JWT auth, heartbeat | Clients ↔ THIS\n`;
    o += `GateRooms    [G#]   : Join/leave, member tracking, broadcast | GateConn ← THIS ↔ $pubsub\n`;
    o += `GatePresence [G#~]  : Online/offline/typing (ephemeral) | GateConn ← THIS ↔ $cache\n`;
    o += `---\n`;
  }
  // Hosting edge: append the slice for the chosen branch so the graph shows how
  // the API, DB, and storage sit behind Caddy. Cloud = public Hetzner VPS edge;
  // Self-host = local rig edge (TLS + monitoring + backups), mirroring shape.
  const hosting = resolveHostingChoice(cfg);
  if (hosting === "cloud") {
    o += genHetznerInfraSlice(cfg);
  } else if (hosting === "self-host") {
    o += genSelfHostInfraSlice(cfg);
  }
  return o;
}

// ═══════════════════════════════════════════════════════════════════════════
// HETZNER / CLOUD VPS — full IaC generation (Terraform/hcloud + cloud-init +
// Caddy + docker-compose + deploy runbook). All pure: given a cfg, return text.
//
// Everything is parameterized by two decision-aware choices the Swift archetype
// already records: the server stack (Vapor/Hono/FastAPI) and the storage option
// (MinIO / local-disk+Caddy / Postgres-only), plus the hosting choice (cloud).
// ═══════════════════════════════════════════════════════════════════════════

// Per-server-stack container facts for the generated compose + Caddy upstream.
const HETZNER_SERVER_META = {
  vapor:   { runtime: "Vapor (Swift)",     port: 8080, base: "swift:5.10-jammy",   start: "./Run serve --hostname 0.0.0.0 --port 8080" },
  hono:    { runtime: "Hono (TypeScript)", port: 3000, base: "node:22-slim",       start: "node dist/index.js" },
  fastapi: { runtime: "FastAPI (Python)",  port: 8000, base: "python:3.12-slim",   start: "uvicorn app.main:app --host 0.0.0.0 --port 8000" },
};

export function resolveHostingChoice(cfg) {
  const at = APP_TYPES[cfg.appType];
  if (!at || !at.hostingOptions) return null;
  return cfg.stackDecision?.hosting?.chosen || at.defaultHosting || null;
}
export function resolveServerStackChoice(cfg) {
  const at = APP_TYPES[cfg.appType];
  if (!at || !at.serverStackOptions) return null;
  return cfg.stackDecision?.serverStack?.chosen || at.defaultServerStack || null;
}
export function resolveStorageChoice(cfg) {
  const at = APP_TYPES[cfg.appType];
  if (!at || !at.storageOptions) return null;
  return cfg.stackDecision?.storage?.chosen || at.defaultStorage || null;
}

function hetznerServerMeta(cfg) {
  const id = resolveServerStackChoice(cfg) || "vapor";
  return { id, ...(HETZNER_SERVER_META[id] || HETZNER_SERVER_META.vapor) };
}

// Project slug used for resource names / paths (kebab, safe for Terraform + dirs).
function projectSlug(cfg) {
  return (cfg.appName || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
}

// infra.graph slice for the Cloud/Hetzner TLS edge: Caddy → Api → DB (+storage).
export function genHetznerInfraSlice(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  let o = `\n--- hetzner-edge [infra,critical] ---\n`;
  o += `Caddy   [N#*$] : automatic-TLS reverse proxy (Let's Encrypt, :80/:443) | Internet → THIS → Api\n`;
  o += `Api     [S#]   : ${m.runtime} app container (:${m.port}) | Caddy → THIS → DB${storage === "postgres-only" ? "" : ",Store"}\n`;
  o += `DB      [R#*]  : PostgreSQL 16 container (Docker volume db_data) | Api → THIS\n`;
  if (storage === "minio") {
    o += `Store   [R#*]  : MinIO S3 object storage (presigned URLs, volume minio_data) | Api → THIS\n`;
  } else if (storage === "local-disk-caddy") {
    o += `Store   [N#]   : Caddy file_server on local disk (/srv/media) | Caddy → THIS ; Api → THIS\n`;
  } else if (storage === "postgres-only") {
    o += `Store   [R#]   : binary blobs in PostgreSQL (bytea/large objects) | Api → DB (no separate store)\n`;
  }
  o += `---\n`;
  return o;
}

export function genHetznerTerraform(cfg) {
  const slug = projectSlug(cfg);
  const stack = resolveServerStackChoice(cfg) || "vapor";
  const storage = resolveStorageChoice(cfg) || "minio";

  const main = `# ${cfg.appName} — Hetzner Cloud (hcloud) infrastructure
# Generated by archkit. Provisions: SSH key + primary IPv4 + firewall + server.
# Bootstraps via ../cloud-init.yaml (Docker, Caddy, ufw, fail2ban, deploy user).

terraform {
  required_version = ">= 1.6"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

resource "hcloud_ssh_key" "deploy" {
  name       = "\${var.project}-deploy"
  public_key = var.ssh_public_key
}

resource "hcloud_primary_ip" "main" {
  name          = "\${var.project}-ipv4"
  type          = "ipv4"
  datacenter    = var.datacenter
  assignee_type = "server"
  auto_delete   = false
}

resource "hcloud_firewall" "main" {
  name = "\${var.project}-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "main" {
  name         = var.project
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.main.id]

  public_net {
    ipv4 = hcloud_primary_ip.main.id
  }

  # cloud-init bootstrap. ssh_public_key + project are injected as template vars.
  user_data = templatefile("\${path.module}/../cloud-init.yaml", {
    ssh_public_key = var.ssh_public_key
    project        = var.project
  })

  labels = {
    project = var.project
    stack   = var.server_stack
    storage = var.storage
  }
}
`;

  const variables = `variable "hcloud_token" {
  type        = string
  sensitive   = true
  description = "Hetzner Cloud API token (project-scoped, read+write)."
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key contents for the deploy user (e.g. file(\\"~/.ssh/id_ed25519.pub\\"))."
}

variable "project" {
  type    = string
  default = "${slug}"
}

variable "server_type" {
  type        = string
  default     = "cx22"
  description = "Hetzner server type (cx22 = 2 vCPU / 4 GB — a sane starter)."
}

variable "location" {
  type    = string
  default = "nbg1"
}

variable "datacenter" {
  type    = string
  default = "nbg1-dc3"
}

# Recorded by the archkit Stack Decision — kept as labels for drift visibility.
variable "server_stack" {
  type    = string
  default = "${stack}"
}

variable "storage" {
  type    = string
  default = "${storage}"
}
`;

  const outputs = `output "server_ipv4" {
  value       = hcloud_server.main.ipv4_address
  description = "Public IPv4 — point your DNS A record (and the DOMAIN env) at this."
}

output "deploy_ssh" {
  value       = "ssh deploy@\${hcloud_server.main.ipv4_address}"
  description = "SSH in as the non-root deploy user."
}
`;

  const tfvars = `# Copy to terraform.tfvars and fill in. NEVER commit the real token.
hcloud_token   = "REPLACE_WITH_HCLOUD_TOKEN"
ssh_public_key = "ssh-ed25519 AAAA... you@host"
# project      = "${slug}"
# server_type  = "cx22"
# location     = "nbg1"
`;

  return { main, variables, outputs, tfvars };
}

export function genHetznerCloudInit(cfg) {
  // NOTE: this file is consumed via Terraform templatefile() — ${ssh_public_key}
  // and ${project} are interpolated there. Any other literal shell $ must be
  // escaped as $${...}; this template intentionally uses none.
  return `#cloud-config
# ${cfg.appName} — Hetzner VPS bootstrap (Docker + Caddy + ufw + fail2ban + deploy user)
# Rendered by Terraform templatefile(): \${ssh_public_key} and \${project} are injected.

users:
  - name: deploy
    groups: [sudo, docker]
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - \${ssh_public_key}

package_update: true
package_upgrade: true
packages:
  - ca-certificates
  - curl
  - ufw
  - fail2ban

write_files:
  - path: /etc/fail2ban/jail.local
    content: |
      [sshd]
      enabled  = true
      port     = ssh
      maxretry = 3
      bantime  = 1h
      findtime = 10m

runcmd:
  # ── Docker engine + compose plugin ──────────────────────────────────────
  - curl -fsSL https://get.docker.com | sh
  - systemctl enable --now docker
  - usermod -aG docker deploy
  # ── Host firewall (deny inbound except SSH/HTTP/HTTPS) ───────────────────
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable
  # ── fail2ban (SSH brute-force protection) ────────────────────────────────
  - systemctl enable --now fail2ban
  # ── App directory owned by the deploy user ────────────────────────────────
  - mkdir -p /opt/\${project}
  - chown -R deploy:deploy /opt/\${project}
`;
}

export function genHetznerCaddyfile(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  let o = `# ${cfg.appName} — Caddy reverse proxy with automatic HTTPS (Let's Encrypt).
# DOMAIN is supplied via the environment (see infra/.env.example). Caddy obtains
# and renews TLS certs automatically on :80/:443.

{$DOMAIN} {
\tencode gzip
`;
  if (storage === "local-disk-caddy") {
    o += `
\t# Storage = local disk: Caddy serves uploaded media directly off /srv/media.
\thandle_path /media/* {
\t\troot * /srv/media
\t\tfile_server
\t}

`;
  }
  o += `\t# Everything else proxies to the ${m.runtime} app container.
\treverse_proxy api:${m.port}
}
`;
  if (storage === "minio") {
    o += `
# Storage = MinIO: expose the S3 API on an s3. subdomain (presigned URLs).
s3.{$DOMAIN} {
\treverse_proxy minio:9000
}
`;
  }
  return o;
}

export function genHetznerCompose(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  const slug = projectSlug(cfg);

  const caddyVolumes = [
    `      - ./Caddyfile:/etc/caddy/Caddyfile:ro`,
    `      - caddy_data:/data`,
    `      - caddy_config:/config`,
    ...(storage === "local-disk-caddy" ? [`      - media:/srv/media`] : []),
  ].join("\n");

  // Per-storage env + volumes for the api service.
  let apiStorageEnv = "";
  let apiVolumes = "";
  if (storage === "minio") {
    apiStorageEnv =
      `      S3_ENDPOINT: http://minio:9000\n` +
      `      S3_BUCKET: media\n` +
      `      S3_ACCESS_KEY: \${MINIO_ROOT_USER}\n` +
      `      S3_SECRET_KEY: \${MINIO_ROOT_PASSWORD}\n`;
  } else if (storage === "local-disk-caddy") {
    apiStorageEnv = `      MEDIA_DIR: /srv/media\n`;
    apiVolumes = `    volumes:\n      - media:/srv/media\n`;
  } else if (storage === "postgres-only") {
    apiStorageEnv = `      # Storage = Postgres-only: blobs live in the DB (bytea / large objects).\n`;
  }

  const minioService = storage === "minio"
    ? `
  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD}
    volumes:
      - minio_data:/data
    expose:
      - "9000"
      - "9001"
`
    : "";

  const volumes = [
    `  caddy_data:`,
    `  caddy_config:`,
    `  db_data:`,
    ...(storage === "minio" ? [`  minio_data:`] : []),
    ...(storage === "local-disk-caddy" ? [`  media:`] : []),
  ].join("\n");

  return `# ${cfg.appName} — production compose for the Hetzner VPS.
# Server stack: ${m.runtime} | Storage: ${storage}
# Bring up with:  docker compose --env-file .env up -d --build
# Secrets come from .env (see .env.example). NEVER commit the real .env.

services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: \${DOMAIN}
    volumes:
${caddyVolumes}
    depends_on:
      - api

  api:
    build:
      context: ../..
      dockerfile: Dockerfile
    image: ${slug}-api:latest
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://app:\${POSTGRES_PASSWORD}@db:5432/app
${apiStorageEnv}    expose:
      - "${m.port}"
${apiVolumes}    depends_on:
      - db

  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - db_data:/var/lib/postgresql/data
${minioService}
volumes:
${volumes}
`;
}

export function genHetznerEnvExample(cfg) {
  const storage = resolveStorageChoice(cfg) || "minio";
  let o = `# ${cfg.appName} — infra secrets. Copy to .env on the server. NEVER commit the real file.
DOMAIN=api.example.com
POSTGRES_PASSWORD=change-me-strong
`;
  if (storage === "minio") {
    o += `MINIO_ROOT_USER=change-me\nMINIO_ROOT_PASSWORD=change-me-strong\n`;
  }
  return o;
}

export function genHetznerSkill(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  const slug = projectSlug(cfg);
  const storageLabel = { minio: "MinIO (self-hosted S3)", "local-disk-caddy": "local disk + Caddy file server", "postgres-only": "Postgres-only (bytea/large objects)" }[storage] || storage;

  return `# hetzner.playbook

## Meta
infra: Hetzner Cloud VPS — Terraform/hcloud + cloud-init + Caddy + docker-compose
server_stack: ${m.runtime}
storage: ${storageLabel}
docs: https://docs.hetzner.com/cloud/ | https://caddyserver.com/docs/
updated: ${new Date().toISOString().split("T")[0]}

## Use
Deploys ${cfg.appName}'s backend to a single Hetzner VPS: Caddy terminates TLS
(automatic Let's Encrypt) and reverse-proxies to the ${m.runtime} \`api\` container
on :${m.port}, backed by a PostgreSQL container${storage === "minio" ? " and a MinIO S3 container" : storage === "local-disk-caddy" ? " with media served off local disk by Caddy" : " (binary blobs live in Postgres)"}.
Infrastructure is in \`infra/\` — Terraform provisions the box, cloud-init bootstraps it,
compose runs the app.

## Provision (once)
\`\`\`bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill hcloud_token + ssh_public_key
terraform init
terraform apply                                # creates SSH key, IPv4, firewall, server
terraform output deploy_ssh                    # -> ssh deploy@<ip>
\`\`\`
Point a DNS A record for your DOMAIN at \`terraform output server_ipv4\`, then set
\`DOMAIN=\` in \`infra/.env\` on the server.

## Deploy Runbook (build → push image → compose up → Caddy reload)
\`\`\`bash
# 1. BUILD the app image (locally or in CI)
docker build -t ${slug}-api:latest .

# 2. PUSH it where the server can pull it (registry), OR build on the box:
#    - registry:  docker push <registry>/${slug}-api:latest
#    - on-box:    rsync the repo to /opt/${slug} and build there

# 3. COMPOSE UP on the server (as the deploy user)
ssh deploy@<server-ip>
cd /opt/${slug}/infra
docker compose --env-file .env pull        # if using a registry
docker compose --env-file .env up -d --build

# 4. RELOAD Caddy after editing infra/Caddyfile (no full restart, no dropped TLS)
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
\`\`\`

## Gotchas
WRONG: Open the firewall to the app port (e.g. :${m.port}) so you can hit it directly.
RIGHT: Keep ufw + the hcloud firewall to 22/80/443 only; reach the app through Caddy.
WHY: Exposing the app port bypasses TLS and the reverse proxy — plaintext + no cert renewal.

WRONG: \`docker compose restart caddy\` to pick up a Caddyfile change.
RIGHT: \`docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile\`.
WHY: A restart drops connections and re-runs the ACME handshake; reload is graceful and keeps certs.

WRONG: Set DOMAIN before the DNS A record resolves to the server IP.
RIGHT: Create the A record first, confirm it resolves, then bring Caddy up.
WHY: Let's Encrypt HTTP-01 fails if the domain doesn't already point at the box — you'll hit rate limits.

WRONG: Commit terraform.tfvars / .env with the hcloud token and Postgres password.
RIGHT: Keep them gitignored; inject via CI secrets or fill them only on the server.
WHY: A leaked hcloud token can spin up billable servers; a leaked DB password is game over.
${storage === "minio" ? `
WRONG: Serve MinIO objects by proxying every download through the api container.
RIGHT: Hand out presigned S3 URLs (s3.\${DOMAIN}) so clients fetch directly from MinIO.
WHY: Proxying media through the app wastes the api container's memory/bandwidth and kills throughput.
` : storage === "local-disk-caddy" ? `
WRONG: Stream uploaded files back through the api container on every request.
RIGHT: Write to /srv/media and let Caddy's file_server serve /media/* directly.
WHY: Caddy serving static files is far faster and frees the app to do real work.
` : `
WRONG: Stuff large media as bytea and SELECT whole blobs into app memory.
RIGHT: Stream large objects, or move to MinIO/object storage once media grows.
WHY: Postgres bloats the WAL and backups with binary blobs; it's fine for small assets only.
`}
## Boundaries
This skill covers provisioning + deploying the single-VPS edge (Caddy → api → db${storage === "minio" ? " → minio" : ""}).
It does NOT cover: app code, DB migrations, multi-node/K8s, or CDN. Scale-out is a separate decision.

## Snippets
\`\`\`bash
# Tail app logs
docker compose -f /opt/${slug}/infra/docker-compose.yml logs -f api

# One-off DB shell
docker compose exec db psql -U app -d app
\`\`\`
`;
}

// Coordinator: every Cloud/Hetzner artifact for a cfg, split into files written
// at the project root (infra/) and files written under .arch/ (the skill).
export function genHetznerArtifacts(cfg) {
  const tf = genHetznerTerraform(cfg);
  return {
    root: [
      { path: "infra/terraform/main.tf", content: tf.main },
      { path: "infra/terraform/variables.tf", content: tf.variables },
      { path: "infra/terraform/outputs.tf", content: tf.outputs },
      { path: "infra/terraform/terraform.tfvars.example", content: tf.tfvars },
      { path: "infra/cloud-init.yaml", content: genHetznerCloudInit(cfg) },
      { path: "infra/Caddyfile", content: genHetznerCaddyfile(cfg) },
      { path: "infra/docker-compose.yml", content: genHetznerCompose(cfg) },
      { path: "infra/.env.example", content: genHetznerEnvExample(cfg) },
    ],
    arch: [
      { path: "playbooks/hetzner.playbook", content: genHetznerSkill(cfg) },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-HOST (local server / rig) — full fleet plane, VENDORED from arch-server.
//
// The Self-host branch of the shared hostingOptions decision-set (the sibling of
// the Cloud/Hetzner branch above). Selecting hosting = "self-host" drives this
// path: it emits arch-server's complete fleet plane — a per-app registry
// descriptor, the app's compose, a Caddy automatic-TLS edge, the
// Prometheus/Loki/Grafana monitoring stack, ntfy notifications, a backup engine
// (+ systemd timer), and an rsync → `docker compose up -d` deploy flow — plus a
// .arch/skills/self-host.skill runbook and an infra.graph slice.
//
// Everything here is SELF-CONTAINED: no runtime import of the arch-server repo.
// The templates are vendored verbatim/genericized so a fresh local rig can be
// bootstrapped end to end. Parameterized by the same decision-aware choices the
// Hetzner branch uses: server stack (Vapor/Hono/FastAPI) + storage (MinIO /
// local-disk+Caddy / Postgres) + hosting (self-host).
// ═══════════════════════════════════════════════════════════════════════════

// ── Vendored fleet-app descriptor schema (mirrors arch-server
// packages/core/src/schema.ts — registry/apps/<app>.yaml). Kept as a real zod
// schema so the generated descriptor can be validated against it (the test gate
// asserts the emitted descriptor parses clean). ──────────────────────────────
export const healthCheckSchema = z.object({
  type: z.enum(["http", "tcp", "container", "none"]).default("container"),
  path: z.string().optional(),
  port: z.number().int().positive().optional(),
});

export const backupDbSchema = z.object({
  engine: z.literal("postgres").default("postgres"),
  container: z.string().min(1),
  user: z.string().default("postgres"),
});

export const backupSchema = z.object({
  paths: z.array(z.string()).default([]),
  volumes: z.array(z.string()).default([]),
  db: backupDbSchema.optional(),
  schedule: z.string().optional(),
});

export const appDescriptorSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  source: z.string().optional(),
  serverPath: z.string().min(1),
  compose: z.string().default("compose.yaml"),
  containers: z.array(z.string()).default([]),
  domain: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  expose: z.enum(["local", "external", "none"]).default("local"),
  port: z.number().int().positive().optional(),
  health: healthCheckSchema.default({ type: "container" }),
  backup: backupSchema.optional(),
  notify: z.array(z.enum(["ntfy", "email"])).default(["ntfy"]),
  dormant: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

const STORAGE_LABELS = {
  minio: "MinIO (self-hosted S3)",
  "local-disk-caddy": "local disk + Caddy file server",
  "postgres-only": "Postgres-only (bytea/large objects)",
};

// Minimal YAML emitter for the descriptor object shape (strings, numbers,
// booleans, string arrays, and one level of nested objects). Avoids pulling a
// YAML dependency just to serialize one well-known structure.
function yamlScalar(v) {
  if (typeof v === "string") {
    if (v === "" || /[:#{}\[\],&*!?|>'"%@`]/.test(v) || /^[\s-]/.test(v) || /\s$/.test(v)) {
      return JSON.stringify(v);
    }
    return v;
  }
  return String(v);
}
function toYaml(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) { out += `${pad}${k}: []\n`; continue; }
      out += `${pad}${k}:\n`;
      for (const item of v) out += `${pad}  - ${yamlScalar(item)}\n`;
    } else if (v && typeof v === "object") {
      out += `${pad}${k}:\n${toYaml(v, indent + 1)}`;
    } else {
      out += `${pad}${k}: ${yamlScalar(v)}\n`;
    }
  }
  return out;
}

// Build (and validate) the fleet-app descriptor object for the iOS-backend app,
// parameterized by the chosen server stack + storage. Returns the parsed object
// (defaults applied) — so callers get the same shape the arch-server loader does.
export function buildSelfHostDescriptor(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  const slug = projectSlug(cfg);

  const containers = [`${slug}-api`, `${slug}-db`];
  if (storage === "minio") containers.push(`${slug}-minio`);

  // docker compose prefixes named volumes with the project name (= slug here).
  const backup = {
    paths: storage === "local-disk-caddy" ? ["./media"] : [],
    volumes: [`${slug}_db_data`, ...(storage === "minio" ? [`${slug}_minio_data`] : [])],
    db: { engine: "postgres", container: `${slug}-db`, user: "postgres" },
    schedule: "0 3 * * *",
  };

  const desc = {
    name: slug,
    title: cfg.appName,
    // Laptop repo path — the rsync source for deploys (fill in for your rig).
    source: `/path/to/${slug}`,
    serverPath: `/home/rig/apps/${slug}`,
    compose: "compose.yaml",
    containers,
    domain: `${slug}.rig.home`,
    aliases: [],
    expose: "local",
    port: m.port,
    health: { type: "http", path: "/health", port: m.port },
    backup,
    notify: ["ntfy", "email"],
    dormant: false,
    tags: ["ios-backend", m.id, storage],
    notes: `${m.runtime} backend for ${cfg.appName}. Storage: ${STORAGE_LABELS[storage] || storage}. Deploys via rsync from source + docker compose up -d (see infra/deploy.sh).`,
  };
  return appDescriptorSchema.parse(desc);
}

export function genSelfHostDescriptor(cfg) {
  const desc = buildSelfHostDescriptor(cfg);
  const header = `# ${cfg.appName} — fleet-app descriptor (arch-server registry format).
# The single source of truth for this app on the rig: Caddy routing, health,
# backups, and notifications are all derived from this file. Validated against
# the vendored app-descriptor schema. Edit \`source\` to your laptop repo path
# and \`serverPath\`/\`domain\` to match your rig before deploying.
`;
  return header + toYaml(desc);
}

// ── App compose for the local rig ────────────────────────────────────────────
// One compose project per app (name = slug, so volumes are <slug>_db_data etc.,
// matching the descriptor's backup.volumes). The api publishes its port on
// localhost; the host-networking Caddy edge proxies to it. Parameterized by the
// chosen server stack + storage.
export function genSelfHostCompose(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  const slug = projectSlug(cfg);

  let apiStorageEnv = "";
  let apiVolumes = "";
  if (storage === "minio") {
    apiStorageEnv =
      `      S3_ENDPOINT: http://minio:9000\n` +
      `      S3_BUCKET: media\n` +
      `      S3_ACCESS_KEY: \${MINIO_ROOT_USER}\n` +
      `      S3_SECRET_KEY: \${MINIO_ROOT_PASSWORD}\n`;
  } else if (storage === "local-disk-caddy") {
    apiStorageEnv = `      MEDIA_DIR: /srv/media\n`;
    apiVolumes = `    volumes:\n      - ./media:/srv/media\n`;
  } else if (storage === "postgres-only") {
    apiStorageEnv = `      # Storage = Postgres-only: blobs live in the DB (bytea / large objects).\n`;
  }

  const minioService = storage === "minio"
    ? `
  minio:
    image: minio/minio:latest
    container_name: ${slug}-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD}
    volumes:
      - minio_data:/data
    networks:
      - arch_net
    ports:
      - "9000:9000"
      - "9001:9001"
`
    : "";

  const volumes = [
    `  db_data:`,
    ...(storage === "minio" ? [`  minio_data:`] : []),
  ].join("\n");

  return `# ${cfg.appName} — app compose for the local rig (self-host).
# Server stack: ${m.runtime} | Storage: ${STORAGE_LABELS[storage] || storage}
# Project name = ${slug} (so named volumes are ${slug}_db_data etc. — matches the
# registry descriptor's backup.volumes). The api publishes :${m.port} on the host;
# the host-networking Caddy edge (infra/caddy/) reverse-proxies to localhost:${m.port}.
# Bring up with:  docker compose --env-file .env up -d --build
name: ${slug}

services:
  api:
    build:
      context: ../..
      dockerfile: Dockerfile
    image: ${slug}-api:latest
    container_name: ${slug}-api
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://app:\${POSTGRES_PASSWORD}@db:5432/app
${apiStorageEnv}    ports:
      - "${m.port}:${m.port}"
${apiVolumes}    networks:
      - arch_net
    depends_on:
      - db

  db:
    image: postgres:16
    container_name: ${slug}-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - db_data:/var/lib/postgresql/data
    networks:
      - arch_net
${minioService}
networks:
  # Shared rig network (created once: docker network create arch_net).
  arch_net:
    external: true

volumes:
${volumes}
`;
}

export function genSelfHostEnvExample(cfg) {
  const storage = resolveStorageChoice(cfg) || "minio";
  const slug = projectSlug(cfg);
  let o = `# ${cfg.appName} — app secrets for the rig. Copy to .env. NEVER commit the real file.
RIG_DOMAIN=${slug}.rig.home
POSTGRES_PASSWORD=change-me-strong
`;
  if (storage === "minio") {
    o += `MINIO_ROOT_USER=change-me\nMINIO_ROOT_PASSWORD=change-me-strong\n`;
  }
  return o;
}

// ── Caddy automatic-TLS edge (local domain, internal CA) ─────────────────────
export function genSelfHostCaddyfile(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  let o = `# ${cfg.appName} — Caddy reverse proxy with automatic TLS for the LAN.
# RIG_DOMAIN is supplied via the environment (see infra/caddy/.env / your app
# .env). \`tls internal\` makes Caddy mint + auto-renew certs from its own root CA
# — install that CA on your devices once (caddy trust) and the local domain is
# HTTPS with no public DNS or Let's Encrypt. Caddy owns :80/:443 on the rig
# (host networking) and proxies to the app on localhost.

{$RIG_DOMAIN} {
\ttls internal
\tencode gzip
`;
  if (storage === "local-disk-caddy") {
    o += `
\t# Storage = local disk: Caddy serves uploaded media directly off /srv/media.
\thandle_path /media/* {
\t\troot * /srv/media
\t\tfile_server
\t}

`;
  }
  o += `\t# Everything else proxies to the ${m.runtime} app container on the host.
\treverse_proxy localhost:${m.port}
}
`;
  if (storage === "minio") {
    o += `
# Storage = MinIO: expose the S3 API on an s3. subdomain (presigned URLs).
s3.{$RIG_DOMAIN} {
\ttls internal
\treverse_proxy localhost:9000
}
`;
  }
  return o;
}

const SELFHOST_CADDY_COMPOSE = `# Caddy reverse proxy for the rig — owns :80/:443 and serves {$RIG_DOMAIN} over
# the LAN with local (internal-CA) TLS. Host networking: Caddy binds the ports
# directly on the host and reaches every app over localhost (works for both
# host-network apps and bridge apps that publish a host port). The caddy-data
# volume holds the internal root CA + issued certs — it MUST persist, or every
# restart mints a new CA your devices must re-trust.
name: caddy

services:
  caddy:
    image: caddy:2
    container_name: caddy
    restart: always
    network_mode: host
    environment:
      - RIG_DOMAIN=\${RIG_DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config

volumes:
  caddy-data:
  caddy-config:
`;

// ── Monitoring stack: Prometheus + Grafana + Loki + Promtail + Alertmanager +
// node-exporter + cAdvisor (vendored from arch-server, genericized). ──────────
const SELFHOST_MONITORING_COMPOSE = `# Canonical monitoring stack for the rig. One compose, one project (monitoring),
# one bridge. Prometheus scrapes host + container metrics; Loki+Promtail collect
# logs; Grafana visualizes; Alertmanager routes alerts to the ntfy bridge.
name: monitoring

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: always
    volumes:
      - ./prometheus:/etc/prometheus
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.enable-lifecycle'
    ports:
      - "9090:9090"
    networks:
      - monitoring

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: always
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    ports:
      - "3000:3000"
    networks:
      - monitoring

  node-exporter:
    image: prom/node-exporter:latest
    container_name: node-exporter
    restart: always
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--path.rootfs=/rootfs'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)(\$\$|/)'
      # Textfile collector: the backup engine drops *.prom here for node-exporter
      # to scrape (feeds the BackupFailed/BackupStale rules).
      - '--collector.textfile.directory=/var/lib/node_exporter/textfile'
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
      - \${HOME}/infra/node_exporter/textfile:/var/lib/node_exporter/textfile:ro
    ports:
      - "9100:9100"
    networks:
      - monitoring

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: cadvisor
    restart: always
    privileged: true
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    ports:
      - "8080:8080"
    networks:
      - monitoring

  loki:
    image: grafana/loki:latest
    container_name: loki
    restart: always
    volumes:
      - ./loki:/etc/loki
      - loki-data:/loki
    command:
      - '-config.file=/etc/loki/loki-config.yml'
      - '-validation.allow-structured-metadata=false'
    ports:
      - "3100:3100"
    networks:
      - monitoring

  promtail:
    image: grafana/promtail:latest
    container_name: promtail
    user: root
    restart: always
    volumes:
      - ./promtail:/etc/promtail
      - /var/log:/var/log:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - promtail-positions:/var/lib/promtail
    command: -config.file=/etc/promtail/promtail-config.yml
    networks:
      - monitoring

  alertmanager:
    image: prom/alertmanager:latest
    container_name: alertmanager
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: always
    volumes:
      - ./alertmanager:/etc/alertmanager
      - alertmanager-data:/alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
    ports:
      - "9093:9093"
    networks:
      - monitoring

networks:
  monitoring:
    driver: bridge

volumes:
  prometheus-data:
  grafana-data:
  loki-data:
  alertmanager-data:
  promtail-positions:
`;

export function genSelfHostPrometheusYml(cfg) {
  const m = hetznerServerMeta(cfg);
  const slug = projectSlug(cfg);
  return `global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager:9093

rule_files:
  - "alerts.yml"

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']

  # ${cfg.appName} API (${m.runtime}). Expose a /metrics endpoint on :${m.port}
  # for this to scrape; reached over the host gateway from the monitoring bridge.
  - job_name: '${slug}-api'
    scrape_interval: 30s
    static_configs:
      - targets: ['host.docker.internal:${m.port}']
    metrics_path: /metrics
`;
}

const SELFHOST_PROM_ALERTS = `groups:
  - name: host_alerts
    interval: 30s
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage detected on {{ $labels.instance }}"
          description: "CPU usage is above 80% (current value: {{ $value | printf \\"%.1f\\" }}%)"

      - alert: CriticalCPUUsage
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 95
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "CRITICAL: CPU usage on {{ $labels.instance }}"
          description: "CPU usage is above 95% (current value: {{ $value | printf \\"%.1f\\" }}%)"

      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage on {{ $labels.instance }}"
          description: "Memory usage is above 85% (current value: {{ $value | printf \\"%.1f\\" }}%)"

      - alert: CriticalMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 95
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "CRITICAL: Memory exhaustion on {{ $labels.instance }}"
          description: "Memory usage is above 95% (current value: {{ $value | printf \\"%.1f\\" }}%)"

      - alert: DiskSpaceWarning
        expr: (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 < 20
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Low disk space on {{ $labels.instance }}"
          description: "Root filesystem below 20% free (current: {{ $value | printf \\"%.1f\\" }}%)"

      - alert: CriticalDiskSpace
        expr: (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 < 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "CRITICAL: Disk space critically low on {{ $labels.instance }}"
          description: "Root filesystem below 10% free (current: {{ $value | printf \\"%.1f\\" }}%)"

      - alert: HostDown
        expr: up{job="node-exporter"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Host is down: {{ $labels.instance }}"
          description: "node-exporter has been unreachable for more than 1 minute."

  - name: container_alerts
    interval: 30s
    rules:
      # cAdvisor keeps exporting a frozen container_last_seen for stopped
      # containers, so we alert on the timestamp no longer advancing; max by
      # (name) avoids false-firing during a healthy redeploy. arch-backup-tmp-*
      # throwaway containers are excluded (they exit by design).
      - alert: ContainerDown
        expr: time() - max by (name) (container_last_seen{name!="",name!~"arch-backup-tmp-.*"}) > 120
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Container down: {{ $labels.name }}"
          description: "Container {{ $labels.name }} has not been seen by cAdvisor for over 2 minutes (stopped or crashed)."

      - alert: ContainerCrashLooping
        expr: changes(container_start_time_seconds{name!="",name!~"arch-backup-tmp-.*"}[15m]) > 3
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "Container crash-looping: {{ $labels.name }}"
          description: "Container {{ $labels.name }} restarted {{ $value }} times in the last 15 minutes."

  - name: backup_alerts
    interval: 1m
    rules:
      # Emitted by infra/backups/backup.sh via the node-exporter textfile
      # collector. Per-app label is \`app\` (job is reserved for the scrape target).
      - alert: BackupFailed
        expr: arch_backup_last_status == 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "Backup failed for {{ $labels.app }}"
          description: "The most recent backup run for {{ $labels.app }} reported failure."

      - alert: BackupStale
        expr: time() - arch_backup_last_success_timestamp_seconds > 26 * 3600
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "Backup stale for {{ $labels.app }}"
          description: "No successful backup for {{ $labels.app }} in over 26 hours."
`;

const SELFHOST_LOKI_CONFIG = `auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

limits_config:
  allow_structured_metadata: false

ruler:
  alertmanager_url: http://alertmanager:9093
  # Alertmanager 0.27+ removed the legacy v1 push API — the ruler MUST post via
  # v2 or firing log-alerts silently never arrive.
  enable_alertmanager_v2: true
  storage:
    type: local
    local:
      # With auth_enabled:false the ruler looks under <dir>/fake, so the rule
      # file ships at /etc/loki/rules/fake/log-alerts.yml.
      directory: /etc/loki/rules
  rule_path: /loki/rules-temp
  ring:
    kvstore:
      store: inmemory
  enable_api: true
`;

const SELFHOST_LOKI_RULES = `groups:
  - name: log_alerts
    interval: 1m
    # Patterns are anchored to structured SEVERITY (level=error, "level":50,
    # [FATAL], panic:, …) rather than bare words, and every selector excludes the
    # monitoring stack's own containers, so the pipeline never alerts on itself.
    rules:
      - alert: ErrorInLogs
        expr: |
          sum(rate({job="docker", container!~"loki|promtail|alertmanager|prometheus|grafana|cadvisor|node-exporter|ntfy.*"} |~ \`(?i)(level=error|"level":"error"|"level":50|\\[error\\])\` [5m])) by (container) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Error-level logs in {{ $labels.container }}"
          description: "Container {{ $labels.container }} has logged error-level messages for >5m"

      - alert: CriticalLogPattern
        expr: |
          sum(rate({job="docker", container!~"loki|promtail|alertmanager|prometheus|grafana|cadvisor|node-exporter|ntfy.*"} |~ \`(?i)(level=(fatal|critical)|"level":(60|"fatal"|"critical")|\\[fatal\\]|\\[critical\\]|panic:)\` [5m])) by (container) > 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "CRITICAL/FATAL log in {{ $labels.container }}"
          description: "Container {{ $labels.container }} has logged FATAL/CRITICAL/PANIC messages"
`;

const SELFHOST_PROMTAIL_CONFIG = `server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /var/lib/promtail/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  # Docker container logs via the Docker API — each stream gets real metadata
  # labels (container name, image, compose service). We relabel the container
  # name to \`container\`, which the Loki log-alert rules use to name the source
  # and to exclude the monitoring stack's own logs.
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 30s
    relabel_configs:
      - target_label: job
        replacement: docker
      - source_labels: ["__meta_docker_container_name"]
        regex: "/(.*)"
        target_label: container
      - source_labels: ["__meta_docker_container_log_stream"]
        target_label: stream
      - source_labels: ["__meta_docker_container_label_com_docker_compose_service"]
        target_label: compose_service
    pipeline_stages:
      - docker: {}

  - job_name: system
    static_configs:
      - targets:
          - localhost
        labels:
          job: syslog
          __path__: /var/log/syslog
`;

const SELFHOST_GRAFANA_DATASOURCES = `apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
    uid: prometheus

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    editable: true
    uid: loki
    jsonData:
      maxLines: 1000
`;

const SELFHOST_GRAFANA_DASHBOARDS = `apiVersion: 1

providers:
  - name: 'Default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
`;

// Alertmanager → ntfy bridge (self-contained: no SMTP/Pushover secrets). The
// bridge (infra/ntfy/) turns these webhooks into ntfy push notifications.
const SELFHOST_ALERTMANAGER_YML = `global:
  resolve_timeout: 5m

# All alerts route to the ntfy bridge (infra/ntfy/, published on :8096). The
# bridge lives in a different compose project, so it's reached over the host
# gateway. Add an email receiver here later if you want a second channel.
route:
  receiver: "ntfy"
  group_by: ["alertname", "severity"]
  group_wait: 10s
  group_interval: 5m
  repeat_interval: 12h

receivers:
  - name: "ntfy"
    webhook_configs:
      - url: "http://host.docker.internal:8096/hook"
        send_resolved: true

# A firing critical silences the matching warning so we don't double-notify.
inhibit_rules:
  - source_match:
      severity: "critical"
    target_match:
      severity: "warning"
    equal: ["alertname", "instance"]
`;

// ── ntfy notification stack (push server + Alertmanager bridge) ───────────────
const SELFHOST_NTFY_COMPOSE = `# ntfy + alertmanager bridge — the notification stack for the rig.
#   - ntfy              : self-hosted push server on :8095 (8080 is cadvisor).
#   - ntfy-alertmanager : turns Alertmanager webhooks into clean ntfy messages.
# Alertmanager (monitoring project) reaches the bridge over the host gateway
# (http://host.docker.internal:8096/hook); the bridge reaches ntfy by service DNS.
name: ntfy

services:
  ntfy:
    image: binwiederhier/ntfy:latest
    container_name: ntfy
    command: serve
    environment:
      - TZ=UTC
    volumes:
      - ./server.yml:/etc/ntfy/server.yml:ro
      - ntfy-cache:/var/cache/ntfy
      - ntfy-data:/var/lib/ntfy
    ports:
      - "8095:80"
    healthcheck:
      test:
        - "CMD-SHELL"
        - "wget -q -O - http://localhost:80/v1/health 2>/dev/null | grep -q '\\"healthy\\":true' || exit 1"
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    restart: unless-stopped

  ntfy-alertmanager:
    image: ghcr.io/alexbakker/alertmanager-ntfy:latest
    container_name: ntfy-alertmanager
    command: ["--configs", "/etc/alertmanager-ntfy/config.yml"]
    volumes:
      - ./alertmanager-ntfy.yml:/etc/alertmanager-ntfy/config.yml:ro
    ports:
      - "8096:8000"
    depends_on:
      ntfy:
        condition: service_healthy
    restart: unless-stopped

volumes:
  ntfy-cache:
  ntfy-data:
`;

const SELFHOST_NTFY_SERVER = `# ntfy server config (read by \`ntfy serve\`). Home LAN deployment: anonymous
# read-write is fine — the port is only bound on the home network. Tighten with
# auth-file + auth-default-access: deny-all if ntfy is ever exposed externally.
base-url: "http://localhost:8095"
listen-http: ":80"
auth-default-access: "read-write"

cache-file: "/var/cache/ntfy/cache.db"
cache-duration: "12h"
attachment-cache-dir: "/var/lib/ntfy/attachments"

behind-proxy: false
`;

const SELFHOST_ALERTMANAGER_NTFY = `# Config for ghcr.io/alexbakker/alertmanager-ntfy — the Alertmanager -> ntfy
# bridge. Loaded via \`--configs /etc/alertmanager-ntfy/config.yml\`.
http:
  addr: ":8000"

ntfy:
  baseurl: "http://ntfy"
  notification:
    topic: "rig-alerts"
    priority: |
      labels.severity == "critical" ? "urgent" : (labels.severity == "warning" ? "high" : "default")
    tags:
      - tag: rotating_light
        condition: status == "firing" && labels.severity == "critical"
      - tag: warning
        condition: status == "firing" && labels.severity == "warning"
      - tag: white_check_mark
        condition: status == "resolved"
    templates:
      title: |
        {{ if eq .Status "resolved" }}✅ Resolved: {{ end }}{{ index .Annotations "summary" }}
      description: |
        {{ index .Annotations "description" }}
    async: false
`;

// ── Backup engine (per-app: pg_dumpall + volume/path tar + ntfy + metric) ─────
// Driven entirely by manifest.json (derived from the registry descriptor). On
// every run it writes a node-exporter textfile metric and pushes ntfy, so the
// BackupFailed/BackupStale Prometheus rules escalate without SMTP.
const SELFHOST_BACKUP_SCRIPT = `#!/usr/bin/env bash
# Per-app backup engine for the rig. Driven by manifest.json (derived from the
# registry descriptors). Invoked by the systemd --user timer (arch-backup@.timer),
# one per app whose descriptor declares a backup.schedule.
#
#   - DB dump : docker exec <container> pg_dumpall -U <user> | gzip   (all dbs + roles)
#   - paths   : tar each backup.path read-only from inside a root busybox container
#   - volumes : tar each named volume read-only via a throwaway busybox container
# Artifacts land in ~/backups/<app>/; old ones are pruned. On every run it writes
# a node-exporter textfile metric and pushes ntfy (success=low, failure=urgent).
#
# Usage:  backup.sh <app>   |   backup.sh --all
set -uo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="\${ARCH_BACKUP_MANIFEST:-\$SCRIPT_DIR/manifest.json}"
BACKUP_ROOT="\${ARCH_BACKUP_ROOT:-\$HOME/backups}"
TEXTFILE_DIR="\${ARCH_TEXTFILE_DIR:-\$HOME/infra/node_exporter/textfile}"
NTFY_URL="\${ARCH_NTFY_URL:-http://localhost:8095}"
NTFY_TOPIC="\${ARCH_NTFY_TOPIC:-rig-alerts}"
RETENTION="\${ARCH_BACKUP_RETENTION:-7}"

STATE_DIR="\$TEXTFILE_DIR/.arch_backup_state"
LOCK_FILE="\$TEXTFILE_DIR/.arch_backup.lock"

log() { printf '%s  %s\\n' "\$(date +%H:%M:%S)" "\$*" >&2; }
die() { log "FATAL: \$*"; exit 2; }

command -v jq >/dev/null 2>&1 || die "jq not found on PATH"
command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
[ -f "\$MANIFEST" ] || die "manifest not found: \$MANIFEST"

safe() { printf '%s' "\$1" | tr -c 'a-zA-Z0-9._-' '_'; }

# notify <app> <ok|fail> <title> <message>
notify() {
  local app="\$1" outcome="\$2" title="\$3" msg="\$4" prio tags channels
  channels="\$(jq -r --arg n "\$app" '.apps[] | select(.name==\$n) | .notify // ["ntfy"] | join(",")' "\$MANIFEST")"
  case ",\$channels," in *",ntfy,"*) ;; *) return 0 ;; esac
  if [ "\$outcome" = ok ]; then prio="low"; tags="white_check_mark,floppy_disk"; else prio="urgent"; tags="rotating_light,floppy_disk"; fi
  curl -fsS --max-time 10 \\
    -H "Title: \$title" -H "Priority: \$prio" -H "Tags: \$tags" \\
    -d "\$msg" "\$NTFY_URL/\$NTFY_TOPIC" >/dev/null 2>&1 \\
    || log "warn: ntfy publish failed for \$app (non-fatal)"
}

write_state() {  # <app> <status> <run_ts> <success_ts> <duration> <size_bytes>
  mkdir -p "\$STATE_DIR"
  printf '%s %s %s %s %s\\n' "\$2" "\$3" "\$4" "\$5" "\$6" > "\$STATE_DIR/\$(safe "\$1")"
}

regen_metrics() {
  local f st rt du sz tmp
  mkdir -p "\$TEXTFILE_DIR"
  exec 9>"\$LOCK_FILE"; flock 9
  # Label apps as \`app=\` — node-exporter reserves \`job\` for the scrape target.
  tmp="\$TEXTFILE_DIR/arch_backup.prom.\$\$"
  {
    echo "# HELP arch_backup_last_status Result of the most recent backup run (1 ok, 0 failed)."
    echo "# TYPE arch_backup_last_status gauge"
    for f in "\$STATE_DIR"/*; do [ -e "\$f" ] || continue; read -r st _ _ _ _ < "\$f"; printf 'arch_backup_last_status{app="%s"} %s\\n' "\$(basename "\$f")" "\$st"; done
    echo "# HELP arch_backup_last_success_timestamp_seconds Unix time of the most recent SUCCESSFUL backup."
    echo "# TYPE arch_backup_last_success_timestamp_seconds gauge"
    for f in "\$STATE_DIR"/*; do [ -e "\$f" ] || continue; read -r _ _ st _ _ < "\$f"; printf 'arch_backup_last_success_timestamp_seconds{app="%s"} %s\\n' "\$(basename "\$f")" "\$st"; done
    echo "# HELP arch_backup_duration_seconds Wall-clock duration of the most recent backup run."
    echo "# TYPE arch_backup_duration_seconds gauge"
    for f in "\$STATE_DIR"/*; do [ -e "\$f" ] || continue; read -r _ _ _ du _ < "\$f"; printf 'arch_backup_duration_seconds{app="%s"} %s\\n' "\$(basename "\$f")" "\$du"; done
  } > "\$tmp"
  mv -f "\$tmp" "\$TEXTFILE_DIR/arch_backup.prom"
}

backup_one() {
  local app="\$1" entry sp ts dest start sz=0 ok=1 errors=""
  entry="\$(jq -c --arg n "\$app" '.apps[] | select(.name==\$n)' "\$MANIFEST")"
  [ -n "\$entry" ] || die "app not in manifest: \$app"
  sp="\$(jq -r '.serverPath' <<<"\$entry")"
  ts="\$(date +%Y%m%d-%H%M%S)"
  dest="\$BACKUP_ROOT/\$(safe "\$app")"
  mkdir -p "\$dest"
  start="\$(date +%s)"
  log "=== backup \$app -> \$dest ==="

  if [ "\$(jq -r '.db.engine // empty' <<<"\$entry")" = "postgres" ]; then
    local c u out
    c="\$(jq -r '.db.container' <<<"\$entry")"
    u="\$(jq -r '.db.user // "postgres"' <<<"\$entry")"
    out="\$dest/\$(safe "\$app")-\$ts-pgdumpall.sql.gz"
    log "pg_dumpall from container \$c (user \$u)"
    if docker exec "\$c" pg_dumpall -U "\$u" 2>/dev/null | gzip > "\$out"; then
      if [ "\$(gzip -dc "\$out" 2>/dev/null | head -c 64 | wc -c)" -gt 0 ]; then
        log "  ok: \$(du -h "\$out" | cut -f1)"
      else ok=0; errors+="empty pg dump; "; rm -f "\$out"; log "  FAIL: empty dump"; fi
    else ok=0; errors+="pg_dumpall failed; "; rm -f "\$out"; log "  FAIL: pg_dumpall"; fi
  fi

  local p out
  while IFS= read -r p; do
    [ -n "\$p" ] || continue
    out="\$dest/\$(safe "\$app")-\$ts-path-\$(safe "\$p").tgz"
    log "tar path \$p (from \$sp)"
    if docker run --rm --name "arch-backup-tmp-\$(safe "\$app")-path-\$\$" -v "\$sp:/src:ro" busybox tar -czf - -C /src "\$p" > "\$out" 2>/dev/null; then
      log "  ok: \$(du -h "\$out" | cut -f1)"
    else ok=0; errors+="tar \$p failed; "; rm -f "\$out"; log "  FAIL: tar \$p"; fi
  done < <(jq -r '.paths[]?' <<<"\$entry")

  local v
  while IFS= read -r v; do
    [ -n "\$v" ] || continue
    out="\$dest/\$(safe "\$app")-\$ts-vol-\$(safe "\$v").tgz"
    log "tar volume \$v"
    if docker run --rm --name "arch-backup-tmp-\$(safe "\$app")-vol-\$\$" -v "\$v:/data:ro" busybox tar -czf - -C /data . > "\$out" 2>/dev/null; then
      log "  ok: \$(du -h "\$out" | cut -f1)"
    else ok=0; errors+="vol \$v failed; "; rm -f "\$out"; log "  FAIL: vol \$v"; fi
  done < <(jq -r '.volumes[]?' <<<"\$entry")

  local end dur run_ts succ_ts prev_succ
  end="\$(date +%s)"; dur=\$((end - start)); run_ts="\$end"
  sz="\$(find "\$dest" -name "\$(safe "\$app")-\$ts-*" -type f -printf '%s\\n' 2>/dev/null | awk '{s+=\$1} END{print s+0}')"
  prev_succ=0
  [ -f "\$STATE_DIR/\$(safe "\$app")" ] && read -r _ _ prev_succ _ _ < "\$STATE_DIR/\$(safe "\$app")"
  if [ "\$ok" = 1 ]; then succ_ts="\$end"; else succ_ts="\$prev_succ"; fi

  prune_kind() {
    local files; mapfile -t files < <(ls -1t "\$dest"/\$(safe "\$app")-*"\$1" 2>/dev/null)
    if [ "\${#files[@]}" -gt "\$RETENTION" ]; then
      printf '%s\\n' "\${files[@]:\$RETENTION}" | while IFS= read -r old; do log "prune \$(basename "\$old")"; rm -f "\$old"; done
    fi
  }
  if [ "\$ok" = 1 ]; then prune_kind "-pgdumpall.sql.gz"; prune_kind ".tgz"; fi

  write_state "\$app" "\$ok" "\$run_ts" "\$succ_ts" "\$dur" "\$sz"
  regen_metrics

  local human; human="\$(numfmt --to=iec "\$sz" 2>/dev/null || echo "\$sz B")"
  if [ "\$ok" = 1 ]; then
    log "DONE \$app ok in \${dur}s (\$human)"
    notify "\$app" ok "Backup ok: \$app" "Backed up \$app in \${dur}s — \$human written to ~/backups/\$(safe "\$app")."
    return 0
  else
    log "DONE \$app FAILED in \${dur}s: \$errors"
    notify "\$app" fail "Backup FAILED: \$app" "Backup of \$app failed after \${dur}s: \${errors}See journalctl --user -u arch-backup@\$app."
    return 1
  fi
}

[ \$# -ge 1 ] || die "usage: backup.sh <app>|--all"
rc=0
if [ "\$1" = "--all" ]; then
  while IFS= read -r app; do backup_one "\$app" || rc=1; done < <(jq -r '.apps[].name' "\$MANIFEST")
else
  backup_one "\$1" || rc=1
fi
exit "\$rc"
`;

export function genSelfHostBackupManifest(cfg) {
  const desc = buildSelfHostDescriptor(cfg);
  const manifest = {
    apps: [
      {
        name: desc.name,
        serverPath: desc.serverPath,
        paths: desc.backup?.paths || [],
        volumes: desc.backup?.volumes || [],
        ...(desc.backup?.db ? { db: desc.backup.db } : {}),
        schedule: desc.backup?.schedule || "0 3 * * *",
        notify: desc.notify,
        dormant: desc.dormant,
      },
    ],
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

const SELFHOST_BACKUP_SERVICE = `# Templated per-app backup (systemd --user). Instance %i = app name.
# Runs as your rig user (docker group); no root needed.
# Manual run:  systemctl --user start arch-backup@<app>.service
[Unit]
Description=Rig backup for %i
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
ExecStart=%h/infra/backups/backup.sh %i
`;

export function genSelfHostBackupTimer(cfg) {
  const slug = projectSlug(cfg);
  // Descriptor schedule is cron "0 3 * * *" → systemd OnCalendar daily at 03:00.
  return `# Daily backup timer for ${slug} (systemd --user). Pairs with
# arch-backup@.service. Enable:  systemctl --user enable --now arch-backup@${slug}.timer
[Unit]
Description=Daily backup timer for ${slug}

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
Unit=arch-backup@${slug}.service

[Install]
WantedBy=timers.target
`;
}

// ── Deploy flow: rsync source → rig, then docker compose up -d ────────────────
export function genSelfHostDeploy(cfg) {
  const slug = projectSlug(cfg);
  return `#!/usr/bin/env bash
# Deploy ${cfg.appName} to the rig (run from the LAPTOP). The rig is NOT a git
# repo — this rsync IS the deploy. Idempotent: safe to re-run after any change.
#
#   1. rsync the app source + infra/ to the rig
#   2. docker compose up -d --build the app (and bring up the shared infra once)
#   3. reload Caddy so routing picks up any descriptor change
#
# Usage:  bash infra/deploy.sh [ssh-host]      (default host: rig)
set -euo pipefail

HOST="\${1:-\${RIG_SSH_HOST:-rig}}"
ROOT="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
SSH="ssh -o ConnectTimeout=8"
APP="${slug}"

say() { printf '\\n\\033[1m== %s\\033[0m\\n' "\$*"; }

# --- 1. one-time shared infra (network + stacks). Safe to re-run. -----------
say "Ensuring shared rig network + infra stacks on \$HOST"
\$SSH "\$HOST" 'docker network inspect arch_net >/dev/null 2>&1 || docker network create arch_net'
rsync -az --delete -e "\$SSH" "\$ROOT/infra/" "\$HOST:infra/"
\$SSH "\$HOST" 'cd ~/infra/ntfy && docker compose up -d'
\$SSH "\$HOST" 'cd ~/infra/monitoring && docker compose up -d'

# --- 2. rsync the app source + compose to the rig --------------------------
say "rsync app source -> \$HOST:~/apps/\$APP"
\$SSH "\$HOST" "mkdir -p ~/apps/\$APP"
rsync -az --delete --exclude .git -e "\$SSH" "\$ROOT/" "\$HOST:apps/\$APP/"
rsync -az -e "\$SSH" "\$ROOT/infra/\$APP/" "\$HOST:apps/\$APP/"

# --- 3. compose up the app -------------------------------------------------
say "docker compose up -d --build (\$APP)"
\$SSH "\$HOST" "cd ~/apps/\$APP && docker compose --env-file .env up -d --build"

# --- 4. reload Caddy (regenerate routing from the registry first) ----------
say "Reload Caddy edge"
\$SSH "\$HOST" 'cd ~/infra/caddy && docker compose up -d && \\
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true'

say "Deployed \$APP to \$HOST"
`;
}

export function genSelfHostSkill(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  const slug = projectSlug(cfg);
  const storageLabel = STORAGE_LABELS[storage] || storage;

  return `# self-host.playbook

## Meta
infra: Self-host (local server / rig) — vendored arch-server fleet plane
server_stack: ${m.runtime}
storage: ${storageLabel}
stack: Caddy (tls internal) + Prometheus/Loki/Grafana + ntfy + per-app backups
docs: https://caddyserver.com/docs/ | https://grafana.com/oss/loki/ | https://docs.ntfy.sh/

## Use
Bootstraps a fresh local rig (mini-PC / NAS / home-lab box) to run ${cfg.appName}'s
backend end to end: Caddy terminates TLS for the LAN domain (\`tls internal\`) and
reverse-proxies to the ${m.runtime} \`api\` container on :${m.port}, backed by a
PostgreSQL container${storage === "minio" ? " and a MinIO S3 container" : storage === "local-disk-caddy" ? " with media served off local disk by Caddy" : " (binary blobs live in Postgres)"}.
Monitoring (Prometheus/Loki/Grafana), ntfy notifications, and a per-app backup
engine are all wired in. The registry descriptor (infra/registry/apps/${slug}.yaml)
is the single source of truth for routing/health/backups.

## Runbook

### 1. Provision the rig (once)
\`\`\`bash
# On the rig: install Docker + jq, create the shared network, trust Caddy's CA.
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "\$USER"   # log out/in so the group takes effect
sudo apt-get install -y jq rsync
docker network create arch_net
\`\`\`
Point your LAN DNS (router or a Pi-hole/dnsmasq) so \`${slug}.rig.home\` resolves
to the rig's LAN IP, OR add it to each client's /etc/hosts.

### 2. Bootstrap infra + deploy the app
\`\`\`bash
# From the laptop (fill infra/registry/apps/${slug}.yaml source/serverPath first):
cp infra/${slug}/.env.example infra/${slug}/.env   # set POSTGRES_PASSWORD${storage === "minio" ? " + MINIO creds" : ""}
bash infra/deploy.sh rig            # rsync + compose up infra (ntfy, monitoring) + app
\`\`\`

### 3. Trust the Caddy CA (once per client device)
\`\`\`bash
# Export Caddy's internal root CA from the container and install it on devices.
docker compose -f infra/caddy/compose.yaml exec caddy \\
  cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
# macOS: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain caddy-root.crt
\`\`\`

### 4. Enable scheduled backups (on the rig)
\`\`\`bash
mkdir -p ~/.config/systemd/user
cp infra/backups/arch-backup@.service ~/.config/systemd/user/
cp infra/backups/arch-backup@${slug}.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now arch-backup@${slug}.timer
loginctl enable-linger "\$USER"     # so timers run when you're not logged in
\`\`\`

### 5. Health + backup checks
\`\`\`bash
curl -k https://${slug}.rig.home/health        # app health via Caddy TLS
systemctl --user start arch-backup@${slug}.service  # run a backup now
journalctl --user -u arch-backup@${slug} -f         # watch it
# Grafana: http://<rig-ip>:3000  (admin/admin) — host + container dashboards
\`\`\`

## Gotchas
WRONG: Mint a new Caddy CA on every restart by not persisting /data.
RIGHT: Keep the caddy-data volume; export the root CA once and trust it on clients.
WHY: \`tls internal\` regenerates the CA if /data is empty — every device would have to re-trust it, and existing certs break.

WRONG: Expose the rig to the internet by port-forwarding :80/:443 from your router.
RIGHT: Keep it LAN-only; reach it remotely via Tailscale/WireGuard or a Cloudflare Tunnel.
WHY: A residential IP + a self-managed box is a soft target; a mesh VPN gives remote access without opening inbound ports.

WRONG: Reference a backup volume by the bare name (e.g. db_data) in the descriptor.
RIGHT: Use the compose-prefixed name (${slug}_db_data) — the project name prefixes volumes.
WHY: \`docker compose\` namespaces volumes by project; the backup engine tars the real volume name or silently backs up nothing.

WRONG: Run the backup timer as a system unit needing root for docker.
RIGHT: Use the systemd --user units + \`loginctl enable-linger\`; your user is in the docker group.
WHY: Root isn't needed (docker group suffices) and user units keep the whole fleet rootless and per-user.
${storage === "minio" ? `
WRONG: Proxy every media download through the api container.
RIGHT: Hand out presigned S3 URLs (s3.${slug}.rig.home) so clients fetch directly from MinIO.
WHY: Proxying media through the app wastes its memory/bandwidth and kills throughput.
` : storage === "local-disk-caddy" ? `
WRONG: Stream uploaded files back through the api container on every request.
RIGHT: Write to ./media and let Caddy's file_server serve /media/* directly.
WHY: Caddy serving static files is far faster and frees the app to do real work.
` : `
WRONG: Stuff large media as bytea and SELECT whole blobs into app memory.
RIGHT: Stream large objects, or move to MinIO once media grows.
WHY: Postgres bloats the WAL and backups with binary blobs; fine for small assets only.
`}
## Boundaries
This skill covers bootstrapping + operating a single local rig (Caddy → api → db${storage === "minio" ? " → minio" : ""}),
its monitoring, notifications, and backups. It does NOT cover: app code, DB
migrations, multi-node/HA, or off-site backup replication. Compare with the Cloud
branch (.arch/skills/hetzner.skill) when App Store review needs a public endpoint.

## Snippets
\`\`\`bash
# Tail app logs
docker compose -f ~/apps/${slug}/compose.yaml logs -f api

# One-off DB shell
docker compose -f ~/apps/${slug}/compose.yaml exec db psql -U app -d app

# Regenerate Caddy routing after editing the descriptor, then reload
docker compose -f ~/infra/caddy/compose.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile
\`\`\`
`;
}

// infra.graph slice for the Self-host rig: Caddy TLS edge → Api → DB (+storage),
// plus the monitoring + backup plane. Mirrors genHetznerInfraSlice's shape so
// the two hosting branches are structurally comparable.
export function genSelfHostInfraSlice(cfg) {
  const m = hetznerServerMeta(cfg);
  const storage = resolveStorageChoice(cfg) || "minio";
  let o = `\n--- selfhost-edge [infra,critical] ---\n`;
  o += `Caddy   [N#*$] : automatic-TLS reverse proxy (tls internal, local domain :80/:443) | LAN → THIS → Api\n`;
  o += `Api     [S#]   : ${m.runtime} app container (:${m.port}) | Caddy → THIS → DB${storage === "postgres-only" ? "" : ",Store"}\n`;
  o += `DB      [R#*]  : PostgreSQL 16 container (Docker volume db_data) | Api → THIS\n`;
  if (storage === "minio") {
    o += `Store   [R#*]  : MinIO S3 object storage (presigned URLs, volume minio_data) | Api → THIS\n`;
  } else if (storage === "local-disk-caddy") {
    o += `Store   [N#]   : Caddy file_server on local disk (/srv/media) | Caddy → THIS ; Api → THIS\n`;
  } else if (storage === "postgres-only") {
    o += `Store   [R#]   : binary blobs in PostgreSQL (bytea/large objects) | Api → DB (no separate store)\n`;
  }
  o += `Mon     [O#*]  : Prometheus + Loki + Grafana + Alertmanager→ntfy (node-exporter, cAdvisor, promtail) | Api,DB${storage === "postgres-only" ? "" : ",Store"} → THIS\n`;
  o += `Backup  [O#~]  : per-app engine (pg_dumpall + volume tar), systemd timer → ntfy + node-exporter metric | DB${storage === "postgres-only" ? "" : ",Store"} → THIS\n`;
  o += `---\n`;
  return o;
}

// Coordinator: every Self-host artifact for a cfg, split into files written at
// the project root (infra/) and files written under .arch/ (the skill).
export function genSelfHostArtifacts(cfg) {
  const slug = projectSlug(cfg);
  return {
    root: [
      { path: `infra/registry/apps/${slug}.yaml`, content: genSelfHostDescriptor(cfg) },
      { path: `infra/${slug}/compose.yaml`, content: genSelfHostCompose(cfg) },
      { path: `infra/${slug}/.env.example`, content: genSelfHostEnvExample(cfg) },
      { path: "infra/caddy/Caddyfile", content: genSelfHostCaddyfile(cfg) },
      { path: "infra/caddy/compose.yaml", content: SELFHOST_CADDY_COMPOSE },
      { path: "infra/monitoring/compose.yaml", content: SELFHOST_MONITORING_COMPOSE },
      { path: "infra/monitoring/prometheus/prometheus.yml", content: genSelfHostPrometheusYml(cfg) },
      { path: "infra/monitoring/prometheus/alerts.yml", content: SELFHOST_PROM_ALERTS },
      { path: "infra/monitoring/loki/loki-config.yml", content: SELFHOST_LOKI_CONFIG },
      { path: "infra/monitoring/loki/rules/fake/log-alerts.yml", content: SELFHOST_LOKI_RULES },
      { path: "infra/monitoring/promtail/promtail-config.yml", content: SELFHOST_PROMTAIL_CONFIG },
      { path: "infra/monitoring/grafana/provisioning/datasources/datasources.yml", content: SELFHOST_GRAFANA_DATASOURCES },
      { path: "infra/monitoring/grafana/provisioning/dashboards/dashboards.yml", content: SELFHOST_GRAFANA_DASHBOARDS },
      { path: "infra/monitoring/alertmanager/alertmanager.yml", content: SELFHOST_ALERTMANAGER_YML },
      { path: "infra/ntfy/compose.yaml", content: SELFHOST_NTFY_COMPOSE },
      { path: "infra/ntfy/server.yml", content: SELFHOST_NTFY_SERVER },
      { path: "infra/ntfy/alertmanager-ntfy.yml", content: SELFHOST_ALERTMANAGER_NTFY },
      { path: "infra/backups/backup.sh", content: SELFHOST_BACKUP_SCRIPT },
      { path: "infra/backups/manifest.json", content: genSelfHostBackupManifest(cfg) },
      { path: "infra/backups/arch-backup@.service", content: SELFHOST_BACKUP_SERVICE },
      { path: `infra/backups/arch-backup@${slug}.timer`, content: genSelfHostBackupTimer(cfg) },
      { path: "infra/deploy.sh", content: genSelfHostDeploy(cfg) },
    ],
    arch: [
      { path: "playbooks/self-host.playbook", content: genSelfHostSkill(cfg) },
    ],
  };
}

export function genEventsGraph(cfg) {
  const at = APP_TYPES[cfg.appType];
  if (!at.reservedWords["$bus"]) return null;
  let o = `--- events ---\n`;
  cfg.features.forEach(f => {
    const Id = f.id.charAt(0).toUpperCase() + f.id.slice(1);
    o += `Evt${Id}Changed [E~] : {${f.id}Id,...} | @${f.id} ⇒ THIS ⇒ [subscribers]\n`;
  });
  o += `---\n`;
  return o;
}

export function genSkillFile(skillId) {
  const sk = SKILL_CATALOG.find(s => s.id === skillId);
  if (!sk) return "";
  let o = `# ${sk.name}.playbook\n\n`;

  // Auto-populate Meta from package-docs map and local package.json
  const pkgInfo = PACKAGE_DOCS[skillId] || {};
  let version = null;
  if (pkgInfo.npm) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
      const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      version = allDeps[pkgInfo.npm] || null;
    } catch {}
  }

  o += `## Meta\n`;
  o += `pkg: ${pkgInfo.npm || skillId}@${version || "[VERSION]"}\n`;
  o += `docs: ${pkgInfo.docs || "[DOCS_URL]"}\n`;
  o += `updated: ${new Date().toISOString().split("T")[0]}\n\n`;
  o += `## Use\n[How YOUR project uses ${sk.name}. 2-3 lines max.]\n[Not what it does generally — how YOUR app uses it specifically.]\n\n`;
  o += `## Patterns\n[The specific import paths, function signatures, and conventions you follow.]\n[List the 5-10 methods/endpoints your app actually calls.]\n\n`;
  o += `## Gotchas\n`;
  const builtinGotchas = GOTCHA_DB[skillId] || [];
  if (builtinGotchas.length > 0) {
    builtinGotchas.forEach(g => {
      o += `WRONG: ${g.wrong}\nRIGHT: ${g.right}\nWHY: ${g.why}\n\n`;
    });
    o += `[Add more WRONG/RIGHT/WHY blocks as you discover them.]\n`;
  } else {
    o += `WRONG: [the code the AI will generate by default]\nRIGHT: [the code it should generate instead]\nWHY: [one-line explanation of the failure mode]\n\n[Add more WRONG/RIGHT/WHY blocks as you discover them.]\n`;
  }
  o += `\n## Boundaries\n[What ${sk.name} does NOT do in your project.]\n[Prevents the AI from overreaching with this package.]\n\n`;
  o += `## Snippets\n[2-3 code blocks showing the correct pattern in YOUR project.]\n[These are the patterns the AI will clone.]\n`;
  return o;
}

export function genApiStub(skillId) {
  const sk = SKILL_CATALOG.find(s => s.id === skillId);
  if (!sk) return null;
  const apiSkills = ["stripe","killbill","meilisearch","opensearch","saleor","langfuse","llm_sdk"];
  if (!apiSkills.includes(skillId)) return null;
  return `# ${sk.name}.api
# v[VERSION] | base: [BASE_URL] | auth: [AUTH_METHOD]
# generated: [YYYY-MM-DD] | source: [openapi|graphql|sdk|manual]

## Types
# [TypeName] = { field: type, field?: type, field: type|type }

## Endpoints
# [METHOD] [PATH] (param: type, param?: type) → [ReturnType]
# Only include endpoints YOUR app actually calls.

## Enums
# [EnumName] = 'value1' | 'value2' | 'value3'

## Webhooks
# [EVENT_NAME] → { field: type, field: type }
`;
}

export function genReadme(cfg) {
  const at = APP_TYPES[cfg.appType];
  return `# .arch/ — Context Engineering for ${cfg.appName}

> ${at.name} — ${at.pattern}

This directory contains architecture context files for AI-assisted development.
The AI reads these files to generate code that fits your system's architecture,
follows your patterns, avoids known gotchas, and calls APIs correctly.

## How to Use

### Claude Projects
1. Copy \`SYSTEM.md\` into your Project instructions
2. Upload \`INDEX.md\` and all \`.graph\` files as project knowledge
3. Upload relevant \`.playbook\` and \`.api\` files as project knowledge

### Cursor / Windsurf
1. Copy \`SYSTEM.md\` into \`.cursorrules\`
2. Add rule: "Read .arch/INDEX.md to resolve context for each prompt"

### Claude Code
1. Add \`SYSTEM.md\` content to your \`CLAUDE.md\` instructions
2. Claude Code reads \`.arch/\` files automatically as needed

## File Map

| File | Purpose | Update When |
|------|---------|-------------|
| SYSTEM.md | Rules + $reserved words | New convention or rule |
| INDEX.md | Keyword → node/playbook routing | New feature or dependency |
| clusters/*.graph | Architecture structure (v2 notation) | Feature added/changed |
| playbooks/*.playbook | Package gotchas + patterns | Dependency upgrade or new gotcha |
| apis/*.api | API contracts (endpoints + types) | Dependency version bump |

## Maintenance

- **Monthly**: Check .playbook freshness. Update for dependency upgrades.
- **Per feature**: Add .graph cluster. Update INDEX.md keywords.
- **Per gotcha**: When AI-generated code needs a fix, add WRONG/RIGHT/WHY to the .playbook.
- **Per deploy**: Regenerate .api files from your latest API specs.
`;
}

export function genCompactContext(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `# ${cfg.appName} — Compact Context (~500 tokens)\n\n`;
  o += `## Rules\n`;
  at.rules.forEach(r => o += `- ${r}\n`);
  o += `\n## NEVER\n`;
  // Import boundaries inline
  const UNIVERSAL = [
    "Commit secrets/credentials to code",
    "Use \`any\` type in TypeScript",
    "Catch errors silently",
    "Use string concatenation for SQL",
    "Trust client-side input without validation",
  ];
  UNIVERSAL.forEach(b => o += `- ${b}\n`);
  o += `\n## Reserved Words\n`;
  for (const [k, v] of Object.entries(at.reservedWords)) {
    o += `${k} = ${v.split("—")[0].trim()}\n`;
  }
  o += `\n## Convention\n`;
  o += `${at.folderConv}\n`;
  o += `${namingLine(cfg)}\n`;
  return o;
}

export { genBoundariesMd } from "../data/boundaries.mjs";
