// Built-in gotchas — common LLM mistakes per package.
// These are merged into generated .skill files during scaffold.
export const GOTCHA_DB = {
  postgres: [
    { wrong: "new Pool() per request", right: "const pool = new Pool(); // module-level singleton", why: "Creates a new connection pool per request. Exhausts max_connections within minutes under load." },
    { wrong: "SELECT * FROM users", right: "SELECT id, name, email FROM users", why: "SELECT * fetches all columns including large text/blob fields. Wastes bandwidth and memory." },
    { wrong: "string concatenation in queries: `WHERE id = ${id}`", right: "pool.query('WHERE id = $1', [id])", why: "SQL injection. Always use parameterized queries." },
  ],
  prisma: [
    { wrong: "new PrismaClient()", right: "globalThis.prisma ??= new PrismaClient()", why: "Serverless/dev hot-reload creates new instance per request. Exhausts connection pool." },
    { wrong: "prisma.user.findMany()", right: "prisma.user.findMany({ select: { id: true, name: true } })", why: "Without select/include, Prisma returns all scalar fields. Over-fetching wastes bandwidth." },
    { wrong: "await prisma.user.create(); await prisma.profile.create();", right: "await prisma.$transaction([prisma.user.create(...), prisma.profile.create(...)])", why: "Multiple writes without a transaction can leave data in an inconsistent state on failure." },
  ],
  stripe: [
    { wrong: "req.body for webhook verification", right: "req.rawBody (Express) or raw buffer", why: "Express/body-parser parses JSON before Stripe can verify the signature. Stripe needs the raw bytes." },
    { wrong: "stripe.charges.create() without idempotencyKey", right: "stripe.charges.create({...}, { idempotencyKey: req.headers['idempotency-key'] })", why: "Network retries can cause duplicate charges. Idempotency keys prevent double-billing." },
    { wrong: "storing card numbers in your database", right: "store only Stripe customer ID and payment method ID", why: "PCI compliance. Never store raw card data. Let Stripe handle it." },
  ],
  bullmq: [
    { wrong: "new Queue('name') in every file that enqueues", right: "export const myQueue = new Queue('name', { connection }); // shared singleton", why: "Each Queue instance creates a Redis connection. Shared instance reuses the connection." },
    { wrong: "job.data without validation", right: "const data = schema.parse(job.data)", why: "Jobs can be enqueued from anywhere. Validate data shape at the worker to catch stale/malformed jobs." },
  ],
  valkey: [
    { wrong: "JSON.stringify for all cache values", right: "Use msgpack or store primitives directly", why: "JSON.stringify is slow for large objects. For simple values (counters, flags), store directly." },
    { wrong: "no TTL on cache keys", right: "SET key value EX 3600", why: "Keys without TTL accumulate forever. Memory grows until OOM. Always set expiration." },
    { wrong: "DEL key (synchronous delete)", right: "UNLINK key (async delete)", why: "DEL blocks Redis for large keys. UNLINK frees memory in the background." },
  ],
  keycloak: [
    { wrong: "validating JWT by decoding only (jwt.decode)", right: "verify signature against JWKS endpoint", why: "jwt.decode does not verify the signature. Anyone can forge a token. Always verify." },
    { wrong: "hardcoding realm URL", right: "use KEYCLOAK_URL and KEYCLOAK_REALM env vars", why: "Realm URL differs per environment. Hardcoding breaks staging/production." },
  ],
  docker: [
    { wrong: "FROM node:latest", right: "FROM node:20-alpine", why: "latest tag is unpredictable, full image is 1GB+. Pin version, use alpine for smaller images." },
    { wrong: "COPY . .", right: "COPY package*.json ./ && RUN npm ci && COPY . .", why: "Copying everything first invalidates the npm install cache on every code change. Copy package.json first." },
    { wrong: "RUN npm install", right: "RUN npm ci --omit=dev", why: "npm install uses fuzzy versions and includes devDependencies. npm ci is deterministic and faster." },
  ],
  jwt: [
    { wrong: "storing JWT in localStorage", right: "store in httpOnly cookie with Secure + SameSite flags", why: "localStorage is accessible via XSS. httpOnly cookies are not readable by JavaScript." },
    { wrong: "long-lived access tokens (24h+)", right: "short access token (15min) + refresh token rotation", why: "Long-lived tokens can't be revoked. Short + refresh allows rotation and revocation." },
  ],
};
