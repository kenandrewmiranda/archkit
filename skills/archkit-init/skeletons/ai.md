---
archetype: ai
displayName: AI-Native Product / LLM App / Agent
description: A product where the LLM call is the core unit of value — chatbots, RAG systems, agents, AI tools. Streaming-first UX, token cost as a real operating expense, eval suites instead of unit tests as the primary correctness signal.
useWhen:
  - The LLM is the product, not a small feature inside something else.
  - Users interact primarily through a chat, agent, or AI-driven workflow surface.
  - Token cost shows up as a real line item in your operating expenses.
  - You ship prompt and model changes more often than you ship feature changes.
  - Output quality (the model said the right thing) is the primary success metric, not just "the code didn't crash."
redFlags:
  - AI is one feature inside a larger app — that's `saas` with an AI feature, not this archetype.
  - The product is the *model* itself (training pipeline, fine-tuning service, model hosting) — that's closer to `data`.
  - Pure offline batch AI processing with no end users — that's `data`.
  - You wrap an existing AI product (Cursor, Claude, ChatGPT) as a thin reseller — that's `saas` with a thin AI integration.
boundariesRef: archkit-boundaries-ai
recommendedSkills:
  - archkit-skill-anthropic-sdk
  - archkit-skill-prompt-caching
  - archkit-skill-rag
  - archkit-skill-evals
  - archkit-skill-streaming

deploymentModes:
  - id: managed
    label: Managed (push-to-deploy app, hosted LLM provider)
    why: |
      Your app runs on Vercel or similar; LLM calls go to Anthropic, OpenAI, or another hosted provider; vector DB (if you have one) is Pinecone or Turbopuffer; observability is LangSmith or Braintrust. Right default for almost every AI product because the operational surface of self-hosting models — GPU nodes, model loading, inference batching, autoscaling under bursty token loads — is harder than the rest of your stack combined. Token cost is the dominant variable cost; cap it explicitly per user.
  - id: selfHosted
    label: Self-hosted (your infrastructure for the app; LLM provider is still typically hosted)
    why: |
      Your app runs on K3s, your vector DB runs on the cluster, your observability is LangFuse self-hosted — but the LLM provider is almost always still Anthropic or OpenAI even in this mode. Genuinely self-hosting models (Ollama for small/dev, vLLM for production) is a separate, much harder choice that is correct only when data residency forbids sending content to a hosted LLM, when token costs are catastrophic at your volume, or when you specifically need an open-weight model that hosted providers don't offer. The default self-hosted shape is "self-hosted everything except the LLM."

stack:
  primary:
    - name: TypeScript
      role: language
    - name: Next.js
      role: full-stack framework — App Router, streaming Route Handlers for LLM responses
      alt: SvelteKit, Hono (if API-only with a separate frontend), Express
    - name: Anthropic SDK
      role: primary LLM client — Claude is the strongest model for code, agents, and long-context work; first-class prompt caching, tool use, computer use, files, citations
      alt: OpenAI SDK (GPT family), Google AI SDK (Gemini), Mistral SDK
    - name: Vercel AI SDK
      role: thin abstraction over multiple LLM providers + UI helpers for streaming chat
      alt: LangChain.js (heavier, more orchestration), bare provider SDKs (more control, more code)
      optional: true
    - name: PostgreSQL
      role: app state — conversations, users, prompt versions, eval results, audit trail of LLM calls
    - name: pgvector or Pinecone
      role: vector storage for RAG (retrieval-augmented generation); pgvector lives inside Postgres, Pinecone is a managed service
      optional: true
    - name: Drizzle ORM
      role: query builder + migrations
      alt: Prisma, Kysely
    - name: Anthropic Claude (hosted)
      role: LLM provider — preferred default for production AI products
      mode: managed
      alt: OpenAI GPT family, Google Gemini, Mistral, mix-and-match per task
    - name: Pinecone or Turbopuffer
      role: managed vector database for RAG
      mode: managed
      alt: pgvector inside Neon/Supabase Postgres (cheaper, simpler), Weaviate Cloud, Qdrant Cloud
      optional: true
    - name: Anthropic Claude (hosted) — yes, even in self-hosted infra mode
      role: LLM provider — self-hosting infrastructure does not require self-hosting models
      mode: selfHosted
      alt: vLLM serving an open-weight model (Llama, Qwen, Mistral) on your own GPU nodes — only when you genuinely cannot use a hosted provider
    - name: Qdrant or Weaviate (self-hosted)
      role: vector database running in your cluster
      mode: selfHosted
      alt: pgvector in your self-hosted Postgres (simpler, often sufficient)
      optional: true
  why: |
    The LLM provider is the most consequential single choice in this archetype because it dictates token cost, latency, prompt-caching behavior, model capability ceiling, and your ability to use features like tool use and structured output. Anthropic Claude is the strongest default for code-shaped, agent-shaped, and long-context workloads as of this writing — the prompt-caching primitive in particular is a major lever for any app with stable system prompts. RAG (vector DB + embeddings) is *optional*: many AI products don't need retrieval at all, and pgvector inside the Postgres you already have is the right starting point if you do — managed vector DBs are appropriate when you cross into millions of vectors or need very specific filtering performance.
  tradeoffs: |
    Use the Vercel AI SDK when you want to swap providers easily or use its streaming UI helpers; use the bare Anthropic SDK when you want full control over caching, tool use, beta features, or message construction. Self-hosting models is the rare path — pick it only when you have a hard requirement (data residency, open-weight model needed, token cost catastrophic at your scale), not because you want to. Operating GPU inference at production quality is a job, not a side project.

hosting:
  primary:
    - name: Vercel
      role: app hosting — supports streaming Route Handlers, edge functions for low-latency LLM proxying
      mode: managed
      alt: Railway, Fly.io (better for long-running agent processes), Render
    - name: Anthropic API (hosted)
      role: LLM inference — pay per token, autoscaled for you
      mode: managed
      alt: OpenAI API, Google Vertex AI, AWS Bedrock (for models bundled with cloud access controls)
    - name: Neon
      role: serverless Postgres for app state and (with pgvector) RAG
      mode: managed
      alt: Supabase, Railway Postgres, RDS
    - name: Pinecone
      role: managed vector DB at scale
      mode: managed
      alt: Turbopuffer (cheaper, newer), Weaviate Cloud, Qdrant Cloud, pgvector
      optional: true
    - name: K3s on Hetzner or similar
      role: app + worker containers + (optionally) self-hosted vector DB
      mode: selfHosted
      alt: Docker Compose on a VM, full K8s
    - name: PostgreSQL with pgvector on the cluster
      role: app database + vector storage
      mode: selfHosted
      alt: separate Postgres + Qdrant instance
    - name: vLLM cluster (only if self-hosting models)
      role: production LLM inference server with continuous batching
      mode: selfHosted
      alt: TGI (HuggingFace), Ollama (dev/small only — not production-shaped)
      optional: true
    - name: Caddy
      role: reverse proxy + automatic TLS
      mode: selfHosted
      alt: Traefik, Nginx
  why: |
    **Managed** is the right default because LLM inference is the part that benefits most from being someone else's problem — Anthropic and OpenAI handle GPU provisioning, autoscaling, model loading, and the very real challenge of bursty token traffic. Vercel + Anthropic + Neon is a complete AI-product stack with no infrastructure to operate. **Self-hosted** infrastructure for the app layer is fine and works the same as other archetypes; the catch is that self-hosting *models* (vLLM clusters with GPU nodes) is a fundamentally different operational discipline than self-hosting Postgres. Most "self-hosted AI" production deployments still call hosted LLM APIs.
  tradeoffs: |
    Move off Vercel toward Fly.io or Railway when your agent runs need long-lived processes (websocket-based agent UIs, multi-minute tool-use loops) — Vercel's function timeouts will bite you. If you genuinely need to self-host models, plan for it as its own project with GPU autoscaling, model versioning, and inference observability — don't bolt it on to your app deployment.

auth:
  primary:
    - name: Clerk
      role: managed auth + user management
      mode: managed
      alt: Auth.js, Supabase Auth, WorkOS for enterprise SSO
    - name: Keycloak
      role: self-hosted IdP
      mode: selfHosted
      alt: Authentik, Authelia
    - name: Per-user rate limiting and token budget
      role: required regardless of auth provider — every authenticated user must have a daily/monthly token cap; prompt injection that gets through caps the blast radius
  why: |
    AI product auth is mostly the same shape as SaaS auth, with one critical addition: every authenticated user needs a hard token budget. Without it, a single malicious user (or a bug in your prompt loop) can run up thousands of dollars in inference cost in minutes. The budget should be enforced server-side before each LLM call, not just monitored after the fact. This is non-negotiable for any AI product with public signup.
  tradeoffs: |
    Anonymous (no-auth) AI products work for free demo experiences but require even tighter rate limiting, IP-based throttling, and ideally Cloudflare Turnstile or similar to keep scrapers from spending your token budget on training data extraction.

networking:
  primary:
    - name: Server-Sent Events (SSE) from Next.js Route Handlers
      role: stream LLM responses to the browser token-by-token — non-negotiable for chat UIs because non-streaming responses feel broken
    - name: Vercel AI SDK streamText / streamUI
      role: helper functions that wrap SSE streaming for common cases
      optional: true
    - name: Webhook receivers
      role: handle async completions from long-running agent runs, Anthropic batch API results, third-party integrations
    - name: Zod
      role: validate user input AND validate LLM-generated structured output — the LLM is an untrusted source of structured data
    - name: Rate limiting middleware
      role: per-user, per-IP, per-route rate limits using Upstash Redis or Postgres-backed counters
  why: |
    AI products live or die on perceived latency, and streaming is the entire reason chat UIs feel responsive — a non-streaming LLM response that takes 8 seconds feels like the app is broken; the same response streaming token-by-token feels instant from the first token. Server-Sent Events is the right transport because it works through every proxy, doesn't require WebSocket infrastructure, and Next.js Route Handlers support it natively. The other half of AI networking is treating the LLM's output as untrusted: structured output (JSON, tool calls) must be validated with Zod just like user input, because models do hallucinate fields and types occasionally.
  tradeoffs: |
    Use WebSockets only if you need bidirectional communication during the response (interrupting an agent mid-run, agent asking for clarification mid-stream) — for one-direction streaming, SSE is simpler and more reliable. Drop the AI SDK helpers and use the bare Anthropic SDK when you need fine control over caching, tools, or response structure that the helpers abstract away.

ui:
  primary:
    - name: Tailwind CSS
      role: styling
    - name: shadcn/ui
      role: component primitives
    - name: '@assistant-ui/react' or Vercel AI SDK UI
      role: chat-shaped components — message list, input box, streaming text rendering
      optional: true
    - name: react-markdown
      role: render LLM markdown output (headings, lists, code blocks, links) safely
    - name: Shiki or @shikijs/rehype
      role: syntax highlighting for code blocks in LLM output
      optional: true
    - name: Lucide
      role: icon set
  why: |
    AI-product UI has two failure modes: rendering LLM output unsafely (model emits HTML, you render it as HTML, prompt-injection ⇒ XSS) and rendering it without polish (model emits markdown, you render it as plain text, looks broken). react-markdown handles the rendering safely; Shiki gives the code-block experience users expect. The chat surface itself (message list, streaming input, scroll-on-new-token) is fiddly enough that purpose-built libraries (assistant-ui, AI SDK UI) save real time.
  tradeoffs: |
    Roll your own chat UI when the assistant-ui shape is wrong for your product (canvas-style agents, structured tool-use displays, multi-pane interfaces). Use a chat library when the product *is* a chat. The hybrid case (chat with rich tool outputs) is where you spend real UI time; budget for it.

jobs:
  primary:
    - name: Inngest
      role: long-running agent loops, scheduled eval runs, embedding pipelines, retry logic for failed LLM calls
      mode: managed
      alt: Trigger.dev (good for agent workflows specifically), Temporal (powerful, heavyweight)
    - name: Anthropic Message Batches API
      role: half-cost batch inference for non-interactive workloads (overnight evals, bulk processing)
      optional: true
    - name: BullMQ
      role: background agent runs, embedding generation, eval batches in self-hosted mode
      mode: selfHosted
      alt: Graphile Worker (Postgres-backed, no Redis), Temporal self-hosted
    - name: Embedding refresh pipeline
      role: re-embed documents when source content changes — required for any RAG system; without it, retrieval drifts silently
      optional: true
  why: |
    AI products have more long-running work than typical web apps because LLM calls are slow (multi-second), agent loops can chain many of them (multi-minute), and RAG systems need ongoing embedding work. Serverless function timeouts will kill these — the right pattern is to enqueue the work, return immediately, and let a background worker run the actual chain while the user sees a streaming "thinking..." surface. Anthropic's Message Batches API is a specific lever worth knowing about: 50% cheaper for non-interactive bulk work like nightly eval runs.
  tradeoffs: |
    Skip the dedicated job system entirely for products that are *only* one-shot chat (single LLM call per user message, no agent loops, no RAG indexing) — streaming Route Handlers handle that case directly. Add a job system the moment you introduce agents, scheduled work, or background indexing.

observability:
  primary:
    - name: LangSmith or Braintrust
      role: LLM call tracing — every prompt, response, latency, token count, cost, model version captured for debugging and eval
      mode: managed
      alt: Helicone (proxy-based), Anthropic console (limited but free), PostHog LLM observability
    - name: Sentry
      role: app error tracking — non-LLM bugs (cart errors, auth failures, etc.)
      mode: managed
      alt: Highlight.io, BugSnag
    - name: Token cost dashboard
      role: real-time view of spend per user, per feature, per model — without this you find out about a runaway prompt loop from your monthly invoice
    - name: LangFuse (self-hosted)
      role: open-source LLM observability — traces, evals, prompt management
      mode: selfHosted
      alt: Helicone self-hosted, Phoenix (Arize), custom logging to Postgres
    - name: GlitchTip
      role: self-hosted Sentry-compatible error tracking
      mode: selfHosted
      alt: Sentry self-hosted (heavier)
    - name: Grafana + Prometheus
      role: token-cost dashboards, LLM call latency, queue depth
      mode: selfHosted
      alt: SigNoz
  why: |
    Standard application observability (errors, performance) is necessary but insufficient for AI products. The signals that actually matter are LLM-specific: which prompt produced which output, what did each call cost, how does latency vary by model, are response qualities drifting after a prompt change, what's the eval-pass rate trending. LangSmith and Braintrust are purpose-built for this; LangFuse is the same shape, open source, self-hostable. Every AI product also needs a real-time cost dashboard because LLM spend can spike from one bad deploy in ways traditional infrastructure costs cannot.
  tradeoffs: |
    Roll your own LLM observability (write each call to a Postgres table, build a basic dashboard) when you're early and don't want another SaaS yet — you'll outgrow it the moment you have multiple chains and want to debug across them. Helicone is the lowest-friction option (it's a proxy in front of the LLM API; you change one line of code) when you don't want to instrument call sites individually.

testing:
  primary:
    - name: PromptFoo or Braintrust evals
      role: eval suite — the primary correctness signal for AI products; runs prompts against a fixed dataset of inputs and checks outputs against assertions or judge models
    - name: Vitest
      role: unit + integration tests for non-LLM code (auth, payments, plain logic)
    - name: Playwright
      role: end-to-end tests for the user journey (login → start chat → message renders → response streams)
    - name: Snapshot testing of LLM outputs
      role: catch unintended drift when prompts or models change — pin known-good outputs and diff
      optional: true
  why: |
    Traditional unit tests are insufficient for AI products because the LLM's behavior is the thing under test, and "did the model say the right thing" is not a boolean function call. Eval suites (PromptFoo, Braintrust, custom) run a fixed dataset of inputs through your prompt+model pipeline and score outputs against assertions, regex patterns, or judge-model verdicts. The eval suite is where you catch quality regressions when you change prompts, swap models, or upgrade SDK versions. Without one, you discover regressions in production from user complaints. Playwright and Vitest still apply for the non-LLM parts of the app.
  tradeoffs: |
    Eval suites cost real tokens to run; gate them behind PR labels or run nightly to keep CI cost bounded. Snapshot testing of LLM outputs is brittle (models update, outputs shift slightly even with temperature 0) — use it as a drift signal, not a hard gate.
---

# AI-Native Product / LLM App / Agent

This archetype is for products where the LLM call is the core unit of value — chatbots, RAG systems, agents that complete multi-step tasks, AI-driven workflow tools, dedicated AI utilities. It is *not* for products that happen to have an AI feature alongside other functionality (those are `saas`); it is for products where removing the model would remove the product.

The architecture differs from `saas` in five specific ways: streaming responses are the default UX (not a nice-to-have), token cost is a real operating expense that needs per-user caps, eval suites replace unit tests as the primary correctness signal, observability needs LLM-specific tooling (not just app errors), and long-running agent loops outgrow serverless function timeouts. Each of these is non-obvious if you come from a SaaS background and each, ignored, costs real money.

## What AI products optimize for that other archetypes don't

Five concerns dominate decisions in this archetype:

1. **Streaming UX is non-negotiable.** A non-streaming LLM response that takes eight seconds feels broken; the same response streaming token-by-token feels instant. Server-Sent Events from Route Handlers is the standard pattern; the Vercel AI SDK streamlines it.
2. **Token cost is variable and unbounded by default.** A single user (malicious or buggy prompt loop) can spend thousands of dollars in minutes. Hard per-user budget enforcement before each LLM call is required for any product with public signup. Anthropic's prompt caching is the highest-leverage cost-reduction lever for apps with stable system prompts — design system prompts to be cacheable.
3. **Evals replace unit tests as the correctness signal.** "Did the function return true" is the wrong question for LLM behavior. "Did the output meet these assertions across this dataset" is the right one. PromptFoo, Braintrust, or a hand-rolled eval suite that runs in CI is what catches quality regressions when prompts or models change.
4. **The LLM is an untrusted source of structured data.** Tool calls and JSON outputs occasionally hallucinate fields, types, or values. Validate them with Zod just like user input. Never render LLM output as HTML — render it as Markdown via a sanitizing renderer.
5. **Long-running work needs a job system.** Agent loops, RAG re-indexing, batch evaluation runs all exceed serverless function timeouts. Inngest (managed) or BullMQ (self-hosted) handle this; the streaming UX shows the user a "thinking..." surface while the background work proceeds.

## The managed vs. self-hosted decision

For AI products, "self-hosted" almost always means self-hosted *application infrastructure* (your app, vector DB, observability), not self-hosted *models*. Hosting an open-weight model in production (vLLM cluster on GPU nodes, model versioning, inference batching) is a substantially harder operational discipline than hosting Postgres or running K3s. The default for both managed and self-hosted modes is to call the Anthropic or OpenAI API for inference; the genuinely-self-hosted-models path is correct only when data residency forbids hosted LLMs, when token costs are catastrophic at scale, or when an open-weight model offers something hosted providers do not.

If your product is a feature inside a larger non-AI app, you're not in this archetype — pick `saas` (or whichever archetype the host product is) and treat the AI as a feature inside it.
