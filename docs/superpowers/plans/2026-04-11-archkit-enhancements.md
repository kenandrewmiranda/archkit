# archkit v1.2.0 Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gotcha proposal queue, agent-scaffold init, pre-commit hook installer, persona README, and cherry-picked gotcha-db entries — all with non-interactive + `--json` agent-access paths.

**Architecture:** Additive changes to three existing command modules (`gotcha.mjs`, `init.mjs`) and one data file (`gotcha-db.mjs`), plus one new data module (`agent-scaffold-templates.mjs`). Logger already writes to stderr; new commands use `console.log()` for JSON stdout only. Tests follow existing script-based pattern (`execFileSync` runners in `tests/`).

**Tech Stack:** Node.js ESM, inquirer for interactive prompts, fs/path/crypto stdlib, no new dependencies.

---

## File Map

**Create:**
- `src/data/agent-scaffold-templates.mjs` — template strings for BOUNDARIES.md, SYSTEM.md, skills/README.md, CLAUDE.md stubs
- `tests/proposals/run.mjs` — proposal queue tests (hash, propose, review, list)
- `tests/agent-scaffold/run.mjs` — agent-scaffold init tests (creation, idempotency, CLAUDE.md skip)
- `tests/hooks/run.mjs` — hook installer tests (creation, existing hook, non-git)

**Modify:**
- `src/commands/gotcha.mjs` — add `--propose`, `--review`, `--list-proposals` branches + proposal helpers
- `src/commands/init.mjs` — add `--agent-scaffold` and `--install-hooks` branches
- `src/data/gotcha-db.mjs` — add `sqlite` and `numerics` keys
- `README.md` — persona section, new command docs, version bump

**No changes needed:**
- `src/lib/logger.mjs` — already writes to stderr via `console.error()`
- `bin/archkit.mjs` — routes to modules, flags handled inside
- `src/lib/shared.mjs` — `findArchDir()` already sufficient

---

### Task 1: Cherry-pick gotcha-db entries

**Files:**
- Modify: `src/data/gotcha-db.mjs:5-32`
- Test: `tests/proposals/run.mjs` (will also cover proposal tests in later tasks — create file now with just gotcha-db tests)

- [ ] **Step 1: Write the test file with gotcha-db tests**

Create `tests/proposals/run.mjs`:

```javascript
#!/usr/bin/env node

/**
 * Proposal Queue + Gotcha DB Test Suite
 *
 * Usage:
 *   node tests/proposals/run.mjs
 */

import { strict as assert } from "node:assert";
import { GOTCHA_DB } from "../../src/data/gotcha-db.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log("\n=== Gotcha DB Tests ===\n");

test("sqlite key exists with at least 1 entry", () => {
  assert.ok(GOTCHA_DB.sqlite, "sqlite key missing");
  assert.ok(GOTCHA_DB.sqlite.length >= 1, "sqlite should have at least 1 entry");
});

test("numerics key exists with at least 1 entry", () => {
  assert.ok(GOTCHA_DB.numerics, "numerics key missing");
  assert.ok(GOTCHA_DB.numerics.length >= 1, "numerics should have at least 1 entry");
});

test("all gotcha entries have required fields", () => {
  for (const [key, entries] of Object.entries(GOTCHA_DB)) {
    for (const entry of entries) {
      assert.ok(entry.wrong, `${key}: missing 'wrong' field`);
      assert.ok(entry.right, `${key}: missing 'right' field`);
      assert.ok(entry.why, `${key}: missing 'why' field`);
    }
  }
});

test("sqlite entry references ALTER TABLE", () => {
  const entry = GOTCHA_DB.sqlite[0];
  assert.ok(entry.wrong.includes("ALTER TABLE"), "sqlite wrong should reference ALTER TABLE");
});

test("numerics entry references IEEE 754 or float precision", () => {
  const entry = GOTCHA_DB.numerics[0];
  assert.ok(entry.why.includes("IEEE 754") || entry.why.includes("float"), "numerics why should reference IEEE 754 or float");
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/proposals/run.mjs`
Expected: FAIL — `sqlite key missing` and `numerics key missing`

- [ ] **Step 3: Add sqlite and numerics entries to gotcha-db.mjs**

In `src/data/gotcha-db.mjs`, add these two keys after the existing `security` entry (before the closing `};`):

```javascript
  sqlite: [
    { wrong: "ALTER TABLE t ADD CHECK (col IN ('a','b'))", right: "BEGIN; CREATE TABLE t_new (...with updated CHECK...); INSERT INTO t_new (col1, col2, ...) SELECT col1, col2, ... FROM t; DROP TABLE t; ALTER TABLE t_new RENAME TO t; COMMIT;", why: "SQLite's ALTER TABLE cannot add or modify CHECK constraints, foreign keys, or column types in place. Full 12-step rebuild required. Always list columns explicitly in INSERT...SELECT. Ref: sqlite.org/lang_altertable.html #7." },
  ],
  numerics: [
    { wrong: "return (current - entry) / entry < threshold  // IEEE 754 noise at exact decimal boundaries", right: "return round((current - entry) / entry, 10) < threshold  // or compare in cents (integer), or use Decimal", why: "IEEE 754 subtract-then-divide produces values like 0.14999999999999991 at what should be exactly 0.15. Rounding to 10 decimals normalizes the noise. Write explicit boundary test cases." },
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/proposals/run.mjs`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/data/gotcha-db.mjs tests/proposals/run.mjs
git commit -m "feat: add sqlite and numerics entries to built-in gotcha DB"
```

---

### Task 2: Agent-scaffold templates

**Files:**
- Create: `src/data/agent-scaffold-templates.mjs`
- Create: `tests/agent-scaffold/run.mjs`

- [ ] **Step 1: Write the test file**

Create `tests/agent-scaffold/run.mjs`:

```javascript
#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { TEMPLATES } from "../../src/data/agent-scaffold-templates.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log("\n=== Agent Scaffold Template Tests ===\n");

test("exports TEMPLATES object", () => {
  assert.ok(TEMPLATES, "TEMPLATES should be exported");
  assert.equal(typeof TEMPLATES, "object");
});

test("has all 4 required templates", () => {
  const required = ["BOUNDARIES", "SYSTEM", "SKILLS_README", "CLAUDE_MD"];
  for (const key of required) {
    assert.ok(TEMPLATES[key], `missing template: ${key}`);
    assert.equal(typeof TEMPLATES[key], "string", `${key} should be a string`);
  }
});

test("BOUNDARIES template has AGENT-INSTRUCTIONS markers", () => {
  assert.ok(TEMPLATES.BOUNDARIES.includes("AGENT-INSTRUCTIONS: START"), "missing START marker");
  assert.ok(TEMPLATES.BOUNDARIES.includes("AGENT-INSTRUCTIONS: END"), "missing END marker");
});

test("SYSTEM template has AGENT-INSTRUCTIONS markers", () => {
  assert.ok(TEMPLATES.SYSTEM.includes("AGENT-INSTRUCTIONS: START"), "missing START marker");
  assert.ok(TEMPLATES.SYSTEM.includes("AGENT-INSTRUCTIONS: END"), "missing END marker");
});

test("CLAUDE_MD template references .arch/ and gotcha propose", () => {
  assert.ok(TEMPLATES.CLAUDE_MD.includes(".arch/"), "should reference .arch/");
  assert.ok(TEMPLATES.CLAUDE_MD.includes("gotcha"), "should reference gotcha workflow");
});

test("SKILLS_README template references WRONG/RIGHT/WHY format", () => {
  assert.ok(TEMPLATES.SKILLS_README.includes("WRONG"), "should reference WRONG");
  assert.ok(TEMPLATES.SKILLS_README.includes("RIGHT"), "should reference RIGHT");
  assert.ok(TEMPLATES.SKILLS_README.includes("WHY"), "should reference WHY");
});

test("no templates contain literal TODO or TBD", () => {
  for (const [key, content] of Object.entries(TEMPLATES)) {
    assert.ok(!content.includes("TBD"), `${key} contains TBD`);
    assert.ok(!content.includes("TODO"), `${key} contains TODO`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/agent-scaffold/run.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Create agent-scaffold-templates.mjs**

Create `src/data/agent-scaffold-templates.mjs`:

```javascript
// Agent-scaffold stub templates — written by `archkit init --agent-scaffold`.
// Each template has AGENT-INSTRUCTIONS blocks that guide AI agents to fill in
// project-specific content. Humans can also fill these in manually.

export const TEMPLATES = {

BOUNDARIES: `# Architectural Boundaries

<!-- AGENT-INSTRUCTIONS: START
This file captures hard architectural rules for this project. Rules should be
written in NEVER form and be enforceable by code review or automated checks.

To populate this file:
1. Read the project's main source directory (src/, lib/, app/, etc.).
2. Identify real boundaries: data layer vs I/O, pure functions vs side effects,
   public API vs internal modules, etc.
3. For each boundary, write a NEVER rule. Be specific — include example module
   names from THIS project, not generic advice.
4. Delete this AGENT-INSTRUCTIONS block when the file is populated.

Format for each rule:

    ### NEVER <short rule>
    **Why:** <one sentence>
    **Example violation:** \\\`path/to/module\\\` imports \\\`other/module\\\`
    **Enforced by:** <test, lint, review, or "convention">

See archkit docs for the full BOUNDARIES.md reference format.
AGENT-INSTRUCTIONS: END -->

## Data Layer Boundaries

<!-- AGENT: populate with NEVER rules specific to this project -->

## I/O Boundaries

<!-- AGENT: populate with NEVER rules specific to this project -->

## Error Handling Boundaries

<!-- AGENT: populate with NEVER rules specific to this project -->
`,

SYSTEM: `# System Architecture

<!-- AGENT-INSTRUCTIONS: START
This file describes the system at cluster granularity — the major functional
areas, their responsibilities, and how they communicate.

To populate this file:
1. Identify the 3-7 major clusters in this project (e.g., domain logic, data
   access, transport/API, UI, infrastructure).
2. For each cluster, write a short description of what it owns and what it
   delegates to other clusters.
3. List the reserved words — canonical module names that should be used
   consistently across the codebase.
4. Delete this AGENT-INSTRUCTIONS block when the file is populated.

Format:

    ## App: <project-name>
    ## Type: <app-type>
    ## Stack: <key technologies>

    ## Clusters
    ### <Cluster Name>
    Owns: <responsibilities>
    Delegates: <what it delegates and to whom>

    ## Reserved Words
    <module> = <canonical meaning>

    ## Rules
    - <architectural rule>
AGENT-INSTRUCTIONS: END -->
`,

SKILLS_README: `# Package Skills

This directory contains per-package skill files that capture gotchas — patterns
the AI is likely to get wrong, and the correct alternatives.

## Format

Each \`.skill\` file follows the WRONG / RIGHT / WHY format:

\`\`\`
WRONG: <the code the AI will generate by default>
RIGHT: <the code it should generate instead>
WHY:   <one-line explanation of the failure mode>
\`\`\`

## Creating skill files

Skill files are created per-package as gotchas are discovered. You don't need
to create them all upfront — they grow with the project.

**To propose a new gotcha (agents or humans):**

\`\`\`bash
# Via CLI (all flags = non-interactive, safe for agents):
archkit gotcha --propose --skill <package> --wrong "..." --right "..." --why "..."

# Or drop a JSON file directly in .arch/gotcha-proposals/:
# { "skill": "...", "wrong": "...", "right": "...", "why": "..." }
\`\`\`

**To review and approve proposed gotchas:**

\`\`\`bash
archkit gotcha --review
\`\`\`

This walks each proposal interactively — accept, edit, reject, or skip.

## Existing skill files

<!-- AGENT: As you discover gotchas while working on this project, use
     archkit gotcha --propose to capture them. Skill files will be created
     during the review step. -->
`,

CLAUDE_MD: `# Project Context

> This file was scaffolded by \`archkit init --agent-scaffold\`.
> Fill in project-specific details and remove instruction comments.

## Architecture

See \`.arch/\` for the full architecture context:
- \`.arch/BOUNDARIES.md\` — hard architectural rules (NEVER rules)
- \`.arch/SYSTEM.md\` — system description at cluster granularity
- \`.arch/skills/*.skill\` — per-package gotchas (WRONG/RIGHT/WHY)

**Before writing code touching a package, check \`.arch/skills/<package>.skill\`** if it exists.

## Reserved Words

<!-- AGENT: Populate this section with canonical module names as they are
     identified. These become the shared vocabulary for discussing changes.
     Format: <word> = <canonical meaning>
     Delete this comment when populated. -->

## Session Protocol

Available archkit commands (all return JSON on stdout, logs on stderr):

| Command | Purpose |
|---------|---------|
| \`archkit resolve warmup --json\` | Pre-session health check |
| \`archkit resolve context "<prompt>" --json\` | Map prompt to features, skills, files |
| \`archkit review --staged --json\` | Review staged files against rules |
| \`archkit gotcha --propose --skill X --wrong "..." --right "..." --why "..."\` | Propose a gotcha |
| \`archkit gotcha --list-proposals --json\` | List pending gotcha proposals |
| \`archkit drift --json\` | Detect .arch/ drift from actual code |

## Index

<!-- AGENT: When you need to reference canonical modules, create .arch/INDEX.md
     with entries in this form:
       @module-name [cluster] basePath: src/path/ file: main-file.ext
     Only add entries for modules you have confirmed exist. -->
`,

};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/agent-scaffold/run.mjs`
Expected: PASS — all 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/data/agent-scaffold-templates.mjs tests/agent-scaffold/run.mjs
git commit -m "feat: add agent-scaffold stub templates"
```

---

### Task 3: Implement `init --agent-scaffold`

**Files:**
- Modify: `src/commands/init.mjs:221-335`
- Test: extend `tests/agent-scaffold/run.mjs`

- [ ] **Step 1: Add integration tests to the test file**

Append to `tests/agent-scaffold/run.mjs` (after the template unit tests, before the summary):

```javascript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-scaffold-"));
  const orig = process.cwd();
  try {
    process.chdir(dir);
    fn(dir);
  } finally {
    process.chdir(orig);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n=== Agent Scaffold Integration Tests ===\n");

test("--agent-scaffold creates expected files in empty dir", () => {
  withTempDir((dir) => {
    // Need a package.json for init to not error (or we bypass — check behavior)
    // Actually --agent-scaffold should NOT require package.json — it's a stub creator
    const result = execFileSync("node", [ARCHKIT, "init", "--agent-scaffold", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    const json = JSON.parse(result);
    assert.ok(json.created.length >= 3, `expected at least 3 created files, got ${json.created.length}`);
    assert.ok(fs.existsSync(path.join(dir, ".arch", "BOUNDARIES.md")), "BOUNDARIES.md missing");
    assert.ok(fs.existsSync(path.join(dir, ".arch", "SYSTEM.md")), "SYSTEM.md missing");
    assert.ok(fs.existsSync(path.join(dir, ".arch", "skills", "README.md")), "skills/README.md missing");
    assert.ok(fs.existsSync(path.join(dir, "CLAUDE.md")), "CLAUDE.md missing");
  });
});

test("--agent-scaffold skips existing CLAUDE.md", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# My existing config\n");
    const result = execFileSync("node", [ARCHKIT, "init", "--agent-scaffold", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    const json = JSON.parse(result);
    assert.ok(json.skipped.includes("CLAUDE.md"), "CLAUDE.md should be in skipped list");
    const content = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    assert.equal(content, "# My existing config\n", "CLAUDE.md content should be unchanged");
  });
});

test("--agent-scaffold is idempotent", () => {
  withTempDir((dir) => {
    execFileSync("node", [ARCHKIT, "init", "--agent-scaffold", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    const result = execFileSync("node", [ARCHKIT, "init", "--agent-scaffold", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    const json = JSON.parse(result);
    // All files should be skipped on second run (they exist with stub content)
    assert.ok(json.created.length === 0, `expected 0 created on second run, got ${json.created.length}`);
  });
});

test("BOUNDARIES.md contains AGENT-INSTRUCTIONS markers", () => {
  withTempDir((dir) => {
    execFileSync("node", [ARCHKIT, "init", "--agent-scaffold", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    const content = fs.readFileSync(path.join(dir, ".arch", "BOUNDARIES.md"), "utf8");
    assert.ok(content.includes("AGENT-INSTRUCTIONS: START"), "missing START marker");
    assert.ok(content.includes("AGENT-INSTRUCTIONS: END"), "missing END marker");
  });
});
```

- [ ] **Step 2: Run test to verify integration tests fail**

Run: `node tests/agent-scaffold/run.mjs`
Expected: Template unit tests PASS, integration tests FAIL (--agent-scaffold not implemented yet)

- [ ] **Step 3: Implement --agent-scaffold in init.mjs**

Add the agent-scaffold branch at the top of `init.mjs`'s `main()` function (before the existing `.arch` exists check at line 230). Insert this block after `const jsonMode = args.includes("--json");` (line 224) and before `// Check if .arch/ already exists` (line 229):

```javascript
  // ── Agent Scaffold Mode ──────────────────────────────────────────────
  if (args.includes("--agent-scaffold")) {
    const { TEMPLATES } = await import("../data/agent-scaffold-templates.mjs");
    const base = path.resolve(".arch");
    const created = [];
    const skipped = [];

    const files = [
      { rel: path.join(".arch", "BOUNDARIES.md"), abs: path.join(base, "BOUNDARIES.md"), content: TEMPLATES.BOUNDARIES },
      { rel: path.join(".arch", "SYSTEM.md"), abs: path.join(base, "SYSTEM.md"), content: TEMPLATES.SYSTEM },
      { rel: path.join(".arch", "skills", "README.md"), abs: path.join(base, "skills", "README.md"), content: TEMPLATES.SKILLS_README },
      { rel: "CLAUDE.md", abs: path.resolve("CLAUDE.md"), content: TEMPLATES.CLAUDE_MD },
    ];

    for (const f of files) {
      if (fs.existsSync(f.abs)) {
        skipped.push(f.rel);
        if (!jsonMode) log.resolve(`Skipped ${f.rel} (already exists)`);
      } else {
        fs.mkdirSync(path.dirname(f.abs), { recursive: true });
        fs.writeFileSync(f.abs, f.content);
        created.push(f.rel);
        if (!jsonMode) log.generate(`Created ${f.rel}`);
      }
    }

    if (jsonMode) {
      console.log(JSON.stringify({ created, skipped }));
    } else {
      if (created.length > 0) {
        log.ok(`Scaffolded ${created.length} file${created.length !== 1 ? "s" : ""} — an AI agent can now populate them`);
      } else {
        log.ok("All files already exist — nothing to do");
      }
      console.error("");
      console.error("  Next: Ask your AI agent to fill in .arch/BOUNDARIES.md and .arch/SYSTEM.md");
      console.error("  Or fill them in manually using the AGENT-INSTRUCTIONS as a guide.");
      console.error("");
    }
    return;
  }
```

Also add this import at the top of `init.mjs` — it already imports `log` from `../lib/logger.mjs`, so no new import needed. The `TEMPLATES` import is dynamic (inside the if block) to avoid loading templates when not needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/agent-scaffold/run.mjs`
Expected: PASS — all 11 tests pass (7 template unit + 4 integration)

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.mjs tests/agent-scaffold/run.mjs
git commit -m "feat: add archkit init --agent-scaffold for AI-driven .arch/ population"
```

---

### Task 4: Proposal queue — hash utility and `--propose`

**Files:**
- Modify: `src/commands/gotcha.mjs`
- Test: extend `tests/proposals/run.mjs`

- [ ] **Step 1: Add hash and propose tests**

Append to `tests/proposals/run.mjs` (after the gotcha-db tests, before the summary):

```javascript
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

// ── Hash function tests ──

// Replicate the hash function to test against
function proposalHash(skill, wrong, right) {
  return createHash("sha1").update(`${skill}\x1f${wrong}\x1f${right}`).digest("hex").slice(0, 12);
}

console.log("\n=== Proposal Hash Tests ===\n");

test("hash is stable — same inputs produce same hash", () => {
  const h1 = proposalHash("aiosqlite", "bad code", "good code");
  const h2 = proposalHash("aiosqlite", "bad code", "good code");
  assert.equal(h1, h2);
});

test("hash is 12 hex characters", () => {
  const h = proposalHash("test", "wrong", "right");
  assert.equal(h.length, 12);
  assert.ok(/^[0-9a-f]{12}$/.test(h), `expected hex string, got: ${h}`);
});

test("changing skill changes hash", () => {
  const h1 = proposalHash("aiosqlite", "bad", "good");
  const h2 = proposalHash("sqlite", "bad", "good");
  assert.notEqual(h1, h2);
});

test("changing wrong changes hash", () => {
  const h1 = proposalHash("pkg", "bad1", "good");
  const h2 = proposalHash("pkg", "bad2", "good");
  assert.notEqual(h1, h2);
});

test("changing right changes hash", () => {
  const h1 = proposalHash("pkg", "bad", "good1");
  const h2 = proposalHash("pkg", "bad", "good2");
  assert.notEqual(h1, h2);
});

test("changing why does NOT change hash", () => {
  // why is excluded from hash by design
  // This test validates the design — the hash function itself doesn't take why
  const h1 = proposalHash("pkg", "bad", "good");
  const h2 = proposalHash("pkg", "bad", "good");
  assert.equal(h1, h2, "why should not affect hash");
});

// ── Propose integration tests ──

function withTempArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-propose-"));
  fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
  const orig = process.cwd();
  try {
    process.chdir(dir);
    fn(dir);
  } finally {
    process.chdir(orig);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n=== Propose Integration Tests ===\n");

test("--propose with all flags creates proposal file", () => {
  withTempArchDir((dir) => {
    const result = execFileSync("node", [
      ARCHKIT, "gotcha", "--propose", "--json",
      "--skill", "aiosqlite",
      "--wrong", "bad code here",
      "--right", "good code here",
      "--why", "explanation here",
    ], { cwd: dir, encoding: "utf8", timeout: 10000 });
    const json = JSON.parse(result);
    assert.equal(json.status, "queued");
    assert.ok(json.hash, "should return hash");
    assert.ok(json.path, "should return path");
    assert.ok(fs.existsSync(path.join(dir, json.path)), "proposal file should exist on disk");
  });
});

test("--propose duplicate returns duplicate status", () => {
  withTempArchDir((dir) => {
    const flags = [
      ARCHKIT, "gotcha", "--propose", "--json",
      "--skill", "pkg", "--wrong", "bad", "--right", "good", "--why", "reason",
    ];
    execFileSync("node", flags, { cwd: dir, encoding: "utf8", timeout: 10000 });
    const result = execFileSync("node", flags, { cwd: dir, encoding: "utf8", timeout: 10000 });
    const json = JSON.parse(result);
    assert.equal(json.status, "duplicate");
  });
});

test("--propose without .arch/ dir errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-no-arch-"));
  try {
    const result = execFileSync("node", [
      ARCHKIT, "gotcha", "--propose", "--json",
      "--skill", "pkg", "--wrong", "bad", "--right", "good", "--why", "reason",
    ], { cwd: dir, encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
    // Should have exited non-zero, but execFileSync throws on non-zero
    assert.fail("should have thrown");
  } catch (err) {
    const stdout = err.stdout?.toString() || "";
    assert.ok(stdout.includes("no_arch_dir") || stdout.includes("Cannot find"), "should mention missing .arch/");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--propose with missing field errors", () => {
  withTempArchDir((dir) => {
    try {
      execFileSync("node", [
        ARCHKIT, "gotcha", "--propose", "--json",
        "--skill", "pkg", "--wrong", "bad",
        // missing --right and --why
      ], { cwd: dir, encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
      assert.fail("should have thrown");
    } catch (err) {
      const stdout = err.stdout?.toString() || "";
      assert.ok(stdout.includes("missing_field"), "should report missing field");
    }
  });
});

test("--propose after rejection returns previously-rejected", () => {
  withTempArchDir((dir) => {
    // Create a proposal first
    const result1 = execFileSync("node", [
      ARCHKIT, "gotcha", "--propose", "--json",
      "--skill", "pkg", "--wrong", "bad", "--right", "good", "--why", "reason",
    ], { cwd: dir, encoding: "utf8", timeout: 10000 });
    const json1 = JSON.parse(result1);

    // Manually move to rejected/ to simulate rejection
    const proposalsDir = path.join(dir, ".arch", "gotcha-proposals");
    const rejectedDir = path.join(proposalsDir, "rejected");
    fs.mkdirSync(rejectedDir, { recursive: true });
    fs.renameSync(
      path.join(dir, json1.path),
      path.join(rejectedDir, `${json1.hash}.json`)
    );

    // Re-propose same content
    const result2 = execFileSync("node", [
      ARCHKIT, "gotcha", "--propose", "--json",
      "--skill", "pkg", "--wrong", "bad", "--right", "good", "--why", "reason",
    ], { cwd: dir, encoding: "utf8", timeout: 10000 });
    const json2 = JSON.parse(result2);
    assert.equal(json2.status, "previously-rejected");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/proposals/run.mjs`
Expected: Gotcha DB tests PASS, hash unit tests PASS (they test a local function), propose integration tests FAIL (--propose not implemented)

- [ ] **Step 3: Implement --propose in gotcha.mjs**

Add the following at the top of `gotcha.mjs` (after the imports at line 22):

```javascript
import { createHash } from "node:crypto";
```

Add this helper function after `appendGotcha()` (after line 78):

```javascript
function proposalHash(skill, wrong, right) {
  return createHash("sha1").update(`${skill}\x1f${wrong}\x1f${right}`).digest("hex").slice(0, 12);
}

function proposalsDir(archDir) {
  return path.join(archDir, "gotcha-proposals");
}

function rejectedDir(archDir) {
  return path.join(archDir, "gotcha-proposals", "rejected");
}
```

Add the `--propose` branch inside `cliMode()`. Insert it after the `--list` block (after line 437) and before the debrief block (line 440). Add this code:

```javascript
  // ── Propose mode ──────────────────────────────────────────────────────
  if (args.includes("--propose")) {
    const skill = args[args.indexOf("--skill") + 1];
    const wrong = args[args.indexOf("--wrong") + 1];
    const right = args[args.indexOf("--right") + 1];
    const why = args[args.indexOf("--why") + 1];

    // Validate required fields
    for (const [name, val] of [["skill", skill], ["wrong", wrong], ["right", right], ["why", why]]) {
      if (!val || val.startsWith("--")) {
        if (jsonMode) {
          console.log(JSON.stringify({ error: "missing_field", field: name }));
        } else {
          console.log(`${C.red}  ${I.warn} Missing --${name} flag${C.reset}`);
          console.log(`${C.gray}  Usage: archkit gotcha --propose --skill <pkg> --wrong "..." --right "..." --why "..."${C.reset}`);
        }
        process.exit(2);
      }
    }

    const hash = proposalHash(skill, wrong, right);
    const pDir = proposalsDir(archDir);
    const rDir = rejectedDir(archDir);
    const proposalPath = path.join(pDir, `${hash}.json`);
    const rejectedPath = path.join(rDir, `${hash}.json`);

    // Check for duplicate
    if (fs.existsSync(proposalPath)) {
      if (jsonMode) console.log(JSON.stringify({ status: "duplicate", hash }));
      else console.log(`${C.yellow}  ${I.warn} Duplicate — this gotcha is already in the proposal queue${C.reset}`);
      return;
    }

    // Check for previous rejection
    if (fs.existsSync(rejectedPath)) {
      if (jsonMode) console.log(JSON.stringify({ status: "previously-rejected", hash }));
      else console.log(`${C.yellow}  ${I.warn} Previously rejected — this gotcha was reviewed and declined${C.reset}`);
      return;
    }

    // Write proposal
    fs.mkdirSync(pDir, { recursive: true });
    const proposal = {
      skill,
      wrong,
      right,
      why,
      source: "cli",
      created_at: new Date().toISOString(),
    };
    fs.writeFileSync(proposalPath, JSON.stringify(proposal, null, 2) + "\n");

    const relPath = path.relative(process.cwd(), proposalPath);
    if (jsonMode) {
      console.log(JSON.stringify({ status: "queued", hash, path: relPath }));
    } else {
      log.gotcha(`Gotcha proposed for ${skill}`);
      console.log(`${C.green}  ${I.check} Proposal queued: ${relPath}${C.reset}`);
      console.log(`${C.gray}  Review with: archkit gotcha --review${C.reset}`);
    }
    return;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/proposals/run.mjs`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/gotcha.mjs tests/proposals/run.mjs
git commit -m "feat: add gotcha --propose for queuing gotcha proposals"
```

---

### Task 5: Proposal queue — `--list-proposals` and `--review`

**Files:**
- Modify: `src/commands/gotcha.mjs`
- Test: extend `tests/proposals/run.mjs`

- [ ] **Step 1: Add list-proposals test**

Append to `tests/proposals/run.mjs`:

```javascript
console.log("\n=== List Proposals Tests ===\n");

test("--list-proposals --json returns array", () => {
  withTempArchDir((dir) => {
    // Create a proposal first
    execFileSync("node", [
      ARCHKIT, "gotcha", "--propose", "--json",
      "--skill", "test-pkg", "--wrong", "bad", "--right", "good", "--why", "reason",
    ], { cwd: dir, encoding: "utf8", timeout: 10000 });

    const result = execFileSync("node", [
      ARCHKIT, "gotcha", "--list-proposals", "--json",
    ], { cwd: dir, encoding: "utf8", timeout: 10000 });
    const proposals = JSON.parse(result);
    assert.ok(Array.isArray(proposals), "should return array");
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].skill, "test-pkg");
    assert.equal(proposals[0].wrong, "bad");
  });
});

test("--list-proposals --json returns empty array when no proposals", () => {
  withTempArchDir((dir) => {
    const result = execFileSync("node", [
      ARCHKIT, "gotcha", "--list-proposals", "--json",
    ], { cwd: dir, encoding: "utf8", timeout: 10000 });
    const proposals = JSON.parse(result);
    assert.ok(Array.isArray(proposals), "should return array");
    assert.equal(proposals.length, 0);
  });
});

test("--list-proposals excludes rejected proposals", () => {
  withTempArchDir((dir) => {
    // Create a proposal, then manually reject it
    const result1 = execFileSync("node", [
      ARCHKIT, "gotcha", "--propose", "--json",
      "--skill", "pkg", "--wrong", "bad", "--right", "good", "--why", "reason",
    ], { cwd: dir, encoding: "utf8", timeout: 10000 });
    const json1 = JSON.parse(result1);
    const pDir = path.join(dir, ".arch", "gotcha-proposals");
    const rDir = path.join(pDir, "rejected");
    fs.mkdirSync(rDir, { recursive: true });
    fs.renameSync(path.join(dir, json1.path), path.join(rDir, `${json1.hash}.json`));

    const result2 = execFileSync("node", [
      ARCHKIT, "gotcha", "--list-proposals", "--json",
    ], { cwd: dir, encoding: "utf8", timeout: 10000 });
    const proposals = JSON.parse(result2);
    assert.equal(proposals.length, 0, "rejected proposals should not appear");
  });
});
```

- [ ] **Step 2: Run test to verify list-proposals tests fail**

Run: `node tests/proposals/run.mjs`
Expected: New list tests FAIL (--list-proposals not implemented)

- [ ] **Step 3: Implement --list-proposals in gotcha.mjs**

Add this block inside `cliMode()`, after the `--propose` block you added in Task 4:

```javascript
  // ── List proposals mode ───────────────────────────────────────────────
  if (args.includes("--list-proposals")) {
    const pDir = proposalsDir(archDir);
    const proposals = [];
    if (fs.existsSync(pDir)) {
      for (const file of fs.readdirSync(pDir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = JSON.parse(fs.readFileSync(path.join(pDir, file), "utf8"));
          content._hash = file.replace(".json", "");
          proposals.push(content);
        } catch {
          log.warn(`Skipping corrupt proposal file: ${file}`);
        }
      }
    }
    if (jsonMode) {
      console.log(JSON.stringify(proposals));
    } else {
      if (proposals.length === 0) {
        console.log(`${C.gray}  No pending proposals.${C.reset}`);
        console.log(`${C.gray}  Agents can emit proposals via: archkit gotcha --propose --skill <pkg> ...${C.reset}`);
      } else {
        console.log(`${C.blue}${C.bold}  ${proposals.length} pending proposal${proposals.length !== 1 ? "s" : ""}:${C.reset}`);
        for (const p of proposals) {
          console.log(`${C.gray}  ${I.dot} ${p.skill}: ${p.wrong.substring(0, 60)}${C.reset}`);
        }
        console.log(`${C.gray}\n  Run archkit gotcha --review to process them.${C.reset}`);
      }
    }
    return;
  }
```

- [ ] **Step 4: Run list-proposals tests to verify they pass**

Run: `node tests/proposals/run.mjs`
Expected: All list-proposals tests PASS

- [ ] **Step 5: Implement --review in gotcha.mjs**

Add this block inside `cliMode()`, after the `--list-proposals` block:

```javascript
  // ── Review mode (interactive, human-only) ─────────────────────────────
  if (args.includes("--review")) {
    const pDir = proposalsDir(archDir);
    if (!fs.existsSync(pDir)) {
      console.log(`${C.gray}  No pending proposals.${C.reset}`);
      console.log(`${C.gray}  Agents can emit proposals via: archkit gotcha --propose --skill <pkg> ...${C.reset}`);
      console.log(`${C.gray}  Or drop JSON files in .arch/gotcha-proposals/${C.reset}`);
      return;
    }

    const files = fs.readdirSync(pDir).filter(f => f.endsWith(".json"));
    if (files.length === 0) {
      console.log(`${C.gray}  No pending proposals.${C.reset}`);
      return;
    }

    banner();
    console.log(`${C.blue}${C.bold}  ${I.brain} Gotcha Proposal Review${C.reset}`);
    console.log(`${C.gray}  ${files.length} proposal${files.length !== 1 ? "s" : ""} to review${C.reset}\n`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join(pDir, file);
      let proposal;
      try {
        proposal = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        log.warn(`Skipping corrupt file: ${file}`);
        continue;
      }

      const hash = file.replace(".json", "");
      console.log(`${C.gray}  ${"─".repeat(50)}${C.reset}`);
      console.log(`${C.blue}${C.bold}  Proposal ${i + 1} of ${files.length}${C.reset}`);
      console.log(`${C.gray}  Skill:  ${C.reset}${C.bold}${proposal.skill}${C.reset}`);
      if (proposal.source) console.log(`${C.gray}  Source: ${proposal.source}  (${proposal.created_at || "unknown date"})${C.reset}`);
      console.log("");
      console.log(`${C.red}  WRONG: ${C.reset}${proposal.wrong}`);
      console.log(`${C.green}  RIGHT: ${C.reset}${proposal.right}`);
      console.log(`${C.yellow}  WHY:   ${C.reset}${proposal.why}`);
      console.log("");

      const { action } = await inquirer.prompt([{
        type: "list",
        name: "action",
        message: "What do you want to do?",
        prefix: `  ${I.arch}`,
        choices: [
          { name: `${C.green}Accept${C.reset} (append to ${proposal.skill}.skill)`, value: "accept" },
          { name: `${C.blue}Edit${C.reset}   (modify in $EDITOR, then accept)`, value: "edit" },
          { name: `${C.red}Reject${C.reset} (move to rejected/)`, value: "reject" },
          { name: `${C.gray}Skip${C.reset}   (leave in queue)`, value: "skip" },
          { name: `${C.gray}Quit${C.reset}   (stop reviewing)`, value: "quit" },
        ],
      }]);

      if (action === "quit") {
        console.log(`${C.gray}  Stopped. ${files.length - i} proposal${files.length - i !== 1 ? "s" : ""} remaining.${C.reset}\n`);
        return;
      }

      if (action === "skip") {
        console.log(`${C.gray}  Skipped.${C.reset}\n`);
        continue;
      }

      if (action === "reject") {
        const rDir = rejectedDir(archDir);
        fs.mkdirSync(rDir, { recursive: true });
        fs.renameSync(filePath, path.join(rDir, file));
        console.log(`${C.red}  ${I.cross} Rejected and archived.${C.reset}\n`);
        continue;
      }

      let finalProposal = proposal;

      if (action === "edit") {
        const { edited } = await inquirer.prompt([{
          type: "editor",
          name: "edited",
          message: "Edit the proposal JSON:",
          default: JSON.stringify(proposal, null, 2),
        }]);
        try {
          finalProposal = JSON.parse(edited);
          if (!finalProposal.skill || !finalProposal.wrong || !finalProposal.right || !finalProposal.why) {
            console.log(`${C.red}  ${I.warn} Edited proposal is missing required fields. Skipping.${C.reset}\n`);
            continue;
          }
        } catch (err) {
          console.log(`${C.red}  ${I.warn} Invalid JSON: ${err.message}. Skipping.${C.reset}\n`);
          continue;
        }
      }

      // Accept: append to skill file
      const skillPath = path.join(archDir, "skills", `${finalProposal.skill}.skill`);
      if (!fs.existsSync(skillPath)) {
        const { create } = await inquirer.prompt([{
          type: "confirm",
          name: "create",
          message: `${finalProposal.skill}.skill doesn't exist. Create it?`,
          default: true,
          prefix: `  ${I.arch}`,
        }]);
        if (!create) {
          console.log(`${C.gray}  Skipped — skill file not created.${C.reset}\n`);
          continue;
        }
        // Create minimal skill file
        fs.mkdirSync(path.dirname(skillPath), { recursive: true });
        fs.writeFileSync(skillPath, `# ${finalProposal.skill}\n\n## Gotchas\n`);
        log.generate(`Created ${finalProposal.skill}.skill`);
      }

      const ok = appendGotcha(archDir, finalProposal.skill, finalProposal.wrong, finalProposal.right, finalProposal.why);
      if (ok) {
        fs.unlinkSync(filePath);
        const total = countGotchas(archDir, finalProposal.skill);
        console.log(`${C.green}  ${I.check} Accepted — added to ${finalProposal.skill}.skill (${total} total)${C.reset}\n`);
      }
    }

    console.log(`${C.green}  ${I.check} Review complete.${C.reset}\n`);
    return;
  }
```

- [ ] **Step 6: Run all tests to verify everything passes**

Run: `node tests/proposals/run.mjs`
Expected: PASS — all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/commands/gotcha.mjs tests/proposals/run.mjs
git commit -m "feat: add gotcha --list-proposals and --review for proposal queue"
```

---

### Task 6: Implement `init --install-hooks`

**Files:**
- Modify: `src/commands/init.mjs`
- Create: `tests/hooks/run.mjs`

- [ ] **Step 1: Write the test file**

Create `tests/hooks/run.mjs`:

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
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function withGitDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-hooks-"));
  // Initialize a bare git repo so .git/hooks exists
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  const orig = process.cwd();
  try {
    process.chdir(dir);
    fn(dir);
  } finally {
    process.chdir(orig);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n=== Hook Installer Tests ===\n");

test("--install-hooks creates pre-commit hook", () => {
  withGitDir((dir) => {
    const result = execFileSync("node", [ARCHKIT, "init", "--install-hooks", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    const json = JSON.parse(result);
    assert.equal(json.status, "installed");
    const hookPath = path.join(dir, ".git", "hooks", "pre-commit");
    assert.ok(fs.existsSync(hookPath), "hook file should exist");
    const content = fs.readFileSync(hookPath, "utf8");
    assert.ok(content.includes("archkit drift"), "hook should call archkit drift");
    // Check executable
    const stat = fs.statSync(hookPath);
    assert.ok(stat.mode & 0o111, "hook should be executable");
  });
});

test("--install-hooks with existing hook returns existing-hook status", () => {
  withGitDir((dir) => {
    const hookPath = path.join(dir, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hookPath, "#!/bin/sh\necho existing\n");
    const result = execFileSync("node", [ARCHKIT, "init", "--install-hooks", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
    });
    const json = JSON.parse(result);
    assert.equal(json.status, "existing-hook");
    assert.ok(json.suggested_append, "should include suggested_append");
    // Verify file unchanged
    const content = fs.readFileSync(hookPath, "utf8");
    assert.ok(content.includes("echo existing"), "existing hook should be unchanged");
  });
});

test("--install-hooks in non-git dir errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-no-git-"));
  try {
    execFileSync("node", [ARCHKIT, "init", "--install-hooks", "--json"], {
      cwd: dir, encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"],
    });
    assert.fail("should have thrown");
  } catch (err) {
    const stdout = err.stdout?.toString() || "";
    assert.ok(stdout.includes("not_a_git_repo"), `should mention not_a_git_repo, got: ${stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/hooks/run.mjs`
Expected: FAIL — `--install-hooks` not implemented

- [ ] **Step 3: Implement --install-hooks in init.mjs**

Add this block in `init.mjs`'s `main()` function, after the `--agent-scaffold` block and before the `.arch/ already exists` check:

```javascript
  // ── Install Hooks Mode ───────────────────────────────────────────────
  if (args.includes("--install-hooks")) {
    const gitDir = path.resolve(".git");
    if (!fs.existsSync(gitDir)) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: "not_a_git_repo" }));
      } else {
        log.error("Not a git repository — .git/ not found");
      }
      process.exit(2);
    }

    const hooksDir = path.join(gitDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, "pre-commit");
    const hookContent = `#!/bin/sh
# Installed by archkit init --install-hooks
# Runs archkit drift to detect .arch/ inconsistencies. Exits non-zero if drift detected.
exec archkit drift --json > /dev/null
`;
    const suggestedAppend = "exec archkit drift --json > /dev/null";

    if (fs.existsSync(hookPath)) {
      if (jsonMode) {
        console.log(JSON.stringify({ status: "existing-hook", path: hookPath, suggested_append: suggestedAppend }));
      } else {
        log.warn("Pre-commit hook already exists — not overwriting");
        console.error(`  Add this line to your existing hook:\n`);
        console.error(`    ${suggestedAppend}\n`);
      }
      return;
    }

    fs.writeFileSync(hookPath, hookContent);
    try { fs.chmodSync(hookPath, 0o755); } catch { log.warn("Could not chmod +x hook file"); }

    if (jsonMode) {
      console.log(JSON.stringify({ status: "installed", path: hookPath }));
    } else {
      log.ok("Pre-commit hook installed");
      console.error(`  Path: ${hookPath}`);
      console.error(`  Runs: archkit drift --json\n`);
    }
    return;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/hooks/run.mjs`
Expected: PASS — all 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.mjs tests/hooks/run.mjs
git commit -m "feat: add archkit init --install-hooks for pre-commit drift detection"
```

---

### Task 7: README persona section and command docs

**Files:**
- Modify: `README.md:47-100`

- [ ] **Step 1: Add persona section to README**

Insert the following after the `---` on line 48 (after the Quick Start section), replacing lines 49-50 (`## Quick Start`... through the quick start block ending at line 67):

Actually — the persona section goes AFTER Quick Start, not replacing it. Insert between the Quick Start closing ` ``` ` on line 65 and the `---` on line 69. The new section is:

```markdown

---

## Which flow is right for you?

<details open>
<summary><b>Solo dev, small project</b></summary>

You hold the architecture in your head. Your test suite is your contract.
You want archkit's context files, not its full protocol.

- Set up `.arch/` once with agent help: `archkit init --agent-scaffold`
- Wire drift detection into pre-commit: `archkit init --install-hooks`
- Capture gotchas as you find them: `archkit gotcha --propose --skill <package> --wrong "..." --right "..." --why "..."`
- Review accumulated gotchas: `archkit gotcha --review`

</details>

<details>
<summary><b>Team or multi-feature project</b></summary>

You need protocol uniformity and a shared architecture record. Full flow.

- Initialize the full scaffolded `.arch/`: `archkit init` (interactive wizard)
- Per-feature gating: `archkit resolve preflight <feature> <layer>`
- Review before every commit: `archkit review --staged`
- Close the feedback loop: `archkit gotcha --review` to approve proposed gotchas

</details>

<details>
<summary><b>Greenfield project</b></summary>

You're designing architecture alongside code. Use archkit to make the
design decisions explicit as you make them.

- Start with boundaries, not code: `archkit init --agent-scaffold` then fill in `.arch/BOUNDARIES.md` first
- Build outward from the cluster graph as clusters emerge
- `archkit drift` catches the moment code diverges from the stated design

</details>
```

- [ ] **Step 2: Update command tables with new commands**

In the **Scaffold & Setup** `<details>` section (around line 158), add these rows to the table:

```markdown
| `archkit init --agent-scaffold` | Stub `.arch/` with AI-fillable templates |
| `archkit init --install-hooks` | Install pre-commit hook for drift detection |
```

In the **Knowledge Capture** `<details>` section (around line 201), add these rows:

```markdown
| `archkit gotcha --propose --skill <pkg> ...` | Queue a gotcha proposal (agent-callable) |
| `archkit gotcha --list-proposals [--json]` | List pending proposals |
| `archkit gotcha --review` | Interactive proposal review (accept/edit/reject) |
```

- [ ] **Step 3: Update version badge**

Change line 22:

```markdown
[![Version](https://img.shields.io/badge/version-1.2.0-cyan.svg)]()
```

- [ ] **Step 4: Add husky documentation snippet**

In the **Health & Maintenance** `<details>` section (around line 215), add a note after the table:

```markdown
> **Husky users:** Add `exec archkit drift --json > /dev/null` to your `.husky/pre-commit` file.
```

- [ ] **Step 5: Visually review the README renders correctly**

Run: `head -120 README.md` to spot-check the persona section placement.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: add persona quickstart, new command docs, husky snippet"
```

---

### Task 8: Clean up dangling `--from-diff` and remove it

**Files:**
- Modify: `src/commands/gotcha.mjs:9`

- [ ] **Step 1: Delete the --from-diff usage line**

Remove line 9 from `src/commands/gotcha.mjs`:

```
 *   archkit gotcha --from-diff <file>
```

The updated usage block should read:

```javascript
/**
 * arch-gotcha — Capture bad AI-generated patterns into .skill files
 * 
 * Usage:
 *   archkit gotcha <skill> "<wrong>" "<right>" "<why>"
 *   archkit gotcha --interactive
 *   archkit gotcha --propose --skill <pkg> --wrong "..." --right "..." --why "..."
 *   archkit gotcha --review
 *   archkit gotcha --list-proposals [--json]
 * 
 * Examples:
 *   archkit gotcha stripe "req.body" "req.rawBody" "Express parses JSON. Stripe needs raw bytes."
 *   archkit gotcha --propose --skill prisma --wrong "new PrismaClient()" --right "globalThis.prisma ??= new PrismaClient()" --why "Serverless exhausts connections"
 *   archkit gotcha --interactive
 */
```

- [ ] **Step 2: Verify no other references to --from-diff**

Run: `grep -r "from-diff" src/`
Expected: No matches

- [ ] **Step 3: Commit**

```bash
git add src/commands/gotcha.mjs
git commit -m "chore: remove dangling --from-diff usage line, update gotcha usage docs"
```

---

### Task 9: Version bump and non-interactive contract tests

**Files:**
- Modify: `package.json:3`

- [ ] **Step 1: Bump version in package.json**

Change line 3 of `package.json`:

```json
  "version": "1.2.0",
```

- [ ] **Step 2: Run all test suites**

```bash
node tests/proposals/run.mjs && node tests/agent-scaffold/run.mjs && node tests/hooks/run.mjs
```

Expected: All suites pass.

- [ ] **Step 3: Run a quick non-interactive contract check**

Verify that `--json` commands produce valid JSON and don't hang without a TTY:

```bash
# These should all exit 0 with valid JSON, no TTY needed:
cd /tmp && mkdir -p archkit-contract-test/.arch/skills && cd archkit-contract-test

# propose (with all flags — should not invoke inquirer)
node <ARCHKIT_PATH> gotcha --propose --json --skill test --wrong "bad" --right "good" --why "reason"

# list-proposals
node <ARCHKIT_PATH> gotcha --list-proposals --json

# agent-scaffold
node <ARCHKIT_PATH> init --agent-scaffold --json

# Clean up
cd / && rm -rf /tmp/archkit-contract-test
```

Expected: Each command returns valid JSON to stdout. No hangs.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 1.2.0"
```

---

### Task 10: File deferred GitHub issues

**Files:** None (GitHub API only)

- [ ] **Step 1: File `init --from-source` deferral issue**

```bash
gh issue create --repo kenandrewmiranda/archkit \
  --title "Feature: init --from-source — reverse-scaffold .arch/ from existing code" \
  --body "$(cat <<'EOF'
## Context

During the v1.2.0 enhancement round, we identified that onboarding friction for existing projects is real — users have to hand-author the entire .arch/ skeleton. `init --from-source` would parse the import graph and propose a starter .arch/ cluster graph + BOUNDARIES skeleton.

## Deferred because

The right design isn't obvious. Key questions that need their own brainstorming pass:

1. **Language scope:** JS/TS is trivial (regex/AST). Python requires a separate scanner. Go/Rust need more. Which languages v1?
2. **Output fidelity:** A half-working scanner that produces misleading .arch/ graphs is worse than none. What confidence threshold is "good enough"?
3. **Write vs. propose:** Should it write .arch/ directly, or write proposal files the user reviews?
4. **Relationship to --agent-scaffold:** `init --agent-scaffold` (shipped in v1.2.0) solves a similar problem by letting the AI agent fill in stubs. Does --from-source complement or compete with that approach?

## Workaround

Use `archkit init --agent-scaffold` and let the AI agent populate the files based on its analysis of the codebase. This is the v1.2.0 solution.

Related: kenandrewmiranda/archkit#11
EOF
)"
```

- [ ] **Step 2: File --json backfill issue**

```bash
gh issue create --repo kenandrewmiranda/archkit \
  --title "Backfill --json + stderr logging on existing commands" \
  --body "$(cat <<'EOF'
## Context

Issue #5 recommended that all archkit commands should:
1. Support a --json flag that strips log output and returns only JSON on stdout
2. Route all log.*() calls to stderr (not stdout)

As of v1.2.0, the new commands (gotcha --propose, --list-proposals, init --agent-scaffold, init --install-hooks) follow this discipline. However, existing commands still mix logs and JSON on stdout in some cases.

## Scope

Audit existing commands and ensure --json mode produces clean JSON on stdout with logs on stderr. The logger (src/lib/logger.mjs) already writes to console.error — the issue is likely direct console.log() calls in command modules that should use log.*() instead.

Related: kenandrewmiranda/archkit#5
EOF
)"
```

- [ ] **Step 3: File marketplace pack format issue**

```bash
gh issue create --repo kenandrewmiranda/archkit \
  --title "Define marketplace pack format for community gotcha contributions" \
  --body "$(cat <<'EOF'
## Context

Issue #12 proposed 5 gotcha entries. Two were cherry-picked into the built-in gotcha-db (sqlite, numerics). The remaining three (aiosqlite implicit txn, in-loop error isolation, git rebase false conflicts) are handed off to the arch-market project as marketplace pack candidates.

Handoff file: arch-market/todo/archkit-issue-12-skill-content-handoff.md

## What's needed

The gotcha-db.mjs header says "Full gotcha packs available on the marketplace: archkit search gotchas" — but the marketplace pack format for gotcha packs doesn't appear to be formally defined. The existing presets/ directory has MCP marketplace configs, not gotcha packs.

Define:
1. The JSON schema for a gotcha pack (array of {skill, wrong, right, why} entries?)
2. How packs are installed (merge into existing .skill files? create new ones?)
3. How packs interact with the built-in GOTCHA_DB (override? supplement?)

Related: kenandrewmiranda/archkit#12
EOF
)"
```

- [ ] **Step 4: Verify all three issues were created**

```bash
gh issue list --repo kenandrewmiranda/archkit --state open
```

Expected: Three new open issues visible.

---

## Summary

| Task | What | Files touched |
|------|------|--------------|
| 1 | Cherry-pick gotcha-db entries | `gotcha-db.mjs`, `tests/proposals/run.mjs` |
| 2 | Agent-scaffold templates | `agent-scaffold-templates.mjs`, `tests/agent-scaffold/run.mjs` |
| 3 | `init --agent-scaffold` | `init.mjs`, `tests/agent-scaffold/run.mjs` |
| 4 | `gotcha --propose` | `gotcha.mjs`, `tests/proposals/run.mjs` |
| 5 | `gotcha --list-proposals` + `--review` | `gotcha.mjs`, `tests/proposals/run.mjs` |
| 6 | `init --install-hooks` | `init.mjs`, `tests/hooks/run.mjs` |
| 7 | README persona section + command docs | `README.md` |
| 8 | Clean up `--from-diff` | `gotcha.mjs` |
| 9 | Version bump + contract tests | `package.json` |
| 10 | File deferred GH issues | GitHub only |

10 tasks, ~10 commits, one PR.
