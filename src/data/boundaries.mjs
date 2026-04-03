// Hard boundaries — industry-standard prohibitions.
// Each rule is backed by an official source (OWASP, RFC, vendor docs, etc.).
// Only absolute rules belong here — context-dependent guidance goes in gotchas.

const UNIVERSAL_BOUNDARIES = [
  // OWASP A07:2021 — Identification and Authentication Failures
  "NEVER commit secrets, API keys, or credentials to code. Use environment variables. (OWASP A07:2021)",
  // OWASP A03:2021 — Injection
  "NEVER use string concatenation for SQL queries. Use parameterized queries. (OWASP A03:2021)",
  // OWASP A03:2021 — Injection (input validation)
  "NEVER trust client-side input. Validate at the API boundary. (OWASP A03:2021)",
  // OWASP A02:2021 — Cryptographic Failures
  "NEVER store passwords in plain text. Use bcrypt/argon2 with salt. (OWASP A02:2021)",
  // OWASP A05:2021 — Security Misconfiguration
  "NEVER disable CORS in production. Configure allowed origins explicitly. (OWASP A05:2021)",
  // OWASP — Error Handling Cheat Sheet
  "NEVER return stack traces or internal errors to the client in production. (OWASP Error Handling)",
  // PostgreSQL docs §14.1 — Performance Tips
  "NEVER use SELECT * in application queries — specify only the columns you need. (PostgreSQL §14.1)",
  // PostgreSQL wiki — Pagination Done the Right Way
  "NEVER use OFFSET for deep pagination (>1000 rows). Use cursor-based pagination. (PostgreSQL wiki)",
  // Redis docs — KEYS command
  "NEVER use KEYS * in production Redis/Valkey. Use SCAN with cursor. (Redis docs — KEYS)",
  // Redis docs — SET, Key Expiration
  "NEVER SET cache keys without TTL. Every cached value must have an expiration. (Redis docs — EXPIRE)",
  // BullMQ docs — Retrying failing jobs
  "NEVER enqueue jobs without retry + backoff configured. (BullMQ docs — Retrying failing jobs)",
];

const APP_TYPE_BOUNDARIES = {
  saas: [
    // PostgreSQL docs — Row Level Security
    "NEVER query the database without tenant scoping. Every query includes tenant_id. (PostgreSQL RLS)",
    // Martin Fowler — Presentation Domain Data Layering
    "NEVER put business logic in controllers. Controllers validate, delegate, respond. (Layered Architecture)",
    // Martin Fowler — Presentation Domain Data Layering
    "NEVER access the database directly from controllers. Go through service → repository. (Layered Architecture)",
    // IEEE 754 floating-point arithmetic — known precision issues with currency
    "NEVER use floating-point for money. Use integer cents. (IEEE 754 precision loss)",
    // PostgreSQL/Prisma docs — Connection Management
    "NEVER create a new database client per request. Use a singleton or connection pool. (PostgreSQL §20.3)",
  ],
  ecommerce: [
    // PostgreSQL docs — Explicit Locking §13.3.2
    "NEVER decrement inventory without a row lock (SELECT FOR UPDATE). (PostgreSQL §13.3.2)",
    // IEEE 754
    "NEVER use floating-point for money. All prices, totals, taxes in integer cents. (IEEE 754)",
    // Stripe docs — Idempotent Requests
    "NEVER process a payment without an idempotency key. (Stripe docs — Idempotent Requests)",
    // Stripe/payment provider docs — Error Handling
    "NEVER call external payment APIs without retry + timeout. (Stripe docs — Error Handling)",
  ],
  realtime: [
    // WebSocket best practices — Gateway pattern
    "NEVER put business logic in the WebSocket gateway. Gateway handles connection lifecycle only.",
    // Clean Architecture — dependency rule
    "NEVER import I/O or framework modules in domain logic. Domain is pure functions. (Clean Architecture)",
    // Redis docs — Key Expiration (ephemeral state)
    "NEVER persist presence/typing state to the database. Use ephemeral TTL keys in Redis. (Redis docs — EXPIRE)",
    // Distributed systems — shared-nothing architecture
    "NEVER assume single-server deployment. Cross-server communication via pub/sub only.",
  ],
  data: [
    // Cube docs — Semantic Layer Architecture
    "NEVER query the OLAP engine directly from API routes. Go through the semantic layer. (Cube docs)",
    // Data engineering — separation of concerns
    "NEVER mix pipeline code and API code. They are separate top-level concerns.",
    // Dagster/dbt docs — Data Quality
    "NEVER skip data quality checks on pipeline assets. Every asset has freshness + schema checks. (Dagster docs)",
  ],
  ai: [
    // Prompt engineering best practices — version control
    "NEVER inline prompt strings in chain code. Prompts are version-controlled files. (Anthropic docs — Prompt Engineering)",
    // Anthropic docs — Guardrails
    "NEVER call an LLM without input validation and output filtering. (Anthropic docs — Guardrails)",
    // Hexagonal Architecture — ports and adapters
    "NEVER hardcode the LLM provider. Use a port interface with swappable adapters. (Hexagonal Architecture)",
  ],
  mobile: [
    // React Native performance — component architecture
    "NEVER put business logic in screen components. Screens compose components and call hooks. (React Native docs)",
    // React Native performance — list rendering
    "NEVER use FlatList for large lists. Use FlashList (@shopify/flash-list). (Shopify FlashList docs)",
    // Mobile best practices — offline-first
    "NEVER send base64 images through the API. Upload via presigned URL. (AWS S3 docs — Presigned URLs)",
  ],
  internal: [
    // Database replication — read replica pattern
    "NEVER use the primary database for display/read queries. Use the read replica.",
    // SOC 2 — Audit Logging requirements
    "NEVER perform destructive actions without audit logging. (SOC 2 — CC7.2)",
    // GDPR Article 25 — Data protection by design
    "NEVER display full PII. Mask by default. Reveal on click with audit log. (GDPR Art. 25)",
  ],
  content: [
    // Google Web Vitals — LCP, CLS
    "NEVER serve unoptimized images. Always include width, height, loading='lazy'. (Google Web Vitals — LCP)",
    // Google — Core Web Vitals, Lighthouse
    "NEVER add client-side JavaScript to static content pages unless interactive functionality requires it. (Google CWV)",
    // Google — SEO Starter Guide
    "NEVER skip SEO metadata (title, description, OG image) on content pages. (Google SEO Guide)",
  ],
};

export function genBoundariesMd(appType) {
  let o = `# BOUNDARIES.md\n\n`;
  o += `> Hard prohibitions backed by industry standards.\n`;
  o += `> Each rule references its source (OWASP, RFC, vendor docs, etc.).\n\n`;
  o += `## Universal Boundaries\n`;
  UNIVERSAL_BOUNDARIES.forEach(b => o += `- ${b}\n`);
  o += `\n## ${appType.charAt(0).toUpperCase() + appType.slice(1)}-Specific Boundaries\n`;
  (APP_TYPE_BOUNDARIES[appType] || []).forEach(b => o += `- ${b}\n`);
  return o;
}
