#!/usr/bin/env node

/**
 * Tests for the workspace-monorepo drift fix.
 *
 * Bug: `archkit drift` read only the ROOT package.json for the orphaned-skill
 * check. In a pnpm/npm/yarn workspace monorepo, runtime deps live in member
 * package.jsons (apps/*, packages/*), so every skill whose package was declared
 * in a workspace got flagged as orphaned (false positive).
 *
 * Fix: src/lib/workspace-deps.mjs unions root + workspace-member deps; drift.mjs
 * uses collectDeps(cwd) instead of reading only the root manifest.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-drift-ws-"));
  try { setup(dir); fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// Base archkit project: .arch/ with the given skill files. App name matches the
// root package.json name so the name-mismatch check stays quiet.
function makeArchProject(dir, skillIds) {
  fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "## App: monorepo\n## Rules\n- R1\n");
  fs.writeFileSync(path.join(dir, ".arch", "INDEX.md"), "## Nodes\n");
  for (const id of skillIds) {
    fs.writeFileSync(path.join(dir, ".arch", "skills", `${id}.skill`), `[${id}]\n`);
  }
}

function orphanedSkills(dir) {
  const r = tryRun(["drift", "--json"], { cwd: dir });
  const result = JSON.parse(r.stdout);
  return result.stale.filter((f) => f.type === "orphaned-skill");
}

console.log("\n\x1b[1m=== Drift Workspace-Monorepo Tests ===\x1b[0m\n");

test("pnpm-workspace.yaml: skill whose dep lives in a member pkg is NOT orphaned", () => {
  withProject(
    (dir) => {
      makeArchProject(dir, ["hono"]);
      // Root has only devDeps — hono is NOT here (the bug trigger).
      writeJson(path.join(dir, "package.json"), {
        name: "monorepo", private: true, devDependencies: { turbo: "^2" },
      });
      fs.writeFileSync(path.join(dir, "pnpm-workspace.yaml"),
        'packages:\n  - "apps/*"\n  - "packages/*"\n');
      // hono lives in a workspace member.
      writeJson(path.join(dir, "apps", "api", "package.json"), {
        name: "api", dependencies: { hono: "^4" },
      });
    },
    (dir) => {
      const found = orphanedSkills(dir);
      assert.equal(found.length, 0,
        `expected no orphaned-skill, got: ${JSON.stringify(found)}`);
    }
  );
});

test("npm workspaces field: skill whose dep lives in a member pkg is NOT orphaned", () => {
  withProject(
    (dir) => {
      makeArchProject(dir, ["hono"]);
      writeJson(path.join(dir, "package.json"), {
        name: "monorepo", private: true,
        workspaces: ["apps/*", "packages/*"],
        devDependencies: { turbo: "^2" },
      });
      writeJson(path.join(dir, "apps", "api", "package.json"), {
        name: "api", dependencies: { hono: "^4" },
      });
    },
    (dir) => {
      const found = orphanedSkills(dir);
      assert.equal(found.length, 0,
        `expected no orphaned-skill, got: ${JSON.stringify(found)}`);
    }
  );
});

test("direct (non-glob) workspace path is unioned too", () => {
  withProject(
    (dir) => {
      makeArchProject(dir, ["postgres"]); // postgres → pg
      writeJson(path.join(dir, "package.json"), {
        name: "monorepo", private: true, workspaces: ["apps/api"],
        devDependencies: { turbo: "^2" },
      });
      writeJson(path.join(dir, "apps", "api", "package.json"), {
        name: "api", dependencies: { pg: "^8" },
      });
    },
    (dir) => {
      assert.equal(orphanedSkills(dir).length, 0);
    }
  );
});

test("negative: skill with dep absent everywhere is STILL flagged orphaned", () => {
  withProject(
    (dir) => {
      makeArchProject(dir, ["stripe"]); // stripe → stripe, not declared anywhere
      writeJson(path.join(dir, "package.json"), {
        name: "monorepo", private: true,
        workspaces: ["apps/*"],
        devDependencies: { turbo: "^2" },
      });
      writeJson(path.join(dir, "apps", "api", "package.json"), {
        name: "api", dependencies: { hono: "^4" },
      });
    },
    (dir) => {
      const found = orphanedSkills(dir);
      assert.equal(found.length, 1,
        `expected stripe flagged, got: ${JSON.stringify(found)}`);
      assert.ok(found[0].detail.includes("stripe"));
    }
  );
});

test("non-workspace single-package repo still flags a missing dep (regression)", () => {
  withProject(
    (dir) => {
      makeArchProject(dir, ["stripe"]);
      writeJson(path.join(dir, "package.json"), {
        name: "monorepo", dependencies: { hono: "^4" },
      });
    },
    (dir) => {
      assert.equal(orphanedSkills(dir).length, 1, "stripe should be orphaned");
    }
  );
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
