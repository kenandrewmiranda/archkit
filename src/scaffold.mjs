import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { C, ICONS, divider } from "./lib/shared.mjs";
import { showBanner } from "./lib/banner.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// VISUAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function banner() {
  showBanner();
}

function heading(icon, text) {
  console.log("");
  console.log(`${C.cyan}${C.bold}  ${icon} ${text}${C.reset}`);
  console.log("");
}

function subheading(text) {
  console.log(`${C.blue}${C.bold}  ${text}${C.reset}`);
}

function info(text) {
  console.log(`${C.gray}  ${text}${C.reset}`);
}

function success(text) {
  console.log(`${C.green}  ${ICONS.check} ${text}${C.reset}`);
}

function warn(text) {
  console.log(`${C.yellow}  ${ICONS.warn} ${text}${C.reset}`);
}

function tip(text) {
  console.log(`${C.dim}${C.italic}  ${ICONS.light} ${text}${C.reset}`);
}

function bullet(text, indent = 2) {
  console.log(`${" ".repeat(indent)}${C.gray}${ICONS.dot}${C.reset} ${text}`);
}

function tree(label, isLast = false) {
  const prefix = isLast ? ICONS.corner : ICONS.tee;
  console.log(`${C.gray}    ${prefix}── ${C.reset}${label}`);
}

function codeBlock(lines, label) {
  if (label) console.log(`${C.gray}  ${label}:${C.reset}`);
  console.log(`${C.gray}  ┌${"─".repeat(62)}┐${C.reset}`);
  for (const line of lines) {
    const padded = line.padEnd(60);
    console.log(`${C.gray}  │ ${C.reset}${C.dim}${padded}${C.reset}${C.gray} │${C.reset}`);
  }
  console.log(`${C.gray}  └${"─".repeat(62)}┘${C.reset}`);
}

function filePreview(filepath, content) {
  const lines = content.split("\n").slice(0, 8);
  console.log(`${C.gray}  ${ICONS.file} ${C.reset}${C.bold}${filepath}${C.reset} ${C.dim}(${content.length} bytes)${C.reset}`);
  for (const line of lines) {
    console.log(`${C.gray}    ${ICONS.pipe} ${C.dim}${line.substring(0, 60)}${C.reset}`);
  }
  if (content.split("\n").length > 8) {
    console.log(`${C.gray}    ${ICONS.pipe} ${C.dim}... (${content.split("\n").length - 8} more lines)${C.reset}`);
  }
  console.log("");
}

function progressStep(step, total, label) {
  const bar = "█".repeat(step) + "░".repeat(total - step);
  console.log(`${C.cyan}  [${bar}] ${step}/${total} ${C.reset}${label}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════════════

const APP_TYPES = {
  saas: {
    name: "SaaS / B2B Platform",
    desc: "Multi-tenant, subscription billing, role-based access, API for integrations",
    icon: ICONS.chart,
    pattern: "Layered (Cont→Ser→Repo) + Modular Monolith",
    folderConv: "src/features/{cluster}/{cluster}.{layer}.ts",
    sharedConv: "src/shared/{name}/index.ts | Jobs: src/jobs/{name}.ts",
    defaultStack: {
      "Frontend": "Next.js + Tailwind + shadcn/ui",
      "API Framework": "Hono",
      "Auth": "Keycloak + Ory Keto",
      "Database": "PostgreSQL (with RLS)",
      "Cache": "Valkey",
      "Search": "Meilisearch",
      "Object Storage": "MinIO",
      "Job Queue": "BullMQ",
      "Observability": "Grafana + Prometheus + Loki",
      "Infrastructure": "Docker + K3s + Caddy + OpenTofu",
      "Billing": "Kill Bill",
    },
    rules: [
      "Layered: C→S→R. Controllers thin (validate, delegate, respond). Services own logic. Repos own DB.",
      "Features NEVER import across boundaries. Cross-feature communication = shared interface only.",
      "All DB queries include $tenant. RLS is the safety net, not the primary filter.",
      "Errors: throw $err types (NotFound, Validation, Forbidden). Centralized handler formats response.",
      "Validation: $zod schemas shared between frontend and API.",
      "Events: async via $bus. All subscribers must be idempotent.",
    ],
    reservedWords: {
      "$tenant": "tenant context — ID from JWT, injected by middleware, scopes all DB operations",
      "$auth": "authenticated user context — JWT validated, permissions attached to request",
      "$err": "typed error classes — NotFoundError, ValidationError, ForbiddenError, ConflictError",
      "$bus": "domain event bus — emit() and on() via Valkey pub/sub. Async, decoupled.",
      "$cache": "Valkey cache layer — sessions, rate limiting counters, query result cache",
      "$db": "PostgreSQL — primary for writes, read replica for dashboards",
      "$zod": "Zod validation schemas — defined once, shared between frontend and API",
      "$rls": "Row-Level Security — PostgreSQL policies enforcing tenant isolation at DB level",
      "$queue": "BullMQ job queue — async tasks like email, exports, webhooks",
    },
    suggestedFeatures: [
      { id: "auth", name: "Authentication & SSO", keywords: "login,logout,SSO,password,session,JWT,token,MFA" },
      { id: "tenants", name: "Tenant management", keywords: "tenant,onboard,workspace,org,company,settings" },
      { id: "billing", name: "Billing & subscriptions", keywords: "bill,subscribe,invoice,payment,usage,plan,upgrade" },
      { id: "teams", name: "Team management", keywords: "team,member,invite,role,permission" },
    ],
    graphGen: "layered",
  },
  ecommerce: {
    name: "E-Commerce / Marketplace",
    desc: "Product catalog, cart, checkout, inventory, payments, seller management",
    icon: "🛒",
    pattern: "Layered + Event-Driven. ALL money in cents (integer).",
    folderConv: "src/features/{cluster}/{cluster}.{layer}.ts",
    sharedConv: "src/shared/{name}/index.ts | Jobs: src/jobs/{name}.ts",
    defaultStack: {
      "Frontend": "Next.js + Tailwind",
      "API / Commerce": "Saleor (headless) or custom Hono",
      "Auth": "Keycloak",
      "Database": "PostgreSQL",
      "Cache": "Valkey",
      "Search": "Meilisearch",
      "Object Storage": "MinIO",
      "Job Queue": "BullMQ",
      "Observability": "Grafana + Prometheus + Loki",
      "Infrastructure": "Docker + K3s + Caddy + OpenTofu",
    },
    rules: [
      "Layered: C→S→R + event-driven for all side effects (email, search reindex, analytics).",
      "Inventory: SELECT FOR UPDATE on every decrement. Never decrement without a row lock.",
      "Pricing logic lives in src/shared/pricing/. ONE source of truth. DRY this aggressively.",
      "ALL money values: integer cents via $money type. Never floating point. Display formatting = frontend only.",
      "Product pages use ISR (Incremental Static Regeneration). Invalidate on price/stock change.",
      "Payment processing is idempotent. Every charge operation has an idempotency key.",
      "Side effects go through $bus. OrderPlaced → email, inventory, analytics. Never direct calls.",
    ],
    reservedWords: {
      "$money": "MoneyInCents type + arithmetic helpers (add, subtract, multiply). Never floating point.",
      "$auth": "authenticated user context",
      "$err": "typed error classes",
      "$bus": "domain event bus — OrderPlaced, PaymentReceived, ItemShipped trigger async workflows",
      "$cache": "Valkey — session storage, guest carts, inventory count cache",
      "$db": "PostgreSQL — ACID transactions for inventory, orders",
      "$search": "Meilisearch — product search with facets (size, color, price range)",
      "$store": "MinIO — product images, invoice PDFs, seller documents",
      "$queue": "BullMQ — email, image processing, search reindex",
    },
    suggestedFeatures: [
      { id: "catalog", name: "Product catalog", keywords: "product,category,image,SKU,search" },
      { id: "cart", name: "Cart management", keywords: "cart,add,remove,update,discount code" },
      { id: "checkout", name: "Checkout & orders", keywords: "checkout,order,payment,confirm,fulfill" },
      { id: "inventory", name: "Inventory management", keywords: "inventory,stock,reserve,decrement,low stock" },
    ],
    graphGen: "layered",
  },
  realtime: {
    name: "Real-Time Application",
    desc: "WebSocket connections, live messaging, collaborative editing, presence",
    icon: "⚡",
    pattern: "Event-Driven + Gateway Pattern (no controller/service/repo)",
    folderConv: "src/{layer}/{name}.ts",
    sharedConv: "src/shared/{name}.ts",
    defaultStack: {
      "Frontend": "React + Yjs (CRDT)",
      "Server": "Go or Node.js WebSocket server",
      "Auth": "Keycloak (JWT at connect)",
      "Database": "PostgreSQL (persistent data)",
      "Real-time State": "Valkey (pub/sub + ephemeral)",
      "Search": "Meilisearch",
      "Object Storage": "MinIO",
      "Job Queue": "BullMQ",
      "Observability": "Grafana + Prometheus + Loki",
      "Infrastructure": "Docker + K3s + Caddy",
    },
    rules: [
      "Gateway layer manages: handshake, auth, heartbeat, reconnection. NO business logic here.",
      "Handlers process ONE message type each. Typed message in → domain call → response/broadcast.",
      "Domain logic is framework-agnostic. Zero WebSocket imports. Pure functions: (state, action) → newState.",
      "Persistence is async and non-blocking. Acknowledge to user FIRST, write to DB AFTER.",
      "Cross-server communication ONLY through Valkey pub/sub. Never assume single-server.",
      "All messages: { type, payload, timestamp, senderId }. Defined in shared/protocol/.",
      "Presence (online/offline/typing) is ephemeral: Valkey TTL keys only. Never persisted.",
    ],
    reservedWords: {
      "$ws": "WebSocket connection instance",
      "$room": "room/channel abstraction — join, leave, broadcast to members",
      "$presence": "online/offline/typing state via Valkey TTL keys + pub/sub",
      "$pubsub": "Valkey pub/sub for cross-server message fan-out",
      "$protocol": "message type definitions: { type, payload, ts, senderId }",
      "$auth": "JWT validated at WebSocket handshake, not per-message",
      "$db": "PostgreSQL for persistent data (messages, channels, users)",
      "$cache": "Valkey for ephemeral state (presence, typing, recent messages)",
    },
    suggestedFeatures: [
      { id: "chat", name: "Chat messaging", keywords: "chat,message,send,edit,delete,thread" },
      { id: "collab", name: "Collaborative editing", keywords: "collab,edit,CRDT,document,sync" },
      { id: "channels", name: "Channels & rooms", keywords: "channel,room,join,leave,members" },
    ],
    graphGen: "realtime",
  },
  data: {
    name: "Data-Intensive / Analytics",
    desc: "Large datasets, ETL pipelines, dashboards, real-time and batch analytics",
    icon: ICONS.chart,
    pattern: "CQRS — write path (pipelines) separated from read path (Cube→API)",
    folderConv: "pipelines/{concern}/{name}.py | api/routes/{name}.py | semantic/models/{name}.js",
    sharedConv: "src/features/{cluster}/{name}.tsx (frontend)",
    defaultStack: {
      "Frontend": "React + ECharts + TanStack Query/Table",
      "API": "FastAPI (Python)",
      "Auth": "Keycloak + OPA (row-level access)",
      "OLAP Engine": "ClickHouse",
      "App Database": "PostgreSQL",
      "Cache": "Valkey",
      "Orchestration": "Dagster",
      "Ingestion": "Airbyte",
      "Transformation": "dbt-core",
      "Semantic Layer": "Cube",
      "Observability": "Grafana + Prometheus + Loki",
      "Infrastructure": "Docker + K3s + OpenTofu",
    },
    rules: [
      "Pipeline code and API code are SEPARATE top-level concerns. Never mix them.",
      "All analytical queries go through Cube semantic layer. Never query ClickHouse directly from API.",
      "Cube models define metrics, dimensions, and access policies. This is the business logic for analytics.",
      "API routes are thin: authenticate → authorize via OPA → delegate to Cube → return JSON.",
      "Pipeline transforms are pure functions: data in → data out. No side effects. Independently testable.",
      "Every pipeline asset in Dagster has a data quality check (freshness, row count, schema, statistical).",
      "Access control: OPA policies inject row-level filters based on user role/region. Never filter in frontend.",
    ],
    reservedWords: {
      "$ch": "ClickHouse OLAP engine — columnar storage for analytical queries",
      "$db": "PostgreSQL — app state only (users, dashboards, saved queries, permissions)",
      "$cube": "Cube semantic layer — metrics, dimensions, pre-aggregations, access policies",
      "$pipe": "Dagster pipeline asset — a unit of ETL work with quality checks",
      "$dbt": "dbt transformation model — SQL-based transform from staging to mart tables",
      "$opa": "OPA policy decision point — injects WHERE clauses based on user attributes",
      "$cache": "Valkey — query result caching, API rate limiting",
      "$auth": "authenticated user with role attribute for OPA policy evaluation",
    },
    suggestedFeatures: [
      { id: "ingest", name: "Data ingestion", keywords: "ingest,sync,connector,source,Airbyte" },
      { id: "transform", name: "Transformations", keywords: "transform,dbt,staging,mart,clean" },
      { id: "dashboard", name: "Dashboard & charts", keywords: "dashboard,chart,filter,drill,date range" },
      { id: "export", name: "Data exports", keywords: "export,CSV,PDF,report,download" },
    ],
    graphGen: "data",
  },
  ai: {
    name: "AI-Powered Product",
    desc: "LLM chains, RAG, embeddings, prompt management, model serving, evaluation",
    icon: ICONS.brain,
    pattern: "Hexagonal (ports + adapters) + Pipeline chains",
    folderConv: "src/chains/{name}.py | src/prompts/{scope}/{name}.md | src/adapters/{type}/{name}.py",
    sharedConv: "src/ports/{name}.py | src/guardrails/{name}.py",
    defaultStack: {
      "Frontend": "Next.js (streaming SSE UI)",
      "API": "FastAPI (Python)",
      "Auth": "Keycloak",
      "Database": "PostgreSQL + pgvector",
      "Cache": "Valkey (semantic cache)",
      "Object Storage": "MinIO (documents)",
      "Job Queue": "Celery or BullMQ",
      "Model Serving": "vLLM or Ollama (self-host) / External API",
      "LLM Observability": "Langfuse",
      "Evaluation": "Promptfoo",
      "Observability": "Grafana + Prometheus",
      "Infrastructure": "Docker + K3s + OpenTofu",
    },
    rules: [
      "LLM provider is an ADAPTER. Chains call PortLLM interface. Swap provider = new adapter, zero chain changes.",
      "Prompts are version-controlled in src/prompts/. Never inline prompt strings in chain code.",
      "Every chain has a Promptfoo eval suite in src/eval/. No prompt change ships without passing tests.",
      "All LLM calls are traced via Langfuse: prompt, response, latency, tokens, model, quality score.",
      "Guardrails (input filtering, output validation, PII detection) wrap EVERY chain. Not optional.",
      "RAG retrieval returns sources with relevance scores. Chains pass sources for citation in response.",
      "Streaming responses via Server-Sent Events. Frontend renders tokens progressively as they arrive.",
      "Semantic caching: check Valkey for semantically similar prior queries before calling LLM.",
    ],
    reservedWords: {
      "$llm": "LLM port interface — adapters: OpenAI, vLLM, Ollama, Anthropic. Swap via LLM_PROVIDER env var.",
      "$vec": "Vector store port — adapters: pgvector, Qdrant. For embedding storage and similarity search.",
      "$embed": "Embedding generation — call $vec.embed(text) to generate vectors",
      "$guard": "Guardrails — input filter, output filter, PII detection. Wraps every chain.",
      "$trace": "Langfuse trace decorator — automatic LLM call observability",
      "$prompt": "Prompt template — loaded from src/prompts/, never inline strings in code",
      "$eval": "Promptfoo test suite — regression tests for prompt quality",
      "$cache": "Valkey semantic cache — deduplicate similar queries to avoid re-inference",
      "$db": "PostgreSQL — app state + pgvector extension for embeddings",
    },
    suggestedFeatures: [
      { id: "rag", name: "RAG (document Q&A)", keywords: "RAG,retrieve,document,search,context,citation" },
      { id: "chat", name: "Conversational AI", keywords: "chat,conversation,message,history,multi-turn" },
      { id: "summarize", name: "Summarization", keywords: "summarize,summary,condense,extract" },
    ],
    graphGen: "ai",
  },
  mobile: {
    name: "Consumer Mobile App",
    desc: "Cross-platform, offline-first, push notifications, fast startup",
    icon: "📱",
    pattern: "MVVM — Screen → Hook → Service → API/LocalDB",
    folderConv: "src/screens/{Name}Screen.tsx | src/features/{name}/{file}.ts(x)",
    sharedConv: "src/services/{name}.ts | src/hooks/{name}.ts | src/components/{Name}.tsx",
    defaultStack: {
      "Framework": "React Native",
      "BFF API": "Hono",
      "Auth": "Keycloak + biometric local auth",
      "Server DB": "PostgreSQL",
      "Client DB": "WatermelonDB (offline-first)",
      "Cache": "Valkey",
      "Object Storage": "MinIO",
      "Job Queue": "BullMQ",
      "Observability": "Grafana + GlitchTip",
      "Infrastructure": "Docker + K3s + Caddy",
    },
    rules: [
      "Screens are THIN. They compose components and call hooks. ZERO business logic in JSX.",
      "Custom hooks encapsulate all feature logic: data fetching, state management, mutations.",
      "Offline-first: write to WatermelonDB first, sync to server when online. Always.",
      "API calls go through single api-client.ts with automatic retry, auth refresh, offline queuing.",
      "Images: upload via presigned URL to $store. Never send base64 through the API.",
      "Navigation params are typed. No magic strings for route names.",
      "All list rendering uses FlashList. Never FlatList. Performance is non-negotiable.",
    ],
    reservedWords: {
      "$sync": "WatermelonDB offline sync — push on foreground, pull on app open",
      "$api": "single HTTP client — retry, auth refresh, offline queue, all in one",
      "$auth": "Keycloak JWT + biometric local unlock via secure storage",
      "$db": "PostgreSQL server-side database",
      "$local": "WatermelonDB client-side database (offline-first)",
      "$store": "MinIO for media uploads via presigned URLs",
      "$nav": "typed navigation routes — no magic strings",
      "$push": "push notification registration and handling (APNs/FCM)",
    },
    suggestedFeatures: [
      { id: "feed", name: "Content feed", keywords: "feed,home,list,refresh,load more" },
      { id: "profile", name: "User profile", keywords: "profile,account,settings,avatar" },
    ],
    graphGen: "mobile",
  },
  internal: {
    name: "Internal Tools / Admin Dashboard",
    desc: "Employee-facing, connects to existing DBs, role-based, behind VPN",
    icon: ICONS.wrench,
    pattern: "Simple Layered or No Architecture. Velocity over elegance.",
    folderConv: "src/{feature}/{name}.ts",
    sharedConv: "src/shared/{name}.ts",
    defaultStack: {
      "UI Framework": "Tooljet or Refine",
      "API": "Direct DB connection or Hono",
      "Auth": "Keycloak SSO + Tailscale VPN",
      "Database": "Existing PostgreSQL (read replica + primary)",
      "Observability": "Grafana (if already deployed)",
      "Infrastructure": "Docker Compose (single server)",
    },
    rules: [
      "ALWAYS use read replica for display queries. Write operations go to primary only.",
      "Every destructive action (delete, refund, ban) requires confirmation AND is audit logged.",
      "Audit log: { user, action, target, timestamp, old_value, new_value }. Non-negotiable.",
      "Role-based visibility: different roles see different data and actions.",
      "No sensitive data (PII) displayed in full. Mask by default. Reveal on click + audit log.",
      "Tool is NOT accessible from public internet. VPN/Tailscale required.",
    ],
    reservedWords: {
      "$replica": "PostgreSQL read replica — all display queries go here",
      "$primary": "PostgreSQL primary — write operations only",
      "$audit": "append-only audit log — every destructive action logged with full context",
      "$auth": "Keycloak SSO with role-based access (support, finance, admin)",
      "$mask": "data masking for PII columns (partial email, last-4 phone, hidden SSN)",
    },
    suggestedFeatures: [
      { id: "customers", name: "Customer lookup", keywords: "customer,user,search,detail,lookup" },
      { id: "orders", name: "Order management", keywords: "order,refund,cancel,status,detail" },
    ],
    graphGen: "internal",
  },
  content: {
    name: "Content-Heavy Site",
    desc: "CMS, blog, publication, media, SEO-optimized, static generation",
    icon: "📝",
    pattern: "Static Generation + Interactive Islands. Zero JS by default.",
    folderConv: "src/pages/{slug}.astro | src/components/{Name}.tsx (React islands)",
    sharedConv: "src/layouts/{Name}.astro | src/lib/{name}.ts",
    defaultStack: {
      "Frontend": "Astro",
      "CMS": "Strapi or Payload CMS",
      "Auth": "Keycloak (editors/admins only)",
      "Database": "PostgreSQL (via CMS)",
      "Cache": "Valkey + CDN",
      "Search": "Meilisearch",
      "Image Processing": "Imgproxy",
      "Object Storage": "MinIO",
      "Newsletter": "Listmonk + Postal",
      "Observability": "Grafana + Prometheus",
      "Infrastructure": "Docker Compose + Caddy",
    },
    rules: [
      "Content pages are static by default. Only add client-side JS for interactive islands.",
      "Images ALWAYS go through Imgproxy. Never serve unoptimized. Always include width, height, alt.",
      "Content model changes in CMS trigger site rebuild via webhook.",
      "SEO metadata (title, description, OG image) is MANDATORY on every content type.",
      "Search index updates via webhook on publish. Not on every draft save.",
      "RSS feed auto-generated from content. Newsletter sends triggered by publish event.",
    ],
    reservedWords: {
      "$cms": "Strapi/Payload headless CMS — content authoring, editorial workflows",
      "$img": "Imgproxy — automatic WebP/AVIF conversion, responsive sizes, lazy loading",
      "$search": "Meilisearch — full-text site search with typo tolerance",
      "$seo": "SEO component — title, description, OG image, JSON-LD structured data",
      "$island": "React interactive island — hydrates client-side only when visible",
      "$cdn": "CDN cache layer — static assets and pre-rendered pages",
      "$auth": "Keycloak — editor and admin authentication only (readers are anonymous)",
    },
    suggestedFeatures: [
      { id: "articles", name: "Articles & blog posts", keywords: "article,post,blog,publish,draft" },
      { id: "pages", name: "Static pages", keywords: "page,about,contact,landing" },
      { id: "media", name: "Media library", keywords: "image,video,gallery,upload,optimize" },
    ],
    graphGen: "content",
  },
};

const SKILL_CATALOG = [
  { id: "postgres", name: "PostgreSQL", keywords: "postgres,pg,RLS,pool,transaction,advisory lock", cat: "Database" },
  { id: "prisma", name: "Prisma ORM", keywords: "prisma,schema,migration,include,select,relation", cat: "Database" },
  { id: "drizzle", name: "Drizzle ORM", keywords: "drizzle,schema,migration,query builder", cat: "Database" },
  { id: "clickhouse", name: "ClickHouse", keywords: "clickhouse,OLAP,MergeTree,materialized view", cat: "Database" },
  { id: "valkey", name: "Valkey / Redis", keywords: "valkey,redis,cache,pubsub,TTL", cat: "Cache" },
  { id: "keycloak", name: "Keycloak", keywords: "keycloak,realm,OIDC,SAML,SSO config", cat: "Auth" },
  { id: "jwt", name: "JWT Patterns", keywords: "jwt,token,refresh,JWKS,claims,bearer", cat: "Auth" },
  { id: "stripe", name: "Stripe", keywords: "stripe,payment,charge,webhook,idempotency", cat: "Payments" },
  { id: "killbill", name: "Kill Bill", keywords: "killbill,subscription,plan,prorate,catalog", cat: "Payments" },
  { id: "meilisearch", name: "Meilisearch", keywords: "meilisearch,search index,facet,typo", cat: "Search" },
  { id: "opensearch", name: "OpenSearch", keywords: "opensearch,elasticsearch,shard,mapping", cat: "Search" },
  { id: "websocket", name: "WebSocket", keywords: "websocket,ws,connection,ping,pong", cat: "Real-time" },
  { id: "yjs", name: "Yjs (CRDT)", keywords: "yjs,CRDT,collaborative,awareness,sync", cat: "Real-time" },
  { id: "llm_sdk", name: "LLM Provider SDK", keywords: "openai,anthropic,claude,embedding", cat: "AI/ML" },
  { id: "pgvector", name: "pgvector", keywords: "pgvector,vector,embedding,HNSW,similarity", cat: "AI/ML" },
  { id: "langfuse", name: "Langfuse", keywords: "langfuse,trace,span,LLM observability", cat: "AI/ML" },
  { id: "bullmq", name: "BullMQ", keywords: "bullmq,queue,job,worker,retry", cat: "Infrastructure" },
  { id: "docker", name: "Docker", keywords: "docker,container,image,Dockerfile,compose", cat: "Infrastructure" },
  { id: "caddy", name: "Caddy", keywords: "caddy,reverse proxy,HTTPS,TLS,Caddyfile", cat: "Infrastructure" },
  { id: "k3s", name: "K3s", keywords: "k3s,kubernetes,pod,deploy,ingress", cat: "Infrastructure" },
  { id: "opentofu", name: "OpenTofu", keywords: "opentofu,terraform,IaC,infrastructure", cat: "Infrastructure" },
  { id: "dagster", name: "Dagster", keywords: "dagster,pipeline,asset,schedule,sensor", cat: "Data" },
  { id: "dbt", name: "dbt", keywords: "dbt,transform,model,staging,mart", cat: "Data" },
  { id: "cube", name: "Cube", keywords: "cube,semantic,metric,dimension,pre-aggregation", cat: "Data" },
  { id: "saleor", name: "Saleor", keywords: "saleor,commerce,checkout,product,order", cat: "Commerce" },
];

// ═══════════════════════════════════════════════════════════════════════════
// GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

function genSystemMd(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `# SYSTEM.md\n\n`;
  o += `## App: ${cfg.appName}\n`;
  o += `## Type: ${at.name}\n`;
  o += `## Stack: ${Object.entries(cfg.stack).map(([k,v]) => v).join(" + ")}\n`;
  o += `## Pattern: ${at.pattern}\n\n`;
  o += `## Rules\n`;
  at.rules.forEach(r => o += `- ${r}\n`);
  o += `\n## Reserved Words\n`;
  for (const [k, v] of Object.entries(at.reservedWords)) o += `${k} = ${v}\n`;
  o += `\n## Naming\n`;
  o += `Files: kebab-case | Types: PascalCase | Funcs: camelCase | Tables: snake_case | Env: SCREAMING_SNAKE\n`;
  o += `\n## On Generate\n`;
  o += `1. State which layer this code belongs to and the file path\n`;
  o += `2. Reference $symbols for all dependencies\n`;
  if (at.reservedWords["$tenant"]) o += `3. Include $tenant in all DB operations\n`;
  o += `${at.reservedWords["$tenant"] ? "4" : "3"}. Throw $err on failure paths\n`;
  o += `${at.reservedWords["$tenant"] ? "5" : "4"}. Write the corresponding test\n`;
  o += `\n## Session Protocol (NON-NEGOTIABLE)\n`;
  o += `- BEFORE any code generation in a new session: run \`node resolve.mjs warmup\`\n`;
  o += `- If warmup returns blockers: FIX THEM before writing any code. No exceptions.\n`;
  o += `- If warmup returns warnings: ACKNOWLEDGE them and proceed with awareness.\n`;
  o += `- BEFORE generating a new feature: run \`node resolve.mjs scaffold <featureId>\` for the checklist.\n`;
  o += `- BEFORE generating code for an existing feature: run \`node resolve.mjs preflight <feature> <layer>\`\n`;
  o += `- When the prompt is ambiguous: run \`node resolve.mjs context "<prompt>"\` to resolve to specific nodes and files.\n`;
  o += `- AT SESSION END: suggest running \`node gotcha.mjs --debrief\` to capture learnings.\n`;
  o += `\n## Delegation Principle\n`;
  o += `Delegate everything deterministic to sub-agents and CLI tools first. The main agent finalizes with judgment.\n\n`;
  o += `### Sub-agent first (70-80% of the work, cheap tokens):\n`;
  o += `- Scaffolding files and boilerplate: \`resolve.mjs scaffold\` + sub-agent generates from checklist\n`;
  o += `- Resolving context and dependencies: \`resolve.mjs context\` + \`resolve.mjs preflight\`\n`;
  o += `- Checking code against rules: \`review.mjs --agent\` (sub-agent reads JSON, reports findings)\n`;
  o += `- Looking up patterns and gotchas: \`resolve.mjs lookup\` (sub-agent applies, not re-derives)\n`;
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
  o += `4. Main agent runs \`review.mjs --agent\` as final gate\n`;
  o += `5. If review passes: done. If not: fix findings, re-run.\n`;
  return o;
}

function genIndexMd(cfg) {
  const at = APP_TYPES[cfg.appType];
  let o = `# INDEX.md\n\n`;
  o += `## Conv: ${at.folderConv}\n`;
  o += `## Shared: ${at.sharedConv}\n\n`;
  o += `## Keywords → Nodes\n`;
  cfg.features.forEach(f => o += `${f.keywords} → @${f.id}\n`);
  o += `\n`;
  if (cfg.skills.length > 0) {
    o += `## Keywords → Skills\n`;
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
    else base = `src/${f.id}/`;
    o += `@${f.id} = [${f.id}] → ${base}\n`;
  });
  o += `\n`;
  if (cfg.skills.length > 0) {
    o += `## Skills → Files\n`;
    cfg.skills.forEach(s => o += `$${s} → .arch/skills/${s}.skill\n`);
    o += `\n`;
  }
  o += `## Cross-Refs\n`;
  o += `# TODO: Map which features depend on which other features\n`;
  cfg.features.forEach((f, i) => {
    if (i < cfg.features.length - 1) o += `# @${f.id} → @${cfg.features[i+1].id} (describe relationship)\n`;
  });
  return o;
}

function genGraph(feature, cfg) {
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

function genInfraGraph(cfg) {
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
  return o;
}

function genEventsGraph(cfg) {
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

function genSkillFile(skillId) {
  const sk = SKILL_CATALOG.find(s => s.id === skillId);
  if (!sk) return "";
  return `# ${sk.name}.skill

## Meta
pkg: [PACKAGE_NAME]@[VERSION]
docs: [OFFICIAL_DOCS_URL]
updated: [YYYY-MM-DD]

## Use
[How YOUR project uses ${sk.name}. 2-3 lines max.]
[Not what it does generally — how YOUR app uses it specifically.]

## Patterns
[The specific import paths, function signatures, and conventions you follow.]
[List the 5-10 methods/endpoints your app actually calls.]

## Gotchas
WRONG: [the code the AI will generate by default]
RIGHT: [the code it should generate instead]
WHY: [one-line explanation of the failure mode]

[Add more WRONG/RIGHT/WHY blocks as you discover them.]

## Boundaries
[What ${sk.name} does NOT do in your project.]
[Prevents the AI from overreaching with this package.]

## Snippets
[2-3 code blocks showing the correct pattern in YOUR project.]
[These are the patterns the AI will clone.]
`;
}

function genApiStub(skillId) {
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

function genReadme(cfg) {
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
3. Upload relevant \`.skill\` and \`.api\` files as project knowledge

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
| INDEX.md | Keyword → node/skill routing | New feature or dependency |
| clusters/*.graph | Architecture structure (v2 notation) | Feature added/changed |
| skills/*.skill | Package gotchas + patterns | Dependency upgrade or new gotcha |
| apis/*.api | API contracts (endpoints + types) | Dependency version bump |

## Maintenance

- **Monthly**: Check .skill freshness. Update for dependency upgrades.
- **Per feature**: Add .graph cluster. Update INDEX.md keywords.
- **Per gotcha**: When AI-generated code needs a fix, add WRONG/RIGHT/WHY to the .skill.
- **Per deploy**: Regenerate .api files from your latest API specs.
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// WIZARD — Step definitions, navigation, save/load
// ═══════════════════════════════════════════════════════════════════════════

const PROGRESS_FILE = ".archkit-progress.json";

const STEPS = [
  { id: "appName",  label: "Project Identity",  stateKeys: ["appName"],               dependsOn: [],                       run: stepAppName },
  { id: "appType",  label: "Application Type",   stateKeys: ["appType"],               dependsOn: [],                       run: stepAppType },
  { id: "stack",    label: "Technology Stack",    stateKeys: ["stack"],                 dependsOn: ["appType"],              run: stepStack },
  { id: "features", label: "Define Features",    stateKeys: ["features"],              dependsOn: ["appType"],              run: stepFeatures },
  { id: "skills",   label: "Package Skills",     stateKeys: ["skills"],                dependsOn: ["appType", "stack"],     run: stepSkills },
  { id: "output",   label: "Output & Options",   stateKeys: ["outDir", "claudeMode"],  dependsOn: [],                       run: stepOutput },
  { id: "preview",  label: "Preview & Generate",  stateKeys: [],                        dependsOn: ["appName","appType","stack","features","skills","output"], run: stepPreview },
];

function createInitialState() {
  return { appName: null, appType: null, stack: null, features: null, skills: null, outDir: null, claudeMode: null, _completedSteps: [] };
}

// ── Save / Load ─────────────────────────────────────────────────────────

function saveProgress(state) {
  const data = {
    version: 1,
    savedAt: new Date().toISOString(),
    state: { ...state, _completedSteps: undefined },
    completedSteps: state._completedSteps,
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
  console.log("");
  success(`Progress saved to ${PROGRESS_FILE}`);
  info("Run archkit again to resume where you left off.");
  console.log("");
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    if (data.version !== 1) return null;
    return data;
  } catch { return null; }
}

function deleteProgressFile() {
  try { fs.unlinkSync(PROGRESS_FILE); } catch {}
}

// ── Navigation ──────────────────────────────────────────────────────────

function invalidateFrom(stepId, state) {
  const toInvalidate = new Set();
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const step of STEPS) {
      if (step.dependsOn.includes(current) && !toInvalidate.has(step.id)) {
        toInvalidate.add(step.id);
        queue.push(step.id);
      }
    }
  }
  for (const id of toInvalidate) {
    const step = STEPS.find(s => s.id === id);
    if (step) step.stateKeys.forEach(k => { state[k] = null; });
    state._completedSteps = state._completedSteps.filter(s => s !== id);
  }
}

async function promptNavigation(currentIndex) {
  const isFirst = currentIndex === 0;
  const choices = [
    { name: `${C.green}${ICONS.arrow}${C.reset} Continue to next step`, value: "continue", short: "Continue" },
  ];
  if (!isFirst) {
    choices.push({ name: `${C.blue}${ICONS.corner}${C.reset} Go back to a previous step`, value: "back", short: "Back" });
  }
  choices.push(
    { name: `${C.yellow}${ICONS.file}${C.reset} Save progress & exit`, value: "save", short: "Save" },
    { name: `${C.red}${ICONS.cross}${C.reset} Exit without saving`, value: "exit", short: "Exit" },
  );

  console.log("");
  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: "What next?",
    prefix: `  ${ICONS.arch}`,
    choices,
  }]);
  return action;
}

async function promptGoBack(completedSteps) {
  const choices = completedSteps.map(id => {
    const step = STEPS.find(s => s.id === id);
    return { name: step.label, value: id, short: step.label };
  });

  const { targetId } = await inquirer.prompt([{
    type: "list",
    name: "targetId",
    message: "Go back to which step?",
    prefix: `  ${ICONS.arch}`,
    choices,
  }]);
  return targetId;
}

// ── Step functions ──────────────────────────────────────────────────────

async function stepAppName(state) {
  heading(ICONS.rocket, `Step 1/${STEPS.length} — Project Identity`);
  info("What are we building? This name appears in generated files.");
  console.log("");

  const { appName } = await inquirer.prompt([{
    type: "input",
    name: "appName",
    message: "Project name:",
    default: state.appName || "my-app",
    prefix: `  ${ICONS.arch}`,
  }]);

  success(`Project: ${appName}`);
  return { appName };
}

async function stepAppType(state) {
  divider();
  heading(ICONS.mag, `Step 2/${STEPS.length} — Application Type`);
  info("This determines your architecture pattern, folder structure,");
  info("default stack, reserved words, and graph node templates.");
  console.log("");

  const { appType } = await inquirer.prompt([{
    type: "list",
    name: "appType",
    message: "What type of application?",
    prefix: `  ${ICONS.arch}`,
    choices: Object.entries(APP_TYPES).map(([k, v]) => ({
      name: `${v.icon}  ${v.name}  ${C.dim}— ${v.desc}${C.reset}`,
      value: k,
      short: v.name,
    })),
    default: state.appType || undefined,
    pageSize: 10,
  }]);

  const at = APP_TYPES[appType];
  console.log("");
  success(`Type: ${at.name}`);
  console.log("");

  subheading("Architecture pattern:");
  info(`  ${at.pattern}`);
  console.log("");

  subheading("File conventions:");
  info(`  ${at.folderConv}`);
  info(`  ${at.sharedConv}`);
  console.log("");

  subheading("Reserved words the AI will understand:");
  for (const [k, v] of Object.entries(at.reservedWords)) {
    console.log(`  ${C.yellow}${k}${C.reset} ${C.dim}= ${v}${C.reset}`);
  }
  console.log("");

  subheading("Rules that will govern code generation:");
  at.rules.forEach((r, i) => {
    console.log(`  ${C.gray}${i + 1}.${C.reset} ${r}`);
  });

  return { appType };
}

async function stepStack(state) {
  const at = APP_TYPES[state.appType];

  divider();
  heading(ICONS.package, `Step 3/${STEPS.length} — Technology Stack`);
  info("Default stack for this app type. Customize any layer or press Enter to keep defaults.");
  console.log("");

  subheading("Default stack:");
  for (const [layer, tool] of Object.entries(at.defaultStack)) {
    console.log(`  ${C.cyan}${layer.padEnd(20)}${C.reset} ${tool}`);
  }
  console.log("");

  const { wantCustomStack } = await inquirer.prompt([{
    type: "confirm",
    name: "wantCustomStack",
    message: "Customize any stack choices?",
    default: false,
    prefix: `  ${ICONS.arch}`,
  }]);

  let stack = state.stack || { ...at.defaultStack };
  if (wantCustomStack) {
    stack = {};
    console.log("");
    tip("Press Enter to keep the default for each layer.");
    console.log("");
    for (const [layer, defaultTool] of Object.entries(at.defaultStack)) {
      const { tool } = await inquirer.prompt([{
        type: "input",
        name: "tool",
        message: `${layer}:`,
        default: defaultTool,
        prefix: `  ${C.gray}${ICONS.gear}${C.reset}`,
      }]);
      stack[layer] = tool;
    }
  }

  console.log("");
  success("Stack configured.");
  return { stack };
}

async function stepFeatures(state) {
  const at = APP_TYPES[state.appType];

  divider();
  heading("\uD83C\uDFD7", `Step 4/${STEPS.length} — Define Your Features`);
  info("Features become clusters in your architecture graph.");
  info("Each gets its own .graph file with controller, service, repo nodes.");
  console.log("");

  if (at.suggestedFeatures.length > 0) {
    subheading("Suggested features for this app type:");
    at.suggestedFeatures.forEach(f => {
      console.log(`  ${C.gray}${ICONS.dot}${C.reset} ${C.bold}${f.id}${C.reset} ${C.dim}— ${f.name} (${f.keywords})${C.reset}`);
    });
    console.log("");
  }

  const { useSuggested } = await inquirer.prompt([{
    type: "confirm",
    name: "useSuggested",
    message: "Start with the suggested features?",
    default: true,
    prefix: `  ${ICONS.arch}`,
  }]);

  let features = useSuggested ? [...at.suggestedFeatures] : [];

  // Restore previously added custom features if resuming
  if (state.features && state.features.length > 0) {
    const suggestedIds = new Set(at.suggestedFeatures.map(f => f.id));
    const customFeatures = state.features.filter(f => !suggestedIds.has(f.id));
    if (customFeatures.length > 0) {
      features.push(...customFeatures);
    }
  }

  if (features.length > 0) {
    console.log("");
    features.forEach(f => success(`${f.id} — ${f.name}`));
  }

  console.log("");
  info("Add your own features. Type 'done' when finished.");
  console.log("");

  let adding = true;
  while (adding) {
    const { featureId } = await inquirer.prompt([{
      type: "input",
      name: "featureId",
      message: "Feature ID (lowercase, or 'done'):",
      prefix: `  ${C.cyan}+${C.reset}`,
    }]);

    if (featureId === "done" || featureId === "") {
      if (features.length === 0) {
        warn("Need at least one feature. Try again.");
        continue;
      }
      adding = false;
      continue;
    }

    if (features.find(f => f.id === featureId)) {
      warn(`${featureId} already exists. Skipping.`);
      continue;
    }

    const { featureName } = await inquirer.prompt([{
      type: "input",
      name: "featureName",
      message: "  Display name:",
      default: featureId.charAt(0).toUpperCase() + featureId.slice(1) + " management",
      prefix: `  ${C.gray}${ICONS.pipe}${C.reset}`,
    }]);

    const { featureKeywords } = await inquirer.prompt([{
      type: "input",
      name: "featureKeywords",
      message: "  Keywords (comma-separated):",
      default: featureId,
      prefix: `  ${C.gray}${ICONS.corner}${C.reset}`,
    }]);

    features.push({ id: featureId, name: featureName, keywords: featureKeywords });
    success(`Added: ${featureId} — ${featureName}`);
    console.log("");
  }

  return { features };
}

async function stepSkills(state) {
  const appType = state.appType;
  const stack = state.stack;

  divider();
  heading(ICONS.shield, `Step 5/${STEPS.length} — Package Skills`);
  info("Skills teach the AI your team's gotchas and patterns for each package.");
  info("We'll auto-detect relevant packages from your stack and suggest them.");
  console.log("");

  const stackStr = JSON.stringify(stack).toLowerCase() + " " + appType;
  const autoDetected = SKILL_CATALOG.filter(s => {
    const n = s.name.toLowerCase();
    if (n.includes("postgres") && stackStr.includes("postgres")) return true;
    if (n.includes("valkey") && (stackStr.includes("valkey") || stackStr.includes("redis"))) return true;
    if (n.includes("keycloak") && stackStr.includes("keycloak")) return true;
    if (n.includes("stripe") && stackStr.includes("stripe")) return true;
    if (n.includes("kill bill") && stackStr.includes("kill bill")) return true;
    if (n.includes("meilisearch") && stackStr.includes("meilisearch")) return true;
    if (n.includes("clickhouse") && stackStr.includes("clickhouse")) return true;
    if (n.includes("docker")) return true;
    if (n.includes("caddy") && stackStr.includes("caddy")) return true;
    if (n.includes("k3s") && stackStr.includes("k3s")) return true;
    if (n.includes("bullmq") && stackStr.includes("bullmq")) return true;
    if (n.includes("saleor") && stackStr.includes("saleor")) return true;
    if (n.includes("dagster") && stackStr.includes("dagster")) return true;
    if (n.includes("dbt") && stackStr.includes("dbt")) return true;
    if (n.includes("cube") && stackStr.includes("cube")) return true;
    if (n.includes("langfuse") && stackStr.includes("langfuse")) return true;
    if (n.includes("pgvector") && stackStr.includes("pgvector")) return true;
    if (n.includes("websocket") && appType === "realtime") return true;
    if (n.includes("yjs") && appType === "realtime") return true;
    if (n.includes("llm") && appType === "ai") return true;
    if (n.includes("opentofu") && stackStr.includes("opentofu")) return true;
    return false;
  });

  const notDetected = SKILL_CATALOG.filter(s => !autoDetected.find(a => a.id === s.id));
  const categories = [...new Set(SKILL_CATALOG.map(s => s.cat))];

  const previousSkills = state.skills || [];
  const choices = [];
  if (autoDetected.length > 0) {
    choices.push(new inquirer.Separator(`${C.green} ── Auto-detected from your stack ──${C.reset}`));
    autoDetected.forEach(s => choices.push({
      name: `${s.name} ${C.dim}(${s.cat})${C.reset}`,
      value: s.id,
      checked: previousSkills.includes(s.id) || (previousSkills.length === 0),
      short: s.name,
    }));
  }
  for (const cat of categories) {
    const catSkills = notDetected.filter(s => s.cat === cat);
    if (catSkills.length > 0) {
      choices.push(new inquirer.Separator(`${C.gray} ── ${cat} ──${C.reset}`));
      catSkills.forEach(s => choices.push({
        name: `${s.name}`,
        value: s.id,
        checked: previousSkills.includes(s.id),
        short: s.name,
      }));
    }
  }

  const { skills } = await inquirer.prompt([{
    type: "checkbox",
    name: "skills",
    message: "Select package skills to generate:",
    prefix: `  ${ICONS.arch}`,
    choices,
    pageSize: 20,
  }]);

  console.log("");
  success(`${skills.length} skill skeletons will be generated.`);
  skills.forEach(s => {
    const sk = SKILL_CATALOG.find(c => c.id === s);
    info(`  ${ICONS.dot} ${sk.name} → .arch/skills/${s}.skill`);
  });

  return { skills };
}

async function stepOutput(state) {
  divider();
  heading(ICONS.folder, `Step 6/${STEPS.length} — Output & Options`);

  const { outDir } = await inquirer.prompt([{
    type: "input",
    name: "outDir",
    message: "Where to generate .arch/ directory:",
    default: state.outDir || ".arch",
    prefix: `  ${ICONS.arch}`,
  }]);

  const cliHasClaude = process.argv.includes("--claude");
  let claudeMode = cliHasClaude;

  if (!cliHasClaude) {
    const { wantClaude } = await inquirer.prompt([{
      type: "confirm",
      name: "wantClaude",
      message: "Also generate Claude Code native files? (CLAUDE.md + .claude/rules/ + .claude/skills/)",
      default: state.claudeMode || false,
      prefix: `  ${ICONS.arch}`,
    }]);
    claudeMode = wantClaude;
  }

  if (claudeMode) {
    console.log("");
    success("Claude Code integration enabled.");
    info("  Will generate: CLAUDE.md (root), .claude/rules/, .claude/skills/");
    info("  Claude Code will auto-load these alongside .arch/ files.");
  }

  return { outDir, claudeMode };
}

async function stepPreview(state) {
  const at = APP_TYPES[state.appType];
  const { appName, appType, stack, features, skills, outDir, claudeMode } = state;

  divider();
  heading(ICONS.mag, `Step 7/${STEPS.length} — Preview & Generate`);
  console.log("");

  const cfg = { appName, appType, stack, features, skills };

  // Show tree preview
  console.log(`  ${C.bold}${outDir}/${C.reset}`);
  tree(`${C.bold}SYSTEM.md${C.reset} ${C.dim}— rules + ${Object.keys(at.reservedWords).length} reserved words${C.reset}`);
  tree(`${C.bold}INDEX.md${C.reset} ${C.dim}— ${features.length} features + ${skills.length} skills routing${C.reset}`);
  tree(`${C.bold}README.md${C.reset} ${C.dim}— usage instructions${C.reset}`);
  tree(`${C.bold}clusters/${C.reset}`);
  console.log(`${C.gray}    ${ICONS.tee}── infra.graph ${C.dim}— shared infrastructure + middleware${C.reset}`);
  features.forEach(f => {
    console.log(`${C.gray}    ${ICONS.tee}── ${f.id}.graph ${C.dim}— ${f.name}${C.reset}`);
  });
  if (at.reservedWords["$bus"]) {
    console.log(`${C.gray}    ${ICONS.corner}── events.graph ${C.dim}— domain event definitions${C.reset}`);
  }
  tree(`${C.bold}skills/${C.reset}`);
  skills.forEach((s, i) => {
    const sk = SKILL_CATALOG.find(c => c.id === s);
    const isLast = i === skills.length - 1;
    console.log(`${C.gray}    ${isLast ? ICONS.corner : ICONS.tee}── ${s}.skill ${C.dim}— ${sk.name} gotchas${C.reset}`);
  });

  const apiSkills = skills.filter(s => ["stripe","killbill","meilisearch","opensearch","saleor","langfuse","llm_sdk"].includes(s));
  if (apiSkills.length > 0) {
    tree(`${C.bold}apis/${C.reset}`, true);
    apiSkills.forEach((s, i) => {
      const sk = SKILL_CATALOG.find(c => c.id === s);
      const isLast = i === apiSkills.length - 1;
      console.log(`${C.gray}    ${isLast ? ICONS.corner : ICONS.tee}── ${s}.api ${C.dim}— ${sk.name} contract stub${C.reset}`);
    });
  }

  console.log("");
  const fileCount = 3 + features.length + 1 + (at.reservedWords["$bus"] ? 1 : 0) + skills.length + apiSkills.length;
  info(`Total: ${fileCount} files`);
  console.log("");

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: "What would you like to do?",
    prefix: `  ${ICONS.arch}`,
    choices: [
      { name: `${C.green}${ICONS.rocket}${C.reset} Generate ${fileCount} files in ${outDir}/`, value: "generate", short: "Generate" },
      { name: `${C.blue}${ICONS.corner}${C.reset} Go back to a previous step`, value: "back", short: "Back" },
      { name: `${C.yellow}${ICONS.file}${C.reset} Save progress & exit`, value: "save", short: "Save" },
      { name: `${C.red}${ICONS.cross}${C.reset} Exit without saving`, value: "exit", short: "Exit" },
    ],
  }]);

  return { _previewAction: action };
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateFiles(state) {
  const { appName, appType, stack, features, skills, outDir, claudeMode } = state;
  const at = APP_TYPES[appType];
  const cfg = { appName, appType, stack, features, skills };

  divider();
  heading(ICONS.gear, "Generating...");

  const base = path.resolve(outDir);
  fs.mkdirSync(path.join(base, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(base, "skills"), { recursive: true });
  fs.mkdirSync(path.join(base, "apis"), { recursive: true });

  const written = [];

  function writeFile(relPath, content) {
    const fullPath = path.join(base, relPath);
    fs.writeFileSync(fullPath, content);
    written.push({ path: relPath, size: content.length });
    console.log(`  ${C.green}${ICONS.check}${C.reset} ${relPath} ${C.dim}(${content.length} bytes)${C.reset}`);
  }

  const sysContent = genSystemMd(cfg);
  writeFile("SYSTEM.md", sysContent);

  const idxContent = genIndexMd(cfg);
  writeFile("INDEX.md", idxContent);

  writeFile("README.md", genReadme(cfg));
  writeFile("clusters/infra.graph", genInfraGraph(cfg));

  for (const f of features) {
    writeFile(`clusters/${f.id}.graph`, genGraph(f, cfg));
  }

  const evtContent = genEventsGraph(cfg);
  if (evtContent) writeFile("clusters/events.graph", evtContent);

  for (const s of skills) {
    writeFile(`skills/${s}.skill`, genSkillFile(s));
  }

  const apiSkills = skills.filter(s => ["stripe","killbill","meilisearch","opensearch","saleor","langfuse","llm_sdk"].includes(s));
  for (const s of apiSkills) {
    const stub = genApiStub(s);
    if (stub) writeFile(`apis/${s}.api`, stub);
  }

  // Generate lenses
  fs.mkdirSync(path.join(base, "lenses"), { recursive: true });

  writeFile("lenses/lens-research.md", `# Lens: Research

> Append to SYSTEM.md or paste into prompt when exploring approaches.

## Active Lens: Research Mode

- Prioritize exploration over implementation. Do NOT generate implementation code yet.
- Suggest 2-3 alternative approaches before committing to one.
- Ask clarifying questions about requirements and constraints.
- Reference existing .graph files to identify what's already built and what's missing.
- When recommending a package, check if a .skill file exists. If not, flag it.
- Output format: analysis and tradeoffs, not code.
`);

  writeFile("lenses/lens-implement.md", `# Lens: Implement

> Append to SYSTEM.md or paste into prompt when writing code.

## Active Lens: Implementation Mode

- Follow all architecture rules strictly. No shortcuts.
- Reference the .graph cluster for this feature before generating any file. Verify the node, layer, and file path.
- Reference the .skill file for every package used. Apply gotchas. Follow patterns.
- Reference the .api file for every external API call. Use exact endpoint signatures and types.
- Generate tests alongside implementation code. Not after.
- Use $reserved words from SYSTEM.md in all generated code.
- State the file path and layer at the top of every code block.
`);

  writeFile("lenses/lens-review.md", `# Lens: Review

> Append to SYSTEM.md or paste into prompt when reviewing code.

## Active Lens: Review Mode

- Do NOT fix code. Only report findings with severity (error/warning/info).
- Check against: .skill gotchas, SYSTEM.md rules, .graph boundaries.
- For each finding, state: what's wrong, which rule it violates, and the correct pattern.
- Flag cross-feature imports that bypass shared interfaces.
- Flag missing $tenant scoping, missing error handling, incorrect API usage.
- Flag any code that matches a WRONG pattern from a .skill file.
- End with a summary: X errors, Y warnings, Z info items.
`);

  // ── Claude Code native files ──────────────────────────────────────────
  if (claudeMode) {
    console.log("");
    console.log(`${C.cyan}${C.bold}  Generating Claude Code native files...${C.reset}`);
    console.log("");

    const projectRoot = path.resolve(".");

    let claudeMd = `# ${cfg.appName}\n\n`;
    claudeMd += `> Generated by archkit. Full context in .arch/ directory.\n\n`;
    claudeMd += `## Stack\n${Object.values(cfg.stack).join(" + ")}\n\n`;
    claudeMd += `## Architecture\n${at.pattern}\n\n`;
    claudeMd += `## Rules\n`;
    at.rules.forEach(r => claudeMd += `- ${r}\n`);
    claudeMd += `\n## Reserved Words\n`;
    for (const [k, v] of Object.entries(at.reservedWords)) claudeMd += `- ${k} = ${v}\n`;
    claudeMd += `\n## Naming\nFiles: kebab-case | Types: PascalCase | Funcs: camelCase | Tables: snake_case | Env: SCREAMING_SNAKE\n`;
    claudeMd += `\n## Session Protocol (NON-NEGOTIABLE)\n`;
    claudeMd += `- BEFORE any code generation: run \`node resolve.mjs warmup\` in .arch-tools/\n`;
    claudeMd += `- If warmup returns blockers: FIX THEM. No exceptions.\n`;
    claudeMd += `- BEFORE new feature: run \`node resolve.mjs scaffold <featureId>\`\n`;
    claudeMd += `- BEFORE editing existing feature: run \`node resolve.mjs preflight <feature> <layer>\`\n`;
    claudeMd += `- AT SESSION END: suggest \`node gotcha.mjs --debrief\`\n`;
    claudeMd += `\n## Delegation\nDelegate deterministic work to sub-agents + CLI tools first (70-80%).\n`;
    claudeMd += `Main agent finalizes with TDD: write failing test → verify generated code passes → review.mjs --agent as gate.\n`;
    claudeMd += `\n## Context Files\n`;
    claudeMd += `- Architecture graphs: @.arch/clusters/ (Key-Rel-Dep v2 notation)\n`;
    claudeMd += `- Package skills: @.arch/skills/ (WRONG/RIGHT/WHY gotchas)\n`;
    claudeMd += `- API contracts: @.arch/apis/ (type-signature digests)\n`;
    claudeMd += `- Full context routing: @.arch/INDEX.md\n`;

    const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
    if (fs.existsSync(claudeMdPath)) {
      console.log(`  ${C.yellow}${ICONS.warn}${C.reset} CLAUDE.md already exists — writing to CLAUDE.archkit.md instead`);
      fs.writeFileSync(path.join(projectRoot, "CLAUDE.archkit.md"), claudeMd);
      written.push({ path: "CLAUDE.archkit.md (project root)", size: claudeMd.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} CLAUDE.archkit.md ${C.dim}(${claudeMd.length} bytes — merge into your CLAUDE.md)${C.reset}`);
    } else {
      fs.writeFileSync(claudeMdPath, claudeMd);
      written.push({ path: "CLAUDE.md (project root)", size: claudeMd.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} CLAUDE.md ${C.dim}(${claudeMd.length} bytes)${C.reset}`);
    }

    const claudeRulesDir = path.join(projectRoot, ".claude", "rules");
    fs.mkdirSync(claudeRulesDir, { recursive: true });

    let archRule = `---\ndescription: "Architecture rules from archkit"\nalwaysApply: true\n---\n\n`;
    at.rules.forEach(r => archRule += `- ${r}\n`);
    fs.writeFileSync(path.join(claudeRulesDir, "architecture.md"), archRule);
    written.push({ path: ".claude/rules/architecture.md", size: archRule.length });
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/rules/architecture.md ${C.dim}(alwaysApply)${C.reset}`);

    for (const f of features) {
      let featureRule = `---\ndescription: "${f.name} architecture context"\n`;
      if (["saas", "ecommerce", "mobile"].includes(cfg.appType)) {
        featureRule += `globs: ["src/features/${f.id}/**"]\n`;
      } else if (cfg.appType === "realtime") {
        featureRule += `globs: ["src/handlers/${f.id}*", "src/domain/${f.id}*"]\n`;
      } else if (cfg.appType === "ai") {
        featureRule += `globs: ["src/chains/${f.id}*", "src/prompts/**/${f.id}*"]\n`;
      } else {
        featureRule += `globs: ["src/**/${f.id}*"]\n`;
      }
      featureRule += `alwaysApply: false\n---\n\n`;
      featureRule += `# ${f.name}\n\n`;
      featureRule += `Architecture graph: @.arch/clusters/${f.id}.graph\n\n`;
      const graphContent = genGraph(f, cfg);
      featureRule += `\`\`\`\n${graphContent}\`\`\`\n`;

      fs.writeFileSync(path.join(claudeRulesDir, `${f.id}.md`), featureRule);
      written.push({ path: `.claude/rules/${f.id}.md`, size: featureRule.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/rules/${f.id}.md ${C.dim}(path-targeted: src/features/${f.id}/**)${C.reset}`);
    }

    const claudeSkillsDir = path.join(projectRoot, ".claude", "skills");
    fs.mkdirSync(claudeSkillsDir, { recursive: true });

    for (const s of skills) {
      const sk = SKILL_CATALOG.find(c => c.id === s);
      if (!sk) continue;
      const skillDir = path.join(claudeSkillsDir, s);
      fs.mkdirSync(skillDir, { recursive: true });

      let skillMd = `---\nname: ${s}\ndescription: "${sk.name} patterns and gotchas for this project"\ntrigger: "When working with ${sk.name} (keywords: ${sk.keywords})"\n---\n\n`;
      skillMd += `# ${sk.name} Skill\n\n`;
      skillMd += `Full skill file: @.arch/skills/${s}.skill\n\n`;
      skillMd += `Load the skill file above for:\n`;
      skillMd += `- Package version and docs URL\n`;
      skillMd += `- Project-specific usage patterns\n`;
      skillMd += `- WRONG → RIGHT → WHY gotchas\n`;
      skillMd += `- Boundary definitions (what NOT to use this package for)\n`;
      skillMd += `- Reference code snippets\n`;

      fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd);
      written.push({ path: `.claude/skills/${s}/SKILL.md`, size: skillMd.length });
      console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/skills/${s}/SKILL.md`);
    }
  }

  // ── File previews ─────────────────────────────────────────────────────
  divider();
  heading(ICONS.file, "File Previews");

  filePreview("SYSTEM.md", sysContent);
  filePreview("INDEX.md", idxContent);

  if (features.length > 0) {
    const firstGraph = genGraph(features[0], cfg);
    filePreview(`clusters/${features[0].id}.graph`, firstGraph);
  }

  // ── Summary ───────────────────────────────────────────────────────────
  divider();
  heading(ICONS.star, "Done!");

  const totalBytes = written.reduce((s, f) => s + f.size, 0);
  console.log(`  ${C.bold}${written.length} files${C.reset} generated (${totalBytes.toLocaleString()} bytes total)`);
  console.log("");

  if (claudeMode) {
    subheading("Claude Code integration:");
    console.log("");
    console.log(`  ${C.green}${ICONS.check}${C.reset} CLAUDE.md at project root ${C.dim}— auto-loaded every session${C.reset}`);
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/rules/ ${C.dim}— path-targeted architecture rules, auto-loaded${C.reset}`);
    console.log(`  ${C.green}${ICONS.check}${C.reset} .claude/skills/ ${C.dim}— on-demand package knowledge${C.reset}`);
    console.log(`  ${C.green}${ICONS.check}${C.reset} .arch/ ${C.dim}— full context system (graphs, skills, APIs, lenses)${C.reset}`);
    console.log("");
  }

  subheading("Next steps:");
  console.log("");
  console.log(`  ${C.yellow}1.${C.reset} ${C.bold}Fill in .arch/skills/*.skill files with your team's gotchas${C.reset}`);
  info("     WRONG → RIGHT → WHY. Add them as you discover them.");
  console.log("");
  console.log(`  ${C.yellow}2.${C.reset} ${C.bold}Generate .arch/apis/*.api from your API specs${C.reset}`);
  info("     OpenAPI → .api conversion, or use MCP servers for live contracts.");
  console.log("");
  console.log(`  ${C.yellow}3.${C.reset} ${C.bold}Update .arch/INDEX.md cross-refs${C.reset}`);
  info("     Map which features depend on which other features.");
  console.log("");
  if (claudeMode) {
    console.log(`  ${C.yellow}4.${C.reset} ${C.bold}Start Claude Code — it will auto-load CLAUDE.md + rules.${C.reset} ${ICONS.rocket}`);
  } else {
    console.log(`  ${C.yellow}4.${C.reset} ${C.bold}Start coding with full context.${C.reset} ${ICONS.rocket}`);
    console.log("");
    tip("Run with --claude flag to also generate Claude Code native files (CLAUDE.md + .claude/rules/ + .claude/skills/)");
  }

  console.log("");
  divider();
  tip("Every time the AI generates wrong code, add a gotcha to the relevant .skill file.");
  tip("The system gets smarter as your team accumulates knowledge.");
  console.log("");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  banner();

  let state = createInitialState();
  let currentStep = 0;

  // Check for saved progress
  const saved = loadProgress();
  if (saved) {
    const completedLabels = saved.completedSteps.map(id => STEPS.find(s => s.id === id)?.label).filter(Boolean);
    console.log(`${C.yellow}  ${ICONS.file} Saved progress found${C.reset} ${C.dim}(${new Date(saved.savedAt).toLocaleString()})${C.reset}`);
    info(`  Completed: ${completedLabels.join(", ")}`);
    console.log("");

    const { resumeChoice } = await inquirer.prompt([{
      type: "list",
      name: "resumeChoice",
      message: "Resume or start fresh?",
      prefix: `  ${ICONS.arch}`,
      choices: [
        { name: `${C.green}${ICONS.arrow}${C.reset} Resume from where you left off`, value: "resume", short: "Resume" },
        { name: `${C.red}${ICONS.cross}${C.reset} Start fresh (discard saved progress)`, value: "fresh", short: "Fresh" },
      ],
    }]);

    if (resumeChoice === "resume") {
      Object.assign(state, saved.state);
      state._completedSteps = [...saved.completedSteps];
      // Find first incomplete step
      currentStep = STEPS.findIndex(s => !state._completedSteps.includes(s.id));
      if (currentStep === -1) currentStep = STEPS.length - 1; // all done, go to preview
      console.log("");
      success(`Resuming at: ${STEPS[currentStep].label}`);
    } else {
      deleteProgressFile();
    }
    console.log("");
  }

  // Main wizard loop
  while (currentStep < STEPS.length) {
    const step = STEPS[currentStep];

    // Show progress bar
    const filled = state._completedSteps.length;
    const total = STEPS.length;
    progressStep(filled, total, step.label);

    // Run the step
    const result = await step.run(state);
    Object.assign(state, result);

    // Preview step handles its own navigation
    if (step.id === "preview") {
      const previewAction = state._previewAction;
      delete state._previewAction;

      if (previewAction === "generate") {
        state._completedSteps.push(step.id);
        generateFiles(state);
        deleteProgressFile();
        break;
      } else if (previewAction === "back") {
        const targetId = await promptGoBack(state._completedSteps);
        invalidateFrom(targetId, state);
        state._completedSteps = state._completedSteps.filter(s => s !== targetId);
        currentStep = STEPS.findIndex(s => s.id === targetId);
        continue;
      } else if (previewAction === "save") {
        saveProgress(state);
        process.exit(0);
      } else if (previewAction === "exit") {
        const { confirmExit } = await inquirer.prompt([{
          type: "confirm", name: "confirmExit",
          message: "Are you sure? All progress will be lost.",
          default: false, prefix: `  ${ICONS.arch}`,
        }]);
        if (confirmExit) process.exit(0);
        continue; // re-show preview
      }
    }

    // Mark step complete
    if (!state._completedSteps.includes(step.id)) {
      state._completedSteps.push(step.id);
    }

    // Navigation prompt (not shown for last step — preview handles it)
    const action = await promptNavigation(currentStep);

    switch (action) {
      case "continue":
        currentStep++;
        break;
      case "back": {
        const targetId = await promptGoBack(state._completedSteps);
        invalidateFrom(targetId, state);
        state._completedSteps = state._completedSteps.filter(s => s !== targetId);
        currentStep = STEPS.findIndex(s => s.id === targetId);
        break;
      }
      case "save":
        saveProgress(state);
        process.exit(0);
        break;
      case "exit": {
        const { confirmExit } = await inquirer.prompt([{
          type: "confirm", name: "confirmExit",
          message: "Are you sure? All progress will be lost.",
          default: false, prefix: `  ${ICONS.arch}`,
        }]);
        if (confirmExit) process.exit(0);
        break; // stay on same step, re-show nav
      }
    }
  }
}

main().catch(err => {
  console.error(`\n${C.red}  Error: ${err.message}${C.reset}\n`);
  process.exit(1);
});
