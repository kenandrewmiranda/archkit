---
archetype: content
displayName: Content Site / Marketing / Blog / Docs
description: A site whose primary job is to publish information that humans read. Marketing sites, product blogs, documentation, landing pages, brochure sites, personal portfolios. Mostly anonymous traffic, SEO-driven, fast pages over rich interactivity.
useWhen:
  - The product is the words and images on the page, not application behavior.
  - Most visitors are anonymous; signup is optional or absent.
  - Search-engine traffic is a primary acquisition channel.
  - Page speed and Core Web Vitals are make-or-break for the business.
  - Content authoring is a recurring activity — new posts, new pages, edits — done by you, a writer, or a marketer.
redFlags:
  - Users sign up and pay you for application access — that's `saas`.
  - Storefront with cart, checkout, and orders — that's `ecommerce`.
  - Heavy logged-in interactivity (dashboards, workflows) — that's `saas` or `internal`.
  - The product is an LLM, agent, or model-driven tool — that's `ai`.
  - Real-time chat, presence, collaborative editing — that's `realtime`.
boundariesRef: archkit-boundaries-content
recommendedSkills:
  - archkit-skill-astro
  - archkit-skill-mdx
  - archkit-skill-seo

deploymentModes:
  - id: managed
    label: Managed (push-to-deploy, edge CDN included)
    why: |
      Static-first hosting on a global edge CDN — Cloudflare Pages, Vercel, or Netlify. Push to git, the site rebuilds and deploys to hundreds of edge locations in under a minute. Free tiers cover most content sites indefinitely. Right default when SEO and page speed matter (which is almost always for content) and you don't want to think about cache invalidation, TLS, or capacity. The trade is dependence on the platform's build limits and pricing curves at very high traffic.
  - id: selfHosted
    label: Self-hosted (your own server, your own static files)
    why: |
      Caddy or Nginx serving static files from a Docker container on a single VM, K3s cluster, or your own bare metal. Right default when you already operate infrastructure, when you want full control of caching headers and CDN configuration, or when content includes large media (video, large image archives) where managed bandwidth costs are prohibitive. The trade is operating the CDN tier yourself — usually Bunny.net or Cloudflare in front of your origin — and patching the OS.

stack:
  primary:
    - name: TypeScript
      role: language (for components and any dynamic bits)
    - name: Astro
      role: content-first framework — ships zero JS by default, server-renders to static HTML, supports React/Svelte/Vue islands when interactivity is needed
      alt: Next.js (if the site also has app-like sections), SvelteKit, Hugo (Go, no JS toolchain), 11ty (JS, very minimal)
    - name: MDX
      role: authoring format — markdown with JSX components inline, version-controlled in git
      alt: plain Markdown (when no embedded components), Markdoc (Stripe's variant, stricter)
    - name: Sharp
      role: image optimization at build time — multiple sizes, modern formats (AVIF, WebP)
      alt: Cloudinary, imgix (managed image CDNs)
    - name: Headless CMS
      role: when non-engineers author content
      optional: true
  why: |
    Content sites are dominated by two requirements: server-rendered HTML for search engines and crawlers, and minimal client-side JavaScript so pages feel instant. Astro is the modern default because it serves pure static HTML by default and only ships JavaScript for the components you explicitly mark as interactive — every other framework does the opposite. MDX gives you markdown for the writing flow with the option to drop in interactive components when you need them. Image handling is non-negotiable: serving an unoptimized 4MB hero image is the single most common way content sites tank their Lighthouse score.
  tradeoffs: |
    Reach for Next.js when the site has substantial application surface (a product app *plus* marketing pages) and you want one framework for both — Astro is awkward for app-shell UX. Use Hugo or 11ty if you want zero Node.js in the build pipeline and aren't writing components. A CMS is right when content authors are not engineers; it's overhead when they are.

hosting:
  primary:
    - name: Cloudflare Pages
      role: static hosting with the most generous free tier and global edge
      mode: managed
      alt: Vercel (best DX, paid tier comes faster), Netlify, GitHub Pages (free but limited)
    - name: Cloudflare Workers
      role: serverless functions for forms, redirects, edge logic
      mode: managed
      alt: Vercel Functions, Netlify Functions
      optional: true
    - name: Sanity, Contentful, or Notion-as-CMS
      role: managed headless CMS when non-engineers author
      mode: managed
      alt: Storyblok, Hygraph, Payload Cloud
      optional: true
    - name: Caddy on a small VM
      role: HTTP server + automatic TLS — serves static build output from a Docker container
      mode: selfHosted
      alt: Nginx + certbot, Traefik, Apache (don't)
    - name: Bunny.net or Cloudflare (in front of origin)
      role: CDN tier so your origin VM doesn't serve every visitor directly
      mode: selfHosted
      alt: Fastly (overkill for content), KeyCDN, self-hosted Varnish
    - name: Payload, Directus, or Decap
      role: self-hosted headless CMS — Payload and Directus need a database; Decap stores content as git commits
      mode: selfHosted
      alt: Strapi (heavier), Ghost (if it's primarily a blog), Statamic (PHP-based)
      optional: true
  why: |
    **Managed** static hosting is almost free at content-site scale and gets you a global edge CDN out of the box — there is no infrastructure to operate, just a git repo. **Self-hosted** is appropriate when you're already running infrastructure or when bandwidth costs at high volumes (large video files, image-heavy archives) make managed pricing unfriendly; the standard pattern is your own origin behind a CDN tier so the VM never gets hit directly. Both modes can serve the same static build artifacts; the difference is where they live and who handles the TLS.
  tradeoffs: |
    Don't self-host without a CDN in front — a single VM serving a viral blog post is how content sites go down. Don't pay for Vercel Pro just to host a blog; Cloudflare Pages or Netlify free tier is fine. If your content includes a lot of video, neither static-host tier is correct — push that to a video-specific service (Mux, Cloudflare Stream, Bunny Stream).

auth:
  primary:
    - name: None
      role: pure content sites have no auth surface
    - name: Clerk or Memberstack
      role: gated/paid content, member-only areas
      mode: managed
      alt: Outseta, Patreon (for creators), Substack (if it's really a newsletter)
      optional: true
    - name: Authelia or Keycloak
      role: gated/member content, federating to your own user database
      mode: selfHosted
      alt: Ory Kratos, custom JWT (only if you really know what you're doing)
      optional: true
  why: |
    Most content sites have no authentication and that's correct — adding accounts to a marketing site or blog adds friction with no benefit. The exception is paid content, member-only areas, or comment systems. When you do need it, the right shape is gating *some* pages while leaving the marketing/SEO surface fully public; never hide content from search crawlers behind login.
  tradeoffs: |
    If you're considering auth purely so people can comment, use a third-party comment system (Giscus on GitHub Discussions, Cusdis, Disqus) instead — it's dramatically less complexity. If the auth requirement comes from "we want to track who reads what," that belongs in analytics, not authentication.

networking:
  primary:
    - name: Astro endpoints (or Next.js Route Handlers)
      role: small server-side handlers for contact forms, newsletter signups, redirects, RSS feeds
    - name: Zod
      role: validate any form input before passing it to email or CRM integrations
    - name: Resend
      role: transactional email for forms (contact form forwards, signup confirmations)
      mode: managed
      alt: Postmark, SendGrid, Loops (if also doing newsletter)
      optional: true
    - name: Plunk or Listmonk (self-hosted)
      role: transactional + newsletter email
      mode: selfHosted
      alt: self-hosted Postal, Maddy, or just `msmtp` to a relay
      optional: true
  why: |
    Content sites are mostly read-only, so the "API" surface is small: contact forms, newsletter signups, search, maybe a webhook from a CMS. Both Astro and Next.js can serve these as edge functions next to the static pages. The two pieces that matter are validating untrusted form input (otherwise your contact form becomes a spam vector) and having a reliable way to actually send the email — Resend is the painless managed default, self-hosted senders work but need correct DNS (SPF/DKIM/DMARC) or messages land in spam.
  tradeoffs: |
    Skip server-side endpoints entirely if you can — third-party form services (Formspree, Web3Forms, Tally) handle contact forms with no code at all. Add your own endpoints when you need to do something specific with the submission (write to a database, trigger a workflow).

ui:
  primary:
    - name: Tailwind CSS
      role: styling
    - name: '@tailwindcss/typography'
      role: prose styling for MDX content — sane defaults for headings, links, code blocks, quotes
    - name: shadcn/ui
      role: component primitives when you need forms, dialogs, dropdowns
      optional: true
    - name: Lucide
      role: icon set
  why: |
    Content sites have two distinct UI concerns: marketing/landing surfaces (need to look distinctive) and prose surfaces (need to be readable). Tailwind handles the first; `@tailwindcss/typography` handles the second by giving you good prose defaults you can tweak with one class. shadcn/ui is only needed where you have actual interactive components — a contact form, a search dialog — not for static pages.
  tradeoffs: |
    For sites that need a strong distinct visual identity (designer portfolios, agency sites, brand sites), skip the component library entirely and write the CSS directly. Component libraries are a starting kit; brand sites should rarely look like they used one.

jobs:
  primary:
    - name: Build-time content processing
      role: image optimization, RSS generation, sitemap generation, search index — handled by Astro/Next during the build, no runtime job system needed
    - name: GitHub Actions on schedule
      role: nightly link checker, broken-image detector, content rebuilds when external data changes
      mode: managed
      alt: Vercel Cron, Cloudflare Cron Triggers
      optional: true
    - name: cron in the container
      role: nightly link checker, content rebuilds, search-index refresh on the schedule that suits you
      mode: selfHosted
      alt: systemd timers, an external scheduler hitting a webhook
      optional: true
  why: |
    Content sites usually need no runtime job system at all — the build step handles image processing, sitemap generation, RSS, search index, and everything else that "happens periodically." The only real recurring jobs are link checking and rebuilds triggered by external content (e.g. CMS webhook), and both are simple cron tasks. Don't introduce Inngest or BullMQ for a content site — it's the wrong shape.
  tradeoffs: |
    The exception is when content depends on live external data (stock prices, weather, sports scores) — then you need a real job system or ISR (incremental static regeneration). For everything else, build-time processing wins.

observability:
  primary:
    - name: Plausible
      role: privacy-respecting analytics — page views, sources, top pages, no cookies, no banner needed in EU
      mode: managed
      alt: Fathom, Simple Analytics, Vercel Analytics (if already on Vercel)
    - name: Sentry
      role: error tracking — light usage, mostly catches client-side JS errors and form-submission failures
      mode: managed
      alt: Highlight.io, GlitchTip self-hosted (yes, even in managed mode)
      optional: true
    - name: Plausible self-hosted
      role: privacy analytics on your own infrastructure
      mode: selfHosted
      alt: Umami, Matomo (heavier), Pirsch
    - name: GlitchTip
      role: self-hosted Sentry-compatible error tracking
      mode: selfHosted
      alt: Sentry self-hosted (heavier), no error tracking at all (defensible for tiny sites)
      optional: true
    - name: Google Search Console + Bing Webmaster Tools
      role: the most important "observability" for a content site — actual search rank, impressions, click-through rate
  why: |
    Content sites have a different observability story than apps. Errors are rare (mostly static pages); what matters is *did people find this page* (Search Console), *what are they reading* (Plausible/Fathom), and *did the contact form actually work* (Sentry catches the failure case). Plausible is the right default for both managed and self-hosted because it doesn't require a cookie banner — the EU/UK cookie consent overlay measurably hurts conversion and adds zero value when you're not actually tracking individuals.
  tradeoffs: |
    Don't install Google Analytics on a content site in 2026 — the data is worse than Plausible's, the cookie banner hurts conversion, and the privacy story is bad. Skip Sentry entirely on a pure-static brochure site with no forms; there's nothing for it to track.

testing:
  primary:
    - name: Lighthouse CI
      role: catch performance regressions in the build — Core Web Vitals are SEO-load-bearing
    - name: Playwright
      role: end-to-end tests for critical CTAs (contact form, signup, demo booking) and accessibility checks
    - name: Link checker
      role: build-step or nightly job — broken internal links erode SEO and trust
  why: |
    The testing bar for content sites is shaped by what actually breaks the business: a slow page (loses search rank), a broken CTA (loses leads), a dead internal link (frustrates readers, dings SEO). Lighthouse CI runs in your build pipeline and fails the build if performance drops below a threshold; Playwright covers the conversion paths that matter; a link checker catches the slow-rotting kind of bug that nobody notices for months. Unit tests are mostly pointless on a content site because there's almost no logic to unit-test.
  tradeoffs: |
    Skip Playwright on truly static brochure sites with no forms or CTAs — there's nothing meaningful to test end-to-end. Skip Lighthouse CI only if you don't care about SEO traffic, in which case you probably shouldn't be in this archetype.
---

# Content Site / Marketing / Blog / Docs

A content site's job is to put information in front of readers and (usually) get them to take an action — sign up for a newsletter, book a demo, buy a product, read more. The audience is mostly anonymous, search engines are a primary delivery mechanism, and the writing matters more than the code. The architecture should disappear: static HTML, fast pages, easy authoring.

The shape is well-defined and the technology choices have largely settled. Astro is the modern default because it's the only major framework whose default output is zero JavaScript — every other framework requires opt-out hydration and bundle-budget vigilance to land in the same place. MDX gives you markdown for the writing flow with the option to drop in interactive components for the rare page that needs them. Static hosting (Cloudflare Pages or self-hosted Caddy) serves the build output without an origin server in the request path.

## What content sites optimize for that other archetypes don't

Three concerns dominate every decision in this archetype:

1. **Server-rendered HTML for crawlers.** Google's crawler executes JavaScript, but unevenly and on a delay; Bing's is worse; LLM crawlers (GPTBot, ClaudeBot, Perplexity) mostly don't execute JS at all. If your content is rendered client-side, half your potential traffic never sees it. This is not negotiable.
2. **Core Web Vitals as a ranking signal.** Largest Contentful Paint, Interaction to Next Paint, Cumulative Layout Shift — Google uses these to rank pages. A slow page doesn't just feel slow; it ranks lower. Image optimization (Sharp, AVIF, sized variants) and shipping minimal JavaScript are the two biggest levers.
3. **Authoring workflow that matches who writes.** If you're the only writer, MDX in the repo is fine. If a marketer or non-engineer writes, they need a CMS. Picking the wrong authoring layer is how content sites die — engineers stop wanting to publish, or marketers can't.

## The managed vs. self-hosted decision

Content sites are the easiest archetype to host in either mode because the build artifact is just static files. **Managed** (Cloudflare Pages or Vercel + a free CDN tier) is push-to-deploy, generous free tier, edge-cached globally, and zero ops. **Self-hosted** (Caddy on a VM behind Bunny.net or Cloudflare) is appropriate when you're already running infrastructure, when bandwidth at scale becomes a real cost, or when you need precise control over cache headers and CDN behavior. The build artifacts are the same — only the serving layer differs.

If your site has substantial application logic, accounts, or transactions, you're not building a content site — pick `saas` (for app-like products) or `ecommerce` (for storefronts) instead.
