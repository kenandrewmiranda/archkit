import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-test-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", dependencies: { pg: "^8.0.0" } })
  );
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  return dir;
}

function runInit(dir, extraArgs) {
  return spawnSync(
    process.execPath,
    [ARCHKIT, "init", "--json", ...extraArgs],
    { cwd: dir, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" }
  );
}

// ── Tests ────────────────────────────────────────────────────────────

test("--app-type overrides auto-detected type", () => {
  const dir = makeTempProject();
  const result = runInit(dir, ["--app-type", "ecommerce"]);
  const json = JSON.parse(result.stdout);
  assert.equal(json.appType, "ecommerce");
});

test("--app-type with invalid type returns error", () => {
  const dir = makeTempProject();
  const result = runInit(dir, ["--app-type", "nonexistent"]);
  assert.notEqual(result.status, 0, "expected non-zero exit");
  const json = JSON.parse(result.stdout);
  assert.equal(json.error, "invalid_app_type");
  assert.ok(Array.isArray(json.valid), "expected valid to be an array");
});

test("--skills overrides auto-detected skills", () => {
  const dir = makeTempProject();
  const result = runInit(dir, ["--skills", "stripe,docker"]);
  assert.equal(result.status, 0, `expected zero exit, got: ${result.stderr}`);
  const json = JSON.parse(result.stdout);
  assert.deepEqual(json.skills, ["stripe", "docker"]);
});

test("--skills with invalid skill returns error", () => {
  const dir = makeTempProject();
  const result = runInit(dir, ["--skills", "postgres,fake_pkg"]);
  assert.notEqual(result.status, 0, "expected non-zero exit");
  const json = JSON.parse(result.stdout);
  assert.equal(json.error, "invalid_skills");
  assert.ok(json.invalid.includes("fake_pkg"), "expected fake_pkg in invalid list");
});

test("--app-type and --skills can be combined", () => {
  const dir = makeTempProject();
  const result = runInit(dir, ["--app-type", "ai", "--skills", "llm_sdk,pgvector"]);
  assert.equal(result.status, 0, `expected zero exit, got: ${result.stderr}`);
  const json = JSON.parse(result.stdout);
  assert.equal(json.appType, "ai");
  assert.deepEqual(json.skills, ["llm_sdk", "pgvector"]);
});

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
