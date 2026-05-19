#!/usr/bin/env node

/**
 * Tests for parseIndex / drift parser handling multi-node INDEX.md lines.
 *
 * Bug: `## Nodes → Clusters → Files` parser only captured the first @node and
 * only recognized [bracket] cluster syntax. The format
 *
 *   @A @B @C → @cluster → .arch/clusters/cluster.graph
 *
 * (which several projects hand-author) produced three classes of false findings:
 *   - orphaned-index-node for the first node (cluster fell back to node id)
 *   - orphaned-graph for every cluster (clusterId set indexed wrong tokens)
 *   - missing-source whose path was the literal "@cluster → ..." substring
 *
 * Cross-refs regex also required a parenthesized reason, so bare `@A → @B`
 * lines (counted by stats) produced an empty crossRefs array — triggering W010
 * "no cross-references" while stats reported a positive count.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseIndex } from "../../src/lib/parsers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

function tryRun(args, opts = {}) {
  try {
    return { ok: true, stdout: execFileSync("node", [ARCHKIT, ...args], {
      encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"], ...opts,
    }) };
  } catch (err) {
    return { ok: false, stdout: err.stdout?.toString() || "", code: err.status };
  }
}

function withProject(setup, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-multi-"));
  try { setup(dir); fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n\x1b[1m=== Drift multi-node INDEX.md format ===\x1b[0m\n");

test("parseIndex captures every @node on a multi-node line and resolves the cluster", () => {
  const idx = `# INDEX.md

## Nodes → Clusters → Files
@Runner @Stages @Research → @pipeline → .arch/clusters/pipeline.graph
@Sources @Workspace → @ingest → .arch/clusters/ingest.graph
`;
  const parsed = parseIndex(idx);
  assert.equal(parsed.nodeCluster.Runner?.cluster, "pipeline");
  assert.equal(parsed.nodeCluster.Stages?.cluster, "pipeline");
  assert.equal(parsed.nodeCluster.Research?.cluster, "pipeline");
  assert.equal(parsed.nodeCluster.Sources?.cluster, "ingest");
  assert.equal(parsed.nodeCluster.Workspace?.cluster, "ingest");
  assert.equal(parsed.nodeCluster.Runner?.basePath, ".arch/clusters/pipeline.graph");
});

test("parseIndex preserves the legacy bracket format", () => {
  const idx = `# INDEX.md

## Nodes
@auth = [auth] → src/features/auth/
@billing = [billing] → src/features/billing/, src/jobs/billing.ts
`;
  const parsed = parseIndex(idx);
  assert.equal(parsed.nodeCluster.auth?.cluster, "auth");
  assert.equal(parsed.nodeCluster.auth?.basePath, "src/features/auth/");
  assert.equal(parsed.nodeCluster.billing?.cluster, "billing");
  assert.equal(
    parsed.nodeCluster.billing?.basePath,
    "src/features/billing/, src/jobs/billing.ts"
  );
});

test("parseIndex accepts cross-refs without a parenthesized reason", () => {
  const idx = `# INDEX.md

## Cross-Refs
@a → @b
@c → @d (depends on auth)
`;
  const parsed = parseIndex(idx);
  assert.equal(parsed.crossRefs.length, 2);
  assert.deepEqual(parsed.crossRefs[0], { from: "a", to: "b", reason: "" });
  assert.deepEqual(parsed.crossRefs[1], { from: "c", to: "d", reason: "depends on auth" });
});

test("archkit drift produces no false positives on multi-node INDEX with all graphs present", () => {
  withProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "## App: test\n## Rules\n- R1\n");
      fs.writeFileSync(path.join(dir, ".arch", "INDEX.md"),
        `# INDEX.md

## Nodes → Clusters → Files
@Runner @Stages @Research → @pipeline → .arch/clusters/pipeline.graph
@Sources @Workspace → @ingest → .arch/clusters/ingest.graph
@Reviewer → @review → .arch/clusters/review.graph
`);
      for (const c of ["pipeline", "ingest", "review"]) {
        fs.writeFileSync(path.join(dir, ".arch", "clusters", `${c}.graph`), `--- ${c} ---\n`);
      }
    },
    (dir) => {
      const r = tryRun(["drift", "--json"], { cwd: dir });
      const result = JSON.parse(r.stdout);
      assert.equal(result.stale.length, 0,
        `expected 0 findings, got ${result.stale.length}: ${JSON.stringify(result.stale, null, 2)}`);
    }
  );
});

test("archkit drift flags a missing cluster on a multi-node line", () => {
  withProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "## App: test\n## Rules\n- R1\n");
      fs.writeFileSync(path.join(dir, ".arch", "INDEX.md"),
        `# INDEX.md

## Nodes → Clusters → Files
@Runner @Stages → @pipeline → .arch/clusters/pipeline.graph
@Sources → @ingest → .arch/clusters/ingest.graph
`);
      // pipeline.graph exists; ingest.graph does NOT
      fs.writeFileSync(path.join(dir, ".arch", "clusters", "pipeline.graph"), "--- pipeline ---\n");
    },
    (dir) => {
      const r = tryRun(["drift", "--json"], { cwd: dir });
      const result = JSON.parse(r.stdout);
      const orphans = result.stale.filter(f => f.type === "orphaned-index-node");
      // @Sources is the only node pointing at the missing ingest cluster.
      assert.equal(orphans.length, 1,
        `expected exactly 1 orphaned-index-node, got: ${JSON.stringify(orphans)}`);
      assert.equal(orphans[0].id, "Sources");
      assert.ok(orphans[0].detail.includes("ingest"),
        `finding should mention the ingest cluster, got: ${orphans[0].detail}`);
      // The pipeline.graph reference in INDEX.md must not be flagged as missing-source.
      assert.equal(
        result.stale.filter(f => f.type === "missing-source" || f.type === "missing-file").length,
        0
      );
    }
  );
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
