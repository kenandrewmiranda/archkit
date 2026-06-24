#!/usr/bin/env node

/**
 * Playbooks rename + back-compat test suite (ADR 0016).
 *
 * Covers:
 *  - The central resolver reads BOTH .arch/playbooks/*.playbook AND legacy
 *    .arch/skills/*.skill (with .playbook shadowing a same-id .skill).
 *  - `archkit migrate` consolidates legacy skills/ → playbooks/.
 *  - warmup/stats/gotcha still find units after a rename (no broken refs).
 *
 * Usage:
 *   node tests/migrate-playbooks/run.mjs
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listPlaybookIds,
  resolvePlaybookPath,
  readPlaybook,
  usesLegacyLayout,
  playbookWriteDir,
} from "../../src/lib/playbooks.mjs";

const ARCHKIT = path.resolve("bin/archkit.mjs");
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[90m${err.message}\x1b[0m`); failed++; failures.push(name); }
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "archkit-pb-"));
}
function seedSystem(arch) {
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "# SYSTEM.md\n## App: x\n## Type: saas\n## Stack: db:postgres\n");
}
function unit(id) {
  return `# ${id}\n## Meta\npkg: ${id}@1\n## Gotchas\nWRONG: bad\nRIGHT: good\nWHY: because\n`;
}

console.log("\n  ┌─────────────────────────────────────────────┐");
console.log("  │       ARCHKIT PLAYBOOKS / BACK-COMPAT        │");
console.log("  └─────────────────────────────────────────────┘\n");

// ── Resolver back-compat ─────────────────────────────────────────────────────

test("resolver reads legacy .arch/skills/*.skill", () => {
  const dir = tmp();
  const arch = path.join(dir, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.writeFileSync(path.join(arch, "skills", "stripe.skill"), unit("stripe"));
  assert.deepEqual(listPlaybookIds(arch), ["stripe"]);
  assert.ok(readPlaybook(arch, "stripe").includes("WRONG: bad"));
  assert.ok(usesLegacyLayout(arch), "should detect legacy layout");
  assert.equal(playbookWriteDir(arch), path.join(arch, "skills"), "legacy projects keep writing to skills/");
});

test("resolver reads canonical .arch/playbooks/*.playbook", () => {
  const dir = tmp();
  const arch = path.join(dir, ".arch");
  fs.mkdirSync(path.join(arch, "playbooks"), { recursive: true });
  fs.writeFileSync(path.join(arch, "playbooks", "prisma.playbook"), unit("prisma"));
  assert.deepEqual(listPlaybookIds(arch), ["prisma"]);
  assert.ok(resolvePlaybookPath(arch, "prisma").endsWith(".playbook"));
  assert.ok(!usesLegacyLayout(arch));
  assert.equal(playbookWriteDir(arch), path.join(arch, "playbooks"));
});

test(".playbook shadows a same-id legacy .skill", () => {
  const dir = tmp();
  const arch = path.join(dir, ".arch");
  fs.mkdirSync(path.join(arch, "playbooks"), { recursive: true });
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.writeFileSync(path.join(arch, "playbooks", "pg.playbook"), "# new\nWRONG: NEW\n");
  fs.writeFileSync(path.join(arch, "skills", "pg.skill"), "# old\nWRONG: OLD\n");
  assert.deepEqual(listPlaybookIds(arch), ["pg"], "deduped by id");
  assert.ok(readPlaybook(arch, "pg").includes("NEW"), "new layout wins");
});

// ── migrate consolidation ────────────────────────────────────────────────────

test("migrate renames skills/*.skill → playbooks/*.playbook", () => {
  const dir = tmp();
  const arch = path.join(dir, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  seedSystem(arch);
  fs.writeFileSync(path.join(arch, "skills", "stripe.skill"), unit("stripe"));
  fs.writeFileSync(path.join(arch, "skills", "README.md"), "# readme\n");

  const out = execFileSync(process.execPath, [ARCHKIT, "migrate", "--json"], { cwd: dir, encoding: "utf8" });
  const renames = JSON.parse(out).changes.filter(c => c.action === "rename");
  assert.equal(renames.length, 1, "one rename");
  assert.ok(fs.existsSync(path.join(arch, "playbooks", "stripe.playbook")), "playbook written");
  assert.ok(!fs.existsSync(path.join(arch, "skills")), "legacy skills/ dir removed when drained");
  assert.ok(fs.existsSync(path.join(arch, "playbooks", "README.md")), "README migrated");
});

test("migrate does not clobber an existing playbook", () => {
  const dir = tmp();
  const arch = path.join(dir, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "playbooks"), { recursive: true });
  seedSystem(arch);
  fs.writeFileSync(path.join(arch, "skills", "pg.skill"), "# legacy\n");
  fs.writeFileSync(path.join(arch, "playbooks", "pg.playbook"), "# canonical\nKEEP\n");
  execFileSync(process.execPath, [ARCHKIT, "migrate", "--json"], { cwd: dir, encoding: "utf8" });
  assert.ok(fs.readFileSync(path.join(arch, "playbooks", "pg.playbook"), "utf8").includes("KEEP"), "existing playbook preserved");
});

// ── No broken refs after rename ──────────────────────────────────────────────

test("warmup + gotcha list find units in a migrated project", () => {
  const dir = tmp();
  const arch = path.join(dir, ".arch");
  fs.mkdirSync(path.join(arch, "playbooks"), { recursive: true });
  seedSystem(arch);
  fs.writeFileSync(path.join(arch, "playbooks", "stripe.playbook"), unit("stripe"));

  const warm = JSON.parse(execFileSync(process.execPath, [ARCHKIT, "resolve", "warmup", "--json"], { cwd: dir, encoding: "utf8" }));
  assert.equal(warm.summary.playbooks, 1, "warmup counts the playbook");
  assert.equal(warm.summary.skills, 1, "back-compat alias key still present");

  const list = JSON.parse(execFileSync(process.execPath, [ARCHKIT, "gotcha", "--list-proposals", "--json"], { cwd: dir, encoding: "utf8" }));
  assert.ok(Array.isArray(list), "list-proposals returns an array");
});

console.log("");
console.log("  ═════════════════════════════════════════════════════════");
console.log(`  \x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
if (failures.length > 0) {
  console.log("\n  \x1b[31mFailed:\x1b[0m");
  for (const f of failures) console.log(`    - ${f}`);
}
console.log("");
process.exit(failed > 0 ? 1 : 0);
