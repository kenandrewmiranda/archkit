---
archetype: ecommerce
displayName: E-commerce / Storefront
description: A site where visitors browse a product catalog, add items to a cart, and check out. Physical or digital goods, single-vendor or multi-vendor, with payments, inventory, orders, and fulfillment.
useWhen:
  - Visitors browse products and pay you to ship or deliver them.
  - There is a cart, a checkout step, and an order record after payment.
  - Inventory or product catalog management is a core concern.
  - Conversion rate (visitors → purchases) is a primary business metric.
  - You handle (or coordinate) fulfillment — shipping, digital delivery, or service activation.
redFlags:
  - Customers pay a recurring subscription for application access — that's `saas`.
  - You take a cut of peer-to-peer transactions but don't own inventory — that's a marketplace, closer to `saas` with payments.
  - Visitors book time slots or appointments, no physical/digital good — leans `saas`.
  - You sell access to information (PDF, video library) and there's no real catalog — that's `content` with a paywall.
boundariesRef: archkit-boundaries-ecommerce
recommendedSkills:
  - archkit-skill-stripe
  - archkit-skill-shopify
  - archkit-skill-medusa
  - archkit-skill-tax-shipping

deploymentModes:
  - id: managed
    label: Managed (commerce platform handles cart, checkout, payments, inventory)
    why: |
      Shopify, BigCommerce, or a similar platform owns the commerce engine — your code is mostly the storefront skin and any custom behavior on top. The platform handles PCI compliance, tax calculation, shipping rates, refunds, fraud screening, and the fact that customers pay with thirty different methods across countries. Right default for almost every vibe-coder building commerce — the alternative is reinventing decades of accumulated commerce primitives that have nothing to do with what makes your store distinctive.
  - id: selfHosted
    label: Self-hosted (you operate the commerce engine on your infrastructure)
    why: |
      Medusa, Saleor, or Vendure as the commerce engine, running on your own infrastructure (K3s, Docker on a VM) with your own Postgres. Right default when you've outgrown what a commerce platform allows (custom checkout flows, complex multi-vendor logic, integrations the platform won't let you build), when transaction fees on a managed platform are a real cost, or when data residency requires the order data to live inside your perimeter. Realistically a path for builders with operational comfort, not the starting position.

stack:
  primary:
    - name: TypeScript
      role: language
    - name: Next.js
      role: storefront framework — App Router, server components for product pages
      alt: Astro (more static, less interactive cart UX), Hydrogen (Shopify-blessed Next.js fork), SvelteKit
    - name: Shopify
      role: commerce engine — products, inventory, cart, checkout, orders, customers, fulfillment
      mode: managed
      alt: BigCommerce, Squarespace Commerce, Wix Stores, Webflow Ecommerce
    - name: Medusa
      role: self-hosted commerce engine (Node.js, Postgres) — products, inventory, cart, orders, fulfillment, regions, tax
      mode: selfHosted
      alt: Saleor (Python/Django, GraphQL-first), Vendure (TypeScript/NestJS)
    - name: PostgreSQL
      role: required by self-hosted commerce engines; storefront-specific tables (wishlists, reviews) when needed
      mode: selfHosted
    - name: Stripe
      role: payments — universal regardless of commerce engine; Stripe Checkout (hosted) for low PCI scope, Stripe Elements (embedded) when checkout UX matters
      alt: Adyen (international, more complex), Braintree, Mollie (Europe-friendly), Lemon Squeezy (digital goods + tax handled)
    - name: Algolia
      role: product search and faceted filtering
      mode: managed
      alt: Typesense Cloud, MeiliSearch Cloud, Shopify's built-in search
      optional: true
    - name: Meilisearch (self-hosted)
      role: product search and faceted filtering
      mode: selfHosted
      alt: Typesense, Postgres full-text (acceptable for small catalogs)
      optional: true
  why: |
    Commerce primitives — cart sessions, inventory locking, tax calculation, shipping zones, payment intents, refund flows, fraud screening — are deceptively complex and have been correctly solved many times. The right move for most builders is to *use* a commerce engine rather than build one. **Managed** (Shopify) gives you the engine plus checkout, hosting, and PCI scope reduction in one bundle. **Self-hosted** (Medusa) gives you the same engine running on your infrastructure. In both cases your code is the storefront UI plus whatever custom behavior makes the store yours; the commerce engine is the boring middle. Stripe sits underneath both modes — even with Shopify Payments, the underlying processor is often Stripe.
  tradeoffs: |
    Building the commerce engine from scratch (no Shopify, no Medusa, just Next.js + Stripe + Postgres) is appropriate only when you genuinely have a unique commerce model the existing engines can't represent — most of the time builders who think they need this end up reimplementing a worse version of Medusa. Hydrogen is the right pick if you've committed to Shopify and want their preferred patterns; it's overkill if you're using Shopify as a backend and don't care about Hydrogen-specific features.

hosting:
  primary:
    - name: Vercel
      role: storefront hosting + preview deploys + edge for product page caching
      mode: managed
      alt: Netlify, Cloudflare Pages (great for product pages, awkward for cart state), Railway
    - name: Shopify
      role: commerce platform hosts itself — checkout, customer accounts, admin all live on Shopify infrastructure
      mode: managed
    - name: Cloudinary or Shopify CDN
      role: product image optimization at scale
      mode: managed
      alt: Bunny.net, imgix, native Next.js Image
      optional: true
    - name: K3s on Hetzner or similar
      role: storefront + Medusa + Postgres + worker containers
      mode: selfHosted
      alt: Docker Compose on a single VM (small catalogs only), full K8s on AWS/GCP
    - name: PostgreSQL on the cluster
      role: commerce engine database — orders, products, customers, inventory
      mode: selfHosted
      alt: managed Postgres (Neon, Supabase) inside the same cloud as the cluster
    - name: Caddy
      role: reverse proxy + automatic TLS
      mode: selfHosted
      alt: Traefik, Nginx + certbot
    - name: Bunny.net or Cloudflare
      role: CDN in front of origin for product images and cached pages
      mode: selfHosted
      alt: Fastly (overkill), KeyCDN
  why: |
    **Managed** ecommerce hosting is unusually clean because the commerce platform hosts the parts that matter most for compliance (checkout, payment processing, customer data) and you only host the storefront. Vercel + Shopify is the standard answer. **Self-hosted** ecommerce is heavier because you operate the database that holds order records — that's not just an availability concern, it's an audit-trail concern. Don't run self-hosted commerce on a single VM at any meaningful scale; the database needs proper backups, the worker needs to actually run reliably, and a single host has too many failure modes when real money is moving.
  tradeoffs: |
    The middle path that often wins: managed app hosting (Vercel) + self-hosted Medusa + managed Postgres (Neon). You get push-to-deploy on the storefront, you control the commerce logic, and the database is operated by people whose job is operating databases. This sidesteps both extremes and is a common pattern for builders graduating off Shopify.

auth:
  primary:
    - name: Shopify Customer Accounts
      role: built-in accounts tied to the commerce platform — login, order history, addresses, password reset
      mode: managed
      alt: Clerk (when you want richer UX than Shopify Customer Accounts provides), passwordless via email link
    - name: Medusa customer auth
      role: built-in customer auth in self-hosted commerce engine
      mode: selfHosted
      alt: Keycloak federated to Medusa, custom JWT (only if you really know what you're doing)
    - name: Guest checkout
      role: anonymous purchases without account creation — required for most stores; conversion-critical
  why: |
    Ecommerce auth has a different shape from SaaS — most carts are anonymous, account creation is a *post-purchase* nudge, and forcing signup before checkout is the single most reliable way to lose 30% of orders. Both Shopify and Medusa give you customer accounts as part of the commerce engine; you don't generally need a separate auth provider unless you're running a multi-vendor marketplace or have other identity surfaces beyond shopping. Guest checkout must be the default; account creation is offered after the order is placed.
  tradeoffs: |
    Reach for Clerk only when you have a logged-in surface beyond shopping (a creator dashboard, a workshop booking system) that needs richer auth than the commerce engine offers. Don't run two auth systems (Clerk + Shopify Customer Accounts) just because you can — pick one source of customer identity.

networking:
  primary:
    - name: Shopify Storefront API (GraphQL)
      role: read products, manage cart, create checkout sessions — called from your Next.js storefront
      mode: managed
      alt: Shopify Admin API (server-only, for management tasks), webhooks for order events
    - name: Stripe Checkout
      role: hosted checkout flow — Stripe handles the form, you redirect users there and receive a webhook on success
      mode: managed
      alt: Stripe Elements (embedded checkout, more PCI scope)
    - name: Medusa REST/GraphQL API
      role: cart, products, orders, customers from your storefront
      mode: selfHosted
      alt: Saleor GraphQL API, Vendure GraphQL API
    - name: Stripe (direct)
      role: payment intents, charges, refunds — called server-to-server from your commerce backend
      mode: selfHosted
      alt: Adyen API, Mollie API
    - name: Webhook receivers
      role: handle async events from Stripe (payment success, refund, dispute), Shopify (order created, fulfillment update), shipping providers (label scanned, delivered) — must be idempotent
    - name: Zod
      role: validate every webhook payload and form input — webhooks especially must be checked because they come from outside your perimeter
  why: |
    Ecommerce networking is shaped by *external systems firing webhooks at you* more than any other archetype. Stripe tells you when a payment succeeded. Shopify tells you when an order was created. The shipping carrier tells you when a label was scanned. Every one of these handlers must be idempotent because webhook providers retry on failure (and will fire the same event multiple times even on success). The synchronous API surface (Storefront API, cart endpoints) is well-trodden; the webhook surface is where bugs lose orders or double-charge customers.
  tradeoffs: |
    Use Stripe Checkout (hosted) over Stripe Elements (embedded) unless you have a specific UX requirement — hosted checkout dramatically reduces your PCI scope and Stripe handles all the payment-method updates automatically. Switch to Elements only when the data shows hosted checkout is hurting conversion specifically.

ui:
  primary:
    - name: Tailwind CSS
      role: styling
    - name: shadcn/ui
      role: component primitives for forms, dialogs, dropdowns
    - name: Radix UI
      role: accessibility primitives underneath shadcn/ui
    - name: Next.js Image (or commerce-platform image CDN)
      role: product image optimization — multiple sizes, modern formats, lazy loading
    - name: Embla Carousel
      role: product galleries, related-products carousels
      optional: true
    - name: Lucide
      role: icon set
  why: |
    Ecommerce UI is dominated by product photos. A store's photographic execution does more for conversion than nearly any other UI choice — and the technical execution of those photos (sizing, format, loading priority) is where most stores leave money on the table. Cart drawer, variant selector, product card, checkout summary are the components every store needs and they all benefit from being your own code (shadcn/ui style) so you can tune them without fighting a third-party theme.
  tradeoffs: |
    Heavy ecommerce-specific component libraries (Shopify Polaris, BigCommerce Big Design) are designed for admin surfaces, not storefronts — don't use them on the customer side. Visual polish matters more here than in any other archetype except `mobile`; budget time for it.

jobs:
  primary:
    - name: Inngest
      role: order workflow orchestration (post-payment fulfillment, abandoned cart emails, retry logic for failed webhooks)
      mode: managed
      alt: Trigger.dev, Shopify Flow (for Shopify-native workflows), QStash
    - name: BullMQ
      role: order processing, email sends, inventory sync — runs in a long-lived worker container next to Medusa
      mode: selfHosted
      alt: Graphile Worker (Postgres-backed), Medusa's built-in event bus + custom subscribers
    - name: Klaviyo or Loops
      role: lifecycle email — abandoned cart, post-purchase, re-engagement
      mode: managed
      alt: Mailchimp, Customer.io, Resend with your own logic
      optional: true
    - name: Listmonk + custom triggers
      role: self-hosted lifecycle email
      mode: selfHosted
      alt: Plunk, Postal + custom worker
      optional: true
  why: |
    Ecommerce has more legitimate background work than any other archetype — order placed → charge payment → reserve inventory → send confirmation email → notify warehouse → schedule shipping label → send shipped email → handle delivery confirmation. Each step is a job, each can fail, and each must be retryable without duplicating its effect. Inngest's workflow model maps to this naturally; BullMQ does too if you wire the steps yourself. Lifecycle email (abandoned cart, post-purchase) drives meaningful revenue and belongs in a tool designed for it (Klaviyo for managed; Listmonk for self-hosted) rather than ad-hoc in your app code.
  tradeoffs: |
    On Shopify-managed mode, much of this workflow lives inside Shopify Flow or Shopify itself — only build it in Inngest when you need behavior Shopify doesn't offer. For self-hosted Medusa, the built-in event bus is enough for simple workflows; reach for BullMQ when you need scheduled retries, complex chains, or visibility into the queue.

observability:
  primary:
    - name: PostHog
      role: funnel analytics (landing → product → cart → checkout → purchase), feature flags for storefront experiments, session replay for cart abandonment investigation
      mode: managed
      alt: Mixpanel, June, Heap
    - name: Sentry
      role: error tracking — cart errors, checkout failures, webhook handler crashes are revenue-bleeding
      mode: managed
      alt: Highlight.io, BugSnag
    - name: Shopify Analytics
      role: built-in conversion analytics if using Shopify — already wired up, free
      mode: managed
      optional: true
    - name: Plausible
      role: privacy-respecting page view analytics
      mode: managed
      alt: Fathom, Vercel Analytics
      optional: true
    - name: PostHog self-hosted
      role: funnel analytics + session replay on your own infrastructure
      mode: selfHosted
      alt: Plausible self-hosted (page views only — no funnel), Umami
    - name: GlitchTip
      role: self-hosted Sentry-compatible error tracking
      mode: selfHosted
      alt: Sentry self-hosted (heavier)
    - name: Grafana + Loki
      role: dashboards (Grafana) + structured logs (Loki) for backend services
      mode: selfHosted
      alt: SigNoz (single binary)
      optional: true
  why: |
    For ecommerce, "observability" splits into three concerns: *did the system error* (Sentry), *did people complete the funnel* (PostHog), and *what did the business do today* (Shopify Analytics or your own dashboards). The funnel is the most important — every drop-off between cart and purchase is lost revenue, and you can only optimize what you can see. PostHog's session replay is particularly useful here because watching a real customer abandon at checkout tells you more than any aggregate funnel chart. Sentry catches the *technical* failure modes (the cart save returned 500, the payment intent timed out) which directly correlate to lost orders.
  tradeoffs: |
    On Shopify-managed mode, much of the funnel data lives in Shopify Analytics already — duplicating it in PostHog only matters if you want flexibility Shopify doesn't offer. Skip Sentry only if your store is genuinely tiny (under a few orders/day) and you can manually monitor — but the cost of a missed checkout bug is worth the Sentry tier.

testing:
  primary:
    - name: Vitest
      role: unit + integration tests for cart logic, pricing rules, tax calculation, inventory operations
    - name: Playwright
      role: end-to-end tests for the entire purchase flow — non-negotiable for ecommerce; this is the test that protects revenue
    - name: MSW
      role: mock Stripe and commerce-engine APIs in tests
      optional: true
    - name: Chromatic or Percy
      role: visual regression testing for product pages and checkout
      optional: true
  why: |
    The single most important test in ecommerce is *can a user complete a purchase end-to-end* — variant selection, add to cart, checkout, payment, order confirmation. If this test breaks and you ship anyway, you stop making money until someone notices. Playwright running this flow against a Stripe test mode + commerce-engine sandbox should run on every PR and on a schedule against production. Cart and pricing logic deserve tight unit-test coverage because off-by-one bugs in pricing are the kind that make headlines (Amazon's penny-priced books).
  tradeoffs: |
    Visual regression is overkill for very early stores but pays off the moment you have repeat traffic — a layout shift on the product page that nobody notices for a week is real lost conversion. Skip Percy/Chromatic only while still in pre-launch.
---

# E-commerce / Storefront

An ecommerce site sells things. The visitor arrives, browses, adds to a cart, pays, and (eventually) receives the product. The architecture is well-understood and the failure modes are expensive in a way no other archetype is — every minute the checkout is broken is revenue going to zero, every cart bug is potential refunds, every misconfigured tax rate is a future audit.

The deceptive thing about ecommerce is that it *looks* like a SaaS app — it has a database, accounts, payments, and a frontend — but the work is dominated by problems that have already been solved. Cart sessions, inventory locking, tax calculation per jurisdiction, shipping rate quoting, payment method handling, refund flows, fraud screening, dispute management — all of this is decades of accumulated complexity, and the right answer for nearly every builder is to *not* reimplement it. Use a commerce engine (Shopify, Medusa, Saleor, BigCommerce) and spend your code budget on the parts that are actually distinctive: the storefront UX, the brand, the product photography, the conversion optimization, the integrations with your specific operations.

## What ecommerce optimizes for that other archetypes don't

Three concerns dominate the architecture:

1. **Conversion rate is the north star.** Every layout change, every checkout step, every load-time regression measurably moves money. You cannot ship without knowing your funnel — landing → product → cart → checkout → purchase — and watching it drift. PostHog or Mixpanel for the funnel; session replay for the *why* behind the drop-off.
2. **Webhooks must be idempotent.** Stripe, Shopify, your shipping carrier, your warehouse system — all of them send webhooks, all of them retry on failure, all of them will fire the same event multiple times even when the first delivery succeeded. Every webhook handler must check whether the event has already been processed (by external event ID) before doing anything that costs money. Forget this once and you double-charge a customer.
3. **PCI scope is the silent design constraint.** Touching credit card numbers directly drags your entire codebase into PCI compliance. The safe path is hosted checkout (Stripe Checkout, Shopify checkout) — your code never sees a card number, your PCI scope drops to the minimum SAQ. Custom embedded checkout (Stripe Elements) is fine but raises the bar; building anything custom on top of raw card data is essentially never the right answer for a vibe-coder-built store.

## The managed vs. self-hosted decision

For ecommerce, the managed/self-hosted decision is more consequential than in other archetypes because the commerce engine itself shifts. **Managed** (Shopify or BigCommerce as backend, Vercel as frontend, Stripe Checkout for payment) is the right starting answer for nearly every solo or small-team builder — you outsource the commerce primitives to a platform whose entire business is getting them right. **Self-hosted** (Medusa or Saleor on your K3s cluster, Postgres for orders, Stripe direct) is the right answer when you've outgrown what platforms allow, when transaction fees become a real cost relative to revenue, or when data residency requires the order data to live in your perimeter. There is also a common middle path — managed app hosting + self-hosted Medusa + managed Postgres — that lets you graduate off Shopify without operating everything yourself.

If your business is recurring software access rather than transactional sales of products, you're not building ecommerce — pick `saas` instead.
