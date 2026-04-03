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
  ],
  keycloak: [
    // Source: RFC 7519 — JSON Web Token, Keycloak docs — Token verification
    { wrong: "jwt.decode() without signature verification", right: "verify against JWKS endpoint (jose library or keycloak-connect)", why: "jwt.decode() does not verify the signature. Any party can forge a valid-looking token. Ref: RFC 7519 §7.2, Keycloak docs." },
    // Source: 12-Factor App — Config
    { wrong: "hardcoded realm/issuer URL", right: "KEYCLOAK_URL and KEYCLOAK_REALM from environment variables", why: "URLs differ per environment. Hardcoding breaks deployment to staging/production. Ref: 12-Factor App — Config." },
  ],
  docker: [
    // Source: Docker docs — Best practices for writing Dockerfiles
    { wrong: "FROM node:latest", right: "FROM node:20-alpine", why: "latest is mutable — builds are non-reproducible. Full image is ~1GB vs alpine ~150MB. Ref: Docker docs — Best practices §FROM." },
    // Source: Docker docs — Leverage build cache
    { wrong: "COPY . . before npm install", right: "COPY package*.json ./ && RUN npm ci && COPY . .", why: "Any source change invalidates npm install cache. Copy dependency files first. Ref: Docker docs — Leverage build cache." },
    // Source: npm docs — npm ci
    { wrong: "RUN npm install in production", right: "RUN npm ci --omit=dev", why: "npm install resolves ranges and modifies lockfile. npm ci is deterministic and faster. Ref: npm docs — npm ci." },
  ],
  jwt: [
    // Source: OWASP — JSON Web Token Cheat Sheet
    { wrong: "JWT in localStorage", right: "httpOnly cookie with Secure, SameSite=Strict flags", why: "localStorage is accessible via XSS (any injected script). httpOnly cookies are not accessible to JavaScript. Ref: OWASP JWT Cheat Sheet." },
    // Source: RFC 6749 — OAuth 2.0, OWASP — Session Management
    { wrong: "access token with long expiry (>1 hour)", right: "short access token (5-15 min) + refresh token with rotation", why: "Long-lived tokens cannot be revoked without infrastructure. Short-lived + refresh enables revocation. Ref: RFC 6749 §1.5, OWASP Session Management." },
  ],
};
