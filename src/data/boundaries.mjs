const UNIVERSAL_BOUNDARIES = [
  "NEVER commit secrets, API keys, or credentials to code. Use environment variables.",
  "NEVER use `any` type in TypeScript. Always define explicit types.",
  "NEVER catch errors silently. Log or re-throw with context.",
  "NEVER use string concatenation for SQL queries. Use parameterized queries.",
  "NEVER trust client-side input. Validate at the API boundary.",
  "NEVER store passwords in plain text. Use bcrypt/argon2 with salt.",
  "NEVER disable CORS in production. Configure allowed origins explicitly.",
  "NEVER return stack traces or internal errors to the client in production.",
  "NEVER use SELECT * — always specify the columns you need.",
  "NEVER query without WHERE on tables with more than 100 rows. Scope every query.",
  "NEVER ORDER BY a column without an index. Add an index or remove the sort.",
  "NEVER use OFFSET for deep pagination (>1000). Use cursor-based pagination.",
  "NEVER load unbounded relations (e.g., include all posts for a user). Always LIMIT.",
  "NEVER run N+1 queries in a loop. Batch with IN/ANY or use a JOIN.",
];

const APP_TYPE_BOUNDARIES = {
  saas: [
    "NEVER query the database without tenant scoping. Every query includes tenant_id.",
    "NEVER import from another feature's internal modules. Use shared interfaces only.",
    "NEVER put business logic in controllers. Controllers validate, delegate, respond.",
    "NEVER access the database directly from controllers. Go through service → repository.",
    "NEVER use floating-point for money. Use integer cents via $money type.",
    "NEVER create a new PrismaClient/pool per request. Use a singleton or connection pool.",
  ],
  ecommerce: [
    "NEVER decrement inventory without a row lock (SELECT FOR UPDATE).",
    "NEVER use floating-point for money. All prices, totals, taxes in integer cents.",
    "NEVER process a payment without an idempotency key.",
    "NEVER call external payment APIs without retry + timeout.",
    "NEVER import from another feature's internal modules. Use shared interfaces.",
    "NEVER calculate prices in the frontend. Pricing logic lives server-side only.",
  ],
  realtime: [
    "NEVER put business logic in the WebSocket gateway. Gateway handles connection lifecycle only.",
    "NEVER import WebSocket/framework modules in domain logic. Domain is pure functions.",
    "NEVER persist presence/typing state to the database. Use ephemeral Valkey TTL keys.",
    "NEVER assume single-server deployment. Cross-server communication via pub/sub only.",
    "NEVER block the event loop with synchronous operations in message handlers.",
  ],
  data: [
    "NEVER query ClickHouse directly from the API layer. Go through the Cube semantic layer.",
    "NEVER mix pipeline code and API code. They are separate top-level concerns.",
    "NEVER skip data quality checks on pipeline assets. Every asset has freshness + schema checks.",
    "NEVER filter sensitive data in the frontend. OPA policies inject server-side WHERE clauses.",
  ],
  ai: [
    "NEVER inline prompt strings in chain code. Prompts live in src/prompts/ and are version-controlled.",
    "NEVER ship a prompt change without passing the Promptfoo eval suite.",
    "NEVER call an LLM without guardrails (input filtering, output validation, PII detection).",
    "NEVER hardcode the LLM provider. Use the $llm port interface — swap via adapter.",
    "NEVER skip Langfuse tracing on LLM calls. Every call is traced.",
  ],
  mobile: [
    "NEVER put business logic in screen components. Screens compose components and call hooks.",
    "NEVER send base64 images through the API. Upload via presigned URL to $store.",
    "NEVER use FlatList. Always use FlashList for list rendering.",
    "NEVER use magic strings for navigation routes. All routes are typed.",
    "NEVER skip offline-first. Write to WatermelonDB first, sync when online.",
  ],
  internal: [
    "NEVER use the primary database for display queries. Use the read replica.",
    "NEVER perform destructive actions without confirmation AND audit logging.",
    "NEVER display full PII. Mask by default. Reveal on click with audit log.",
    "NEVER make internal tools accessible from the public internet.",
  ],
  content: [
    "NEVER serve unoptimized images. Always go through Imgproxy with width, height, alt.",
    "NEVER add client-side JavaScript to content pages by default. Use interactive islands only when needed.",
    "NEVER skip SEO metadata. Title, description, OG image are mandatory on every content type.",
    "NEVER update the search index on draft saves. Only on publish.",
  ],
};

export function genBoundariesMd(appType) {
  let o = `# BOUNDARIES.md\n\n`;
  o += `> Hard prohibitions. The AI must NEVER violate these rules.\n`;
  o += `> These are non-negotiable constraints, not suggestions.\n\n`;
  o += `## Universal Boundaries\n`;
  UNIVERSAL_BOUNDARIES.forEach(b => o += `- ${b}\n`);
  o += `\n## ${appType.charAt(0).toUpperCase() + appType.slice(1)}-Specific Boundaries\n`;
  (APP_TYPE_BOUNDARIES[appType] || []).forEach(b => o += `- ${b}\n`);
  return o;
}
