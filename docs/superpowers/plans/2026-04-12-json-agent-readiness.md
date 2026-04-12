# Agent-Readiness Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the archkit CLI fully agent-usable by adding `--json` to `stats`, aliasing `--json` in `review`, and adding detection-override flags to `init`.

**Architecture:** Three independent changes to existing command files. Each is self-contained with its own test. No new dependencies. Logger already writes to stderr.

**Tech Stack:** Node.js ESM, fs/path stdlib, node:assert for tests.

---

## File Map

**Modify:**
- `src/commands/stats.mjs` — add `--json` flag + `buildRecommendations()` helper
- `src/commands/review.mjs:420` — alias `--json` alongside `--agent`
- `src/commands/init.mjs:348,356` — change `const` to `let` for `appType`/`skills`, add override flags
- `README.md` — add new flag documentation to command tables

**Create:**
- `tests/stats-json/run.mjs` — stats --json tests
- `tests/review-json/run.mjs` — review --json tests
- `tests/init-overrides/run.mjs` — init override flag tests

---

### Task 1: `stats --json`

**Files:**
- Modify: `src/commands/stats.mjs:268-312,316-388`
- Create: `tests/stats-json/run.mjs`

- [ ] **Step 1: Write the test file**

Create `tests/stats-json/run.mjs`:

```javascript
#!/usr/bin/env node

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
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-stats-"));
  // Create minimal .arch/ with SYSTEM.md so findArchDir works
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "skills"), { recursive: true });
  fs.mkdirSync(path.join(archDir, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(archDir, "apis"), { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "## App: test\n## Rules\n- Rule 1\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(archDir, "INDEX.md"), "test → @test\n");
  fs.writeFileSync(path.join(archDir, "skills", "postgres.skill"), "# postgres\n\n## Meta\npkg: pg@8.0\ndocs: docs\nupdated: 2026-01-01\n\n## Use\nWe use it.\n\n## Patterns\npool.query\n\n## Gotchas\nWRONG: bad\nRIGHT: good\nWHY: reason\n\n## Boundaries\nNo ORM.\n\n## Snippets\ncode here\n");
  fs.writeFileSync(path.join(archDir, "clusters", "auth.graph"), "[auth] : handles authentication\n  [login] : user → session\n");
  const orig = process.cwd();
  try { process.chdir(dir); fn(dir); }
  finally { process.chdir(orig); fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n=== Stats --json Tests ===\n");

test("--json outputs valid JSON with expected keys", () => {
  withArchDir((dir) => {
    const result = execFileSync("node", [ARCHKIT, "stats", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const json = JSON.parse(result);
    assert.ok(json.health, "missing health key");
    assert.ok(typeof json.health.pct === "number", "health.pct should be number");
    assert.ok(Array.isArray(json.health.checks), "health.checks should be array");
    assert.ok(json.system, "missing system key");
    assert.ok(json.system.exists === true, "system.exists should be true");
    assert.ok(Array.isArray(json.skills), "skills should be array");
    assert.ok(Array.isArray(json.graphs), "graphs should be array");
    assert.ok(Array.isArray(json.recommendations), "recommendations should be array");
  });
});

test("--json includes skill details", () => {
  withArchDir((dir) => {
    const result = execFileSync("node", [ARCHKIT, "stats", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const json = JSON.parse(result);
    assert.equal(json.skills.length, 1);
    assert.equal(json.skills[0].id, "postgres");
    assert.ok(json.skills[0].gotchas >= 1, "postgres should have at least 1 gotcha");
  });
});

test("--json without .arch/ returns error JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-no-arch-"));
  try {
    execFileSync("node", [ARCHKIT, "stats", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.fail("should have thrown");
  } catch (err) {
    const stdout = err.stdout?.toString() || "";
    assert.ok(stdout.includes("no_arch_dir") || stdout.includes("error"), "should report error");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--json takes precedence over --compact", () => {
  withArchDir((dir) => {
    const result = execFileSync("node", [ARCHKIT, "stats", "--json", "--compact"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const json = JSON.parse(result);
    assert.ok(json.health, "should output full JSON, not compact line");
  });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/stats-json/run.mjs`
Expected: FAIL — stats does not support --json

- [ ] **Step 3: Extract `buildRecommendations()` from `displayOverallScore()`**

In `src/commands/stats.mjs`, add this function BEFORE `displayOverallScore()` (before line 268):

```javascript
function buildRecommendations(sys, idx, skills, graphs, apis) {
  const recs = [];
  if (!sys.exists) recs.push("Run archkit to generate SYSTEM.md");
  if (!idx.exists) recs.push("Run archkit to generate INDEX.md");
  if (idx.exists && idx.crossRefs === 0) recs.push("Add cross-references to INDEX.md (which features depend on which)");
  if (skills.length > 0) {
    const empty = skills.filter(s => s.completeness === 0);
    if (empty.length > 0) recs.push(`Fill in ${empty.length} skeleton skill${empty.length > 1 ? "s" : ""}: ${empty.slice(0, 3).map(s => s.id).join(", ")}${empty.length > 3 ? "..." : ""}`);
    const noGotchas = skills.filter(s => s.gotchas === 0 && s.completeness > 0);
    if (noGotchas.length > 0) recs.push(`Add gotchas to: ${noGotchas.slice(0, 3).map(s => s.id).join(", ")} — run: archkit gotcha -i`);
  }
  if (apis.length > 0) {
    const stubs = apis.filter(a => a.isStub);
    if (stubs.length > 0) recs.push(`Populate ${stubs.length} API stub${stubs.length > 1 ? "s" : ""}: ${stubs.map(a => a.id).join(", ")}`);
  }
  return recs;
}
```

Then update `displayOverallScore()` to use it — replace lines 291-304 (the duplicated recommendations logic) with:

```javascript
  const recs = buildRecommendations(sys, idx, skills, graphs, apis);
```

- [ ] **Step 4: Add `--json` path to `main()`**

In `main()` (starting at line 316), add `jsonMode` check and the JSON output path. Insert after `const args = process.argv.slice(2);` (line 317):

```javascript
  const jsonMode = args.includes("--json");
```

Replace the no-arch-dir error block (lines 320-326) with:

```javascript
  const archDir = findArchDir();
  if (!archDir) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: "no_arch_dir" }));
    } else {
      banner();
      console.log(`${C.red}  ${I.warn} Cannot find .arch/ directory.${C.reset}`);
      console.log(`${C.gray}  Run archkit first, or run this from your project root.${C.reset}\n`);
    }
    process.exit(1);
  }
```

Then after the analysis block (after line ~337 `log.stats(\`Health score: ${healthPct}%\`);`), insert the JSON output path — it must come BEFORE the `--compact` check:

```javascript
  // JSON mode: structured output for agents
  if (jsonMode) {
    const health = calculateHealthScore(sys, idx, skills, graphs, apis);
    const recommendations = buildRecommendations(sys, idx, skills, graphs, apis);
    console.log(JSON.stringify({ health, system: sys, index: idx, skills, graphs, apis, recommendations }));
    return;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/stats-json/run.mjs`
Expected: PASS — all 4 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/stats.mjs tests/stats-json/run.mjs
git commit -m "feat: add --json flag to stats command for agent-readable health output"
```

---

### Task 2: `review --json` alias

**Files:**
- Modify: `src/commands/review.mjs:420`
- Create: `tests/review-json/run.mjs`

- [ ] **Step 1: Write the test file**

Create `tests/review-json/run.mjs`:

```javascript
#!/usr/bin/env node

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
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

function withArchProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-review-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "skills"), { recursive: true });
  fs.mkdirSync(path.join(archDir, "clusters"), { recursive: true });
  // Minimal SYSTEM.md for review to load app type
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"), "## App: test\n## Type: Internal Tool\n## Stack: Node.js\n## Pattern: Simple Layered\n\n## Rules\n- Layered\n\n## Reserved Words\n\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(archDir, "INDEX.md"), "");
  // Create a simple JS file to review
  fs.writeFileSync(path.join(dir, "test-file.js"), "// a clean file\nconst x = 1;\nexport default x;\n");
  const orig = process.cwd();
  try { process.chdir(dir); fn(dir); }
  finally { process.chdir(orig); fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n=== Review --json Tests ===\n");

test("--json produces valid JSON output", () => {
  withArchProject((dir) => {
    const result = execFileSync("node", [ARCHKIT, "review", "--json", "test-file.js"], {
      cwd: dir, encoding: "utf8", timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const json = JSON.parse(result);
    assert.ok(typeof json.files === "number", "should have files count");
    assert.ok(typeof json.pass === "boolean", "should have pass boolean");
    assert.ok(json.findings !== undefined, "should have findings object");
  });
});

test("--json and --agent produce same output shape", () => {
  withArchProject((dir) => {
    const jsonResult = execFileSync("node", [ARCHKIT, "review", "--json", "test-file.js"], {
      cwd: dir, encoding: "utf8", timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const agentResult = execFileSync("node", [ARCHKIT, "review", "--agent", "test-file.js"], {
      cwd: dir, encoding: "utf8", timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const jsonOut = JSON.parse(jsonResult);
    const agentOut = JSON.parse(agentResult);
    assert.deepStrictEqual(Object.keys(jsonOut).sort(), Object.keys(agentOut).sort(), "should have same keys");
  });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/review-json/run.mjs`
Expected: FAIL — `--json` not recognized, outputs human text instead of JSON

- [ ] **Step 3: One-line change in review.mjs**

In `src/commands/review.mjs`, change line 420:

From:
```javascript
  const agentMode = args.includes("--agent");
```

To:
```javascript
  const agentMode = args.includes("--agent") || args.includes("--json");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/review-json/run.mjs`
Expected: PASS — both tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/review.mjs tests/review-json/run.mjs
git commit -m "feat: alias --json alongside --agent in review command"
```

---

### Task 3: `init --app-type` + `--skills` override flags

**Files:**
- Modify: `src/commands/init.mjs:348,356`
- Create: `tests/init-overrides/run.mjs`

- [ ] **Step 1: Write the test file**

Create `tests/init-overrides/run.mjs`:

```javascript
#!/usr/bin/env node

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
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed++; }
}

function withProjectDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-init-override-"));
  // Minimal package.json so init can run detection
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "test-project",
    dependencies: { "pg": "^8.0.0" },
  }));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const orig = process.cwd();
  try { process.chdir(dir); fn(dir); }
  finally { process.chdir(orig); fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n=== Init Override Flag Tests ===\n");

test("--app-type overrides auto-detected type", () => {
  withProjectDir((dir) => {
    const result = execFileSync("node", [ARCHKIT, "init", "--json", "--app-type", "ecommerce"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const json = JSON.parse(result);
    assert.equal(json.appType, "ecommerce", "should use overridden app type");
  });
});

test("--app-type with invalid type returns error", () => {
  withProjectDir((dir) => {
    try {
      execFileSync("node", [ARCHKIT, "init", "--json", "--app-type", "nonexistent"], {
        cwd: dir, encoding: "utf8", timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      assert.fail("should have thrown");
    } catch (err) {
      const stdout = err.stdout?.toString() || "";
      const json = JSON.parse(stdout);
      assert.equal(json.error, "invalid_app_type");
      assert.ok(Array.isArray(json.valid), "should list valid types");
    }
  });
});

test("--skills overrides auto-detected skills", () => {
  withProjectDir((dir) => {
    const result = execFileSync("node", [ARCHKIT, "init", "--json", "--skills", "stripe,docker"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const json = JSON.parse(result);
    assert.deepStrictEqual(json.skills, ["stripe", "docker"], "should use overridden skills");
  });
});

test("--skills with invalid skill returns error", () => {
  withProjectDir((dir) => {
    try {
      execFileSync("node", [ARCHKIT, "init", "--json", "--skills", "postgres,fake_pkg"], {
        cwd: dir, encoding: "utf8", timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      assert.fail("should have thrown");
    } catch (err) {
      const stdout = err.stdout?.toString() || "";
      const json = JSON.parse(stdout);
      assert.equal(json.error, "invalid_skills");
      assert.ok(json.invalid.includes("fake_pkg"), "should list invalid skills");
    }
  });
});

test("--app-type and --skills can be combined", () => {
  withProjectDir((dir) => {
    const result = execFileSync("node", [ARCHKIT, "init", "--json", "--app-type", "ai", "--skills", "llm_sdk,pgvector"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const json = JSON.parse(result);
    assert.equal(json.appType, "ai");
    assert.deepStrictEqual(json.skills, ["llm_sdk", "pgvector"]);
  });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/init-overrides/run.mjs`
Expected: FAIL — override flags not recognized, auto-detection used instead

- [ ] **Step 3: Implement override flags in init.mjs**

In `src/commands/init.mjs`, make two changes:

**Change 1:** Change `const` to `let` for `appType` and `skills` (lines 348 and 356):

From:
```javascript
  const appType = detectAppType(stack, dirStructure, pkgJson);
```
To:
```javascript
  let appType = detectAppType(stack, dirStructure, pkgJson);
```

From:
```javascript
  const skills = detectSkills(pkgJson);
```
To:
```javascript
  let skills = detectSkills(pkgJson);
```

**Change 2:** Add override logic AFTER the detection and logging, BEFORE `const cfg = ...` (line 359). Insert:

```javascript
  // Override app type if specified
  const appTypeIdx = args.indexOf("--app-type");
  if (appTypeIdx !== -1) {
    const appTypeFlag = args[appTypeIdx + 1];
    if (!appTypeFlag || !APP_TYPES[appTypeFlag]) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: "invalid_app_type", value: appTypeFlag || null, valid: Object.keys(APP_TYPES) }));
      } else {
        log.error(`Unknown app type: ${appTypeFlag}. Valid: ${Object.keys(APP_TYPES).join(", ")}`);
      }
      process.exit(2);
    }
    appType = appTypeFlag;
    log.resolve(`App type override: ${APP_TYPES[appType].name}`);
  }

  // Override skills if specified
  const skillsIdx = args.indexOf("--skills");
  if (skillsIdx !== -1) {
    const skillsFlag = args[skillsIdx + 1];
    if (!skillsFlag) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: "invalid_skills", invalid: [], valid: SKILL_CATALOG.map(s => s.id) }));
      } else {
        log.error("--skills requires a comma-separated list of skill IDs");
      }
      process.exit(2);
    }
    const requestedSkills = skillsFlag.split(",").map(s => s.trim());
    const invalid = requestedSkills.filter(s => !SKILL_CATALOG.find(sc => sc.id === s));
    if (invalid.length > 0) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: "invalid_skills", invalid, valid: SKILL_CATALOG.map(s => s.id) }));
      } else {
        log.error(`Unknown skill(s): ${invalid.join(", ")}. Valid: ${SKILL_CATALOG.map(s => s.id).join(", ")}`);
      }
      process.exit(2);
    }
    skills = requestedSkills;
    log.resolve(`Skills override: ${skills.join(", ")}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/init-overrides/run.mjs`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.mjs tests/init-overrides/run.mjs
git commit -m "feat: add --app-type and --skills override flags to init command"
```

---

### Task 4: README updates + version bump

**Files:**
- Modify: `README.md`
- Modify: `package.json:3`

- [ ] **Step 1: Add new flags to README command tables**

In the **Scaffold & Setup** `<details>` section, add after the `--install-hooks` row:

```markdown
| `archkit init --app-type <type>` | Override auto-detected app type |
| `archkit init --skills <a,b,c>` | Override auto-detected skills |
```

In the **Health & Maintenance** `<details>` section, add to the stats row or add a new row:

```markdown
| `archkit stats --json` | Health data as structured JSON (agent-callable) |
```

In the **Code Review** `<details>` section, add a note:

```markdown
| `archkit review --json <file>` | Same as `--agent` — JSON output (agent-callable) |
```

- [ ] **Step 2: Bump version**

Change line 3 of `package.json`:

From:
```json
  "version": "1.2.0",
```
To:
```json
  "version": "1.2.1",
```

- [ ] **Step 3: Run all new test suites**

```bash
node tests/stats-json/run.mjs && node tests/review-json/run.mjs && node tests/init-overrides/run.mjs
```

Expected: All suites pass.

- [ ] **Step 4: Also verify existing tests still pass**

```bash
node tests/proposals/run.mjs && node tests/agent-scaffold/run.mjs && node tests/hooks/run.mjs
```

Expected: All suites pass.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json
git commit -m "docs: add agent-readiness flags to README, bump to 1.2.1"
```

---

### Task 5: Update GH issue #15 and close tracking

**Files:** None (GitHub API only)

- [ ] **Step 1: Comment on original issue with results**

```bash
gh issue comment 15 --repo kenandrewmiranda/archkit --body "$(cat <<'EOF'
## Agent-readiness backfill complete (v1.2.1)

Three changes landed:
1. `stats --json` — full health data as structured JSON
2. `review --json` — alias for `--agent` flag, backwards compatible
3. `init --app-type <type> --skills <a,b,c>` — override auto-detection

All archkit commands are now fully agent-usable. See the updated command tables in README.md.
EOF
)"
```

- [ ] **Step 2: Verify all open issues**

```bash
gh issue list --repo kenandrewmiranda/archkit --state open
```

---

## Summary

| Task | What | Files touched |
|------|------|--------------|
| 1 | `stats --json` | `stats.mjs`, `tests/stats-json/run.mjs` |
| 2 | `review --json` alias | `review.mjs`, `tests/review-json/run.mjs` |
| 3 | `init --app-type` + `--skills` | `init.mjs`, `tests/init-overrides/run.mjs` |
| 4 | README + version bump | `README.md`, `package.json` |
| 5 | GH issue tracking | GitHub only |

5 tasks, ~5 commits.
