#!/usr/bin/env node
// Tests the archkit_init_generate MCP path: generating a real .arch/ scaffold
// from STRUCTURED answers (no inquirer TTY) via the shared scaffold-core.
//
// Two surfaces under test:
//   - generateScaffold()      — the pure decoupled core (src/wizard/scaffold-core.mjs)
//   - runInitGenerateJson()   — the MCP runner (src/commands/init-generate.mjs)

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateScaffold, normalizeAnswers } from "../../src/wizard/scaffold-core.mjs";
import { runInitGenerateJson } from "../../src/commands/init-generate.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; });
}

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-init-gen-"));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ── Pure core: generateScaffold ────────────────────────────────────────

await test("generateScaffold writes the .arch/ scaffold from structured answers", () => {
  const { dir, cleanup } = tmpProject();
  try {
    const res = generateScaffold({
      appName: "acme-billing",
      appType: "saas",
      features: [{ id: "auth", name: "Authentication", keywords: "login,auth" }, { id: "billing" }],
      skills: ["postgres", "stripe"],
      claudeMode: false,
    }, { projectRoot: dir });

    const arch = path.join(dir, ".arch");
    assert.ok(fs.existsSync(path.join(arch, "SYSTEM.md")), "SYSTEM.md written");
    assert.ok(fs.existsSync(path.join(arch, "INDEX.md")), "INDEX.md written");
    assert.ok(fs.existsSync(path.join(arch, "BOUNDARIES.md")), "BOUNDARIES.md written");
    assert.ok(fs.existsSync(path.join(arch, "CONTEXT.compact.md")), "CONTEXT.compact.md written");
    assert.ok(fs.existsSync(path.join(arch, "clusters", "infra.graph")), "infra cluster written");
    assert.ok(fs.existsSync(path.join(arch, "clusters", "auth.graph")), "auth cluster written");
    assert.ok(fs.existsSync(path.join(arch, "clusters", "billing.graph")), "billing cluster written");
    assert.ok(fs.existsSync(path.join(arch, "skills", "postgres.skill")), "postgres skill written");
    assert.ok(fs.existsSync(path.join(arch, "skills", "stripe.skill")), "stripe skill written");
    // stripe ships an .api stub
    assert.ok(fs.existsSync(path.join(arch, "apis", "stripe.api")), "stripe api stub written");
    // lenses
    assert.ok(fs.existsSync(path.join(arch, "lenses", "lens-implement.md")), "lens written");

    // SYSTEM.md should carry the app name and the resolved appType name
    const sys = fs.readFileSync(path.join(arch, "SYSTEM.md"), "utf8");
    assert.match(sys, /acme-billing/, "SYSTEM.md names the app");

    assert.equal(res.cfg.appName, "acme-billing");
    assert.deepEqual(res.cfg.features.map(f => f.id), ["auth", "billing"]);
    assert.ok(res.written.length >= 9, `expected many files, got ${res.written.length}`);
  } finally { cleanup(); }
});

await test("generateScaffold defaults features+stack from the archetype when omitted", () => {
  const { dir, cleanup } = tmpProject();
  try {
    const res = generateScaffold({ appName: "x", appType: "ecommerce", claudeMode: false }, { projectRoot: dir });
    assert.ok(res.cfg.features.length > 0, "archetype suggested features applied");
    assert.ok(Object.keys(res.cfg.stack).length > 0, "archetype default stack applied");
    // Each suggested feature got a cluster file
    for (const f of res.cfg.features) {
      assert.ok(fs.existsSync(path.join(dir, ".arch", "clusters", `${f.id}.graph`)), `${f.id}.graph written`);
    }
  } finally { cleanup(); }
});

await test("generateScaffold claudeMode:true writes Claude Code native files", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({
      appName: "x", appType: "saas",
      features: [{ id: "auth" }], skills: [], claudeMode: true,
    }, { projectRoot: dir });
    assert.ok(fs.existsSync(path.join(dir, "CLAUDE.md")), "CLAUDE.md written");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "rules", "architecture.md")), "arch rule written");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "rules", "auth.md")), "feature rule written");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "archkit-protocol", "SKILL.md")), "protocol skill written");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "settings.json")), "settings.json written");
    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    assert.ok(settings.hooks && settings.hooks.PreToolUse, "hooks merged");
  } finally { cleanup(); }
});

await test("generateScaffold claudeMode:false skips Claude Code native files", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({ appName: "x", appType: "saas", features: [{ id: "auth" }], claudeMode: false }, { projectRoot: dir });
    assert.ok(!fs.existsSync(path.join(dir, "CLAUDE.md")), "no CLAUDE.md");
    assert.ok(!fs.existsSync(path.join(dir, ".claude")), "no .claude dir");
    assert.ok(fs.existsSync(path.join(dir, ".arch", "SYSTEM.md")), "but .arch/ still written");
  } finally { cleanup(); }
});

await test("generateScaffold renames to CLAUDE.archkit.md when CLAUDE.md exists", () => {
  const { dir, cleanup } = tmpProject();
  try {
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# existing\n");
    const res = generateScaffold({ appName: "x", appType: "saas", features: [{ id: "auth" }], claudeMode: true }, { projectRoot: dir });
    assert.equal(res.claudeMdRenamed, true, "flagged renamed");
    assert.ok(fs.existsSync(path.join(dir, "CLAUDE.archkit.md")), "wrote CLAUDE.archkit.md");
    assert.equal(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), "# existing\n", "did not clobber existing CLAUDE.md");
  } finally { cleanup(); }
});

await test("normalizeAnswers throws coded errors for invalid input", () => {
  assert.throws(() => normalizeAnswers({ appName: "x", appType: "nope" }), e => e.code === "invalid_app_type");
  assert.throws(() => normalizeAnswers({ appType: "saas" }), e => e.code === "missing_app_name");
  assert.throws(() => normalizeAnswers({ appName: "x", appType: "saas", skills: ["not-a-skill"] }), e => e.code === "invalid_skills");
});

// ── MCP runner: runInitGenerateJson ───────────────────────────────────

await test("runInitGenerateJson generates a scaffold and returns a structured envelope", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    const res = await runInitGenerateJson({
      cwd: dir, archDir: null,
      answers: { appName: "demo", appType: "ai", features: [{ id: "chat" }], claudeMode: false },
    });
    assert.equal(res.ok, true);
    assert.equal(res.appName, "demo");
    assert.equal(res.appType, "ai");
    assert.ok(res.features.includes("chat"));
    assert.ok(res.filesWritten > 0);
    assert.ok(Array.isArray(res.written) && res.written.includes("SYSTEM.md"));
    assert.match(res.nextStep, /warmup/i);
    assert.ok(fs.existsSync(path.join(dir, ".arch", "clusters", "chat.graph")));
  } finally { cleanup(); }
});

await test("runInitGenerateJson refuses to clobber an existing .arch/ without overwrite", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "# existing\n");
    await assert.rejects(
      runInitGenerateJson({ cwd: dir, archDir: path.join(dir, ".arch"), answers: { appName: "x", appType: "saas" } }),
      e => e.code === "arch_dir_exists"
    );
    // overwrite:true proceeds
    const res = await runInitGenerateJson({
      cwd: dir, archDir: path.join(dir, ".arch"),
      answers: { appName: "x", appType: "saas", features: [{ id: "auth" }], claudeMode: false }, overwrite: true,
    });
    assert.equal(res.ok, true);
  } finally { cleanup(); }
});

await test("runInitGenerateJson surfaces invalid appType as a coded error with valid list", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    await assert.rejects(
      runInitGenerateJson({ cwd: dir, archDir: null, answers: { appName: "x", appType: "bogus" } }),
      e => e.code === "invalid_app_type" && /saas/.test(e.suggestion || "")
    );
  } finally { cleanup(); }
});

await test("runInitGenerateJson requires an answers object", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    await assert.rejects(
      runInitGenerateJson({ cwd: dir, archDir: null }),
      e => e.code === "missing_answers"
    );
  } finally { cleanup(); }
});

console.log(`\n${passed}/${passed + failed} init-generate assertions passed.`);
if (failed) process.exit(1);
