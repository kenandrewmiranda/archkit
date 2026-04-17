#!/usr/bin/env node

/**
 * Scaffold Live Tests
 *
 * Verifies that `archkit resolve scaffold` generates files correctly:
 * dry-run by default, --apply writes files, --overwrite forces overwrite.
 *
 * Usage:
 *   node tests/scaffold-live/run.mjs
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[90m${err.message}\x1b[0m`);
    failed++;
    failures.push(name);
  }
}

function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-scaffold-live-"));
  try {
    // Set up minimal .arch/
    fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".arch", "SYSTEM.md"),
      "## App: test\n## Type: SaaS / B2B Platform\n## Pattern: Layered Architecture\n## Rules\n- R1\n"
    );
    fs.writeFileSync(
      path.join(dir, ".arch", "INDEX.md"),
      "## Nodes\n"
    );
    // Set up package.json with hono + prisma
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: {
          hono: "^4.0.0",
          "@prisma/client": "^5.0.0",
        },
      }, null, 2)
    );
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runScaffold(dir, featureId, extraArgs = []) {
  const args = [ARCHKIT, "resolve", "scaffold", featureId, "--pretty", ...extraArgs];
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
    const match = stdout.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : null;
    return { ok: true, result, stdout };
  } catch (err) {
    const stdout = err.stdout?.toString() || "";
    let result = null;
    const match = stdout.match(/\{[\s\S]*\}/);
    try { result = match ? JSON.parse(match[0]) : null; } catch (_) {}
    return { ok: false, result, stdout, stderr: err.stderr?.toString() || "" };
  }
}

console.log("");
console.log("  ┌─────────────────────────────────────────────────────────┐");
console.log("  │          ARCHKIT SCAFFOLD LIVE TESTS                    │");
console.log("  └─────────────────────────────────────────────────────────┘");
console.log("");

// ── Test 1: dry-run by default — does NOT write files ───────────────────────

test("dry-run by default — does NOT write files", () => {
  withProject((dir) => {
    const { result } = runScaffold(dir, "notify");
    assert.ok(result, "Expected JSON result");
    assert.ok(Array.isArray(result.wouldCreate), "result.wouldCreate should be an array");
    assert.ok(result.wouldCreate.length >= 1, "wouldCreate should have at least 1 entry");
    const featureDir = path.join(dir, "src", "features", "notify");
    assert.ok(!fs.existsSync(featureDir), "src/features/notify/ should NOT exist on disk");
  });
});

// ── Test 2: --apply writes files ────────────────────────────────────────────

test("--apply writes files", () => {
  withProject((dir) => {
    const { result } = runScaffold(dir, "notify", ["--apply"]);
    assert.ok(result, "Expected JSON result");
    assert.ok(Array.isArray(result.created), "result.created should be an array");
    assert.ok(result.created.length >= 1, "created should have at least 1 entry");
    const controller = path.join(dir, "src", "features", "notify", "notify.controller.ts");
    assert.ok(fs.existsSync(controller), "notify.controller.ts should exist on disk");
    const clusterGraph = path.join(dir, ".arch", "clusters", "notify.graph");
    assert.ok(fs.existsSync(clusterGraph), ".arch/clusters/notify.graph should exist on disk");
  });
});

// ── Test 3: --apply generated files contain AGENT-VALIDATION block ──────────

test("--apply generated files contain AGENT-VALIDATION block", () => {
  withProject((dir) => {
    runScaffold(dir, "notify", ["--apply"]);
    const controller = path.join(dir, "src", "features", "notify", "notify.controller.ts");
    const content = fs.readFileSync(controller, "utf8");
    assert.ok(
      content.includes("AGENT-VALIDATION (required"),
      "controller.ts should contain AGENT-VALIDATION (required"
    );
    assert.ok(
      content.includes("[ ]"),
      "controller.ts should contain [ ] markers"
    );
  });
});

// ── Test 4: --apply generated files contain feature name in correct case ─────

test("--apply generated files contain feature name in correct case", () => {
  withProject((dir) => {
    runScaffold(dir, "notify", ["--apply"]);
    const controller = path.join(dir, "src", "features", "notify", "notify.controller.ts");
    const controllerContent = fs.readFileSync(controller, "utf8");
    assert.ok(
      controllerContent.includes("notifyController"),
      "controller.ts should contain notifyController (lowercase)"
    );
    assert.ok(
      controllerContent.includes("notifyService") || controllerContent.includes("notify.service"),
      "controller.ts or service should reference notifyService"
    );
    const types = path.join(dir, "src", "features", "notify", "notify.types.ts");
    if (fs.existsSync(types)) {
      const typesContent = fs.readFileSync(types, "utf8");
      assert.ok(
        typesContent.includes("Notify"),
        "types.ts should contain Notify (capitalized)"
      );
    } else {
      // Check service.ts for Notify reference
      const service = path.join(dir, "src", "features", "notify", "notify.service.ts");
      const serviceContent = fs.readFileSync(service, "utf8");
      assert.ok(
        serviceContent.includes("Notify"),
        "service.ts should reference Notify (capitalized)"
      );
    }
  });
});

// ── Test 5: --apply skips files that already exist (no --overwrite) ──────────

test("--apply skips files that already exist (no --overwrite)", () => {
  withProject((dir) => {
    // Pre-create controller.ts with custom content
    const featureDir = path.join(dir, "src", "features", "notify");
    fs.mkdirSync(featureDir, { recursive: true });
    const controllerPath = path.join(featureDir, "notify.controller.ts");
    const customContent = "// CUSTOM EXISTING CONTENT — DO NOT OVERWRITE\n";
    fs.writeFileSync(controllerPath, customContent);

    const { result } = runScaffold(dir, "notify", ["--apply"]);
    assert.ok(result, "Expected JSON result");
    assert.ok(Array.isArray(result.skipped), "result.skipped should be an array");
    const skippedPaths = result.skipped.map(s => s.path);
    const controllerRelPath = path.join("src", "features", "notify", "notify.controller.ts");
    assert.ok(
      skippedPaths.some(p => p === controllerRelPath || p.replace(/\\/g, "/") === controllerRelPath.replace(/\\/g, "/")),
      `skipped should include ${controllerRelPath}, got: ${JSON.stringify(skippedPaths)}`
    );
    // Existing content should be unchanged
    const actualContent = fs.readFileSync(controllerPath, "utf8");
    assert.strictEqual(actualContent, customContent, "Existing file content should be unchanged");
  });
});

// ── Test 6: --apply --overwrite forces overwrite ─────────────────────────────

test("--apply --overwrite forces overwrite", () => {
  withProject((dir) => {
    // Pre-create controller.ts with custom content
    const featureDir = path.join(dir, "src", "features", "notify");
    fs.mkdirSync(featureDir, { recursive: true });
    const controllerPath = path.join(featureDir, "notify.controller.ts");
    fs.writeFileSync(controllerPath, "// CUSTOM CONTENT WITHOUT VALIDATION BLOCK\n");

    runScaffold(dir, "notify", ["--apply", "--overwrite"]);

    const content = fs.readFileSync(controllerPath, "utf8");
    assert.ok(
      content.includes("AGENT-VALIDATION"),
      "controller.ts should contain AGENT-VALIDATION after --overwrite (was overwritten)"
    );
  });
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("");
console.log("  ═════════════════════════════════════════════════════════");
const total = passed + failed;
const pct = total > 0 ? ((passed / total) * 100).toFixed(0) : 0;
console.log(`  \x1b[1m${total} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m | \x1b[1m${pct}%\x1b[0m`);

if (failures.length > 0) {
  console.log("");
  console.log("  \x1b[31mFailed:\x1b[0m");
  for (const f of failures) {
    console.log(`    - ${f}`);
  }
}
console.log("");

process.exit(failed > 0 ? 1 : 0);
