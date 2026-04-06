// Built-in gotchas — industry-standard patterns per package.
// Sources cited per entry. Only includes patterns backed by official
// documentation, RFCs, OWASP, or vendor best-practice guides.
// These are merged into generated .skill files during scaffold.

export const GOTCHA_DB = {
  postgres: [
    // Source: PostgreSQL docs — Connection Pooling, pg docs — Pool
    { wrong: "new Pool() per request", right: "const pool = new Pool(); // module-level singleton", why: "Each Pool opens connections up to max. Per-request pools exhaust pg max_connections (default 100). Ref: PostgreSQL docs §20.3." },
    // Source: OWASP SQL Injection Prevention Cheat Sheet
    { wrong: "string concatenation in queries: `WHERE id = ${id}`", right: "pool.query('WHERE id = $1', [id])", why: "SQL injection (OWASP A03:2021). Parameterized queries separate data from SQL. Ref: OWASP SQL Injection Prevention." },
    // Source: PostgreSQL docs — Performance Tips §14.1
    { wrong: "SELECT * FROM table", right: "SELECT id, name, email FROM table", why: "Fetches all columns including TOAST-stored text/bytea. Increases I/O and network transfer. Ref: PostgreSQL docs §14.1 — only retrieve needed columns." },
    // Source: PostgreSQL docs — Indexes §11, EXPLAIN documentation
    { wrong: "WHERE on unindexed column in large table", right: "CREATE INDEX idx_table_col ON table(col); SELECT ... WHERE col = $1", why: "Without index, PostgreSQL does sequential scan (O(n)). With B-tree index: O(log n). Ref: PostgreSQL docs §11.1." },
    // Source: PostgreSQL docs — LIKE pattern matching §9.7.1
    { wrong: "WHERE col LIKE '%value%' (leading wildcard)", right: "WHERE col LIKE 'value%' or CREATE INDEX ... USING gin(col gin_trgm_ops)", why: "Leading % prevents index usage — sequential scan. Prefix match uses index. pg_trgm extension enables indexed wildcard. Ref: PostgreSQL §9.7.1, §12.9." },
    // Source: PostgreSQL wiki — Pagination, Slack engineering blog
    { wrong: "OFFSET 10000 LIMIT 50 for deep pagination", right: "WHERE id > $cursor ORDER BY id LIMIT 50", why: "OFFSET scans and discards N rows before returning results. Cursor-based pagination is O(1). Ref: PostgreSQL wiki — Pagination Done the Right Way." },
    // Source: PostgreSQL docs — Aggregate Functions §9.21
    { wrong: "SELECT COUNT(*) FROM large_table (exact count for UI)", right: "SELECT reltuples::bigint FROM pg_class WHERE relname = 'table' (approximate)", why: "COUNT(*) requires full sequential scan or index-only scan. pg_class.reltuples is updated by ANALYZE and is O(1). Ref: PostgreSQL §28.1. Note: reltuples can be stale — run ANALYZE periodically." },
    // Source: PostgreSQL docs — SELECT FOR UPDATE §13.3.2
    { wrong: "read-then-write without locking (lost update)", right: "SELECT ... FOR UPDATE (row-level lock) or use serializable isolation", why: "Concurrent read-then-write causes lost updates. FOR UPDATE locks the row until transaction commits. Ref: PostgreSQL §13.3.2." },
    // Source: PostgreSQL docs — SET LOCAL, set_config()
    { wrong: "SET LOCAL app.tenant_id = $1 (parameter binding in SET LOCAL)", right: "SELECT set_config('app.tenant_id', $1, true)", why: "SET LOCAL doesn't support parameter binding — $1 is treated as literal text. set_config() accepts parameters. Third arg true = transaction-local. Ref: PostgreSQL docs — set_config()." },
  ],
  prisma: [
    // Source: Prisma docs — Connection Management, Best Practices
    { wrong: "new PrismaClient() in hot-reloaded module", right: "globalThis.prisma ??= new PrismaClient()", why: "Dev hot-reload creates new client per reload, each opening a connection pool. Ref: Prisma docs — Best practice for instantiating PrismaClient with Next.js." },
    // Source: Prisma docs — Select Fields
    { wrong: "prisma.user.findMany() without select", right: "prisma.user.findMany({ select: { id: true, name: true } })", why: "Returns all scalar fields by default. Select only needed columns to reduce data transfer. Ref: Prisma docs — Select fields." },
    // Source: Prisma docs — Transactions
    { wrong: "sequential writes without $transaction", right: "prisma.$transaction([prisma.user.create(...), prisma.profile.create(...)])", why: "Without transaction, partial failure leaves inconsistent state. Ref: Prisma docs — Transactions and batch queries." },
    // Source: Prisma docs — Pagination
    { wrong: "prisma.findMany({ skip: 10000 })", right: "prisma.findMany({ cursor: { id: lastId }, take: 50 })", why: "skip translates to SQL OFFSET — same performance problem. Use cursor-based pagination. Ref: Prisma docs — Cursor-based pagination." },
    // Source: Prisma docs — Relations, performance
    { wrong: "include: { posts: true } without limit", right: "include: { posts: { take: 20, orderBy: { createdAt: 'desc' } } }", why: "Loads ALL related records. A user with 50K posts returns 50K rows. Ref: Prisma docs — Relation queries." },
  ],
  drizzle: [
    // Source: Drizzle docs — Select, Performance
    { wrong: "db.select().from(users)", right: "db.select({ id: users.id, name: users.name }).from(users)", why: "Empty select() is SELECT *. Specify columns. Ref: Drizzle docs — Partial select." },
    // Source: Drizzle docs — Transactions
    { wrong: "sequential db.insert() without transaction", right: "await db.transaction(async (tx) => { ... })", why: "Sequential writes without transaction risk partial failure. Ref: Drizzle docs — Transactions." },
  ],
  stripe: [
    // Source: Stripe docs — Webhook Signatures
    { wrong: "req.body for webhook signature verification", right: "req.rawBody or raw buffer (before body-parser)", why: "Body-parser modifies the payload. Stripe signature verification requires the raw request body. Ref: Stripe docs — Check the webhook signatures." },
    // Source: Stripe docs — Idempotent Requests
    { wrong: "charge/payment intent without idempotency key", right: "stripe.paymentIntents.create({...}, { idempotencyKey: key })", why: "Network retries without idempotency key can create duplicate charges. Ref: Stripe docs — Idempotent requests." },
    // Source: PCI DSS v4.0 — Requirement 3
    { wrong: "storing card numbers in application database", right: "store only Stripe customer_id and payment_method_id", why: "PCI DSS Requirement 3: protect stored account data. Let Stripe (PCI Level 1) handle card storage. Ref: PCI DSS v4.0." },
  ],
  bullmq: [
    // Source: BullMQ docs — Connections
    { wrong: "new Queue('name') per file", right: "export const queue = new Queue('name', { connection }); // shared", why: "Each Queue opens a Redis connection. Share instances. Ref: BullMQ docs — Connections." },
    // Source: BullMQ docs — Retrying failing jobs
    { wrong: "jobs without retry configuration", right: "defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }", why: "Without retries, transient failures (network, timeout) cause permanent job loss. Ref: BullMQ docs — Retrying failing jobs." },
    // Source: BullMQ docs — Workers, Concurrency
    { wrong: "Worker without concurrency setting", right: "new Worker('name', handler, { concurrency: 10 })", why: "Default concurrency is 1. Set explicitly based on downstream capacity. Ref: BullMQ docs — Concurrency." },
    // Source: BullMQ docs — Jobs, Redis memory management
    { wrong: "large payload (>50KB) in job.data", right: "store in object storage, pass URL in job.data", why: "Redis stores entire job in memory. Large payloads increase memory and serialization time. Ref: BullMQ docs — Best practices." },
    // Source: BullMQ docs — Job IDs
    { wrong: "adding duplicate jobs without jobId", right: "queue.add('task', data, { jobId: `task-${uniqueId}` })", why: "Without jobId, duplicate enqueues create duplicate jobs. jobId makes add() idempotent. Ref: BullMQ docs — Job IDs." },
    // Source: BullMQ docs — Graceful shutdown
    { wrong: "process.exit() without draining workers", right: "await worker.close(); // waits for active jobs to finish, then shuts down", why: "Killing workers mid-job leaves jobs in active state (stuck). close() drains gracefully. Ref: BullMQ docs — Graceful shutdown." },
    // Source: BullMQ docs — Events, Stalled jobs
    { wrong: "no stalled job handling", right: "new Worker('name', handler, { stalledInterval: 30000, maxStalledCount: 2 })", why: "If a worker crashes mid-job, the job stalls. Without stalled check interval, it stays stuck forever. Ref: BullMQ docs — Stalled jobs." },
    // Source: At-least-once delivery — distributed systems (Kleppmann, Designing Data-Intensive Applications §11)
    { wrong: "non-idempotent job handler (side effects on retry)", right: "check if action already completed before executing: if (await alreadyProcessed(job.id)) return;", why: "Jobs can be delivered more than once (at-least-once). Handlers must be idempotent. Ref: Kleppmann DDIA §11 — Message delivery guarantees." },
    // Source: BullMQ docs — Rate limiting
    { wrong: "no rate limiting on queue that calls external APIs", right: "new Queue('api-calls', { limiter: { max: 10, duration: 1000 } })", why: "Without rate limiting, burst of jobs can exceed external API rate limits (429 errors). Ref: BullMQ docs — Rate limiting." },
    // Source: Kubernetes docs — Liveness/Readiness probes
    { wrong: "no health check on queue connection", right: "expose /health endpoint that checks queue.client.status === 'ready'", why: "If Redis connection drops, workers silently stop processing. Health check enables orchestrator restart. Ref: BullMQ docs — Events, Kubernetes — Configure Liveness." },
  ],
  valkey: [
    // Source: Redis docs — SET, Key expiration
    { wrong: "SET without TTL", right: "SET key value EX 3600", why: "Keys without TTL persist forever. Memory grows until eviction or OOM. Ref: Redis docs — EXPIRE." },
    // Source: Redis docs — KEYS command warning
    { wrong: "KEYS * in production", right: "SCAN 0 MATCH pattern COUNT 100", why: "KEYS is O(N) and blocks the server. SCAN is cursor-based and non-blocking. Ref: Redis docs — KEYS: 'Don't use KEYS in production.'" },
    // Source: Redis docs — UNLINK
    { wrong: "DEL on large key (>1MB)", right: "UNLINK key", why: "DEL is synchronous — blocks Redis for large keys. UNLINK frees memory asynchronously. For small keys DEL is fine. Ref: Redis docs — UNLINK." },
    // Source: Redis docs — Distributed Locks, Redlock
    { wrong: "SET lock without NX and EX", right: "SET lock:resource token NX EX 30", why: "Without NX, SET overwrites existing locks. Without EX, a crashed holder keeps the lock forever. Ref: Redis docs — Distributed Locks." },
    // Source: Redis docs — Pub/Sub, Persistence
    { wrong: "Redis as sole data store (no persistence backup)", right: "Redis for cache/sessions/pub-sub. Persistent DB (PostgreSQL) as source of truth.", why: "Default Redis has no durability guarantee. AOF/RDB provide persistence but with trade-offs. Ref: Redis docs — Persistence." },
    // Source: Redis docs — Key namespacing conventions
    { wrong: "flat cache key without namespace", right: "cache key: feature:entity:id (e.g., user:123:profile)", why: "Flat keys risk collision across features. Colon-separated namespacing is Redis convention. Ref: Redis docs — Data types tutorial." },
    // Source: Microsoft — Cache-Aside pattern, AWS — Caching Best Practices
    { wrong: "no fallback when cache is down", right: "try { value = await cache.get(key); } catch { value = await db.query(...); } // circuit breaker", why: "If cache is down and app crashes instead of falling back to DB, a cache failure becomes a full outage. Ref: Microsoft — Cache-Aside pattern." },
    // Source: Facebook — Scaling Memcache, cache stampede literature
    { wrong: "no stampede protection on hot keys", right: "use lock-based recompute: SET key value NX EX 5 → if locked, serve stale → recompute → update", why: "When a hot key expires, all concurrent requests hit DB simultaneously (thundering herd). Lock recompute so only one request rebuilds. Ref: Facebook — Scaling Memcache at Facebook." },
    // Source: Redis docs — Maxmemory, Eviction policies
    { wrong: "no maxmemory or eviction policy configured", right: "maxmemory 256mb + maxmemory-policy allkeys-lru", why: "Without maxmemory, Redis grows until OS OOM-kills it. Set a limit + eviction policy. Ref: Redis docs — Using Redis as an LRU cache." },
    // Source: Kubernetes — Container probes
    { wrong: "no health check on Redis connection", right: "expose /health that runs redis.ping() with timeout", why: "Silent Redis disconnects cause stale reads or timeouts. Health probe enables orchestrator restart. Ref: Redis docs — PING, Kubernetes — Configure Liveness." },
    // Source: JSON serialization — Date handling
    { wrong: "calling .toISOString() on event payload dates after pub/sub", right: "check instanceof Date first: const d = payload.date instanceof Date ? payload.date : new Date(payload.date)", why: "JSON.parse returns strings for Date values. Calling .toISOString() on a string crashes. Events through Valkey pub/sub lose Date types. Ref: MDN — JSON.parse." },
  ],
  keycloak: [
    // Source: RFC 7519 — JSON Web Token, Keycloak docs — Token verification
    { wrong: "jwt.decode() without signature verification", right: "verify against JWKS endpoint (jose library or keycloak-connect)", why: "jwt.decode() does not verify the signature. Any party can forge a valid-looking token. Ref: RFC 7519 §7.2, Keycloak docs." },
    // Source: 12-Factor App — Config
    { wrong: "hardcoded realm/issuer URL", right: "KEYCLOAK_URL and KEYCLOAK_REALM from environment variables", why: "URLs differ per environment. Hardcoding breaks deployment to staging/production. Ref: 12-Factor App — Config." },
    // Source: Keycloak docs — Reverse Proxy, production deployment
    { wrong: "Keycloak behind reverse proxy without forwarded headers", right: "send X-Forwarded-Proto: https and X-Forwarded-Host from proxy; use --proxy-headers=forwarded on Keycloak", why: "Without forwarded headers, Keycloak doesn't set Secure cookies and generates wrong redirect URLs. Ref: Keycloak docs — Reverse Proxy." },
    // Source: Keycloak docs — check-sso, browser third-party cookie policies
    { wrong: "check-sso with iframe when auth domain differs from app domain", right: "disable check-sso and silentCheckSsoRedirectUri; use explicit login redirect", why: "Modern browsers block third-party cookies. check-sso iframe fails silently when auth domain ≠ app domain. Ref: Keycloak docs — SSO, Chrome third-party cookie deprecation." },
    // Source: Keycloak docs — Bootstrap admin
    { wrong: "creating permanent admin user without assigning admin role first", right: "assign admin realm role to new user BEFORE or immediately after creation", why: "Keycloak deletes the bootstrap admin once a permanent user is created. If the new user lacks admin role, you're locked out. Ref: Keycloak docs — Admin bootstrap." },
  ],
  docker: [
    // Source: Docker docs — Best practices for writing Dockerfiles
    { wrong: "FROM node:latest", right: "FROM node:20-alpine", why: "latest is mutable — builds are non-reproducible. Full image is ~1GB vs alpine ~150MB. Ref: Docker docs — Best practices §FROM." },
    // Source: Docker docs — Leverage build cache
    { wrong: "COPY . . before npm install", right: "COPY package*.json ./ && RUN npm ci && COPY . .", why: "Any source change invalidates npm install cache. Copy dependency files first. Ref: Docker docs — Leverage build cache." },
    // Source: npm docs — npm ci
    { wrong: "RUN npm install in production", right: "RUN npm ci --omit=dev", why: "npm install resolves ranges and modifies lockfile. npm ci is deterministic and faster. Ref: npm docs — npm ci." },
    // Source: Docker docs — USER instruction, OWASP Docker Security
    { wrong: "running container as root (no USER instruction)", right: "USER node (after creating node user or using node:alpine which has it)", why: "Root in container = root-equivalent if container is compromised. Ref: OWASP Docker Security, Docker docs — USER." },
    // Source: Next.js docs — Environment Variables
    { wrong: "NEXT_PUBLIC_* vars in docker-compose environment (not build args)", right: "declare as ARG in Dockerfile build stage, set as ENV before 'next build'", why: "NEXT_PUBLIC_* are baked at build time, not runtime. Docker Compose 'environment' is runtime only. Ref: Next.js docs — Environment Variables." },
    // Source: Monorepo build tooling — TypeScript project references
    { wrong: "Dockerfile CMD path assumes flat output (dist/src/...)", right: "check actual compiled path: tsc with rootDir='../../' outputs to dist/apps/api/src/...", why: "TypeScript rootDir affects output directory structure. Monorepo compiled paths differ from single-project. Verify with 'tsc --showConfig'. Ref: TypeScript docs — rootDir." },
    // Source: MinIO docs — TLS configuration
    { wrong: "MinIO client with useSSL based on NODE_ENV when MinIO is behind internal proxy", right: "match useSSL to actual MinIO protocol: useSSL: false for internal HTTP, even in production", why: "MinIO often serves plain HTTP internally with TLS terminated at the proxy. useSSL: true → EPROTO crash. Ref: MinIO docs — Network Encryption." },
  ],
  hono: [
    // Source: Hono docs — Routing
    { wrong: "route order: /configs/:id before /configs/mine", right: "specific routes first: /configs/mine before /configs/:id", why: "Hono matches routes in order. /configs/:id matches 'mine' as a parameter. Specific routes must come before parameterized. Ref: Hono docs — Routing." },
    // Source: Hono docs — Middleware
    { wrong: "middleware applied after route definition", right: "app.use('*', middleware) BEFORE app.get/post/etc.", why: "Middleware must be registered before routes to intercept requests. After registration order matters. Ref: Hono docs — Middleware." },
    // Source: Hono docs — CORS
    { wrong: "app.use('*', cors()) with no origin config", right: "cors({ origin: ['https://yourdomain.com'], credentials: true })", why: "Default CORS allows all origins. In production, restrict to your domains. Ref: Hono docs — CORS, OWASP A05:2021." },
    // Source: Hono docs — Error Handling
    { wrong: "no global error handler", right: "app.onError((err, c) => { logger.error(err); return c.json({ error: 'Internal Error' }, 500); })", why: "Without onError, unhandled exceptions return default error with stack trace. Ref: Hono docs — Error Handling." },
    // Source: Hono docs — Routing, app.route()
    { wrong: "authed sub-app middleware blocks public routes when mounted on same prefix", right: "mount public routes BEFORE authed routes, or use separate prefixes (/api/public vs /api/authed)", why: "app.route('/api', authed) applies authed middleware to ALL /api/* routes including public ones. Hono doesn't fall through between app.route() mounts. Ref: Hono docs — Routing." },
  ],
  express: [
    // Source: Express docs — Error handling
    { wrong: "error handler with 3 params instead of 4", right: "app.use((err, req, res, next) => { ... }) — must have 4 params", why: "Express identifies error middleware by the 4-parameter signature. 3 params makes it a regular middleware. Ref: Express docs — Error handling." },
    // Source: Express docs — Security Best Practices
    { wrong: "app.use(express.json()) with no size limit", right: "app.use(express.json({ limit: '100kb' }))", why: "Without limit, a single request can send a multi-GB JSON payload and crash the server (DoS). Ref: Express Security Best Practices." },
    // Source: Express docs — req.body
    { wrong: "accessing req.body without verifying Content-Type", right: "use express.json() middleware — it rejects non-JSON bodies automatically", why: "Without body-parser, req.body is undefined. With it but wrong Content-Type, req.body is empty. Ref: Express docs — req.body." },
  ],
  eventbus: [
    // Source: Distributed systems — pub/sub semantics
    { wrong: "emitLocal() in production services (bypasses pub/sub)", right: "emit() — uses Valkey pub/sub for cross-process delivery, falls back to local when unavailable", why: "emitLocal() only reaches handlers in the same process. In multi-process/multi-server deployments, events are silently lost. Ref: Valkey pub/sub docs." },
    // Source: Event-driven architecture — event sourcing patterns
    { wrong: "registering event handlers with no corresponding emitter", right: "verify every bus.on('event') has a matching emit('event') somewhere in the codebase", why: "Handlers without emitters are dead code. They pass tests but never execute in production. Cross-reference emitters and subscribers." },
    // Source: Distributed systems — idempotent consumers
    { wrong: "event handler with side effects that isn't idempotent", right: "check if already processed: if (await isProcessed(event.id)) return;", why: "Events can be delivered more than once (at-least-once delivery). Handlers must be idempotent. Ref: Kleppmann DDIA §11." },
  ],
  jwt: [
    // Source: OWASP — JSON Web Token Cheat Sheet
    { wrong: "JWT in localStorage", right: "httpOnly cookie with Secure, SameSite=Strict flags", why: "localStorage is accessible via XSS (any injected script). httpOnly cookies are not accessible to JavaScript. Ref: OWASP JWT Cheat Sheet." },
    // Source: RFC 6749 — OAuth 2.0, OWASP — Session Management
    { wrong: "access token with long expiry (>1 hour)", right: "short access token (5-15 min) + refresh token with rotation", why: "Long-lived tokens cannot be revoked without infrastructure. Short-lived + refresh enables revocation. Ref: RFC 6749 §1.5, OWASP Session Management." },
  ],
  api: [
    // Source: RFC 7231 — HTTP/1.1 Semantics and Content §6
    { wrong: "returning 200 for all responses with { success: false } in body", right: "use correct HTTP status codes: 201 Created, 400 Bad Request, 404 Not Found, 409 Conflict, 422 Unprocessable Entity", why: "HTTP clients, proxies, and CDNs rely on status codes for caching, retry, and routing decisions. Ref: RFC 7231 §6." },
    // Source: RFC 9457 — Problem Details for HTTP APIs (supersedes RFC 7807)
    { wrong: "inconsistent error response shapes: { error: 'msg' } vs { message: 'msg' } vs string", right: "{ type: 'about:blank', title: 'Not Found', status: 404, detail: 'User 123 not found' } — RFC 9457 Problem Details", why: "Inconsistent error shapes force every client to handle multiple formats. RFC 9457 standardizes error responses. Ref: RFC 9457." },
    // Source: IETF RFC 6585 — Additional HTTP Status Codes (429)
    { wrong: "no rate limiting on public API endpoints", right: "return 429 Too Many Requests with Retry-After header", why: "Without rate limiting, a single client can exhaust server resources. 429 + Retry-After is the standard response. Ref: RFC 6585 §4." },
    // Source: Google API Design Guide — Standard Methods
    { wrong: "POST /getUsers, POST /deleteUser", right: "GET /users, DELETE /users/:id — use HTTP methods as verbs", why: "REST uses HTTP methods (GET/POST/PUT/DELETE) as verbs. Endpoints are nouns. Ref: Google API Design Guide — Standard methods." },
    // Source: RFC 7231 §4.2.2 — Idempotent Methods
    { wrong: "PUT/DELETE endpoints with side effects that aren't idempotent", right: "PUT and DELETE must produce the same result when called multiple times", why: "PUT and DELETE are defined as idempotent by RFC 7231 §4.2.2. Network retries depend on this guarantee." },
    // Source: RFC 8288 — Web Linking, cursor-based pagination
    { wrong: "pagination with no total count or next page indicator", right: "return { data: [...], pagination: { total, page, pageSize, hasNext } } or Link headers", why: "Clients need to know if more pages exist. Standard patterns: RFC 8288 Link header or envelope with pagination metadata." },
    // Source: Semver, Stripe API versioning
    { wrong: "breaking API changes without versioning", right: "version via URL prefix (/v1/, /v2/) or Accept header (application/vnd.api+json;version=2)", why: "Breaking changes without versioning break all existing clients simultaneously. Ref: Stripe — API versioning." },
  ],
  errors: [
    // Source: Node.js docs — Error handling, MDN — Promise
    { wrong: "async function without try/catch or .catch()", right: "wrap async handlers: try { await logic(); } catch (err) { next(err); }", why: "Unhandled promise rejections crash Node.js (--unhandled-rejections=throw is default since v15). Ref: Node.js docs — Errors." },
    // Source: RFC 9457 — Problem Details
    { wrong: "throw new Error('something went wrong') — generic string errors", right: "throw new NotFoundError('User', userId) — typed error classes with context", why: "Generic errors lose context. Typed errors enable centralized handling with correct HTTP status codes. Ref: OWASP Error Handling." },
    // Source: OWASP — Error Handling Cheat Sheet
    { wrong: "catch (err) { } — swallowing errors silently", right: "catch (err) { logger.error('context', { error: err, requestId }); throw err; }", why: "Swallowed errors are invisible bugs. Always log with context and either re-throw or handle explicitly. Ref: OWASP Error Handling Cheat Sheet." },
    // Source: OWASP — Error Handling, information leakage
    { wrong: "res.status(500).json({ error: err.message, stack: err.stack })", right: "res.status(500).json({ type: 'internal_error', title: 'Internal Server Error' }) — log full error server-side", why: "Stack traces expose internals (file paths, versions, dependencies). Log server-side, return generic message to client. Ref: OWASP — Improper Error Handling." },
    // Source: Express docs — Error handling middleware
    { wrong: "error handling in every route handler", right: "centralized error middleware: app.use((err, req, res, next) => { ... })", why: "Duplicated try/catch in every route is fragile. Centralized error middleware handles all errors consistently. Ref: Express docs — Error handling." },
  ],
  http_client: [
    // Source: AWS SDK Best Practices — Timeouts
    { wrong: "fetch() or axios() without timeout", right: "fetch(url, { signal: AbortSignal.timeout(5000) }) or axios({ timeout: 5000 })", why: "Without timeout, a hung upstream service blocks your thread indefinitely. Always set connect + read timeout. Ref: AWS SDK — Timeouts and HTTP client best practices." },
    // Source: Microsoft — Circuit Breaker pattern
    { wrong: "retrying failed HTTP requests immediately in a tight loop", right: "exponential backoff: delay = Math.min(baseDelay * 2^attempt, maxDelay) + jitter", why: "Immediate retries amplify load on a failing service. Exponential backoff with jitter spreads retry load. Ref: AWS — Exponential Backoff and Jitter." },
    // Source: Microsoft — Circuit Breaker pattern (Cloud Design Patterns)
    { wrong: "no circuit breaker on external API calls", right: "use circuit breaker: after N consecutive failures, stop calling for cooldown period", why: "Continuing to call a failing service wastes resources and delays recovery. Circuit breaker fails fast. Ref: Microsoft — Circuit Breaker pattern." },
    // Source: IETF — Retry-After header (RFC 7231 §7.1.3)
    { wrong: "ignoring Retry-After header on 429/503 responses", right: "if (res.status === 429) { await sleep(res.headers.get('Retry-After') * 1000); retry(); }", why: "Retry-After tells you exactly when to retry. Ignoring it wastes requests and may get you banned. Ref: RFC 7231 §7.1.3." },
    // Source: Node.js docs — HTTP Agent, Keep-Alive
    { wrong: "creating new HTTP connection per request (no keep-alive)", right: "const agent = new http.Agent({ keepAlive: true, maxSockets: 50 })", why: "TCP + TLS handshake per request adds ~100ms latency. Keep-alive reuses connections. Ref: Node.js docs — http.Agent." },
  ],
  deployment: [
    // Source: Kubernetes — Container probes, 12-Factor App §9
    { wrong: "no health check endpoint", right: "GET /health returns { status: 'ok', checks: { db: 'connected', cache: 'connected' } }", why: "Without health checks, orchestrators can't detect failures or route traffic away from unhealthy instances. Ref: Kubernetes — Configure Liveness, Readiness." },
    // Source: 12-Factor App §9 — Disposability
    { wrong: "no graceful shutdown (process just dies on SIGTERM)", right: "process.on('SIGTERM', async () => { server.close(); await db.disconnect(); await cache.quit(); process.exit(0); })", why: "SIGTERM is sent on deploy/scale-down. Without graceful shutdown, in-flight requests fail. Ref: 12-Factor App §9 — Disposability." },
    // Source: Kubernetes — Rolling Update Strategy
    { wrong: "deploying by killing all instances and starting new ones", right: "rolling update: maxUnavailable: 0, maxSurge: 1 — zero-downtime deployment", why: "Replacing all instances at once causes downtime. Rolling update ensures at least one instance is always serving. Ref: Kubernetes — Rolling Update." },
    // Source: OWASP — Docker Security Cheat Sheet
    { wrong: "running container as root user", right: "USER node (in Dockerfile) — run as non-root", why: "Root in container = root-equivalent if container is compromised. Run as non-root. Ref: OWASP Docker Security, Docker — Best practices §USER." },
    // Source: 12-Factor App §7 — Port Binding
    { wrong: "hardcoded port: app.listen(3000)", right: "app.listen(process.env.PORT || 3000)", why: "Port must be configurable for container orchestration. Multiple instances can't bind the same port. Ref: 12-Factor App §7." },
  ],
  concurrency: [
    // Source: PostgreSQL §13.4 — Serialization Failure Handling
    { wrong: "read-modify-write without optimistic locking", right: "UPDATE table SET col = newVal, version = version + 1 WHERE id = $1 AND version = $2 — check rowCount", why: "Concurrent read-modify-write causes lost updates. Optimistic locking detects conflicts via version column. Ref: PostgreSQL §13.4." },
    // Source: Stripe — Idempotent Requests
    { wrong: "non-idempotent mutation endpoints (POST /charge called twice = double charge)", right: "accept Idempotency-Key header: if (await isDuplicate(key)) return cachedResponse;", why: "Network retries, user double-clicks, and queue redelivery all cause duplicate calls. Idempotency keys prevent duplicate side effects. Ref: Stripe — Idempotent Requests, IETF draft-ietf-httpapi-idempotency-key." },
    // Source: PostgreSQL §13.3.2 — Row-Level Locks
    { wrong: "check-then-act without locking (TOCTOU race condition)", right: "SELECT ... FOR UPDATE within a transaction — lock the row before checking", why: "Between your SELECT and UPDATE, another transaction can modify the row. FOR UPDATE serializes access. Ref: PostgreSQL §13.3.2." },
    // Source: Redis docs — Distributed Locks with SET NX
    { wrong: "distributed locking with SETNX without expiry or token", right: "SET lock:resource $token NX EX 30 — release only if token matches (compare-and-delete)", why: "Lock without expiry: crash = permanent lock. Lock without token: any process can release it. Ref: Redis — Distributed Locks, Martin Kleppmann — lock analysis." },
  ],
  logging: [
    // Source: OWASP — Logging Cheat Sheet
    { wrong: "console.log('user logged in', user)", right: "logger.info('user_login', { userId: user.id, ip: req.ip, timestamp: new Date().toISOString() })", why: "console.log is unstructured — can't query, filter, or alert. Use structured logging (JSON) with context. Ref: OWASP Logging Cheat Sheet." },
    // Source: OWASP — Logging Cheat Sheet §What to Log
    { wrong: "logger.info('Login', { email: user.email, password: req.body.password })", right: "logger.info('Login', { userId: user.id }) — never log PII or credentials", why: "Logs are often stored unencrypted and accessible to ops teams. PII in logs violates GDPR. Ref: OWASP Logging Cheat Sheet." },
    // Source: OpenTelemetry — Context Propagation
    { wrong: "log statements without request/correlation ID", right: "logger.info('action', { requestId: req.id, ...data })", why: "Without correlation ID, you can't trace a request across services or logs. Ref: OpenTelemetry — Context propagation." },
    // Source: 12-Factor App §11 — Logs
    { wrong: "writing logs to local files (fs.writeFileSync('app.log', ...))", right: "write to stdout/stderr — let the platform (Docker, K8s) handle collection", why: "Log files fill disks, need rotation, and aren't accessible in containers. 12-Factor: treat logs as event streams. Ref: 12-Factor App §11." },
    // Source: Pino/Winston docs — Log Levels
    { wrong: "using console.log for everything (no log levels)", right: "logger.debug() for dev, logger.info() for operations, logger.error() for failures", why: "Without levels, production logs are flooded with debug output. Levels enable filtering by environment. Ref: RFC 5424 — Syslog severity levels." },
  ],
  security: [
    // Source: OWASP A01:2021 — Broken Access Control
    { wrong: "checking permissions only in the frontend (UI hides buttons)", right: "enforce authorization server-side on every request: if (!user.can('delete', resource)) throw ForbiddenError()", why: "Frontend checks are bypassable with browser devtools or direct API calls. Ref: OWASP A01:2021 — Broken Access Control." },
    // Source: OWASP — CSRF Prevention Cheat Sheet
    { wrong: "no CSRF protection on state-changing requests", right: "use CSRF token (Synchronizer Token Pattern) or SameSite=Strict cookies", why: "Without CSRF protection, malicious sites can submit forms on behalf of authenticated users. Ref: OWASP — CSRF Prevention Cheat Sheet." },
    // Source: OWASP — HTTP Security Response Headers
    { wrong: "no security headers in HTTP responses", right: "set Content-Security-Policy, X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Strict-Transport-Security", why: "Security headers prevent XSS, clickjacking, and MIME sniffing attacks. Ref: OWASP — HTTP Security Response Headers Cheat Sheet." },
    // Source: OWASP A06:2021 — Vulnerable and Outdated Components
    { wrong: "no dependency vulnerability scanning", right: "run npm audit or snyk test in CI pipeline on every PR", why: "Known vulnerabilities in dependencies are the #6 OWASP risk. Automated scanning catches them before deploy. Ref: OWASP A06:2021." },
    // Source: OWASP — Input Validation Cheat Sheet
    { wrong: "rendering user input as HTML without sanitization", right: "sanitize with DOMPurify (frontend) or isomorphic-dompurify (server): DOMPurify.sanitize(userInput)", why: "Unsanitized HTML enables XSS (stored, reflected, DOM-based). Ref: OWASP — Input Validation Cheat Sheet, OWASP A03:2021." },
    // Source: OWASP — REST Security Cheat Sheet
    { wrong: "API endpoint that returns different data based on existence (user enumeration)", right: "return same response shape and timing for exists/not-exists: 'Invalid credentials' for both", why: "Different responses for 'user not found' vs 'wrong password' enable user enumeration attacks. Ref: OWASP — Authentication Cheat Sheet." },
  ],
  config: [
    // Source: 12-Factor App §3 — Config
    { wrong: "hardcoded configuration values: const DB_HOST = 'localhost'", right: "const DB_HOST = process.env.DB_HOST ?? throwEnvError('DB_HOST')", why: "Config varies between environments. Hardcoding breaks deployment. Ref: 12-Factor App §3 — Store config in the environment." },
    // Source: 12-Factor App §3, fail-fast principle
    { wrong: "process.env.SECRET_KEY || 'default-secret'", right: "if (!process.env.SECRET_KEY) throw new Error('SECRET_KEY is required') — fail at startup", why: "Default secrets create false security. App should crash at startup if required config is missing. Ref: 12-Factor App §3." },
    // Source: OWASP — Secrets Management Cheat Sheet
    { wrong: ".env file committed to git", right: ".env in .gitignore, .env.example committed with placeholder values", why: "Committed .env files expose secrets in git history (even after removal). Ref: OWASP — Secrets Management Cheat Sheet." },
    // Source: Node.js best practices — config validation
    { wrong: "reading process.env throughout the codebase", right: "validate all env vars at startup with zod/joi: const config = envSchema.parse(process.env)", why: "Scattered env reads fail at runtime when a var is missing. Validate once at startup, export typed config. Ref: 12-Factor App §3, Zod docs." },
  ],
};
