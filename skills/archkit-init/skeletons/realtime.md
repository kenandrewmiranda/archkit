---
archetype: realtime
displayName: Realtime / Collaborative / Live
description: An app where multiple clients see each other's updates within a few hundred milliseconds — chat, collaborative editing, live dashboards, multiplayer experiences. WebSockets and pub/sub instead of request/response, presence as a first-class concept, conflict resolution as a real concern.
useWhen:
  - Two or more users need to see each other's actions in real time within the same session.
  - Presence (who's online, who's typing, who's looking at this doc) is meaningful product behavior.
  - Sub-second update latency is part of how the product *feels*, not just a nice-to-have.
  - Multiple clients can edit the same shared state and you need to merge their changes coherently.
  - Live data (dashboards, scores, prices, queue depths) is the product surface.
redFlags:
  - "Realtime" just means "fresh data on page reload" — that's `saas`, polling every 30s is fine.
  - Single-user notifications without multi-client coordination — that's `saas` plus a notification system.
  - Live video / voice is the core experience — that's a media-streaming product, use WebRTC-specific tooling (LiveKit, Daily.co, Agora) and treat this skeleton as guidance for the data layer only.
  - Backend "realtime" sync where users never see each other's edits live — that's offline-first sync, related but a different shape.
boundariesRef: archkit-boundaries-realtime
recommendedSkills:
  - archkit-skill-websockets
  - archkit-skill-yjs
  - archkit-skill-presence
  - archkit-skill-pubsub

deploymentModes:
  - id: managed
    label: Managed (realtime-as-a-service handles the WebSocket layer)
    why: |
      Pusher, Ably, PartyKit, Liveblocks, Supabase Realtime, or Convex run the WebSocket infrastructure for you — connection management, fanout, autoscaling, presence, missed-message recovery. Your app speaks to their hosted gateway; users connect to it directly. Right default for almost every realtime product because operating WebSocket infrastructure that scales to thousands of concurrent connections, handles graceful reconnects, and survives one node going down is a real engineering investment that has nothing to do with what makes your product distinctive.
  - id: selfHosted
    label: Self-hosted (you run the realtime gateway and pub/sub layer)
    why: |
      Soketi (Pusher-compatible), Centrifugo, SocketIO + Redis pub/sub, or Hocuspocus (for Yjs) running on your K3s cluster. Right default when message volume is high enough that managed pricing becomes painful, when data residency requires the realtime layer to live in your perimeter, or when you have specific latency requirements (co-located gateway in the same region as the database). The trade is operating sticky-session-aware load balancing, monitoring connection counts, and handling the real-world failure modes of long-lived connections.

stack:
  primary:
    - name: TypeScript
      role: language
    - name: Next.js
      role: app shell + non-realtime API surface — actual WebSocket gateway lives elsewhere
      alt: SvelteKit, Remix; the framework choice matters less here because the realtime layer is separate
    - name: PostgreSQL
      role: durable state — messages, documents, presence history, audit; the source of truth that the realtime layer fans out from
    - name: Drizzle ORM
      role: query builder + migrations
      alt: Prisma, Kysely
    - name: Yjs
      role: CRDT library — required for collaborative editing on shared state (text, JSON, lists); handles conflict-free merging
      alt: Automerge (alternative CRDT), Loro (newer, Rust-based, JS bindings), Operational Transform via ShareDB (older approach, harder to extend)
      optional: true
    - name: Pusher / Ably / PartyKit / Liveblocks / Convex
      role: managed realtime gateway + pub/sub
      mode: managed
      alt: Supabase Realtime (when already on Supabase), PubNub
    - name: Liveblocks or PartyKit (for collab editing)
      role: hosted Yjs provider with React hooks for cursors, presence, comments
      mode: managed
      alt: y-sweet (managed Yjs), Liveblocks Yjs adapter
      optional: true
    - name: Stream Chat or Sendbird
      role: managed chat-as-a-service if chat is the *entire* product, not a feature
      mode: managed
      alt: build on top of Pusher/Ably, Talkjs
      optional: true
    - name: Soketi
      role: self-hosted Pusher-protocol-compatible realtime gateway
      mode: selfHosted
      alt: Centrifugo (more features, own protocol), SocketIO + Redis pub/sub (most flexible, most code)
    - name: Hocuspocus
      role: self-hosted Yjs provider — handles document persistence and connection multiplexing
      mode: selfHosted
      alt: y-websocket reference server (minimal, no persistence)
      optional: true
    - name: Redis or Valkey
      role: pub/sub layer underneath the gateway, for fanout across multiple gateway nodes
      mode: selfHosted
      alt: NATS (different protocol, very capable), Postgres LISTEN/NOTIFY (for low-volume cases)
  why: |
    The realtime layer is the most distinctive part of this archetype's stack — and it must live somewhere persistent connections can stay open, which rules out plain serverless functions for that role. **Managed** providers (Pusher, Ably, PartyKit, Liveblocks, Convex) run the WebSocket gateway, the pub/sub layer, and the connection state for you; your app code talks to their hosted gateway and fans out events through their API. **Self-hosted** runs the same shape on your infrastructure — a gateway process (Soketi, Centrifugo, SocketIO) with a pub/sub backplane (Redis, Valkey, NATS) for fanout across multiple gateway nodes. CRDTs (Yjs) are the right primitive for any collaborative editing surface; rolling your own merge logic for concurrent edits is a path to bugs that don't show up in testing.
  tradeoffs: |
    Use Convex specifically if its database+realtime model maps cleanly to your product (it co-locates queries and subscriptions in a way other providers don't); use Liveblocks if your product is collaborative documents (it's the easiest path to cursors, comments, and Yjs-backed shared state). Avoid Convex when you also need a traditional Postgres for non-realtime workloads. PartyKit is the right pick when you want code that runs *next to* the connection (game servers, small simulation loops) rather than just fanout.

hosting:
  primary:
    - name: Vercel
      role: app shell hosting (non-realtime routes); the realtime gateway lives elsewhere
      mode: managed
      alt: Railway, Fly.io
    - name: Pusher / Ably / Liveblocks (hosted gateway)
      role: realtime gateway hosting — the provider runs it for you
      mode: managed
    - name: Neon
      role: serverless Postgres for durable state
      mode: managed
      alt: Supabase, Railway Postgres
    - name: Fly.io or Railway (for the realtime gateway)
      role: long-lived process hosting for self-hosted gateway — both support persistent connections cleanly
      mode: selfHosted
      alt: K3s on Hetzner, Render with persistent services
    - name: K3s on Hetzner
      role: full self-hosted stack — app + gateway + Redis + Postgres in one cluster
      mode: selfHosted
      alt: Docker Compose on a single VM (single point of failure for connections)
    - name: Caddy with WebSocket proxying
      role: reverse proxy that handles WS upgrade and TLS termination
      mode: selfHosted
      alt: Traefik, Nginx (WS proxying configuration is fiddly), HAProxy
    - name: PostgreSQL on the cluster
      role: durable state
      mode: selfHosted
    - name: Valkey or Redis on the cluster
      role: pub/sub backplane for gateway fanout
      mode: selfHosted
  why: |
    The realtime archetype breaks the "deploy everything on Vercel" pattern because WebSockets need a process that stays alive across many minutes or hours — Vercel's function model is fundamentally request/response and times out. **Managed** sidesteps this entirely by putting the WebSocket layer on the provider's infrastructure; your Next.js app on Vercel just calls the provider's API to publish events. **Self-hosted** requires you to actually run the gateway on infrastructure that supports long-lived connections (Fly.io, Railway, K3s) with sticky-session-aware load balancing if you scale beyond one node. The pub/sub backplane (Redis/Valkey) is what lets multiple gateway nodes deliver the same event to clients connected to different nodes.
  tradeoffs: |
    Don't try to run WebSockets on Vercel or Cloudflare Pages — Cloudflare Workers does have Durable Objects for this case (PartyKit is built on them) but bare Vercel doesn't fit. If you've committed to Cloudflare, PartyKit is the native realtime answer. Sticky sessions matter the moment you have more than one gateway node; some load balancers handle this with cookie-based or IP-hash routing, others need explicit configuration.

auth:
  primary:
    - name: Clerk
      role: app auth — sessions, organizations, social login
      mode: managed
      alt: Auth.js, Supabase Auth, WorkOS
    - name: Keycloak
      role: self-hosted IdP
      mode: selfHosted
      alt: Authentik, Authelia
    - name: Short-lived WebSocket auth tokens
      role: client requests a connection token from your authenticated API; gateway validates the token on WS upgrade — never send long-lived session tokens over the WebSocket itself
    - name: Channel / room authorization
      role: server-side check at subscribe time — can this user receive messages on this channel? (channel_authorization in Pusher, capability tokens in Ably, presence permission in Liveblocks); without this, any authenticated user can subscribe to any other user's private channel
  why: |
    Realtime auth has two moving parts beyond standard SaaS auth: validating the WebSocket connection itself (the gateway needs to know who this connection belongs to) and authorizing each channel subscription (just because a user is logged in doesn't mean they should receive *every* event). The standard pattern is short-lived connection tokens minted by your authenticated API and validated by the gateway, plus per-channel authorization checks at subscribe time. Both managed and self-hosted gateways support this shape; getting it wrong is how realtime products leak data between users.
  tradeoffs: |
    For trusted-internal realtime (a dashboard for one company's team), simpler shared-secret auth is acceptable. For any consumer-facing or multi-tenant realtime, per-channel authorization is non-negotiable.

networking:
  primary:
    - name: WebSockets via the chosen realtime provider
      role: bidirectional client ↔ server messaging; the default transport for chat, collab, presence
    - name: Server-Sent Events (SSE) as fallback
      role: server → client only; useful for one-direction live data (dashboards, notifications) where bidirectional isn't needed
      optional: true
    - name: TanStack Query
      role: cache + invalidation for the *non-realtime* parts of the app (initial document load, list of rooms, profile data)
    - name: Connection state machine
      role: client-side handling of connect / disconnect / reconnect / missed-message recovery — every realtime client app needs this regardless of provider
    - name: Optimistic local updates
      role: apply changes locally immediately, reconcile when server confirms; required for the "feels instant" product perception
  why: |
    The networking shape for realtime is fundamentally different from request/response. Connections drop (mobile network changes, laptop sleep, Wi-Fi handoffs) and the client must reconnect, replay missed messages, and reconcile any optimistic local changes against the server's view. Every realtime app needs a connection state machine; managed providers (Pusher, Ably, Liveblocks) ship one; self-hosted means writing your own. Optimistic updates are what make collaborative apps feel responsive — applying the local change before the server round-trips, then reconciling.
  tradeoffs: |
    Use SSE instead of WebSockets when the data flow is genuinely one-direction (live scoreboards, monitoring dashboards, log tail) — SSE is simpler, traverses proxies more reliably, and reconnects automatically. Reach for WebSockets only when bidirectional matters (chat, collab editing, multiplayer interaction).

ui:
  primary:
    - name: Tailwind CSS
      role: styling
    - name: shadcn/ui
      role: component primitives
    - name: Realtime provider's React hooks (useChannel, usePresence, useStorage, etc.)
      role: subscribing to events, presence, shared state — every managed provider ships these
      mode: managed
      alt: write your own hooks on top of the provider's vanilla JS client
    - name: Yjs React bindings (y-react, y-codemirror, y-tiptap)
      role: bind a CRDT document to a React component or rich-text editor
      optional: true
    - name: Custom cursor / presence components
      role: render other users' cursors, selections, "who's here" avatars; built on top of presence events
      optional: true
    - name: Tiptap or Lexical (for collab text editing)
      role: rich-text editor with first-class Yjs integration
      optional: true
  why: |
    Realtime UI has unique components that the other archetypes don't need — live cursors, presence avatars, optimistic typing indicators, "user X is editing this field" highlights, conflict-resolution prompts. Managed providers ship React hooks for the common cases (subscribe to events, read presence, mutate shared state) which save real time vs. wiring up event listeners by hand. For collaborative text specifically, Tiptap (built on ProseMirror) or Lexical (Meta's editor framework) are the two serious choices; both have first-class Yjs integration.
  tradeoffs: |
    Don't build collab text on top of a contenteditable div directly; the edge cases (IME composition, undo/redo, selection persistence, browser inconsistencies) will eat months. Tiptap and Lexical have already solved them.

jobs:
  primary:
    - name: Backend job system
      role: same as other archetypes — Inngest (managed) or BullMQ (self-hosted) for non-realtime work
    - name: Scheduled broadcasts
      role: jobs that publish events into the realtime fanout on a schedule (daily summary message, hourly metric updates) — implemented as a backend job that calls the gateway's publish API
    - name: Persistence + replay
      role: write every realtime event to durable storage (Postgres) so disconnected clients can replay missed messages on reconnect; without this, "I was offline for 30 seconds and missed messages" is unfixable
    - name: Inngest
      role: managed job orchestration
      mode: managed
      alt: Trigger.dev, QStash
    - name: BullMQ
      role: self-hosted job orchestration
      mode: selfHosted
      alt: Graphile Worker
  why: |
    The realtime-specific job concern is durability — every event delivered through the realtime layer should also be persisted to a durable store so clients that were offline can catch up on reconnect. Managed providers handle some of this (Liveblocks persists Yjs documents; Convex persists everything by default; Pusher / Ably do not) — know which guarantees your provider gives you and write the rest yourself. Scheduled broadcasts (daily summaries, periodic metric updates) are just regular jobs that happen to publish to the realtime fanout.
  tradeoffs: |
    Skip durable replay only if your product genuinely doesn't care about missed messages (live scoreboards where stale data is just stale) — for chat or collab editing, durability is non-negotiable.

observability:
  primary:
    - name: Sentry
      role: error tracking — connection errors, message-handler crashes, reconnect storms
      mode: managed
      alt: Highlight.io
    - name: Realtime provider dashboard
      role: connection counts, message rates, error rates from the provider's own monitoring
      mode: managed
    - name: PostHog
      role: product analytics, session replay (especially valuable for collab apps where users do unexpected things)
      mode: managed
      alt: Mixpanel, Amplitude
    - name: Connection metrics (custom)
      role: track concurrent connections, average connection duration, reconnect rate, message latency from publish to delivery — required regardless of provider; the provider dashboard shows volume, custom metrics tie volume to *your* product surfaces
    - name: GlitchTip
      role: self-hosted Sentry-compatible error tracking
      mode: selfHosted
      alt: Sentry self-hosted
    - name: Grafana + Prometheus + Loki
      role: dashboards (Grafana), gateway metrics (Prometheus), gateway logs (Loki) — connection counts, message rates, fanout latency
      mode: selfHosted
      alt: SigNoz
    - name: PostHog self-hosted
      role: self-hosted product analytics
      mode: selfHosted
  why: |
    Realtime observability has metrics no other archetype tracks: concurrent connections (capacity), connection duration distribution (are users staying connected, or are reconnects masking churn), publish-to-delivery latency (is fanout actually fast), and reconnect rate (a sudden spike means something is dropping connections). Managed providers expose most of this in their own dashboards but you should still mirror the metrics that tie to your *product* surfaces (which features have the most active connections, what's the latency on the chat feature specifically) into your own observability stack.
  tradeoffs: |
    Skip the provider dashboard mirror only if you trust the provider's tooling and don't need correlated metrics across realtime + non-realtime — most teams want one place to look during incidents.

testing:
  primary:
    - name: Vitest
      role: unit + integration tests for state-merge logic, message handlers, optimistic-update reconciliation
    - name: Playwright with multiple browser contexts
      role: end-to-end tests with two or more "users" in the same session — Playwright supports multiple browser contexts in one test, which is the right shape for testing realtime interaction
    - name: CRDT-specific conflict tests
      role: when using Yjs/Automerge, write tests that apply diverging edits to two replicas and assert convergence
      optional: true
    - name: Connection lifecycle tests
      role: verify reconnect behavior, missed-message replay, optimistic-update reconciliation against a real or mocked server
  why: |
    Realtime is the archetype where unit tests miss the most bugs because the bugs are in *interaction* — two users editing simultaneously, one user disconnecting mid-message, a slow client lagging behind a fast one. Playwright's multiple browser contexts in one test let you simulate "Alice and Bob in the same room" and assert that what Alice does shows up in Bob's view. CRDT-based products need an additional class of test: prove that diverging edits converge to the same final state regardless of merge order.
  tradeoffs: |
    Skip CRDT convergence tests only if you're using a managed provider's higher-level abstractions (Liveblocks Storage, Convex documents) where the provider has tested convergence — your tests then focus on *your* code on top.
---

# Realtime / Collaborative / Live

This archetype is for products where multiple clients see each other's actions within a few hundred milliseconds — chat, collaborative editing (Google Docs, Notion, Linear-style), live dashboards, multiplayer experiences. The shape is fundamentally different from request/response apps because connections stay open across long sessions, state is shared across clients, and the network can drop and recover at any moment. None of those concerns apply to a typical SaaS app, and trying to retrofit a SaaS architecture into a realtime product produces awkward polling-based "fake realtime" that costs more and feels worse.

The single most consequential choice in this archetype is whether to use a managed realtime provider (Pusher, Ably, Liveblocks, PartyKit, Convex, Supabase Realtime) or run your own realtime gateway (Soketi, Centrifugo, SocketIO + Redis). Managed is dramatically less work for the realtime layer specifically, because operating WebSocket infrastructure that scales to thousands of concurrent connections, handles graceful reconnects, supports sticky sessions, and survives node failures is a real engineering investment with no product-distinctive payoff. Self-hosted is appropriate when message volume is high enough that managed pricing becomes painful, when data residency requires the realtime path to live in your perimeter, or when latency requirements demand co-location with your database.

## What realtime products optimize for that other archetypes don't

Five concerns dominate decisions in this archetype:

1. **WebSockets don't fit serverless cleanly.** Vercel's function model times out long-lived connections. The realtime layer must live somewhere processes can stay alive — either on a managed provider's infrastructure (the simple answer) or on Fly.io, Railway, or K3s (the self-hosted answer). Your Next.js app shell can still live on Vercel; only the gateway needs the persistent-process host.
2. **Connections drop and clients must recover.** Mobile network changes, laptop sleep, Wi-Fi handoffs — connections break constantly in real conditions. Every realtime client needs a connection state machine that handles reconnect, replays missed messages, and reconciles optimistic local updates against the server's view. Managed providers ship this; self-hosted means writing it yourself.
3. **Channel authorization is non-negotiable.** Just because a user is logged in doesn't mean they should receive every event. Per-channel authorization at subscribe time prevents data leakage between users. The standard pattern is short-lived connection tokens minted by your authenticated API and validated by the gateway, plus capability tokens or `channel_authorization` callbacks for each subscribe.
4. **Optimistic updates make the product feel alive.** Apply the local change immediately, reconcile when the server confirms. Without this the app feels laggy even on fast networks because every interaction round-trips before the UI updates.
5. **For collaborative editing, use a CRDT.** Yjs is the standard. Don't roll your own merge logic for concurrent edits — the bugs do not show up in testing and do show up when two users edit the same paragraph simultaneously.

## The managed vs. self-hosted decision

Both are common in this archetype but the operational gap is wider than other archetypes because self-hosting realtime means actually operating WebSocket infrastructure with all its real-world failure modes. **Managed** (Pusher / Ably / Liveblocks / PartyKit / Convex on the realtime side; Vercel + Neon for the rest) is the right starting answer for most realtime products. **Self-hosted** (Soketi or Centrifugo gateway, Redis/Valkey for fanout, K3s for everything) is appropriate when you have ops capacity and the volume to justify it.

If your product would work fine with the user reloading the page or polling every 30 seconds, you don't need this archetype — `saas` is simpler and cheaper. Pick `realtime` only when sub-second multi-client updates are core to how the product *feels*.
