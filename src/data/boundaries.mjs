// Minimal fallback boundaries — critical OWASP/RFC rules only.
// Full boundary packs per app type available on marketplace:
// archkit install archkit-boundaries-saas, etc.

const UNIVERSAL_BOUNDARIES = [
  "NEVER use string concatenation for SQL queries. Use parameterized queries. (OWASP A03:2021)",
  "NEVER commit secrets, API keys, or credentials to code. Use environment variables. (OWASP A07:2021)",
  "NEVER store passwords in plain text. Use bcrypt/argon2 with salt. (OWASP A02:2021)",
  "NEVER return stack traces or internal errors to the client in production. (OWASP Error Handling)",
  "NEVER trust client-side input. Validate at the API boundary. (OWASP A03:2021)",
  "NEVER make outbound HTTP requests without a timeout. (AWS SDK Best Practices)",
];

const APP_TYPE_BOUNDARIES = {
  saas: [
    "NEVER query the database without tenant scoping. (PostgreSQL RLS)",
    "NEVER put business logic in controllers. Controllers validate, delegate, respond. (Layered Architecture)",
  ],
  ecommerce: [
    "NEVER use floating-point for money. Use integer cents. (IEEE 754)",
    "NEVER process a payment without an idempotency key. (Stripe docs)",
  ],
  realtime: [
    "NEVER put business logic in the WebSocket gateway. (Clean Architecture)",
    "NEVER import I/O or framework modules in domain logic. (Clean Architecture)",
  ],
  data: [
    "NEVER query the OLAP engine directly from API routes. Go through the semantic layer. (Cube docs)",
  ],
  ai: [
    "NEVER inline prompt strings in chain code. Prompts are version-controlled files. (Anthropic docs)",
    "NEVER call an LLM without input validation and output filtering. (Anthropic docs — Guardrails)",
  ],
  mobile: [
    "NEVER put business logic in screen components. Use hooks. (React Native docs)",
  ],
  internal: [
    "NEVER perform destructive actions without audit logging. (SOC 2 — CC7.2)",
  ],
  content: [
    "NEVER serve unoptimized images. Include width, height, loading='lazy'. (Google Web Vitals)",
  ],
};

export function genBoundariesMd(appType) {
  let o = `# BOUNDARIES.md\n\n`;
  o += `> Hard prohibitions backed by industry standards.\n`;
  o += `> Full boundary packs: archkit install archkit-boundaries-${appType}\n\n`;
  o += `## Universal Boundaries\n`;
  UNIVERSAL_BOUNDARIES.forEach(b => o += `- ${b}\n`);
  o += `\n## ${appType.charAt(0).toUpperCase() + appType.slice(1)}-Specific Boundaries\n`;
  (APP_TYPE_BOUNDARIES[appType] || []).forEach(b => o += `- ${b}\n`);
  return o;
}
