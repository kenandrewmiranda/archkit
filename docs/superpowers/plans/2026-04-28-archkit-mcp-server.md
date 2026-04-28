# archkit MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `archkit-mcp` (and `archkit mcp serve`) as a stdio MCP server exposing 10 typed tools that mirror archkit's CLI surface, so AI agents reach for archkit natively instead of via shell-outs.

**Architecture:** Per the spec at `docs/superpowers/specs/2026-04-28-archkit-mcp-server-design.md`, each `src/commands/<name>.mjs` exports a pure `run*Json()` function returning structured data; the existing CLI wraps it in `console.log + process.exit`; the new `src/mcp/` layer wraps it in MCP `content[]` envelopes. Throws of `ArchkitError` map to MCP `isError: true` envelopes carrying `{ code, message, suggestion?, docsUrl? }`.

**Tech Stack:** Node.js >=18, ES modules (no build step), `@modelcontextprotocol/sdk@^1.29.0`, `zod@^3` for input schemas, existing `inquirer` retained.

**Source spec:** [docs/superpowers/specs/2026-04-28-archkit-mcp-server-design.md](../specs/2026-04-28-archkit-mcp-server-design.md)

---

## File Structure

**New files:**
- `bin/archkit-mcp.mjs` — bin entrypoint for MCP server
- `src/lib/errors.mjs` — `ArchkitError` class + `archkitError()` factory
- `src/mcp/server.mjs` — `McpServer` lifecycle, transport wiring
- `src/mcp/tools.mjs` — tool registry: name → { description, schema, handler }
- `src/mcp/envelope.mjs` — `toMcpResult`, `toMcpError`, `formatZodError`
- `tests/mcp-runners/<command>/run.mjs` x 8 — per-function unit tests
- `tests/mcp-envelope/run.mjs` — envelope unit tests
- `tests/mcp-server/run.mjs` — E2E MCP transport tests

**Modified files:**
- `package.json` — add `archkit-mcp` bin, add deps, bump to 1.4.0
- `bin/archkit.mjs` — route `mcp` subcommand
- `src/commands/review.mjs` — add `runReviewJson()` export
- `src/commands/resolve.mjs` — add `runLookupJson()` export
- `src/commands/resolve/warmup.mjs` — add `runWarmupJson()` export
- `src/commands/resolve/preflight.mjs` — add `runPreflightJson()` export
- `src/commands/resolve/scaffold.mjs` — add `runScaffoldJson()` export
- `src/commands/gotcha.mjs` — add `runGotchaListJson()` + `runGotchaProposeJson()` exports
- `src/commands/stats.mjs` — add `runStatsJson()` export
- `src/commands/drift.mjs` — add `runDriftJson()` export
- `src/commands/init.mjs` — add `--mcp` flag handling
- `src/data/skill-templates.mjs` — add MCP-preference line to archkit-protocol skill
- `README.md` — MCP install/registration section
- `CHANGELOG.md` (or wherever changes are tracked) — v1.4.0 entry

---

## Task 1: Install dependencies and version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install MCP SDK and Zod**

```bash
cd /Users/kenmiranda/Desktop/Projects/archkit
npm install @modelcontextprotocol/sdk@^1.29.0 zod@^3
```

Expected: both packages added to `dependencies` in `package.json`. No errors.

- [ ] **Step 2: Add `archkit-mcp` bin entry and bump version**

Edit `package.json`. Update the `version` and `bin` blocks to:

```json
{
  "name": "archkit",
  "version": "1.4.0",
  "bin": {
    "archkit": "./bin/archkit.mjs",
    "archkit-claude-hook": "./bin/archkit-claude-hook.mjs",
    "archkit-mcp": "./bin/archkit-mcp.mjs"
  }
}
```

- [ ] **Step 3: Verify install succeeded**

Run: `node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m => console.log(typeof m.McpServer))"`
Expected: prints `function`.

Run: `node -e "import('zod').then(m => console.log(typeof m.z))"`
Expected: prints `object`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add MCP SDK and zod, register archkit-mcp bin, bump to 1.4.0"
```

---

## Task 2: Implement ArchkitError class

**Files:**
- Create: `src/lib/errors.mjs`
- Test: `tests/mcp-envelope/run.mjs` (initial — error class tests only; envelope tests added in Task 11)

- [ ] **Step 1: Write failing test for ArchkitError class**

Create `tests/mcp-envelope/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { ArchkitError, archkitError } from "../../src/lib/errors.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

test("ArchkitError carries code, message, suggestion, docsUrl", () => {
  const e = new ArchkitError("no_arch_dir", "missing", {
    suggestion: "Run archkit init", docsUrl: "https://example.com",
  });
  assert.equal(e.code, "no_arch_dir");
  assert.equal(e.message, "missing");
  assert.equal(e.suggestion, "Run archkit init");
  assert.equal(e.docsUrl, "https://example.com");
  assert.equal(e.name, "ArchkitError");
  assert.ok(e instanceof Error);
});

test("ArchkitError without optional fields leaves them undefined", () => {
  const e = new ArchkitError("internal_error", "boom");
  assert.equal(e.suggestion, undefined);
  assert.equal(e.docsUrl, undefined);
});

test("archkitError factory returns an ArchkitError instance", () => {
  const e = archkitError("invalid_input", "bad", { suggestion: "fix it" });
  assert.ok(e instanceof ArchkitError);
  assert.equal(e.code, "invalid_input");
  assert.equal(e.suggestion, "fix it");
});

test("ArchkitError preserves cause", () => {
  const cause = new Error("inner");
  const e = new ArchkitError("internal_error", "wrap", { cause });
  assert.equal(e.cause, cause);
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-envelope/run.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/errors.mjs'`.

- [ ] **Step 3: Create `src/lib/errors.mjs`**

```javascript
// src/lib/errors.mjs
// Canonical archkit error envelope shared by CLI JSON output and MCP responses.
// Pure run*Json() functions throw ArchkitError; CLI wrappers map to stderr+exit,
// MCP wrappers map to isError: true envelopes.

export class ArchkitError extends Error {
  constructor(code, message, { suggestion, docsUrl, cause } = {}) {
    super(message, { cause });
    this.name = "ArchkitError";
    this.code = code;
    this.suggestion = suggestion;
    this.docsUrl = docsUrl;
  }
}

export function archkitError(code, message, opts) {
  return new ArchkitError(code, message, opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/mcp-envelope/run.mjs`
Expected: `Results: 4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.mjs tests/mcp-envelope/run.mjs
git commit -m "feat(errors): add ArchkitError class for shared CLI/MCP error envelope"
```

---

## Task 3: Extract `runReviewJson()` from review.mjs

**Files:**
- Modify: `src/commands/review.mjs`
- Create: `tests/mcp-runners/review/run.mjs`

- [ ] **Step 1: Write failing unit test**

Create `tests/mcp-runners/review/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReviewJson } from "../../../src/commands/review.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-review-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Type: Internal Tool\n## Stack: Node.js\n## Pattern: Simple Layered\n\n## Rules\n- Layered\n\n## Reserved Words\n\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(tmp, "test-file.js"), "const x = 1;\nexport default x;\n");
  return tmp;
}

await test("runReviewJson returns structured findings", async () => {
  const tmp = makeFixture();
  try {
    const result = await runReviewJson({ files: ["test-file.js"], archDir: path.join(tmp, ".arch"), cwd: tmp });
    assert.equal(typeof result.files, "number");
    assert.equal(typeof result.errors, "number");
    assert.equal(typeof result.warnings, "number");
    assert.equal(typeof result.pass, "boolean");
    assert.equal(typeof result.findings, "object");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test("runReviewJson throws ArchkitError when archDir missing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-review-noarch-"));
  try {
    await runReviewJson({ files: ["whatever.js"], archDir: null, cwd: tmp });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError, `expected ArchkitError, got ${err.constructor.name}`);
    assert.equal(err.code, "no_arch_dir");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test("runReviewJson throws when file does not exist", async () => {
  const tmp = makeFixture();
  try {
    await runReviewJson({ files: ["does-not-exist.js"], archDir: path.join(tmp, ".arch"), cwd: tmp });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "file_not_found");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-runners/review/run.mjs`
Expected: FAIL — `runReviewJson is not a function` (export missing).

- [ ] **Step 3: Refactor `src/commands/review.mjs`**

Add this import at the top alongside existing imports:

```javascript
import { execFileSync } from "node:child_process";
import { archkitError } from "../lib/errors.mjs";
```

(The existing file already imports `execSync` from `child_process`. Replace that with `execFileSync` — it's the safer git-invocation pattern used elsewhere in this codebase, e.g. `tests/review-json/run.mjs`.)

Add a new exported function above `function main()`:

```javascript
// Pure JSON runner — used by CLI --json path AND MCP server.
export async function runReviewJson({ files: fileArgs, archDir, cwd, staged, diff, dir, verify }) {
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init` in your project root.",
      docsUrl: "https://github.com/kenandrewmiranda/archkit#getting-started",
    });
  }

  const systemContent = loadFile(archDir, "SYSTEM.md");
  const { rules, reservedWords } = parseSystem(systemContent);
  const skills = loadSkills(archDir);
  const graphs = loadGraphs(archDir);
  const appType = getAppType(systemContent);

  const files = resolveReviewFiles({ fileArgs, cwd, archDir, staged, diff, dir, verify });

  for (const f of files) {
    if (!fs.existsSync(f)) {
      throw archkitError("file_not_found", `File not found: ${f}`, {
        suggestion: "Pass a path that exists relative to cwd.",
      });
    }
  }

  const allFindings = {};
  let totalErrors = 0, totalWarnings = 0, totalInfos = 0, cleanFiles = 0;

  for (const filepath of files) {
    const code = fs.readFileSync(filepath, "utf8");
    const findings = [
      ...checkGotchas(code, skills),
      ...checkArchitectureRules(code, filepath, rules, reservedWords),
      ...checkFileLocation(filepath, graphs),
      ...checkImportHierarchy(code, filepath),
      ...checkDatabasePatterns(code, filepath),
      ...checkCachePatterns(code, filepath),
      ...checkQueuePatterns(code, filepath),
      ...checkApiPatterns(code, filepath),
      ...checkFeatureCompleteness(code, filepath),
      ...checkFrontendWiring(code, filepath),
      ...checkEventPatterns(code, filepath),
      ...checkFloatingPromise(code, filepath),
      ...checkMockDataLeftover(code, filepath),
      ...checkDeadErrorHandler(code, filepath),
      ...checkUntrackedTodo(code, filepath),
      ...checkIncompleteSkeleton(code, filepath),
    ];
    if (appType === "realtime") findings.push(...checkRealtimeRules(code, filepath));
    if (appType === "ai") findings.push(...checkAIRules(code, filepath));
    if (appType === "data") findings.push(...checkDataRules(code, filepath));
    if (appType === "mobile") findings.push(...checkMobileRules(code, filepath));
    if (appType === "internal") findings.push(...checkInternalRules(code, filepath));
    if (appType === "content") findings.push(...checkContentRules(code, filepath));

    const suppressions = parseSuppressions(code);
    const archTypes = new Set(["import-hierarchy", "import-boundary", "boundary-violation", "reserved-word"]);
    const filtered = findings.filter(f => {
      if (archTypes.has(f.type)) return true;
      const supp = suppressions.find(s => s.line === f.line && s.ruleId === f.type);
      if (!supp) return true;
      const validation = validateReason(supp.reason);
      if (validation.ok) return false;
      if (validation.weak) {
        findings.push({
          type: "weak-suppression", severity: "error", line: f.line,
          message: `Suppression reason "${supp.reason}" is too vague — explain why this code is correct.`,
        });
      }
      return true;
    });

    allFindings[filepath] = filtered;
    totalErrors += filtered.filter(f => f.severity === "error").length;
    totalWarnings += filtered.filter(f => f.severity === "warning").length;
    totalInfos += filtered.filter(f => f.severity === "info").length;
    if (filtered.length === 0) cleanFiles++;
  }

  // Persist for --verify mode
  try {
    fs.writeFileSync(
      path.join(archDir, ".last-review.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), files: files.length, errors: totalErrors, warnings: totalWarnings, findings: allFindings })
    );
  } catch {}

  // Gotcha suggestions
  const gotchaSuggestions = [];
  for (const [filepath, findings] of Object.entries(allFindings)) {
    if (findings.length === 0) continue;
    const code = fs.readFileSync(filepath, "utf8");
    for (const [skillId, skill] of Object.entries(skills)) {
      if (skill.gotchas.length === 0 && code.toLowerCase().includes(skillId)) {
        gotchaSuggestions.push({ skill: skillId, file: filepath, hint: `${skillId}.skill has 0 gotchas but ${skillId} is used in this file` });
      }
    }
  }

  return {
    files: files.length,
    errors: totalErrors,
    warnings: totalWarnings,
    infos: totalInfos,
    clean: cleanFiles,
    pass: totalErrors === 0,
    findings: allFindings,
    gotchaSuggestions: gotchaSuggestions.length > 0 ? gotchaSuggestions : undefined,
  };
}

function resolveReviewFiles({ fileArgs, cwd, archDir, staged, diff, dir, verify }) {
  if (verify) {
    const lastPath = path.join(archDir, ".last-review.json");
    if (!fs.existsSync(lastPath)) {
      throw archkitError("no_previous_review", "No previous review to verify against",
        { suggestion: "Run `archkit review` first." });
    }
    const last = JSON.parse(fs.readFileSync(lastPath, "utf8"));
    return Object.entries(last.findings || {}).filter(([, f]) => f.length > 0).map(([p]) => p);
  }
  if (staged) {
    let out;
    try {
      out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
        { cwd, encoding: "utf8" });
    } catch (err) {
      throw archkitError("git_not_available", "git --staged failed", {
        suggestion: "Ensure you're in a git repo with staged changes.", cause: err,
      });
    }
    return out.split("\n").filter(Boolean).filter(f => /\.(js|mjs|ts|tsx|jsx)$/.test(f));
  }
  if (diff) {
    let out;
    try {
      out = execFileSync("git", ["diff", "--name-only"], { cwd, encoding: "utf8" });
    } catch (err) {
      throw archkitError("git_not_available", "git --diff failed", {
        suggestion: "Ensure you're in a git repo.", cause: err,
      });
    }
    return out.split("\n").filter(Boolean).filter(f => /\.(js|mjs|ts|tsx|jsx)$/.test(f));
  }
  if (dir) {
    return walkDir(dir).filter(f => /\.(js|mjs|ts|tsx|jsx)$/.test(f));
  }
  return fileArgs;
}

function walkDir(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") out.push(...walkDir(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
```

In `function main()`, replace the body that currently builds and emits the JSON (the agent-mode block around line 427–532) with a call to `runReviewJson`:

```javascript
const isJson = args.includes("--json") || args.includes("--agent");

if (isJson) {
  try {
    const result = await runReviewJson({
      files: args.filter(a => !a.startsWith("--")),
      archDir,
      cwd: process.cwd(),
      staged: args.includes("--staged"),
      diff: args.includes("--diff"),
      dir: args.find((a, i) => args[i - 1] === "--dir"),
      verify: args.includes("--verify"),
    });
    console.log(JSON.stringify(result));
    process.exit(result.errors > 0 ? 1 : 0);
  } catch (err) {
    console.log(JSON.stringify({
      error: err.code || "internal_error",
      message: err.message,
      suggestion: err.suggestion,
      docsUrl: err.docsUrl,
    }));
    process.exit(1);
  }
}

// Human-readable path remains unchanged below.
```

The human-readable path keeps its existing logic unchanged.

- [ ] **Step 4: Run new test to verify it passes**

Run: `node tests/mcp-runners/review/run.mjs`
Expected: `Results: 3 passed, 0 failed`.

- [ ] **Step 5: Run existing CLI test to verify no regression**

Run: `node tests/review-json/run.mjs`
Expected: `Results: 2 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src/commands/review.mjs tests/mcp-runners/review/run.mjs
git commit -m "refactor(review): extract runReviewJson() pure function for MCP reuse"
```

---

## Task 4: Extract `runWarmupJson()` from resolve/warmup.mjs

**Files:**
- Modify: `src/commands/resolve/warmup.mjs`
- Create: `tests/mcp-runners/warmup/run.mjs`

- [ ] **Step 1: Write failing unit test**

Create `tests/mcp-runners/warmup/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWarmupJson } from "../../../src/commands/resolve/warmup.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-warmup-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## Rules\n- Rule 1\n\n## Reserved Words\n$tenant = scoped to current org\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "test → @test\n");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n");
  return path.join(tmp, ".arch");
}

await test("runWarmupJson returns pass/blockers/warnings/actions/checks", async () => {
  const arch = makeFixture();
  const result = await runWarmupJson({ archDir: arch, deep: false });
  assert.equal(typeof result.pass, "boolean");
  assert.ok(Array.isArray(result.blockers));
  assert.ok(Array.isArray(result.warnings));
  assert.ok(Array.isArray(result.actions));
  assert.ok(Array.isArray(result.checks));
  fs.rmSync(path.dirname(arch), { recursive: true, force: true });
});

await test("runWarmupJson throws no_arch_dir when archDir is null", async () => {
  try { await runWarmupJson({ archDir: null }); assert.fail("expected throw"); }
  catch (err) { assert.ok(err instanceof ArchkitError); assert.equal(err.code, "no_arch_dir"); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-runners/warmup/run.mjs`
Expected: FAIL — `runWarmupJson is not a function`.

- [ ] **Step 3: Add `runWarmupJson()` export to `src/commands/resolve/warmup.mjs`**

Add import at top:

```javascript
import { archkitError } from "../../lib/errors.mjs";
```

Add at the bottom of the file (or alongside existing exports):

```javascript
export async function runWarmupJson({ archDir, deep = false }) {
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init` in your project root.",
    });
  }
  const result = cmdWarmup(archDir, deep);
  return {
    pass: result.pass,
    blockers: result.blockers || [],
    warnings: result.warnings || [],
    actions: result.actions || [],
    checks: result.checks || [],
  };
}
```

If `cmdWarmup` currently writes to stdout instead of returning the data, refactor it: change `cmdWarmup` to return `{ pass, blockers, warnings, actions, checks }` instead of console.log-ing them. Move stdout-emission to the CLI caller in `src/commands/resolve.mjs`.

- [ ] **Step 4: Run new test to verify it passes**

Run: `node tests/mcp-runners/warmup/run.mjs`
Expected: `Results: 2 passed, 0 failed`.

- [ ] **Step 5: Verify CLI still works**

Set up a fixture and run the CLI smoke check:

```bash
mkdir -p /tmp/warmup-smoke/.arch/clusters && \
printf '## Rules\n- R\n' > /tmp/warmup-smoke/.arch/SYSTEM.md && \
touch /tmp/warmup-smoke/.arch/INDEX.md && \
printf '[a]\n' > /tmp/warmup-smoke/.arch/clusters/a.graph && \
cd /tmp/warmup-smoke && \
node /Users/kenmiranda/Desktop/Projects/archkit/bin/archkit.mjs resolve warmup --json
```

Expected: Valid JSON output containing a `"pass":` key.

Cleanup: `rm -rf /tmp/warmup-smoke`

- [ ] **Step 6: Commit**

```bash
git add src/commands/resolve/warmup.mjs src/commands/resolve.mjs tests/mcp-runners/warmup/run.mjs
git commit -m "refactor(warmup): extract runWarmupJson() pure function for MCP reuse"
```

---

## Task 5: Extract `runPreflightJson()` from resolve/preflight.mjs

**Files:**
- Modify: `src/commands/resolve/preflight.mjs`
- Create: `tests/mcp-runners/preflight/run.mjs`

- [ ] **Step 1: Write failing unit test**

Create `tests/mcp-runners/preflight/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPreflightJson } from "../../../src/commands/resolve/preflight.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-preflight-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- Layered\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"),
    "[auth] : authentication cluster\n  [login] : user → session\n");
  return tmp;
}

await test("runPreflightJson returns structured data for known feature", async () => {
  const tmp = makeFixture();
  try {
    const result = await runPreflightJson({
      archDir: path.join(tmp, ".arch"),
      cwd: tmp,
      feature: "auth",
      layer: "controller",
    });
    assert.equal(typeof result, "object");
    assert.ok(result !== null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test("runPreflightJson throws no_arch_dir without archDir", async () => {
  try {
    await runPreflightJson({ archDir: null, feature: "x", layer: "y" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "no_arch_dir");
  }
});

await test("runPreflightJson throws on missing feature", async () => {
  try {
    await runPreflightJson({ archDir: "/tmp/x", feature: "", layer: "controller" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "invalid_input");
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-runners/preflight/run.mjs`
Expected: FAIL — `runPreflightJson is not a function`.

- [ ] **Step 3: Add `runPreflightJson()` export to `src/commands/resolve/preflight.mjs`**

Add import at top:

```javascript
import { archkitError } from "../../lib/errors.mjs";
```

Add export:

```javascript
export async function runPreflightJson({ archDir, cwd = process.cwd(), feature, layer }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  if (!feature) throw archkitError("invalid_input", "feature is required", { suggestion: "Pass a feature name (e.g. 'auth')." });
  if (!layer) throw archkitError("invalid_input", "layer is required", { suggestion: "Pass a layer (controller/service/repo)." });

  const result = cmdPreflight(archDir, feature, layer, { cwd, returnData: true });
  return result;
}
```

If `cmdPreflight` does not currently support a `returnData` flag, refactor it: collect its return data into an object and return it. The CLI caller in `src/commands/resolve.mjs` then `console.log(JSON.stringify(result))`.

- [ ] **Step 4: Run new test to verify it passes**

Run: `node tests/mcp-runners/preflight/run.mjs`
Expected: `Results: 3 passed, 0 failed`.

- [ ] **Step 5: Run existing preflight test to verify no regression**

Run: `node tests/preflight-live/run.mjs`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/resolve/preflight.mjs src/commands/resolve.mjs tests/mcp-runners/preflight/run.mjs
git commit -m "refactor(preflight): extract runPreflightJson() pure function for MCP reuse"
```

---

## Task 6: Extract `runScaffoldJson()` from resolve/scaffold.mjs

**Files:**
- Modify: `src/commands/resolve/scaffold.mjs`
- Create: `tests/mcp-runners/scaffold/run.mjs`

- [ ] **Step 1: Write failing unit test**

Create `tests/mcp-runners/scaffold/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runScaffoldJson } from "../../../src/commands/resolve/scaffold.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-scaffold-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- Layered\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "clusters", "billing.graph"),
    "[billing]\n  [invoice]\n");
  return tmp;
}

await test("runScaffoldJson returns checklist for new feature", async () => {
  const tmp = makeFixture();
  try {
    const result = await runScaffoldJson({
      archDir: path.join(tmp, ".arch"), cwd: tmp, feature: "billing",
    });
    assert.equal(typeof result, "object");
    assert.ok(result !== null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await test("runScaffoldJson throws on missing feature", async () => {
  try {
    await runScaffoldJson({ archDir: "/tmp/x", feature: "" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "invalid_input");
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-runners/scaffold/run.mjs`
Expected: FAIL — `runScaffoldJson is not a function`.

- [ ] **Step 3: Add `runScaffoldJson()` export to `src/commands/resolve/scaffold.mjs`**

Add import:

```javascript
import { archkitError } from "../../lib/errors.mjs";
```

Add export:

```javascript
export async function runScaffoldJson({ archDir, cwd = process.cwd(), feature }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  if (!feature) throw archkitError("invalid_input", "feature is required", { suggestion: "Pass a feature name." });
  return cmdScaffold(archDir, feature, { cwd, returnData: true });
}
```

If `cmdScaffold` does not return a structured result today, refactor it so it returns the checklist data; the CLI caller handles logging.

- [ ] **Step 4: Run new test to verify it passes**

Run: `node tests/mcp-runners/scaffold/run.mjs`
Expected: `Results: 2 passed, 0 failed`.

- [ ] **Step 5: Run existing scaffold tests to verify no regression**

Run: `node tests/scaffold-live/run.mjs`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/resolve/scaffold.mjs src/commands/resolve.mjs tests/mcp-runners/scaffold/run.mjs
git commit -m "refactor(scaffold): extract runScaffoldJson() pure function for MCP reuse"
```

---

## Task 7: Extract `runLookupJson()` from resolve.mjs

**Files:**
- Modify: `src/commands/resolve.mjs`
- Create: `tests/mcp-runners/lookup/run.mjs`

- [ ] **Step 1: Write failing unit test**

Create `tests/mcp-runners/lookup/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runLookupJson } from "../../../src/commands/resolve.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-lookup-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- R\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"),
    "[auth]\n  [login] : signs user in\n");
  fs.writeFileSync(path.join(arch, "skills", "postgres.skill"),
    "## Meta\npackage: postgres\n## Use\nUsed for storage.\n");
  return path.join(tmp, ".arch");
}

await test("runLookupJson finds a node by id", async () => {
  const arch = makeFixture();
  try {
    const result = await runLookupJson({ archDir: arch, id: "login" });
    assert.equal(typeof result, "object");
    assert.ok(result !== null);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("runLookupJson throws node_not_found for unknown id", async () => {
  const arch = makeFixture();
  try {
    await runLookupJson({ archDir: arch, id: "nonexistent-xyz" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "node_not_found");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-runners/lookup/run.mjs`
Expected: FAIL — `runLookupJson is not a function`.

- [ ] **Step 3: Extract `runLookupJson()` in `src/commands/resolve.mjs`**

Add import at top:

```javascript
import { archkitError } from "../lib/errors.mjs";
```

Add export. The current `lookup` branch in `main()` searches clusters, skills, and cluster-lists. Refactor that logic into a pure function:

```javascript
export async function runLookupJson({ archDir, id }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  if (!id || typeof id !== "string") throw archkitError("invalid_input", "id is required (string)", { suggestion: "Pass a node, skill, or cluster id." });

  const indexContent = loadFile(archDir, "INDEX.md");
  const index = parseIndex(indexContent);

  // Search nodes (from clusters)
  const clustersDir = path.join(archDir, "clusters");
  if (fs.existsSync(clustersDir)) {
    for (const file of fs.readdirSync(clustersDir).filter(f => f.endsWith(".graph"))) {
      const clusterId = file.replace(".graph", "");
      const cluster = loadGraphCluster(archDir, clusterId);
      if (clusterId === id) return { type: "cluster", id: clusterId, ...cluster };
      if (cluster.nodes && cluster.nodes[id]) {
        return { type: "node", id, cluster: clusterId, ...cluster.nodes[id] };
      }
    }
  }

  // Search skills
  const skillsDir = path.join(archDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))) {
      const skillId = file.replace(".skill", "");
      if (skillId === id) {
        const gotchas = loadSkillGotchas(archDir, skillId);
        return { type: "skill", id: skillId, gotchas };
      }
    }
  }

  throw archkitError("node_not_found", `No node, skill, or cluster found with id: ${id}`, {
    suggestion: "Run `archkit stats --json` to see available ids.",
  });
}
```

In `main()`, replace the lookup branch JSON path with a call to `runLookupJson` and console.log + exit handling matching the pattern in Task 3 step 3.

- [ ] **Step 4: Run new test to verify it passes**

Run: `node tests/mcp-runners/lookup/run.mjs`
Expected: `Results: 2 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/commands/resolve.mjs tests/mcp-runners/lookup/run.mjs
git commit -m "refactor(resolve): extract runLookupJson() pure function for MCP reuse"
```

---

## Task 8: Extract `runGotchaListJson()` and `runGotchaProposeJson()` from gotcha.mjs

**Files:**
- Modify: `src/commands/gotcha.mjs`
- Create: `tests/mcp-runners/gotcha/run.mjs`

- [ ] **Step 1: Write failing unit test**

Create `tests/mcp-runners/gotcha/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGotchaListJson, runGotchaProposeJson } from "../../../src/commands/gotcha.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-gotcha-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- R\n");
  fs.writeFileSync(path.join(arch, "skills", "postgres.skill"),
    "## Meta\npackage: postgres\n## Gotchas\nWRONG: SELECT *\nRIGHT: SELECT id\nWHY: explicit\n");
  return path.join(tmp, ".arch");
}

await test("runGotchaListJson returns skill list with gotcha counts", async () => {
  const arch = makeFixture();
  try {
    const result = await runGotchaListJson({ archDir: arch });
    assert.ok(Array.isArray(result.skills));
    const pg = result.skills.find(s => s.id === "postgres");
    assert.ok(pg, "should include postgres skill");
    assert.ok(pg.gotchas >= 1);
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("runGotchaProposeJson queues a proposal and returns its path", async () => {
  const arch = makeFixture();
  try {
    const result = await runGotchaProposeJson({
      archDir: arch,
      skill: "postgres",
      wrong: "SELECT * FROM x",
      right: "SELECT id FROM x",
      why: "explicit columns",
    });
    assert.equal(result.queued, true);
    assert.equal(typeof result.proposalPath, "string");
    assert.ok(fs.existsSync(result.proposalPath), "proposal file should exist on disk");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("runGotchaProposeJson throws on missing required field", async () => {
  const arch = makeFixture();
  try {
    await runGotchaProposeJson({ archDir: arch, skill: "postgres", wrong: "x", right: "y" /* why missing */ });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ArchkitError);
    assert.equal(err.code, "proposal_invalid");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-runners/gotcha/run.mjs`
Expected: FAIL — `runGotchaListJson is not a function`.

- [ ] **Step 3: Add exports to `src/commands/gotcha.mjs`**

Add import:

```javascript
import { archkitError } from "../lib/errors.mjs";
```

Add exports (extract from existing `--list` and `--propose` branches):

```javascript
export async function runGotchaListJson({ archDir }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  const skillsDir = path.join(archDir, "skills");
  if (!fs.existsSync(skillsDir)) return { skills: [] };
  const skills = [];
  for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))) {
    const id = file.replace(".skill", "");
    const content = fs.readFileSync(path.join(skillsDir, file), "utf8");
    const gotchas = parseGotchas(content);
    skills.push({ id, gotchas: gotchas.length });
  }
  return { skills };
}

export async function runGotchaProposeJson({ archDir, skill, wrong, right, why, appType }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  for (const [key, val] of Object.entries({ skill, wrong, right, why })) {
    if (!val || typeof val !== "string") {
      throw archkitError("proposal_invalid", `Missing required field: ${key}`, {
        suggestion: "Provide all of: skill, wrong, right, why.",
      });
    }
  }
  const proposalsDir = path.join(archDir, "proposals");
  fs.mkdirSync(proposalsDir, { recursive: true });
  const proposalPath = path.join(proposalsDir, `${skill}-${Date.now()}.json`);
  fs.writeFileSync(proposalPath, JSON.stringify({ skill, wrong, right, why, appType, timestamp: new Date().toISOString() }, null, 2));
  return { queued: true, proposalPath };
}
```

If gotcha.mjs already imports `parseGotchas`, reuse it. Match the existing proposal file naming and storage location used by the current `--propose` branch (read the existing code first; align names so `tests/proposals/run.mjs` keeps passing).

In `main()`, route the `--list --json` branch and `--propose` branch through these new functions, then `console.log(JSON.stringify(result))`.

- [ ] **Step 4: Run new test to verify it passes**

Run: `node tests/mcp-runners/gotcha/run.mjs`
Expected: `Results: 3 passed, 0 failed`.

- [ ] **Step 5: Run existing proposals test to verify no regression**

Run: `node tests/proposals/run.mjs`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/gotcha.mjs tests/mcp-runners/gotcha/run.mjs
git commit -m "refactor(gotcha): extract runGotchaListJson() and runGotchaProposeJson()"
```

---

## Task 9: Extract `runStatsJson()` from stats.mjs

**Files:**
- Modify: `src/commands/stats.mjs`
- Create: `tests/mcp-runners/stats/run.mjs`

- [ ] **Step 1: Write failing unit test**

Create `tests/mcp-runners/stats/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runStatsJson } from "../../../src/commands/stats.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-stats-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.mkdirSync(path.join(arch, "apis"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Rules\n- R\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "test → @test\n");
  fs.writeFileSync(path.join(arch, "skills", "postgres.skill"),
    "## Meta\npackage: postgres\nversion: 15\n## Use\nU\n## Gotchas\nWRONG: x\nRIGHT: y\nWHY: z\n");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n  [login]\n");
  return path.join(tmp, ".arch");
}

await test("runStatsJson returns health, system, index, skills, graphs, recommendations", async () => {
  const arch = makeFixture();
  try {
    const result = await runStatsJson({ archDir: arch });
    assert.equal(typeof result.health, "object");
    assert.equal(typeof result.health.pct, "number");
    assert.ok(Array.isArray(result.health.checks));
    assert.equal(result.system.exists, true);
    assert.ok(Array.isArray(result.skills));
    assert.ok(Array.isArray(result.graphs));
    assert.ok(Array.isArray(result.recommendations));
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("runStatsJson throws no_arch_dir when archDir missing", async () => {
  try { await runStatsJson({ archDir: null }); assert.fail("expected throw"); }
  catch (err) { assert.ok(err instanceof ArchkitError); assert.equal(err.code, "no_arch_dir"); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-runners/stats/run.mjs`
Expected: FAIL — `runStatsJson is not a function`.

- [ ] **Step 3: Add `runStatsJson()` export to `src/commands/stats.mjs`**

Add import:

```javascript
import { archkitError } from "../lib/errors.mjs";
```

Add export. The file already has `analyzeSystem`, `analyzeIndex`, `analyzeSkills`, `analyzeGraphs`, `analyzeApis`, `calculateHealthScore` — reuse them:

```javascript
export async function runStatsJson({ archDir }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  const sys = analyzeSystem(archDir);
  const idx = analyzeIndex(archDir);
  const skills = analyzeSkills(archDir);
  const graphs = analyzeGraphs(archDir);
  const apis = analyzeApis(archDir);
  const health = calculateHealthScore(sys, idx, skills, graphs, apis);
  const recommendations = buildRecommendations(sys, idx, skills, graphs, apis);
  return { health, system: sys, index: idx, skills, graphs, apis, recommendations };
}
```

If `buildRecommendations` is not yet a standalone helper, extract it from `displayOverallScore()` (per the existing JSON-readiness spec at `docs/superpowers/specs/2026-04-12-json-agent-readiness-design.md`) into a pure function near the top of stats.mjs.

In `main()`, replace the existing `--json` block with `const result = await runStatsJson({ archDir }); console.log(JSON.stringify(result)); return;`.

- [ ] **Step 4: Run new test to verify it passes**

Run: `node tests/mcp-runners/stats/run.mjs`
Expected: `Results: 2 passed, 0 failed`.

- [ ] **Step 5: Run existing CLI test to verify no regression**

Run: `node tests/stats-json/run.mjs`
Expected: All existing tests pass (4 passed).

- [ ] **Step 6: Commit**

```bash
git add src/commands/stats.mjs tests/mcp-runners/stats/run.mjs
git commit -m "refactor(stats): extract runStatsJson() pure function for MCP reuse"
```

---

## Task 10: Extract `runDriftJson()` from drift.mjs

**Files:**
- Modify: `src/commands/drift.mjs`
- Create: `tests/mcp-runners/drift/run.mjs`

- [ ] **Step 1: Write failing unit test**

Create `tests/mcp-runners/drift/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDriftJson } from "../../../src/commands/drift.mjs";
import { ArchkitError } from "../../../src/lib/errors.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-drift-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"), "## Rules\n- R\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "skills", "stale.skill"), "## Meta\npackage: nonexistent-zzz-pkg\n");
  return path.join(tmp, ".arch");
}

await test("runDriftJson returns stale array and summary", async () => {
  const arch = makeFixture();
  try {
    const result = await runDriftJson({ archDir: arch, cwd: path.dirname(arch) });
    assert.ok(Array.isArray(result.stale));
    assert.equal(typeof result.summary, "object");
  } finally {
    fs.rmSync(path.dirname(arch), { recursive: true, force: true });
  }
});

await test("runDriftJson throws no_arch_dir when archDir missing", async () => {
  try { await runDriftJson({ archDir: null }); assert.fail("expected throw"); }
  catch (err) { assert.ok(err instanceof ArchkitError); assert.equal(err.code, "no_arch_dir"); }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-runners/drift/run.mjs`
Expected: FAIL — `runDriftJson is not a function`.

- [ ] **Step 3: Add `runDriftJson()` export to `src/commands/drift.mjs`**

Add import:

```javascript
import { archkitError } from "../lib/errors.mjs";
```

Add export reusing existing drift-detection helpers:

```javascript
export async function runDriftJson({ archDir, cwd = process.cwd() }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });

  const stale = detectStaleFiles(archDir, cwd);
  const summary = {
    total: stale.length,
    bySeverity: stale.reduce((acc, s) => { acc[s.severity] = (acc[s.severity] || 0) + 1; return acc; }, {}),
  };
  return { stale, summary };
}
```

If `detectStaleFiles` does not exist yet, extract the drift-detection logic from `main()` into a pure helper. Then in `main()`, the `--json` branch becomes `const r = await runDriftJson({ archDir }); console.log(JSON.stringify(r));`.

- [ ] **Step 4: Run new test to verify it passes**

Run: `node tests/mcp-runners/drift/run.mjs`
Expected: `Results: 2 passed, 0 failed`.

- [ ] **Step 5: Run existing drift tests to verify no regression**

Run: `node tests/drift-fix/run.mjs`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/drift.mjs tests/mcp-runners/drift/run.mjs
git commit -m "refactor(drift): extract runDriftJson() pure function for MCP reuse"
```

---

## Task 11: Implement MCP envelope helpers

**Files:**
- Create: `src/mcp/envelope.mjs`
- Modify: `tests/mcp-envelope/run.mjs` (extend with envelope tests)

- [ ] **Step 1: Extend the failing test file**

Append to `tests/mcp-envelope/run.mjs` (after the existing ArchkitError tests, before the summary):

```javascript
// Envelope tests
import { toMcpResult, toMcpError, formatZodError } from "../../src/mcp/envelope.mjs";
import { z } from "zod";

test("toMcpResult wraps data as MCP text content", () => {
  const r = toMcpResult({ ok: true, items: [1, 2] });
  assert.deepEqual(r, { content: [{ type: "text", text: '{"ok":true,"items":[1,2]}' }] });
});

test("toMcpError on ArchkitError preserves code/message/suggestion/docsUrl", () => {
  const err = new ArchkitError("no_arch_dir", "missing", {
    suggestion: "Run init", docsUrl: "https://x.com",
  });
  const r = toMcpError(err);
  assert.equal(r.isError, true);
  const env = JSON.parse(r.content[0].text);
  assert.equal(env.code, "no_arch_dir");
  assert.equal(env.message, "missing");
  assert.equal(env.suggestion, "Run init");
  assert.equal(env.docsUrl, "https://x.com");
});

test("toMcpError on unknown Error returns internal_error envelope", () => {
  const r = toMcpError(new Error("boom"));
  assert.equal(r.isError, true);
  const env = JSON.parse(r.content[0].text);
  assert.equal(env.code, "internal_error");
  assert.equal(env.message, "boom");
  assert.equal(env.suggestion, undefined);
});

test("formatZodError produces a readable single-line summary", () => {
  const schema = z.object({ files: z.array(z.string()).min(1) });
  const result = schema.safeParse({ files: [] });
  const msg = formatZodError(result.error);
  assert.ok(msg.includes("files"), `expected message to mention 'files', got: ${msg}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-envelope/run.mjs`
Expected: FAIL — `Cannot find module '.../src/mcp/envelope.mjs'`.

- [ ] **Step 3: Create `src/mcp/envelope.mjs`**

```javascript
// src/mcp/envelope.mjs
// Shape MCP tool responses. Success returns { content: [...] }; failure
// returns { isError: true, content: [...] } with a JSON-encoded archkit envelope
// inside. Keeps the agent's error-handling logic identical to the CLI's
// --json error path.

import { ArchkitError } from "../lib/errors.mjs";

export function toMcpResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function toMcpError(err) {
  const envelope = err instanceof ArchkitError
    ? {
        code: err.code,
        message: err.message,
        suggestion: err.suggestion,
        docsUrl: err.docsUrl,
      }
    : { code: "internal_error", message: err && err.message ? err.message : "unknown error" };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(envelope) }],
  };
}

export function formatZodError(zodError) {
  const issues = zodError.issues || [];
  if (issues.length === 0) return "invalid input";
  return issues.map(i => {
    const p = (i.path || []).join(".") || "<root>";
    return `${p}: ${i.message}`;
  }).join("; ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/mcp-envelope/run.mjs`
Expected: `Results: 8 passed, 0 failed` (4 ArchkitError tests + 4 envelope tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/envelope.mjs tests/mcp-envelope/run.mjs
git commit -m "feat(mcp): add envelope helpers (toMcpResult, toMcpError, formatZodError)"
```

---

## Task 12: Implement MCP tool registry

**Files:**
- Create: `src/mcp/tools.mjs`

This file is data + dispatch: tool definitions paired with handler functions that import the `run*Json()` exports from Tasks 3–10. Tests for it run through the E2E suite in Task 14.

- [ ] **Step 1: Create `src/mcp/tools.mjs`**

```javascript
// src/mcp/tools.mjs
// Tool registry for archkit MCP server. Each entry has:
//   - description: prose used at tool-pick time (CRITICAL — iterate post-dogfood)
//   - inputSchema: Zod schema for validation
//   - handler: (validatedInput) => Promise<resultObject> (throws ArchkitError on failure)

import { z } from "zod";
import path from "node:path";
import fs from "node:fs";

import { runReviewJson } from "../commands/review.mjs";
import { runWarmupJson } from "../commands/resolve/warmup.mjs";
import { runPreflightJson } from "../commands/resolve/preflight.mjs";
import { runScaffoldJson } from "../commands/resolve/scaffold.mjs";
import { runLookupJson } from "../commands/resolve.mjs";
import { runGotchaListJson, runGotchaProposeJson } from "../commands/gotcha.mjs";
import { runStatsJson } from "../commands/stats.mjs";
import { runDriftJson } from "../commands/drift.mjs";
import { archkitError } from "../lib/errors.mjs";

function findArchDir(cwd) {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, ".arch");
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "SYSTEM.md"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function requireArchDir(cwd) {
  const archDir = findArchDir(cwd);
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init` in your project root.",
      docsUrl: "https://github.com/kenandrewmiranda/archkit#getting-started",
    });
  }
  return archDir;
}

export const tools = {
  archkit_review: {
    description: "Review one or more files against archkit rules and gotchas, returning structured findings with severities. When to use: AFTER editing code, BEFORE committing.",
    inputSchema: z.object({
      files: z.array(z.string().min(1)).min(1),
    }),
    handler: async ({ files }) => {
      const cwd = process.cwd();
      return runReviewJson({ files, archDir: requireArchDir(cwd), cwd });
    },
  },

  archkit_review_staged: {
    description: "Review all git-staged files against archkit rules. When to use: as a pre-commit safety net, or when the user mentions staging.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runReviewJson({ files: [], archDir: requireArchDir(cwd), cwd, staged: true });
    },
  },

  archkit_resolve_warmup: {
    description: "Run pre-session health checks on the .arch/ context system. Returns blockers, warnings, and actions. When to use: at the START of a coding session, or whenever context drift is suspected.",
    inputSchema: z.object({
      deep: z.boolean().optional(),
    }),
    handler: async ({ deep }) => {
      const cwd = process.cwd();
      return runWarmupJson({ archDir: requireArchDir(cwd), deep });
    },
  },

  archkit_resolve_preflight: {
    description: "Verify a feature/layer combination exists and is correctly wired before generating code. When to use: BEFORE writing or modifying code in a feature path.",
    inputSchema: z.object({
      feature: z.string().min(1),
      layer: z.string().min(1),
    }),
    handler: async ({ feature, layer }) => {
      const cwd = process.cwd();
      return runPreflightJson({ archDir: requireArchDir(cwd), cwd, feature, layer });
    },
  },

  archkit_resolve_scaffold: {
    description: "Return the scaffolding checklist for a new feature: which files to create, in what order, with what naming conventions. When to use: when starting a new feature, BEFORE creating files.",
    inputSchema: z.object({
      feature: z.string().min(1),
    }),
    handler: async ({ feature }) => {
      const cwd = process.cwd();
      return runScaffoldJson({ archDir: requireArchDir(cwd), cwd, feature });
    },
  },

  archkit_resolve_lookup: {
    description: "Look up a single node, skill, or cluster by id and return its details. When to use: when you need to know what a referenced symbol or package is for.",
    inputSchema: z.object({
      id: z.string().min(1),
    }),
    handler: async ({ id }) => {
      const cwd = process.cwd();
      return runLookupJson({ archDir: requireArchDir(cwd), id });
    },
  },

  archkit_gotcha_propose: {
    description: "Queue a new gotcha proposal capturing a wrong/right pattern with a why explanation. When to use: when you discover a pattern that should be enforced or warned about in future sessions.",
    inputSchema: z.object({
      skill: z.string().min(1),
      wrong: z.string().min(1),
      right: z.string().min(1),
      why: z.string().min(1),
      appType: z.string().optional(),
    }),
    handler: async (input) => {
      const cwd = process.cwd();
      return runGotchaProposeJson({ archDir: requireArchDir(cwd), ...input });
    },
  },

  archkit_gotcha_list: {
    description: "List all skills with their gotcha counts. When to use: to see what gotchas already exist before proposing a new one, or to identify skills with weak coverage.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runGotchaListJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_stats: {
    description: "Get a health dashboard for the .arch/ context system: SYSTEM/INDEX coverage, skills, graphs, APIs, and prioritized recommendations. When to use: to assess archkit setup completeness or pick what to improve next.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runStatsJson({ archDir: requireArchDir(cwd) });
    },
  },

  archkit_drift: {
    description: "Detect stale .arch/ files (e.g. skills referencing removed packages, missing imports). When to use: as a periodic maintenance check or when the codebase has changed significantly.",
    inputSchema: z.object({}),
    handler: async () => {
      const cwd = process.cwd();
      return runDriftJson({ archDir: requireArchDir(cwd), cwd });
    },
  },
};
```

- [ ] **Step 2: Smoke-check the file imports cleanly**

Run: `node -e "import('./src/mcp/tools.mjs').then(m => console.log('Loaded ' + Object.keys(m.tools).length + ' tools')).catch(e => { console.error(e); process.exit(1); })"`
Expected: `Loaded 10 tools`.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools.mjs
git commit -m "feat(mcp): add tool registry wiring 10 archkit_* tools to run*Json exports"
```

---

## Task 13: Implement MCP server and bin entrypoint

**Files:**
- Create: `src/mcp/server.mjs`
- Create: `bin/archkit-mcp.mjs`
- Modify: `bin/archkit.mjs` (route `mcp` subcommand)

- [ ] **Step 1: Create `src/mcp/server.mjs`**

```javascript
// src/mcp/server.mjs
// archkit MCP server — stdio transport, no auth, no persistent state.
// Exposes 10 archkit_* tools defined in ./tools.mjs.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "./tools.mjs";
import { toMcpResult, toMcpError, formatZodError } from "./envelope.mjs";
import { archkitError } from "../lib/errors.mjs";

export async function startMcpServer() {
  const server = new McpServer({
    name: "archkit",
    version: "1.4.0",
  });

  for (const [toolName, def] of Object.entries(tools)) {
    server.registerTool(
      toolName,
      {
        description: def.description,
        inputSchema: def.inputSchema,
      },
      async (rawInput) => {
        const parsed = def.inputSchema.safeParse(rawInput);
        if (!parsed.success) {
          return toMcpError(archkitError(
            "invalid_input",
            formatZodError(parsed.error),
            { suggestion: "Check the tool's input schema." }
          ));
        }
        try {
          const result = await def.handler(parsed.data);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err);
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    process.stderr.write("[archkit-mcp] shutting down\n");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  process.stderr.write("[archkit-mcp] ready (stdio, 10 tools)\n");
}
```

Note: the exact registration API on `McpServer` may differ slightly between SDK versions. If `registerTool` does not exist on v1.29.0, use the equivalent (`server.tool(name, schema, handler)` or whatever the SDK exposes — check `node_modules/@modelcontextprotocol/sdk/dist/` TypeScript definitions). Adjust the call sites only; the (description, inputSchema, handler) shape maps onto whichever method.

- [ ] **Step 2: Create `bin/archkit-mcp.mjs`**

```javascript
#!/usr/bin/env node
// archkit-mcp — stdio MCP server for archkit.
// Also reachable via `archkit mcp serve`.

import { startMcpServer } from "../src/mcp/server.mjs";

startMcpServer().catch(err => {
  process.stderr.write(`[archkit-mcp] fatal: ${err.message}\n`);
  process.exit(1);
});
```

Make it executable:

```bash
chmod +x bin/archkit-mcp.mjs
```

- [ ] **Step 3: Route `mcp` subcommand in `bin/archkit.mjs`**

Edit the `commands` map in `bin/archkit.mjs` to add an entry. After the existing entries:

```javascript
const commands = {
  init:     "../src/commands/init.mjs",
  resolve:  "../src/commands/resolve.mjs",
  gotcha:   "../src/commands/gotcha.mjs",
  review:   "../src/commands/review.mjs",
  stats:    "../src/commands/stats.mjs",
  drift:    "../src/commands/drift.mjs",
  export:   "../src/commands/export.mjs",
  sync:     "../src/commands/sync.mjs",
  update:   "../src/commands/update.mjs",
  migrate:  "../src/commands/migrate.mjs",
  market:   "../src/commands/market.mjs",
  mcp:      "../bin/archkit-mcp.mjs",   // NEW
};
```

If the existing routing logic enforces argument removal that would break this, route `mcp` separately — add a check before the generic dispatch:

```javascript
if (command === "mcp") {
  await import(path.resolve(__dirname, "../bin/archkit-mcp.mjs"));
} else if (command && commands[command]) {
  // existing path
}
```

- [ ] **Step 4: Smoke-test the bin runs**

Run a one-shot init message and confirm the bin replies:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}\n' \
  | timeout 3 node /Users/kenmiranda/Desktop/Projects/archkit/bin/archkit-mcp.mjs
```

Expected: stdout contains a JSON-RPC response with a `"result"` object (the initialize reply); stderr contains `[archkit-mcp] ready`. The exact protocol version may vary; what matters is the bin starts, responds, and exits without throwing.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.mjs bin/archkit-mcp.mjs bin/archkit.mjs
git commit -m "feat(mcp): add archkit-mcp bin and 'archkit mcp' subcommand routing"
```

---

## Task 14: End-to-end MCP transport tests

**Files:**
- Create: `tests/mcp-server/run.mjs`

- [ ] **Step 1: Write the E2E test**

Create `tests/mcp-server/run.mjs`:

```javascript
#!/usr/bin/env node
// E2E test: spawn archkit-mcp as a subprocess, talk via stdio JSON-RPC
// using the MCP SDK's client. Verifies transport, tool registration,
// and round-trip semantics.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT_MCP = path.resolve(__dirname, "../../bin/archkit-mcp.mjs");

let passed = 0, failed = 0;

function log(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-e2e-"));
  const arch = path.join(tmp, ".arch");
  fs.mkdirSync(path.join(arch, "skills"), { recursive: true });
  fs.mkdirSync(path.join(arch, "clusters"), { recursive: true });
  fs.writeFileSync(path.join(arch, "SYSTEM.md"),
    "## App: test\n## Type: Internal Tool\n## Stack: Node.js\n## Pattern: Simple Layered\n\n## Rules\n- Layered\n\n## Reserved Words\n\n## Naming\nFiles: kebab\n");
  fs.writeFileSync(path.join(arch, "INDEX.md"), "");
  fs.writeFileSync(path.join(arch, "clusters", "auth.graph"), "[auth]\n  [login]\n");
  fs.writeFileSync(path.join(tmp, "test-file.js"), "const x = 1;\nexport default x;\n");
  return tmp;
}

async function withClient(cwd, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ARCHKIT_MCP],
    cwd,
  });
  const client = new Client({ name: "archkit-e2e-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

await log("initialize handshake succeeds", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const info = client.getServerVersion();
      assert.equal(info.name, "archkit");
      assert.ok(info.version.startsWith("1.4."));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("tools/list returns all 10 tools", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name).sort();
      assert.deepEqual(names, [
        "archkit_drift",
        "archkit_gotcha_list",
        "archkit_gotcha_propose",
        "archkit_resolve_lookup",
        "archkit_resolve_preflight",
        "archkit_resolve_scaffold",
        "archkit_resolve_warmup",
        "archkit_review",
        "archkit_review_staged",
        "archkit_stats",
      ]);
      const review = tools.find(t => t.name === "archkit_review");
      assert.ok(review.description.includes("When to use"), "description should include 'When to use' prose");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("archkit_review happy path", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const result = await client.callTool({
        name: "archkit_review",
        arguments: { files: ["test-file.js"] },
      });
      assert.equal(result.isError, undefined, `unexpected error: ${JSON.stringify(result)}`);
      const data = JSON.parse(result.content[0].text);
      assert.equal(typeof data.files, "number");
      assert.equal(typeof data.pass, "boolean");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("archkit_review error path: missing file", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const result = await client.callTool({
        name: "archkit_review",
        arguments: { files: ["does-not-exist.js"] },
      });
      assert.equal(result.isError, true);
      const env = JSON.parse(result.content[0].text);
      assert.equal(env.code, "file_not_found");
      assert.equal(typeof env.suggestion, "string");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("archkit_resolve_warmup happy path", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const result = await client.callTool({ name: "archkit_resolve_warmup", arguments: {} });
      assert.equal(result.isError, undefined);
      const data = JSON.parse(result.content[0].text);
      assert.equal(typeof data.pass, "boolean");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("invalid_input on schema violation", async () => {
  const tmp = makeFixture();
  try {
    await withClient(tmp, async (client) => {
      const result = await client.callTool({
        name: "archkit_review",
        arguments: { files: [] }, // violates min(1)
      });
      assert.equal(result.isError, true);
      const env = JSON.parse(result.content[0].text);
      assert.equal(env.code, "invalid_input");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await log("server shuts down cleanly on SIGTERM", async () => {
  const tmp = makeFixture();
  const child = spawn(process.execPath, [ARCHKIT_MCP], { cwd: tmp, stdio: ["pipe", "pipe", "pipe"] });
  await new Promise(resolve => setTimeout(resolve, 500)); // allow boot
  child.kill("SIGTERM");
  const code = await new Promise(resolve => child.on("exit", resolve));
  assert.equal(code, 0, `expected clean exit (0), got ${code}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the E2E test**

Run: `node tests/mcp-server/run.mjs`
Expected: `Results: 7 passed, 0 failed`.

If a test fails because the SDK's client API differs (e.g. `getServerVersion()` returns a different shape, `callTool` expects different args), adjust the test code to match the SDK's actual API — the SDK's TypeScript definitions are authoritative.

- [ ] **Step 3: Commit**

```bash
git add tests/mcp-server/run.mjs
git commit -m "test(mcp): add E2E stdio transport tests covering all 10 tools"
```

---

## Task 15: Add `--mcp` flag to `archkit init --install-hooks`

**Files:**
- Modify: `src/commands/init.mjs`
- Create: `tests/mcp-init/run.mjs`

- [ ] **Step 1: Write failing integration test**

Create `tests/mcp-init/run.mjs`:

```javascript
#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-mcp-init-"));
  fs.mkdirSync(path.join(tmp, ".arch"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".arch", "SYSTEM.md"), "## Rules\n- R\n");
  const home = path.join(tmp, "fake-home");
  fs.mkdirSync(home, { recursive: true });
  return { tmp, home };
}

test("--install-hooks --mcp writes archkit entry to ~/.claude/mcp.json", () => {
  const { tmp, home } = makeFixture();
  try {
    execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"], {
      cwd: tmp,
      env: { ...process.env, HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const cfgPath = path.join(home, ".claude", "mcp.json");
    assert.ok(fs.existsSync(cfgPath), `expected ${cfgPath} to exist`);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    assert.ok(cfg.mcpServers, "mcpServers key missing");
    assert.equal(cfg.mcpServers.archkit.command, "archkit-mcp");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--install-hooks --mcp is idempotent (no duplicate on re-run)", () => {
  const { tmp, home } = makeFixture();
  try {
    const env = { ...process.env, HOME: home };
    execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"],
      { cwd: tmp, env, stdio: ["pipe", "pipe", "pipe"] });
    execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"],
      { cwd: tmp, env, stdio: ["pipe", "pipe", "pipe"] });
    const cfg = JSON.parse(fs.readFileSync(path.join(home, ".claude", "mcp.json"), "utf8"));
    assert.equal(cfg.mcpServers.archkit.command, "archkit-mcp");
    assert.equal(Object.keys(cfg.mcpServers).filter(k => k === "archkit").length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--install-hooks --mcp does not overwrite a different existing archkit entry", () => {
  const { tmp, home } = makeFixture();
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "mcp.json"),
      JSON.stringify({ mcpServers: { archkit: { command: "custom-archkit", args: ["--special"] } } }, null, 2));
    execFileSync(process.execPath, [ARCHKIT, "init", "--install-hooks", "--mcp", "--yes"],
      { cwd: tmp, env: { ...process.env, HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
    const cfg = JSON.parse(fs.readFileSync(path.join(home, ".claude", "mcp.json"), "utf8"));
    assert.equal(cfg.mcpServers.archkit.command, "custom-archkit");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mcp-init/run.mjs`
Expected: FAIL — `--mcp` flag is unknown.

- [ ] **Step 3: Add `--mcp` flag handling in `src/commands/init.mjs`**

Find the existing `--install-hooks` flag handling (added in v1.3 alongside `--claude` / `--claude-only`). Add `--mcp` handling that runs alongside or independent of the hook installation:

```javascript
const wantsMcp = args.includes("--mcp");

if (wantsMcp) {
  installMcpEntry();
}

function installMcpEntry() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    log.warn("Could not determine home directory; skipping MCP registration.");
    return;
  }
  const claudeDir = path.join(home, ".claude");
  const cfgPath = path.join(claudeDir, "mcp.json");
  fs.mkdirSync(claudeDir, { recursive: true });

  let cfg = { mcpServers: {} };
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (!cfg.mcpServers) cfg.mcpServers = {};
    } catch (err) {
      log.warn(`Could not parse ${cfgPath}: ${err.message}. Skipping.`);
      return;
    }
  }

  const existing = cfg.mcpServers.archkit;
  if (existing && existing.command !== "archkit-mcp") {
    log.warn(`mcp.json already has an 'archkit' entry with a different command (${existing.command}). Leaving it alone.`);
    return;
  }
  if (existing && existing.command === "archkit-mcp") {
    log.ok(`MCP archkit entry already present in ${cfgPath}`);
    return;
  }

  cfg.mcpServers.archkit = { command: "archkit-mcp", args: [] };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  log.ok(`Wrote archkit MCP entry to ${cfgPath}`);
}
```

Make sure the `--yes` flag (or equivalent non-interactive flag used by existing init tests) suppresses any prompts in the MCP path.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/mcp-init/run.mjs`
Expected: `Results: 3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.mjs tests/mcp-init/run.mjs
git commit -m "feat(init): add --mcp flag to register archkit in Claude Code MCP config"
```

---

## Task 16: Update `archkit-protocol` skill template

**Files:**
- Modify: `src/data/skill-templates.mjs`

- [ ] **Step 1: Read the current archkit-protocol template**

Use Grep to find the section in `src/data/skill-templates.mjs` that defines the `archkit-protocol.skill` content. Look for occurrences of `archkit-protocol`, `When to use`, or similar landmark strings.

- [ ] **Step 2: Add the MCP-preference line**

Edit `src/data/skill-templates.mjs`. Inside the `archkit-protocol` template literal, find the section that explains when to call archkit (the "When to use" or similar block). Add this line near the top of that section:

```
- If `archkit_*` MCP tools appear in your tool list, prefer them over CLI shell-outs. Both produce the same JSON; MCP tools are typed, faster, and surface structured errors directly.
```

The exact placement depends on existing template structure — put it where it's read alongside the other "how to use archkit" guidance, not at the bottom.

- [ ] **Step 3: Verify the template still scaffolds correctly**

```bash
rm -rf /tmp/protocol-smoke && \
mkdir /tmp/protocol-smoke && \
cd /tmp/protocol-smoke && \
node /Users/kenmiranda/Desktop/Projects/archkit/bin/archkit.mjs init --yes && \
grep -n "archkit_" .arch/skills/archkit-protocol.skill | head -5
```

Expected: the new line appears in the generated skill file.

Cleanup: `rm -rf /tmp/protocol-smoke`.

- [ ] **Step 4: Commit**

```bash
git add src/data/skill-templates.mjs
git commit -m "docs(skill): nudge agents toward archkit_* MCP tools when available"
```

---

## Task 17: README, CHANGELOG, full suite, and dogfood

**Files:**
- Modify: `README.md`
- Create or modify: `CHANGELOG.md`

- [ ] **Step 1: Add an MCP section to `README.md`**

Find a logical home in README.md (after the install/quickstart, before deeper reference docs). Add:

````markdown
## MCP server (Claude Code, Cursor, Continue)

archkit ships a Model Context Protocol server so AI agents can call archkit's review/resolve/stats tools natively, without shell-outs.

### Install

```bash
npm install -g archkit  # or per-project --save-dev
```

This registers two bins: `archkit` and `archkit-mcp`.

### Register with Claude Code

Automatic (recommended):

```bash
archkit init --install-hooks --claude --mcp
```

This adds an entry to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "archkit": {
      "command": "archkit-mcp",
      "args": []
    }
  }
}
```

Manual: copy that block into your Claude Code MCP config yourself.

### Available tools

- `archkit_review` — review files against rules and gotchas
- `archkit_review_staged` — review git-staged files
- `archkit_resolve_warmup` — pre-session health check
- `archkit_resolve_preflight` — verify a feature/layer before coding
- `archkit_resolve_scaffold` — get a new-feature checklist
- `archkit_resolve_lookup` — look up a node, skill, or cluster by id
- `archkit_gotcha_propose` — queue a gotcha proposal
- `archkit_gotcha_list` — list skills with gotcha counts
- `archkit_stats` — health dashboard data
- `archkit_drift` — detect stale `.arch/` files

All tools return structured JSON in MCP `text` content. Errors flow through `isError: true` with the standard archkit envelope (`code`, `message`, `suggestion`, `docsUrl`).
````

- [ ] **Step 2: Add a CHANGELOG entry**

If `CHANGELOG.md` exists, prepend an entry. If it does not, create one with this initial content:

```markdown
# Changelog

## v1.4.0 — 2026-04-28

### Added
- **MCP server** (`archkit-mcp` and `archkit mcp serve`): stdio MCP server exposing 10 typed tools that mirror the CLI surface. Lets AI agents call archkit natively in Claude Code, Cursor, and Continue.
- `archkit init --install-hooks --mcp`: idempotent registration of archkit in `~/.claude/mcp.json`.
- `ArchkitError` class and shared error envelope (`{ code, message, suggestion?, docsUrl? }`) used by both CLI `--json` output and MCP `isError` responses.
- Per-command `run*Json()` exports (review, warmup, preflight, scaffold, lookup, gotcha-list, gotcha-propose, stats, drift) for direct programmatic use.

### Changed
- `archkit-protocol` skill template now nudges agents toward MCP tools when available.

### Dependencies
- Added `@modelcontextprotocol/sdk@^1.29.0`
- Added `zod@^3`
```

- [ ] **Step 3: Run the full test suite locally**

Run each new and existing test runner sequentially. Stop at the first failure:

```bash
node tests/mcp-envelope/run.mjs && \
node tests/mcp-runners/review/run.mjs && \
node tests/mcp-runners/warmup/run.mjs && \
node tests/mcp-runners/preflight/run.mjs && \
node tests/mcp-runners/scaffold/run.mjs && \
node tests/mcp-runners/lookup/run.mjs && \
node tests/mcp-runners/gotcha/run.mjs && \
node tests/mcp-runners/stats/run.mjs && \
node tests/mcp-runners/drift/run.mjs && \
node tests/mcp-server/run.mjs && \
node tests/mcp-init/run.mjs && \
node tests/review-json/run.mjs && \
node tests/stats-json/run.mjs && \
node tests/proposals/run.mjs && \
node tests/preflight-live/run.mjs && \
node tests/scaffold-live/run.mjs && \
node tests/drift-fix/run.mjs && \
node tests/claude-hook/run.mjs && \
node tests/hooks/run.mjs && \
node tests/init-overrides/run.mjs && \
node tests/deprecation/run.mjs && \
node tests/suppression/run.mjs && \
node tests/guardrails/run.mjs && \
node tests/agent-scaffold/run.mjs && \
node tests/skeleton-renderer/run.mjs && \
node tests/production-checks/run.mjs && \
node tests/verify-wiring-fix/run.mjs && \
echo "ALL TESTS PASS"
```

Expected: every runner exits 0; final line `ALL TESTS PASS`.

- [ ] **Step 4: Dogfood — open Claude Code in the archkit repo with MCP enabled**

Manual check (no automated test). Steps:

1. Register the local archkit-mcp in your dev Claude Code MCP config:
   ```json
   { "mcpServers": { "archkit-dev": { "command": "node", "args": ["/Users/kenmiranda/Desktop/Projects/archkit/bin/archkit-mcp.mjs"] } } }
   ```
2. Open a fresh Claude Code session in the archkit repo.
3. Confirm the 10 `archkit_*` tools appear in the tool list.
4. Ask Claude to "review src/commands/review.mjs" — expect `archkit_review` to be called proactively.
5. Ask Claude to "check if my .arch/ is healthy" — expect `archkit_resolve_warmup`.

If both happen without explicit prompting to use the tools, the success criterion from the spec (§1) is met for v1 ship.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document MCP server in README and CHANGELOG for v1.4.0"
```

- [ ] **Step 6: Tag the release (when ready to publish)**

```bash
git tag v1.4.0
# When ready to publish:
# npm publish
# git push origin main --tags
```

---

## Self-Review Notes

- **Spec coverage:** All 10 spec sections covered. §1 goals → Task 17 dogfood. §2 architecture → Tasks 11–13. §3 tool surface → Task 12. §4 refactor sequence → Tasks 3–10 (matches spec §4.4 ordering). §5 error handling → Tasks 2 + 11. §6 distribution → Tasks 13 + 15 + 16 + 17. §7 testing → all per-task TDD steps + Task 14 E2E. §8 DoD checklist → Task 17 step 3 runs the full suite.
- **No placeholders:** every step has actual code or a precise refactor pattern; commands include cwd setup; expected outputs are explicit.
- **Type consistency:** function names match the spec table (§4.4) exactly. Error codes match §5.4 taxonomy. Tool names match §3.1.
- **One concern flagged:** Tasks 4–7, 9, 10 each say "if X helper doesn't already return data, refactor it." That's a real fork — the engineer needs to read the existing code to know which branch they're on. This is acceptable because the refactor is mechanical (move from console.log to return). If we wanted to remove the conditional, we'd need to read each command's current shape now and prescribe the exact diff — but that adds plan length without changing the work.
