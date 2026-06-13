#!/usr/bin/env node
import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOD = pathToFileURL(path.resolve(__dirname, "../../src/lib/decision-detector.mjs")).href;
const { detectDecisions, PATTERNS } = await import(MOD);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic corpus — 30 decision-shaped sentences across 8 archetypes,
// 30 non-decision foils. Targets per v1.6 design: precision ≥85%, recall ≥40%.
//
// We deliberately bias for high precision. False positives spam the proposal
// queue and erode trust faster than missed decisions hurt.
// ─────────────────────────────────────────────────────────────────────────────

const POSITIVES = [
  // saas
  "We'll use Postgres for the auth tables — RLS gives us multi-tenant isolation cleanly.",
  "I'll go with Clerk for auth instead of building it from scratch.",
  "Let's adopt Stripe for billing — Paddle has worse webhook reliability.",
  // ecommerce
  "We're going with Medusa over Saleor because the Node ecosystem is closer to the team's strength.",
  "Decided to use Algolia for product search — Postgres FTS won't scale past 50k SKUs.",
  "The right choice here is Shopify Hydrogen since we don't need a custom storefront.",
  // realtime
  "We will adopt Phoenix Channels for the live presence feature.",
  "Going with Liveblocks over building our own CRDT layer.",
  "I'm going to use Pusher for the MVP and revisit if we hit scaling limits.",
  // data
  "We'll switch to ClickHouse for the analytics OLAP queries — Postgres is timing out at this volume.",
  "Decided on Airflow over Prefect because the bigger ecosystem fits the team's existing skills.",
  "Let's use dbt for the warehouse modeling layer.",
  // ai
  "We're going to use the Claude API directly rather than wrapping it in LangChain.",
  "I'll pick pgvector over Pinecone to keep the stack on a single Postgres instance.",
  "The right answer is to do RAG with Supabase pgvector for v1.",
  // mobile
  "Going with Expo over bare React Native because the OTA story is faster.",
  "We should adopt Tamagui for cross-platform styling.",
  "Decided to use TanStack Query for server state — Redux is overkill here.",
  // internal
  "We'll build with Retool for the admin panel — saves us 4 weeks of frontend work.",
  "I will go with Auth0 for SSO instead of rolling Keycloak.",
  "Let's use Notion's API for the internal wiki sync.",
  // content
  "We're going with Sanity over Contentful because the structured content model is closer to our needs.",
  "Decided against headless WordPress — too much PHP ops overhead.",
  "The best option is Astro for the marketing site.",
  // cross-archetype
  "I'll go with TypeScript strict mode from day one — it's painful to retrofit.",
  "We'll use Vitest over Jest because ESM-first matches the build pipeline.",
  "Going with pnpm over npm — workspaces are cleaner.",
  "The tradeoff is bundle size for DX, and the right answer here is the smaller bundle.",
  "We're going to use Drizzle over Prisma — query performance is the deciding factor.",
  "Let's pick Cloudflare Workers for the edge layer.",
];

const NEGATIVES = [
  // questions
  "Should we use Postgres or MySQL here?",
  "What about going with Redis for caching?",
  "Is the right choice MongoDB?",
  // comparisons without resolution
  "Postgres vs MongoDB — both have tradeoffs.",
  "Looking at Redis vs Memcached for the cache layer.",
  // soft recommendations
  "Consider using Redis for caching.",
  "Maybe we should look at TanStack Query.",
  // descriptive / status
  "We have an auth feature.",
  "The user table has 5 columns.",
  "I see Postgres is already configured.",
  // past-tense narration
  "We used Postgres last time, and it worked well.",
  "Last project we went with Redis but the team didn't love it.",
  // hypotheticals
  "If we use MongoDB, we'd have schema flexibility.",
  "Suppose we adopted Redux — would the boilerplate be worth it?",
  // code-shaped
  "const choice = 'postgres';",
  "// TODO: pick a database",
  "function shouldUseCache(req) { return req.query.cache === 'true'; }",
  // structured listing
  "- Postgres for primary data\n- Redis for cache\n- S3 for blobs",
  "Database: Postgres 16. Cache: Redis 7. Queue: BullMQ.",
  // questions about boundaries
  "Should we be using `any` types like this?",
  // exploratory imperatives
  "Let me check the current setup before deciding.",
  "Let's see what the existing code does.",
  "Let's look at the auth module first.",
  // first-person non-commitment verbs
  "I'm going to read the spec next.",
  "I'll start by listing the files in src/.",
  // user-directed instructions
  "You should run npm install first.",
  // softeners
  "Could we consider Redis here?",
  "We have to read the existing code first.",
  "I think Postgres might be a better fit.",
  // figure-of-speech "over"
  "Looking at the data access layer over the weekend because the team is offsite.",
];

console.log("\ndecision-detector — pattern + corpus calibration\n");

test(`PATTERNS exposes ${PATTERNS.length} regexes, all with /g flag`, () => {
  assert.equal(PATTERNS.length, 7);
  for (const p of PATTERNS) {
    assert.ok(p.regex.flags.includes("g"), `${p.name} must have /g flag for matchAll`);
    assert.ok(p.name && p.description, `${p.name} must have name + description`);
  }
});

test("detectDecisions returns [] on empty / non-string input", () => {
  assert.deepEqual(detectDecisions(""), []);
  assert.deepEqual(detectDecisions(null), []);
  assert.deepEqual(detectDecisions(undefined), []);
  assert.deepEqual(detectDecisions(42), []);
});

test("each detection has required fields + stable hash", () => {
  const d = detectDecisions("We'll use Postgres for auth.");
  assert.equal(d.length, 1);
  const r = d[0];
  assert.match(r.hash, /^[a-f0-9]{12}$/);
  assert.ok(r.patternName);
  assert.ok(r.matchedText);
  assert.ok(r.titleHint.length > 0);
  assert.ok(r.contextExcerpt.length > 0);
  assert.equal(r.source, "stop-hook");
});

test("identical sentence repeated dedups by hash", () => {
  const text = "We'll use Postgres. We'll use Postgres.";
  const d = detectDecisions(text);
  assert.equal(d.length, 1, "exact repeat in same turn should produce one proposal");
});

test("question-form 'What about going with Redis' is suppressed", () => {
  assert.equal(detectDecisions("What about going with Redis for caching?").length, 0);
});

test("question-form 'How about going with Auth0' is suppressed", () => {
  assert.equal(detectDecisions("How about going with Auth0?").length, 0);
});

test("multiple distinct decisions in one turn produce multiple proposals", () => {
  const text = [
    "We'll use Postgres for auth.",
    "I'll go with Redis for caching.",
    "Going with Cloudflare for the CDN.",
  ].join(" ");
  const d = detectDecisions(text);
  assert.ok(d.length >= 3, `expected ≥3 distinct detections, got ${d.length}`);
});

// Per-pattern smoke tests — at least one canonical sentence per regex.
test("commit_we — canonical match", () => {
  assert.ok(detectDecisions("We'll use Postgres.").length >= 1);
  assert.ok(detectDecisions("We will adopt Phoenix.").length >= 1);
  assert.ok(detectDecisions("We should pick pnpm.").length >= 1);
  assert.ok(detectDecisions("We are going to use Drizzle.").length >= 1);
});

test("commit_first_person — canonical match", () => {
  assert.ok(detectDecisions("I'll use Vitest.").length >= 1);
  assert.ok(detectDecisions("I'm going to go with Astro.").length >= 1);
});

test("commit_imperative — canonical match", () => {
  assert.ok(detectDecisions("Going with Sanity over Contentful.").length >= 1);
  assert.ok(detectDecisions("Let's use dbt for modeling.").length >= 1);
});

test("commit_decided — canonical match", () => {
  assert.ok(detectDecisions("Decided to use Algolia.").length >= 1);
  assert.ok(detectDecisions("Decided against headless WordPress.").length >= 1);
});

test("commit_right_choice — canonical match", () => {
  assert.ok(detectDecisions("The right answer is Astro.").length >= 1);
  assert.ok(detectDecisions("The best option is pgvector.").length >= 1);
});

test("commit_tradeoff — canonical match", () => {
  assert.ok(detectDecisions("The tradeoff is bundle size.").length >= 1);
});

test("commit_over_because — canonical match", () => {
  assert.ok(detectDecisions("Going with Postgres over MongoDB because RLS works.").length >= 1);
});

// Negative spot-checks — high-risk false positives.
test("'should we' (question) does NOT match", () => {
  assert.equal(detectDecisions("Should we use Postgres here?").length, 0);
});

test("'I'm going to read' does NOT match (read is not a commitment verb)", () => {
  assert.equal(detectDecisions("I'm going to read the spec.").length, 0);
});

test("'over the weekend' does NOT match commit_over_because", () => {
  assert.equal(detectDecisions("Working on it over the weekend because of the offsite.").length, 0);
});

test("'consider using' does NOT match", () => {
  assert.equal(detectDecisions("Consider using Redis for caching.").length, 0);
});

test("'X vs Y' bare comparison does NOT match", () => {
  assert.equal(detectDecisions("Postgres vs MongoDB — both have tradeoffs.").length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Corpus-level precision + recall
// ─────────────────────────────────────────────────────────────────────────────

function evaluateCorpus() {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  const fpExamples = [], fnExamples = [];

  for (const sentence of POSITIVES) {
    if (detectDecisions(sentence).length > 0) tp++;
    else { fn++; fnExamples.push(sentence); }
  }
  for (const sentence of NEGATIVES) {
    if (detectDecisions(sentence).length > 0) { fp++; fpExamples.push(sentence); }
    else tn++;
  }
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  return { tp, fn, fp, tn, precision, recall, fpExamples, fnExamples };
}

test("corpus precision ≥85%", () => {
  const r = evaluateCorpus();
  console.log(`    TP=${r.tp} FN=${r.fn} FP=${r.fp} TN=${r.tn}`);
  console.log(`    precision=${(r.precision * 100).toFixed(1)}% recall=${(r.recall * 100).toFixed(1)}%`);
  if (r.fp > 0) {
    console.log(`    false positives:`);
    for (const s of r.fpExamples) console.log(`      - ${s}`);
  }
  if (r.fn > 0) {
    console.log(`    false negatives:`);
    for (const s of r.fnExamples) console.log(`      - ${s}`);
  }
  assert.ok(r.precision >= 0.85, `precision ${(r.precision * 100).toFixed(1)}% < 85%`);
});

test("corpus recall ≥40%", () => {
  const r = evaluateCorpus();
  assert.ok(r.recall >= 0.40, `recall ${(r.recall * 100).toFixed(1)}% < 40%`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
