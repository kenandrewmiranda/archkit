---
archetype: internal
displayName: Internal Tool / Admin Console
description: A workflow tool for employees, not customers — admin dashboards, ops consoles, support tooling, internal reports. Small known user base, behind SSO, often touching the production database read-only.
useWhen:
  - The audience is your team, not the public.
  - Users authenticate with corporate identity (SSO, SAML, OIDC, Okta, Google Workspace).
  - The tool runs behind a VPN, behind SSO, or on an internal network.
  - The job is to view and operate on production data — refunds, support, backfills, admin actions.
  - Correctness matters more than polish; a wrong number costs real money.
redFlags:
  - Customers sign up themselves and pay you — that's `saas`.
  - Marketing site, landing pages, or blog — that's `content`.
  - Heavy data transformation, ETL, warehousing, BI modeling — that's `data`.
  - LLM-heavy product where the model is the product — that's `ai`.
  - Storefront with carts and customer checkout — that's `ecommerce`.
boundariesRef: archkit-boundaries-internal
recommendedSkills:
  - archkit-skill-postgres
  - archkit-skill-tanstack-table
  - archkit-skill-audit-logging

deploymentModes:
  - id: managed
    label: Managed (push-to-deploy, behind SSO on the public internet)
    why: |
      The tool lives on a public URL but every page requires SSO — accessible from anywhere employees work without VPN setup. Right default when your team is remote, when you want preview environments per PR for non-engineer stakeholders to click through, and when you don't already operate internal infrastructure. The trade is that the auth provider becomes a hard dependency; if Clerk or WorkOS is down, your team can't process refunds.
  - id: selfHosted
    label: Self-hosted (inside your perimeter, behind VPN or on the internal network)
    why: |
      The tool lives on an internal hostname (`admin.internal`, `ops.corp.local`) reachable only from VPN or office network. Right default when the data is sensitive enough that "publicly reachable, auth-gated" is unacceptable, when you already run internal services and adding one more is cheap, or when corporate policy mandates it. The trade is more setup — DNS, VPN routing, certificates — and remote workers needing the VPN for daily work.

stack:
  primary:
    - name: TypeScript
      role: language
    - name: Next.js
      role: full-stack framework (App Router)
      alt: Remix, Astro with React islands, plain Vite + Hono
    - name: PostgreSQL
      role: own metadata database (sessions, audit log, app state)
    - name: Drizzle ORM
      role: query builder + migrations
      alt: Prisma, Kysely, raw SQL through pg
    - name: Read-only connection to production DB
      role: when the tool surfaces data from a customer-facing system, connect with a credential that has SELECT-only on the relevant tables
      optional: true
  why: |
    Internal tools share most of the SaaS stack — they're web apps with a database and auth. The one structural difference: they often need to *read* from another system's database (your SaaS's production DB, your billing system, your warehouse). The right pattern is a separate read-only credential scoped to specific tables, never a full superuser connection. Internal tools that bypass this rule eventually run a destructive query at 2am.
  tradeoffs: |
    Skip the read-only production connection when the tool's data lives entirely in its own database (e.g. a runbook tracker, an internal directory). Use a separate API call to the source system instead of a direct DB connection when the source system is owned by a different team and the contract should be explicit.

hosting:
  primary:
    - name: Vercel
      role: app hosting + preview deploys
      mode: managed
      alt: Netlify, Railway, Render
    - name: Neon
      role: serverless Postgres for the tool's own metadata
      mode: managed
      alt: Supabase, Railway Postgres, RDS
    - name: K3s on internal infrastructure
      role: lightweight Kubernetes on existing on-prem or private-cloud nodes
      mode: selfHosted
      alt: Docker Compose on a single internal VM, Nomad, full K8s
    - name: PostgreSQL (self-hosted on the cluster)
      role: tool's own metadata database
      mode: selfHosted
      alt: existing managed Postgres inside your VPC
    - name: Caddy (internal-only)
      role: reverse proxy + automatic TLS via internal CA or Let's Encrypt DNS-01
      mode: selfHosted
      alt: Traefik, Nginx + internal CA
    - name: Tailscale or WireGuard
      role: zero-config VPN to reach the internal-only hostname
      mode: selfHosted
      alt: existing corporate VPN, ZeroTier, IP allowlist
      optional: true
  why: |
    **Managed** (Vercel + Neon) keeps internal tools as boring as customer-facing ones — same deploy story, same preview environments, accessible from anywhere with a browser. **Self-hosted** (K3s on your existing internal infrastructure) keeps the tool inside your perimeter so the data never crosses a third party's network. For tools that touch sensitive data (PII, payments, employee records), self-hosted is often the easier compliance answer even when the team is small.
  tradeoffs: |
    Avoid self-hosting on infrastructure you don't already operate — spinning up K3s just for one internal tool is overkill. If managed feels too exposed, the middle path is managed app hosting + a private database in your own VPC, accessed over a tunnel. Don't host the production DB *and* the internal tool on the same managed Postgres unless you've thought hard about credential scoping.

auth:
  primary:
    - name: Clerk
      role: auth + SSO/SAML for small teams; drop-in components, organization model maps to your company
      mode: managed
      alt: WorkOS (enterprise SSO/SAML focus), Auth.js (cheaper at scale, more wiring)
    - name: Keycloak
      role: self-hosted IdP that federates to your corporate identity (Google Workspace, Okta, Entra ID) over OIDC/SAML
      mode: selfHosted
      alt: Authentik (lighter, modern UI), Authelia (smaller surface)
    - name: Pomerium or oauth2-proxy
      role: identity-aware proxy in front of the app — SSO at the edge, app sees a verified header
      mode: selfHosted
      alt: Cloudflare Access, Tailscale's app-connector
      optional: true
  why: |
    Internal tools must never be reachable without a logged-in employee identity — there is no "public" surface, ever. **Managed** auth (Clerk, WorkOS) handles SSO/SAML for you, including the enterprise IdPs your IT team uses. **Self-hosted** auth (Keycloak) federates to your existing corporate IdP without your tool ever seeing passwords; the identity-aware proxy pattern (Pomerium / oauth2-proxy) puts the SSO step *before* the app even runs, which is the safest shape for tools handling sensitive data because misconfigured app-level auth can't accidentally expose anything.
  tradeoffs: |
    For very small teams (under ~10 people) without an existing IdP, Clerk or WorkOS is dramatically less effort than running Keycloak. The moment your IT team standardizes on Okta or Google Workspace SSO, federate through it instead of managing accounts in two places. Identity-aware proxies are the right answer when you have several internal tools — set up SSO once at the edge instead of per-app.

networking:
  primary:
    - name: Next.js Route Handlers
      role: HTTP API surface for the internal frontend
    - name: tRPC
      role: typed RPC between the internal client and server — primary for internal tools because there are no third-party API consumers
      alt: REST + Zod, Server Actions only
    - name: Zod
      role: input validation at every untrusted edge (request body, URL params, env vars)
    - name: Webhook receiver routes
      role: HTTP endpoints for cron schedulers, integrations from other internal services
      optional: true
  why: |
    Internal tools have a fixed, known set of clients (the same tool's frontend, plus maybe a cron job and one or two other internal services). That makes tRPC's tradeoffs strictly favorable — you get end-to-end types across the whole interface and never need to publish OpenAPI for outsiders. Zod still belongs on every untrusted edge because "internal" doesn't mean "trusted input"; an employee submitting bad form data shouldn't be able to crash the service.
  tradeoffs: |
    Drop tRPC if another internal team needs to integrate against this tool's API — at that point publish a proper REST surface with OpenAPI. Server Actions alone are fine for tools that are mostly forms and tables and have no external integrations.

ui:
  primary:
    - name: Tailwind CSS
      role: styling
    - name: shadcn/ui
      role: component primitives (copied into your repo, not installed)
    - name: TanStack Table
      role: data tables — sorting, filtering, pagination, virtualization
    - name: Radix UI
      role: accessibility primitives underneath shadcn/ui
    - name: Lucide
      role: icon set
    - name: Recharts or Tremor
      role: charts for dashboards
      optional: true
  why: |
    Internal tools are mostly tables and forms. shadcn/ui covers forms, modals, dropdowns, toasts; TanStack Table covers the table half of the workload, including the boring requirements (sticky headers, filterable columns, server-side pagination) that data-heavy tools always need. The polish bar is lower than customer-facing apps — function over fashion — but density and keyboard-friendliness matter more because the same employee will use this thing dozens of times a day.
  tradeoffs: |
    Reach for Mantine if you want a richer batteries-included component library (date pickers, rich-text editors) without assembling them from primitives. Avoid heavy "admin theme" templates (Material Admin, etc.) — they look polished in the demo and feel slow once your data shows up.

jobs:
  primary:
    - name: Inngest
      role: scheduled jobs (nightly reports, cleanups), event-triggered workflows, manual ops job runs
      mode: managed
      alt: Trigger.dev, QStash for simpler webhook-style schedules, GitHub Actions cron for very low-frequency jobs
    - name: Graphile Worker
      role: Postgres-backed background jobs — uses the database you already have, no Redis required
      mode: selfHosted
      alt: BullMQ (requires Valkey/Redis, more features), River (Go-based, Postgres)
  why: |
    Internal tools run two kinds of background work: scheduled jobs (nightly P&L report, weekly stale-data cleanup) and ad-hoc ops work triggered from the UI ("run this backfill"). **Managed** (Inngest) gives you both with no extra infrastructure. **Self-hosted** (Graphile Worker) is specifically the right pick for internal tools because they already have Postgres and adding Redis just for jobs is unnecessary infrastructure — Graphile Worker uses the same database for the queue.
  tradeoffs: |
    BullMQ is more powerful than Graphile Worker (better priorities, complex flows, mature dashboard) but requires Redis and a worker container. Use it when your job needs outgrow Postgres LISTEN/NOTIFY. For very simple cron needs, GitHub Actions on schedule is genuinely fine and zero-cost.

observability:
  primary:
    - name: Sentry
      role: error tracking (managed)
      mode: managed
      alt: Highlight.io, BugSnag
    - name: Vercel/Axiom logs
      role: structured logs
      mode: managed
      alt: Better Stack, Logtail
      optional: true
    - name: GlitchTip
      role: self-hosted Sentry-compatible error tracking
      mode: selfHosted
      alt: Sentry self-hosted (heavier), Bugsink
    - name: Grafana + Loki
      role: dashboards (Grafana) + logs (Loki) on your existing cluster
      mode: selfHosted
      alt: SigNoz (single binary), Vector + plain log files for very small deployments
    - name: Audit log table in Postgres
      role: append-only record of who did what to what — required for compliance and post-incident review
  why: |
    Internal tools have a tiny user base, so traditional product analytics and session replay are mostly wasted spend — when something is broken your users can DM you. The signals that *do* matter for internal tools are different: error tracking (because nobody is paid to use this and they'll route around bugs without telling you), structured logs (because production-data mistakes need post-mortems), and a hand-rolled audit log table (because compliance and post-incident review need to answer "who clicked the refund button at 2:14am?"). The audit log isn't observability software you install — it's a table you write to from every mutation. Both deployment modes need it.
  tradeoffs: |
    Skip product analytics entirely (PostHog, Mixpanel) — internal tool usage data is better captured by your audit log because it's tied to identity and intent, not anonymous sessions. Skip Datadog unless your company already pays for it; the spend doesn't make sense for one tool.

testing:
  primary:
    - name: Vitest
      role: unit + integration tests
    - name: Playwright
      role: end-to-end browser tests
    - name: MSW
      role: mocking external HTTP in tests
      optional: true
  why: |
    The testing bar for internal tools is asymmetric: cosmetic bugs are tolerable, *data-mutation* bugs are not. A misaligned chart costs nothing; a refund flow that issues double refunds costs real money. Cover the mutating paths (write actions, deletes, money movement) with both Vitest and Playwright. Read-only views can lean on lighter coverage. AI-generated code is especially risky here because the second prompt often forgets the audit-logging or the read-only-connection rule from the first.
  tradeoffs: |
    Skip Playwright only if the tool is truly throwaway — a one-week reporting page nobody else will touch. The moment a second person uses the tool, e2e becomes worth it because regressions in shared internal tools are how trust in tooling dies inside companies.
---

# Internal Tool / Admin Console

Internal tools are web apps built for a known, small audience of employees. The most common shapes are admin consoles for a SaaS product (refund flows, user impersonation, support search), ops dashboards (queue depth, error rates, manual reruns), back-office workflow tools (approvals, compliance, internal CRMs), and reporting surfaces for non-technical stakeholders. The audience is finite and identified — usually fewer than a hundred people, often fewer than ten.

The architecture looks a lot like SaaS but the priorities flip. Polish matters less, correctness matters more, scale matters very little, and audit-ability matters a great deal. You will never have a million users on this thing, but the five users you do have will perform actions that move real money or change real customer state.

## What internal tools have that customer-facing apps don't

Three things show up in every internal tool of consequence:

1. **Read-only access to a production database.** The whole reason the tool exists is to view and act on data that lives in your customer-facing system. The right pattern is a database credential with `SELECT` on a specific allowlist of tables — *never* a full-access connection — and writes happen through your product's own API or service layer, not direct UPDATE statements from the admin tool. Internal tools that bypass this rule eventually run a destructive query at 2 AM and there's no rollback.
2. **An audit log of every mutation.** Append-only table, written from every action that changes state, capturing actor identity, action, target ID, before/after diff, and timestamp. This is non-negotiable for tools that touch money or customer data — both for compliance and for the post-mortem when something goes wrong. The audit log is more important than any third-party observability tool.
3. **SSO at the edge.** No internal tool should be reachable without first proving employee identity. The most robust pattern is an identity-aware proxy (Pomerium, oauth2-proxy, Cloudflare Access, Tailscale) that gates access *before* the app runs — that way a misconfigured app-level auth check can't accidentally expose anything.

## The managed vs. self-hosted decision

For internal tools the choice often comes down to data sensitivity and existing infrastructure. **Managed** (Vercel + Neon + Clerk) is dramatically less effort and works fine for most internal tools, including ones touching sensitive data — modern managed providers offer SOC 2 / ISO 27001 / HIPAA paths if you need them. **Self-hosted** (K3s + Postgres + Keycloak) is the right answer when corporate policy mandates it, when the tool needs to talk to internal-only services, or when you already operate internal infrastructure for other reasons. Both are common; pick based on where you already have ops capacity.

If your tool will eventually be sold to customers as a product, you're not building an internal tool — pick `saas` instead.
