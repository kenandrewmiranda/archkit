#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPrdCheckJson } from "../../../src/commands/prd.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeProject({ prdContent, prdName = "PRD.md", systemContent } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-prd-"));
  if (prdContent !== undefined) {
    const prdPath = path.join(tmp, prdName);
    fs.mkdirSync(path.dirname(prdPath), { recursive: true });
    fs.writeFileSync(prdPath, prdContent);
  }
  let archDir = null;
  if (systemContent !== undefined) {
    archDir = path.join(tmp, ".arch");
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, "SYSTEM.md"), systemContent);
  }
  return { cwd: tmp, archDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

await test("returns prdFound: false when no PRD exists", async () => {
  const { cwd, archDir, cleanup } = makeProject({});
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.prdFound, false);
    assert.ok(Array.isArray(result.searchedPaths));
    assert.ok(result.suggestion.length > 0);
  } finally { cleanup(); }
});

await test("detects PRD.md at repo root", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "# Product\nA multi-tenant subscription billing dashboard with sign-up.",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.prdFound, true);
    assert.equal(result.prdRelativePath, "PRD.md");
  } finally { cleanup(); }
});

await test("detects docs/BRIEF.md when root PRD absent", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "Internal admin tool for the ops team behind SSO.",
    prdName: "docs/BRIEF.md",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.prdFound, true);
    assert.equal(result.prdRelativePath, "docs/BRIEF.md");
  } finally { cleanup(); }
});

await test("scores saas signals correctly", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "Multi-tenant B2B subscription product with sign-up, log-in, billing via Stripe, organization workspaces, and a dashboard.",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.recommendedArchetype, "saas");
    const saas = result.signals.archetypes.find(a => a.archetype === "saas");
    assert.ok(saas.score >= 5, `expected saas score >= 5, got ${saas.score}`);
  } finally { cleanup(); }
});

await test("scores ecommerce signals correctly", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "A storefront with cart, checkout, product catalog, inventory tracking, shipping integration, and Shopify backend.",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.recommendedArchetype, "ecommerce");
  } finally { cleanup(); }
});

await test("scores ai signals correctly", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "An LLM-powered chatbot with RAG and embeddings, using Anthropic Claude.",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.recommendedArchetype, "ai");
  } finally { cleanup(); }
});

await test("scores realtime signals correctly", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "A collaborative editing tool with real-time cursors, presence indicators, and CRDT-backed sync via Yjs.",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.recommendedArchetype, "realtime");
  } finally { cleanup(); }
});

await test("detects deployment mode signal — managed", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "We'll deploy on Vercel with Neon Postgres and Clerk for auth.",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.signals.deploymentMode, "managed");
  } finally { cleanup(); }
});

await test("detects deployment mode signal — selfHosted", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "Self-hosted on a Kubernetes cluster with Hetzner. Data residency requires the database to stay on-premise.",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.signals.deploymentMode, "selfHosted");
  } finally { cleanup(); }
});

await test("returns null deployment mode when no signal", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "A multi-tenant SaaS product with login and billing.",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.signals.deploymentMode, null);
  } finally { cleanup(); }
});

await test("emits archetype_mismatch finding when SYSTEM disagrees with PRD", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "Multi-tenant SaaS subscription product with billing and dashboards via Stripe.",
    systemContent: "# SYSTEM.md\n## Type: Content Site / Marketing\n",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.declaredArchetype, "content");
    assert.equal(result.recommendedArchetype, "saas");
    const mismatch = result.findings.find(f => f.type === "archetype_mismatch");
    assert.ok(mismatch, "expected archetype_mismatch finding");
    assert.equal(mismatch.severity, "warning");
  } finally { cleanup(); }
});

await test("does not emit mismatch when SYSTEM and PRD agree", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "Multi-tenant SaaS with billing, sign-up, and Stripe.",
    systemContent: "# SYSTEM.md\n## Type: SaaS / B2B Platform\n## Mode: Managed\n",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    assert.equal(result.declaredArchetype, "saas");
    const mismatch = result.findings.find(f => f.type === "archetype_mismatch");
    assert.equal(mismatch, undefined, "should not emit mismatch when in agreement");
  } finally { cleanup(); }
});

await test("emits mode_mismatch finding when modes disagree", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "Self-hosted on Kubernetes for data residency.",
    systemContent: "# SYSTEM.md\n## Type: SaaS\n## Mode: Managed\n",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    const mismatch = result.findings.find(f => f.type === "mode_mismatch");
    assert.ok(mismatch, "expected mode_mismatch finding");
  } finally { cleanup(); }
});

await test("emits low_signal finding when PRD matches no keywords", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "We will build something. It will be cool. People will use it.",
    systemContent: "# SYSTEM.md\n## Type: SaaS\n",
  });
  try {
    const result = await runPrdCheckJson({ archDir, cwd });
    const lowSignal = result.findings.find(f => f.type === "low_signal");
    assert.ok(lowSignal, "expected low_signal finding");
  } finally { cleanup(); }
});

await test("works without an .arch/ directory (bare project)", async () => {
  const { cwd, cleanup } = makeProject({
    prdContent: "Multi-tenant SaaS with billing.",
  });
  try {
    const result = await runPrdCheckJson({ archDir: null, cwd });
    assert.equal(result.prdFound, true);
    assert.equal(result.recommendedArchetype, "saas");
    assert.deepEqual(result.findings, []); // no findings without a system to compare
    assert.equal(result.declaredArchetype, null);
  } finally { cleanup(); }
});

await test("respects explicit prdPath argument", async () => {
  const { cwd, cleanup } = makeProject({
    prdContent: "Mobile iOS app with App Store distribution.",
    prdName: "specs/v2-rewrite.md",
  });
  try {
    const result = await runPrdCheckJson({ archDir: null, cwd, prdPath: "specs/v2-rewrite.md" });
    assert.equal(result.prdFound, true);
    assert.equal(result.recommendedArchetype, "mobile");
  } finally { cleanup(); }
});

await test("returns prdFound: false when explicit prdPath does not exist", async () => {
  const { cwd, cleanup } = makeProject({});
  try {
    const result = await runPrdCheckJson({ archDir: null, cwd, prdPath: "nonexistent.md" });
    assert.equal(result.prdFound, false);
  } finally { cleanup(); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
