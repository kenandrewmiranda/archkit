---
archetype: saas
displayName: SaaS / B2B Platform
description: Multi-tenant subscription product — login, billing, dashboards, per-account data isolation. Web-first, served to paying customers.
useWhen:
  - Users sign up for accounts and (eventually) pay you.
  - Each account's data must stay isolated from every other account.
  - You expect to ship features continuously, not as versioned releases.
  - There is a dashboard or admin surface that real humans log into.
redFlags:
  - No accounts, no login — that's content or a marketing site, not SaaS.
  - One customer, one deployment per customer — that's enterprise on-prem, not multi-tenant SaaS.
  - Primary surface is a mobile app with web as a marketing page — pick `mobile` instead.
  - The product IS the data pipeline (ETL, warehousing) — pick `data` instead.
boundariesRef: archkit-boundaries-saas
recommendedSkills:
  - archkit-skill-postgres
  - archkit-skill-stripe
  - archkit-skill-nextjs

deploymentModes:
  - id: managed
    label: Managed (push-to-deploy, less ops)
    why: |
      Optimizes for shipping speed. Hosting, database, auth, queues, and observability are all someone else's problem. Costs scale with usage and start near zero. Right default when you're racing to find product-market fit and a single hour of yak-shaving on infra is an hour not spent on the product.
  - id: selfHosted
    label: Self-hosted (you own the infrastructure)
    why: |
      Optimizes for control and cost-at-scale. You run Postgres, your auth provider, your queue, your observability stack, usually on a small Kubernetes cluster or a few VMs. Higher up-front effort, predictable monthly cost, no vendor lock, and no surprises in the bill when traffic spikes. Right default when you have ops capacity, hard data-residency requirements, or you've already been burned by managed-service pricing curves.

stack:
  primary:
    - name: TypeScript
      role: language
    - name: Next.js
      role: full-stack framework (App Router)
      alt: Remix, SvelteKit, Hono (if you split the API)
    - name: PostgreSQL
      role: primary database
      alt: nothing — Postgres is the right answer for SaaS until proven otherwise
    - name: Drizzle ORM
      role: query builder + migrations
      alt: Prisma (heavier, more codegen), Kysely (lower-level)
  why: |
    A SaaS MVP is a web app with a database and accounts. Next.js gives you the UI, the API, and the deploy story in one repo so you aren't wiring three services together before you have a customer. Postgres is non-negotiable — multi-tenant SaaS lives or dies by relational integrity, transactions, and row-level security, none of which document stores do well. Drizzle keeps you close to SQL while still typing your queries; the cost of a heavy ORM (Prisma's generated client, runtime engine) is real on serverless cold starts.
  tradeoffs: |
    Split the API out (Hono, Fastify, separate service) only when you have a non-browser consumer — a mobile app, a CLI, a partner integration. Doing it earlier doubles your deploy surface for no gain. Swap Drizzle for Prisma only if your team already knows Prisma deeply.

hosting:
  primary:
    - name: Vercel
      role: app hosting + edge + preview deploys
      mode: managed
      alt: Railway, Fly.io, Render
    - name: Neon
      role: serverless Postgres with built-in connection pooling
      mode: managed
      alt: Supabase, Railway Postgres, RDS
    - name: Upstash Redis
      role: managed cache + rate limits + ephemeral state
      mode: managed
      alt: Vercel KV, Redis on Railway
      optional: true
    - name: K3s on Hetzner
      role: lightweight Kubernetes on cheap European VMs
      mode: selfHosted
      alt: Docker Compose on a single VM (smaller scale), full K8s on AWS/GCP (larger scale)
    - name: PostgreSQL (self-hosted on the cluster)
      role: primary database, run yourself with PgBouncer in front
      mode: selfHosted
      alt: managed Postgres from your cloud provider as a stepping stone
    - name: Caddy
      role: reverse proxy + automatic TLS
      mode: selfHosted
      alt: Traefik, Nginx + certbot
    - name: Valkey
      role: self-hosted Redis-compatible cache + queues
      mode: selfHosted
      alt: Redis itself (license terms permitting), Dragonfly
  why: |
    Hosting is the choice that most divides this archetype. **Managed** (Vercel + Neon) gets you push-to-deploy, preview environments per PR, and a free tier that survives an MVP — connection-pooling-aware Postgres matters specifically because traditional Postgres on serverless app hosts dies from connection exhaustion. **Self-hosted** (K3s on Hetzner, Postgres on the cluster, Caddy out front) gets you a fully reproducible stack you can move between providers, predictable €20–60/month all-in for small SaaS, and no surprises when traffic spikes. Both are valid; pick based on whether you'd rather spend hours on infra or hours on a managed-service bill.
  tradeoffs: |
    Cross over from managed to self-hosted when the bill becomes a real line item *and* you have someone who actually wants to operate it. Cross from self-hosted to managed when ops time is eating product time. The wrong move in either direction kills more SaaS projects than any technical decision.

auth:
  primary:
    - name: Clerk
      role: hosted auth — sessions, social login, MFA, organizations, drop-in React components
      mode: managed
      alt: Auth.js (NextAuth) for fully managed-but-self-hosted-DB, WorkOS for B2B/SAML-heavy
    - name: Keycloak
      role: self-hosted identity provider — OIDC, SAML, social, MFA, federation
      mode: selfHosted
      alt: Authentik (lighter, modern UI), Authelia (smaller surface, simpler), Ory Kratos (headless)
  why: |
    Auth bugs are silent and catastrophic — wrong session handling leaks customer data and you don't find out until someone tweets at you. **Managed** (Clerk) takes password resets, social, MFA, and organizations off your plate so you can't subtly get them wrong; the React components drop in and the multi-tenant org model maps cleanly to SaaS. **Self-hosted** (Keycloak) gives you the same surface but you operate the IdP yourself — that's a real responsibility (you own the patching, the database, the JWKS rotation), but you also keep all session data inside your perimeter and avoid the per-MAU pricing curve.
  tradeoffs: |
    Clerk's pricing kicks in around 10k+ MAUs — at that point Auth.js or self-hosted Keycloak is dramatically cheaper if you have the discipline. Use WorkOS if your customers are enterprises asking about SAML on day one. Don't run Keycloak unless you're comfortable with at least one production-grade Postgres and have a plan for upgrading it.

networking:
  primary:
    - name: Next.js Route Handlers
      role: HTTP API surface for your own frontend
    - name: Zod
      role: input validation + shared types between client and server
    - name: tRPC
      role: typed RPC between your Next.js client and server
      alt: REST + Zod, Server Actions only
      optional: true
  why: |
    A SaaS frontend talking to its own backend doesn't need a public REST API — it needs a fast, typed contract that doesn't drift. tRPC gives you that and removes an entire category of "the API returned a shape the client didn't expect" bugs. Zod lives at the edge of every untrusted input (request body, URL params, env vars) so bad data can't reach your service layer.
  tradeoffs: |
    Drop tRPC if you also need to expose a stable public API to third parties — at that point you want OpenAPI/REST, not RPC. Plain Server Actions are fine for simple mutation-heavy apps but they hide error handling in ways that bite later.

ui:
  primary:
    - name: Tailwind CSS
      role: styling
    - name: shadcn/ui
      role: component primitives (copied into your repo, not installed)
    - name: Radix UI
      role: accessibility primitives underneath shadcn/ui
    - name: Lucide
      role: icon set
  why: |
    SaaS UIs all need the same surface: forms, tables, modals, dropdowns, toasts. shadcn/ui gives you those as code you own — when Claude generates a component using these, the styling is yours to tweak rather than fighting a third-party library's theme system. Tailwind keeps the styling local to the markup, which is exactly the shape AI agents do best with.
  tradeoffs: |
    Reach for Mantine or Chakra if your team strongly prefers a runtime component library — both are fine, just heavier. Avoid CSS-in-JS libraries (styled-components, Emotion) on Next.js App Router; they fight the server-component model.

jobs:
  primary:
    - name: Inngest
      role: durable background jobs, scheduled tasks, event-driven workflows; triggers your Next.js routes
      mode: managed
      alt: Trigger.dev, QStash (Upstash) for simpler webhook-style queues
    - name: BullMQ
      role: Redis-backed queue running in a long-lived Node worker container
      mode: selfHosted
      alt: Graphile Worker (Postgres-backed, no Redis needed), River (Go-based, Postgres)
  why: |
    Anything taking longer than a few seconds (sending email, generating reports, syncing third-party APIs) cannot run inside a serverless request — it will time out and the user will stare at a spinner. **Managed** (Inngest) sits outside your app and triggers code in your Next.js routes when events happen, so you don't run a separate worker process — exactly the right shape for Vercel-hosted apps. **Self-hosted** (BullMQ on Valkey, with a worker container in the same K3s cluster) gives you a battle-tested queue you fully control, retries, scheduled jobs, and a dashboard you can SSH to.
  tradeoffs: |
    BullMQ requires a persistent Redis-compatible store and a long-lived worker process — that's an additional deploy target, which matters on managed hosting but is free on self-hosted. Graphile Worker is the right pick if you want to skip Redis entirely and just use the Postgres you already have.

observability:
  primary:
    - name: Sentry
      role: error tracking + performance + session replay
      mode: managed
      alt: Highlight.io, BugSnag
    - name: PostHog
      role: product analytics + feature flags + session replay
      mode: managed
      alt: June, Mixpanel, Amplitude
    - name: Axiom
      role: structured logs
      mode: managed
      alt: Better Stack, Vercel log drains
      optional: true
    - name: Grafana + Prometheus + Loki
      role: dashboards (Grafana), metrics (Prometheus), logs (Loki) — the LGTM stack
      mode: selfHosted
      alt: SigNoz (single-binary alternative covering all three), VictoriaMetrics (better metrics scaling)
    - name: GlitchTip
      role: self-hosted Sentry-compatible error tracking
      mode: selfHosted
      alt: Sentry self-hosted (heavier), Bugsink
    - name: Plausible
      role: self-hosted, privacy-respecting product analytics
      mode: selfHosted
      alt: Umami, PostHog self-hosted (heavier)
  why: |
    "It works on my machine" is the default state of every SaaS in production — you need to know when an error fires for a real user before they tell you in a support ticket. **Managed** (Sentry + PostHog + Axiom) gives you errors, product analytics, and logs in three SaaS dashboards with zero ops. **Self-hosted** (Grafana + Prometheus + Loki + GlitchTip + Plausible) gives you the same surface running inside your cluster — more setup, but everything stays in your perimeter and the cost is just the disk and CPU you were already paying for.
  tradeoffs: |
    Datadog is the real answer at scale but is wildly overkill (and expensive) for a solo SaaS. Self-hosting the LGTM stack is well-documented but expects you to maintain it — don't pick this path unless someone on the team will look at Grafana when the alert fires.

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
    AI-generated code rots without test discipline — the second prompt overwrites assumptions from the first, and nothing catches it. Vitest catches logic regressions per-file; Playwright catches the wiring (does the checkout flow still work end-to-end?). For a SaaS, the auth + billing + tenant-isolation paths must have e2e coverage because regressions there are the ones that take the company down.
  tradeoffs: |
    Skip Playwright only if you have no real users yet and are still in pure prototyping — but add it before you ship paid plans. Cypress is fine if a teammate already knows it; otherwise Playwright is the modern default.
---

# SaaS / B2B Platform

A SaaS is a web product where users sign up, log in, and (eventually) pay you. The shape is so consistent that most decisions can be made for you: there's a frontend, an API, a relational database, accounts, billing, and a dashboard. What changes from one SaaS to the next is the *domain*, not the architecture.

The hard part of SaaS isn't any single technology — it's that several boring things have to be done correctly *together*: authentication can't leak sessions, every database query has to be scoped to the right tenant, background jobs can't silently fail, and the bill from your hosting provider can't grow faster than your revenue. Get any one of those wrong and you've built a product that is technically working but commercially dangerous.

## The managed vs. self-hosted decision

This skeleton supports both paths as first-class choices. Roughly half of solo SaaS builders pick managed (Vercel + Neon + Clerk + Inngest + Sentry); roughly half pick self-hosted (K3s on Hetzner + Postgres + Keycloak + BullMQ + Grafana). Both ship working SaaS. The wizard asks once, up front, and resolves the rest of the stack consistently.

- **Managed** is right when shipping speed is the constraint, when you have no ops capacity, or when your traffic is small enough that the free tiers carry you. The cost of managed is a pricing curve that gets steep around real traction (10k+ MAUs, paid Sentry, paid Postgres). The benefit is that you can deploy by `git push` and never think about TLS, connection pools, or Postgres upgrades.
- **Self-hosted** is right when you have at least basic ops comfort, when you've been burned by managed-service pricing, or when data-residency rules require the database to live in your perimeter. The cost is real time spent on K3s, Postgres operations, and patching Keycloak. The benefit is a stack that costs €20–60/month all-in regardless of traffic and that you can move between providers without rewriting anything.

Don't pick the mode you think makes you sound serious — pick the mode that matches where you'll actually spend your time. Vibe-coders ship more SaaS in either mode than the people debating which is correct.

## Cross-cutting patterns that matter regardless of mode

Two patterns are encoded in the boundaries and apply to both deployment modes:

1. **Tenant isolation is non-negotiable.** Every database query that touches account data must be scoped by tenant ID, and Row-Level Security in Postgres is the safety net underneath that — not the primary mechanism. Forgetting this once means one customer can read another customer's data.
2. **Layered architecture (Controller → Service → Repository).** Controllers validate input and return responses. Services own business logic. Repositories own database access. Features never import across each other directly. This is the convention because it's the convention LLMs follow most reliably; a repo organized any other way drifts within a few prompts.

If your project doesn't have accounts, doesn't have a database with relations, or only ever has a single customer, you're not building SaaS — pick a different archetype.
