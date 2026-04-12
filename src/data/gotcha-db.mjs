// Minimal fallback gotcha DB — critical patterns only (OWASP, RFC, vendor docs).
// Full gotcha packs available on the marketplace: archkit search "gotchas"
// Install with: archkit install archkit-postgres-gotchas, etc.

export const GOTCHA_DB = {
  postgres: [
    { wrong: "string concatenation in queries: `WHERE id = ${id}`", right: "pool.query('WHERE id = $1', [id])", why: "SQL injection (OWASP A03:2021). Ref: OWASP SQL Injection Prevention." },
    { wrong: "new Pool() per request", right: "const pool = new Pool(); // module-level singleton", why: "Exhausts max_connections. Ref: PostgreSQL docs §20.3." },
    { wrong: "SELECT * FROM table", right: "SELECT id, name, email FROM table", why: "Over-fetches columns including TOAST fields. Ref: PostgreSQL §14.1." },
  ],
  prisma: [
    { wrong: "new PrismaClient() in hot-reloaded module", right: "globalThis.prisma ??= new PrismaClient()", why: "Exhausts connection pool on dev hot-reload. Ref: Prisma docs — Best practices." },
  ],
  stripe: [
    { wrong: "req.body for webhook signature verification", right: "req.rawBody or raw buffer", why: "Body-parser modifies payload. Stripe needs raw bytes. Ref: Stripe docs — Webhook Signatures." },
    { wrong: "charge without idempotency key", right: "stripe.paymentIntents.create({...}, { idempotencyKey: key })", why: "Duplicate charges on retry. Ref: Stripe docs — Idempotent Requests." },
  ],
  jwt: [
    { wrong: "JWT in localStorage", right: "httpOnly cookie with Secure, SameSite=Strict", why: "XSS can read localStorage. Ref: OWASP JWT Cheat Sheet." },
    { wrong: "jwt.decode() without signature verification", right: "verify against JWKS endpoint", why: "Anyone can forge a token. Ref: RFC 7519 §7.2." },
  ],
  docker: [
    { wrong: "FROM node:latest", right: "FROM node:20-alpine", why: "Non-reproducible builds, 1GB+ image. Ref: Docker docs — Best practices." },
    { wrong: "RUN npm install in production", right: "RUN npm ci --omit=dev", why: "Non-deterministic, includes devDependencies. Ref: npm docs — npm ci." },
  ],
  errors: [
    { wrong: "res.status(500).json({ error: err.message, stack: err.stack })", right: "res.status(500).json({ type: 'internal_error', title: 'Internal Server Error' })", why: "Stack traces expose internals. Ref: OWASP — Improper Error Handling." },
  ],
  security: [
    { wrong: "checking permissions only in the frontend", right: "enforce authorization server-side on every request", why: "Frontend checks bypassable via devtools. Ref: OWASP A01:2021." },
  ],
  sqlite: [
    { wrong: "ALTER TABLE t ADD CHECK (col IN ('a','b'))", right: "BEGIN; CREATE TABLE t_new (...with updated CHECK...); INSERT INTO t_new (col1, col2, ...) SELECT col1, col2, ... FROM t; DROP TABLE t; ALTER TABLE t_new RENAME TO t; COMMIT;", why: "SQLite's ALTER TABLE cannot add or modify CHECK constraints, foreign keys, or column types in place. Full 12-step rebuild required. Always list columns explicitly in INSERT...SELECT. Ref: sqlite.org/lang_altertable.html #7." },
  ],
  numerics: [
    { wrong: "return (current - entry) / entry < threshold  // IEEE 754 noise at exact decimal boundaries", right: "return round((current - entry) / entry, 10) < threshold  // or compare in cents (integer), or use Decimal", why: "IEEE 754 subtract-then-divide produces values like 0.14999999999999991 at what should be exactly 0.15. Rounding to 10 decimals normalizes the noise. Write explicit boundary test cases." },
  ],
};
