---
archetype: _generic
displayName: Generic / Unspecified
description: Fallback skeleton for projects that don't yet fit a canonical archetype, or that are hybrids of two or more. Provides sane minimal defaults and clear pointers to the eight specific archetypes — intended as a starting point you upgrade out of, not a destination.
useWhen:
  - You're starting a project and the shape isn't clear yet — explore now, commit later.
  - The project is a genuine hybrid of two or three archetypes and none dominates.
  - You're prototyping to find product-market fit and don't want to over-commit to an archetype's specifics.
  - You picked a canonical archetype and the wizard's defaults didn't fit — coming back here to opt out is fine.
redFlags:
  - You can describe the product in one sentence and it matches a canonical archetype — pick that archetype instead.
  - Multi-tenant subscription product with login, billing, dashboards → use `saas`.
  - Internal admin tool / ops console for your team → use `internal`.
  - Marketing site, blog, documentation, brochure site → use `content`.
  - Storefront with cart, checkout, orders → use `ecommerce`.
  - LLM is the core product (chat, agent, RAG) → use `ai`.
  - iOS / Android app, App Store distribution → use `mobile`.
  - Multi-client realtime updates, collaborative editing, presence → use `realtime`.
  - Pipelines, warehouse, BI, embedded analytics → use `data`.
boundariesRef: archkit-boundaries-generic
recommendedSkills:
  - archkit-skill-postgres
  - archkit-skill-nextjs

deploymentModes:
  - id: managed
    label: Managed (push-to-deploy, less ops)
    why: |
      Vercel for the app, Neon for Postgres, Clerk for auth, Inngest for jobs, Sentry for errors. Right default when you want to ship something working today and figure out architecture later. Costs scale with usage from near-zero. Easy to migrate off later when the shape clarifies — Next.js + Postgres + Stripe is portable.
  - id: selfHosted
    label: Self-hosted (you own the infrastructure)
    why: |
      K3s on Hetzner, self-hosted Postgres, Keycloak for auth, BullMQ or Graphile Worker for jobs, GlitchTip + Grafana for observability. Right default when you already operate infrastructure or have a strong preference for it. Heavier up-front than managed; predictable cost at scale. The defaults below match the saas archetype's self-hosted defaults closely because saas is the broadest applicable shape.

stack:
  primary:
    - name: TypeScript
      role: language
    - name: Next.js
      role: full-stack framework — broadest applicability across web product shapes
      alt: switch to Astro for content-heavy, Expo for mobile, or split out a separate API layer once you outgrow the monolith
    - name: PostgreSQL
      role: primary database — defer the "do we need a different store" question until you actually feel the pain
      alt: SQLite (genuinely fine for small or single-user products), DuckDB (analytical workloads), specialized stores when justified
    - name: Drizzle ORM
      role: query builder + migrations
      alt: Prisma, Kysely, raw SQL via pg
  why: |
    The point of this skeleton is to defer architecture-defining choices until the product shape is clearer. Next.js + TypeScript + Postgres + Drizzle is the most portable starting point — it works for SaaS, internal tools, content sites with light app surface, AI products, and embedded analytics, and it migrates cleanly into more specialized shapes later. The right move when you're early is to write code that's *easy to throw away* in any direction, not code that's optimized for any one direction.
  tradeoffs: |
    Switch to Astro the moment you realize the product is dominated by content/marketing surfaces. Switch to Expo the moment you decide mobile is the primary surface. Switch to a more opinionated stack from a canonical archetype the moment your product shape is clear — staying generic past that point costs you the thought-layer that the canonical archetypes provide.

hosting:
  primary:
    - name: Vercel
      role: app hosting + preview deploys
      mode: managed
      alt: Railway, Fly.io, Render
    - name: Neon
      role: serverless Postgres
      mode: managed
      alt: Supabase, Railway Postgres
    - name: K3s on Hetzner
      role: lightweight Kubernetes on cheap VMs
      mode: selfHosted
      alt: Docker Compose on a VM (small scale), full K8s
    - name: PostgreSQL on the cluster
      role: primary database
      mode: selfHosted
    - name: Caddy
      role: reverse proxy + automatic TLS
      mode: selfHosted
      alt: Traefik
  why: |
    Generic-archetype hosting matches the saas archetype's defaults because saas is the broadest applicable shape. Both modes optimize for "ship something working today, refactor when the product clarifies." Vercel + Neon gets you push-to-deploy in minutes; K3s + Postgres gets you a portable self-hosted stack for a similar effort to other archetypes' self-hosted paths.
  tradeoffs: |
    These choices are intentionally generic — when the product shape clarifies, pick a canonical archetype and accept its more opinionated hosting picks (Cloudflare Pages for content, EAS for mobile, managed warehouse for data, etc.).

auth:
  primary:
    - name: Clerk
      role: managed auth — drop-in components, sessions, social, MFA
      mode: managed
      alt: Auth.js, Supabase Auth
    - name: Keycloak
      role: self-hosted IdP
      mode: selfHosted
      alt: Authentik, Authelia
    - name: None
      role: skip auth entirely if the product genuinely has no logged-in surface yet — most products eventually need it, but premature auth wiring isn't free
      optional: true
  why: |
    Default to Clerk (managed) or Keycloak (self-hosted) because adding auth later is harder than adding it early — login, sessions, password reset, and account ownership thread through every part of an app. The only good reason to skip is if the product genuinely has zero logged-in surface (a public tool, a brochure site) — in which case treat it as a content-archetype-shaped product and revisit when accounts become a real requirement.
  tradeoffs: |
    Skip auth for true single-user / single-tenant prototypes — wire it in when the second user appears.

networking:
  primary:
    - name: Next.js Route Handlers
      role: HTTP API surface
    - name: Zod
      role: input validation at every untrusted edge — request bodies, URL params, env vars
    - name: tRPC or Server Actions
      role: typed contract between your frontend and backend; pick whichever matches your team's preference
      optional: true
  why: |
    The networking shape is intentionally minimal and matches every web-shaped archetype. Zod is non-negotiable regardless of archetype because it's the cheapest defense against bad input crashing your services. tRPC and Server Actions are equivalent for solo-builder Next.js apps; the choice doesn't matter much until you have non-browser API consumers (then you want REST).
  tradeoffs: |
    If the product turns out to need streaming responses (AI), WebSockets (realtime), or webhook ingestion (ecommerce, data), the networking shape will outgrow this baseline — switch to the relevant canonical archetype's defaults at that point.

ui:
  primary:
    - name: Tailwind CSS
      role: styling
    - name: shadcn/ui
      role: component primitives copied into your repo
    - name: Radix UI
      role: accessibility primitives underneath shadcn/ui
    - name: Lucide
      role: icon set
  why: |
    Tailwind + shadcn/ui is the broadest-applicable UI stack — it works for SaaS dashboards, internal tools, marketing pages, embedded analytics, AI chat surfaces. The components are code you own, so when the archetype clarifies you can specialize them (TanStack Table for internal tools, NativeWind for mobile, react-markdown for AI, Recharts for data) without throwing the foundation away.
  tradeoffs: |
    Same UI defaults work everywhere except mobile (use NativeWind via React Native) and content sites that want a strong distinct visual identity (skip the component library, write custom CSS).

jobs:
  primary:
    - name: Inngest
      role: durable jobs, scheduled tasks, event-driven workflows — works on serverless app hosting without a separate worker process
      mode: managed
      alt: Trigger.dev, QStash
    - name: Graphile Worker
      role: Postgres-backed background jobs — uses the database you already have, no Redis required
      mode: selfHosted
      alt: BullMQ (more features, requires Redis), River
    - name: None yet
      role: skip a job system entirely until you have a job that actually needs durable retry — premature job infrastructure is a common form of yak-shaving
      optional: true
  why: |
    Default to Inngest (managed) or Graphile Worker (self-hosted) when you have any background work; skip both when you don't. Graphile Worker is a particularly good generic-archetype fit because it uses the Postgres you already have — adding Redis purely for jobs is unnecessary infrastructure for a project whose shape isn't clear yet.
  tradeoffs: |
    Don't add a job system before you need one — a single scheduled task can run as a cron-triggered Vercel Function or GitHub Action while you're still figuring out the product shape.

observability:
  primary:
    - name: Sentry
      role: error tracking
      mode: managed
      alt: Highlight.io
    - name: Plausible
      role: lightweight, privacy-respecting page-view analytics
      mode: managed
      alt: Vercel Analytics, Fathom
    - name: GlitchTip
      role: self-hosted Sentry-compatible error tracking
      mode: selfHosted
      alt: Sentry self-hosted
    - name: Plausible self-hosted
      role: self-hosted analytics
      mode: selfHosted
      alt: Umami
  why: |
    Generic observability defaults match the saas baseline — Sentry for errors, Plausible for traffic, both available in both deployment modes. When the archetype clarifies, layer in archetype-specific signals (PostHog funnels for ecommerce, LangSmith for AI, Search Console for content, audit log for internal, data quality tests for data, connection metrics for realtime).
  tradeoffs: |
    Skip Plausible if there's no public-facing surface (internal tools, single-user products) — page-view analytics on an internal tool is mostly noise.

testing:
  primary:
    - name: Vitest
      role: unit + integration tests
    - name: Playwright
      role: end-to-end browser tests for critical paths
    - name: MSW
      role: mocking external HTTP in tests
      optional: true
  why: |
    Vitest + Playwright covers nearly every web-shaped archetype's testing needs. The depth of coverage varies by archetype (ecommerce needs full-checkout e2e, AI needs eval suites, data needs dbt tests, content needs Lighthouse CI) — but Vitest + Playwright is the foundation underneath all of them. Set this up early; you won't regret it regardless of which archetype you eventually settle on.
  tradeoffs: |
    Skip Playwright for the very first prototype week — but add it before showing the product to anyone you'd be embarrassed to have hit a regression in front of.
---

# Generic / Unspecified

This skeleton is the fallback when none of the eight canonical archetypes (`saas`, `internal`, `content`, `ecommerce`, `ai`, `mobile`, `realtime`, `data`) fits cleanly — either because the product is genuinely early and the shape isn't clear yet, or because it's a real hybrid where no single archetype dominates. The defaults are intentionally generic and biased toward portability: TypeScript + Next.js + Postgres + Drizzle + Tailwind + shadcn/ui works for almost any web-shaped product and migrates cleanly into more specialized stacks later.

This is a starting point, not a destination. The thought-layer value of archkit comes from the *opinionated* archetype skeletons — they encode the patterns and gotchas specific to that kind of product. Staying generic past the point where the archetype is clear costs you that value. The wizard can be re-run at any time, and switching archetypes mid-project is a normal thing to do once you understand what you're actually building.

## How to use this skeleton well

Three concrete moves make this skeleton work as intended:

1. **Re-run the wizard once the shape clarifies.** This usually happens within the first few weeks — you realize you're really building a SaaS, or that the product is dominated by content, or that the AI surface is the actual product. When that clicks, run `/archkit-init` again and pick the canonical archetype. The wizard will update `.arch/SYSTEM.md`, `.arch/BOUNDARIES.md`, and the foundation ADR; your code keeps working.
2. **Treat the prose body of the relevant canonical archetype as a checklist.** Even before you commit, read through `saas.md`, `ai.md`, etc. and identify the *concerns* that apply to your product. The technology picks are negotiable; the concerns (tenant isolation, idempotent webhooks, eval suites, audit logs) are not, and they don't go away just because you're using the generic skeleton.
3. **For genuine hybrids, pick the dominant archetype and treat the others as features.** A SaaS that has an AI feature is `saas`, not `ai`. An internal tool that has embedded analytics is `internal`, not `data`. The dominant archetype's boundaries and patterns govern; the secondary archetype's specific concerns (LLM caching, dbt tests) get layered in as feature-level decisions.

## Why opinionated archetypes exist

The eight canonical archetypes encode patterns and failure modes that are specific to each product shape — tenant isolation in SaaS, audit logging in internal tools, Core Web Vitals in content, webhook idempotency in ecommerce, eval suites in AI, App Store review constraints in mobile, channel authorization in realtime, idempotent jobs in data. The boundaries shipped with each archetype enforce these. The skeletons' prose explains them in plain language. None of that lands when you're using the generic skeleton — you get a working app, but not the thought-layer.

The generic skeleton exists because forcing an archetype choice before the product is clear leads to worse outcomes than letting people start vague and specialize later. Use it deliberately as a transitional state, not as a final answer.
