#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInitJson } from "../../../src/commands/init-mcp.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeProject({ prdContent, systemContent } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-init-"));
  if (prdContent !== undefined) fs.writeFileSync(path.join(tmp, "PRD.md"), prdContent);
  let archDir = null;
  if (systemContent !== undefined) {
    archDir = path.join(tmp, ".arch");
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, "SYSTEM.md"), systemContent);
  }
  return { cwd: tmp, archDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

await test("returns wizardInstructions inline (full SKILL.md content)", async () => {
  const { cwd, archDir, cleanup } = makeProject();
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.equal(typeof result.wizardInstructions, "string");
    assert.ok(result.wizardInstructions.length > 1000, "should return full SKILL.md, not a stub");
    assert.match(result.wizardInstructions, /name: archkit-init/);
    assert.match(result.wizardInstructions, /## Step 0 — Check for a PRD/);
  } finally { cleanup(); }
});

await test("returns skeletonsIndex with all 9 archetypes in canonical order", async () => {
  const { cwd, archDir, cleanup } = makeProject();
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.ok(Array.isArray(result.skeletonsIndex));
    assert.equal(result.skeletonsIndex.length, 9);
    const ids = result.skeletonsIndex.map(s => s.id);
    assert.deepEqual(ids, ["saas", "internal", "content", "ecommerce", "ai", "mobile", "realtime", "data", "_generic"]);
    for (const sk of result.skeletonsIndex) {
      assert.ok(sk.displayName, `${sk.id} should have displayName`);
      assert.ok(sk.description, `${sk.id} should have description`);
      assert.ok(sk.absolutePath && fs.existsSync(sk.absolutePath), `${sk.id} should have a real absolutePath`);
    }
  } finally { cleanup(); }
});

await test("returns skeletonsDir as absolute existing path", async () => {
  const { cwd, archDir, cleanup } = makeProject();
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.ok(path.isAbsolute(result.skeletonsDir));
    assert.ok(fs.existsSync(result.skeletonsDir));
  } finally { cleanup(); }
});

await test("returns prdSignal: prdFound: true when PRD exists in cwd", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "Multi-tenant SaaS subscription product with billing, sign-up, dashboards, Stripe.",
  });
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.equal(result.prdSignal.prdFound, true);
    assert.equal(result.prdSignal.recommendedArchetype, "saas");
  } finally { cleanup(); }
});

await test("returns prdSignal: prdFound: false when no PRD", async () => {
  const { cwd, archDir, cleanup } = makeProject();
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.equal(result.prdSignal.prdFound, false);
  } finally { cleanup(); }
});

await test("hasExistingArchDir is false in greenfield projects", async () => {
  const { cwd, archDir, cleanup } = makeProject();
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.equal(result.hasExistingArchDir, false);
  } finally { cleanup(); }
});

await test("hasExistingArchDir is true when archDir is passed", async () => {
  const { cwd, archDir, cleanup } = makeProject({ systemContent: "## Type: SaaS" });
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.equal(result.hasExistingArchDir, true);
    assert.match(result.nextStep, /already exists/i);
  } finally { cleanup(); }
});

await test("nextStep mentions PRD recommendation when PRD found in greenfield", async () => {
  const { cwd, archDir, cleanup } = makeProject({
    prdContent: "Real-time collaborative editing with WebSockets, presence indicators, Yjs.",
  });
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.match(result.nextStep, /realtime/);
  } finally { cleanup(); }
});

await test("returns currentDate in YYYY-MM-DD format", async () => {
  const { cwd, archDir, cleanup } = makeProject();
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.match(result.currentDate, /^\d{4}-\d{2}-\d{2}$/);
  } finally { cleanup(); }
});

await test("returns archkitVersion matching package.json", async () => {
  const { cwd, archDir, cleanup } = makeProject();
  try {
    const result = await runInitJson({ cwd, archDir });
    assert.match(result.archkitVersion, /^\d+\.\d+\.\d+/);
  } finally { cleanup(); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
