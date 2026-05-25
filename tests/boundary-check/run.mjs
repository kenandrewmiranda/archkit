#!/usr/bin/env node
// Tests for archkit boundary-check (arch-poly item #10, #2 priority).
//
// Verifies the full pipeline: parse BAN directives from BOUNDARIES.md,
// detect imports per language, intersect with staged hunks, emit violations.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseBoundaries, normalizeImport } from "../../src/lib/boundary-parser.mjs";
import { extractImports } from "../../src/lib/import-detector.mjs";
import { checkBoundaries } from "../../src/commands/boundary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

console.log("\n  boundary-parser — parseBoundaries");

test("standalone BAN bullet", () => {
  const { rules, warnings } = parseBoundaries("- BAN: copilot/* -> execution/*\n");
  assert.equal(rules.length, 1);
  assert.equal(warnings.length, 0);
  assert.equal(rules[0].source, "copilot/*");
  assert.equal(rules[0].target, "execution/*");
});

test("BAN embedded in NEVER prose", () => {
  const { rules } = parseBoundaries(
    "- NEVER import from execution layer. (BAN: copilot/* -> execution/*)\n"
  );
  assert.equal(rules.length, 1);
});

test("unicode arrow accepted", () => {
  const { rules } = parseBoundaries("- BAN: domain/* → infrastructure/*\n");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].target, "infrastructure/*");
});

test("multiple rules across lines", () => {
  const md = [
    "- BAN: copilot/* -> execution/*",
    "- BAN: routes/public/* -> auth/internal/*",
    "- NEVER skip CORS. (no ban here)",
    "- BAN: ui/* -> db/*",
  ].join("\n");
  const { rules } = parseBoundaries(md);
  assert.equal(rules.length, 3);
});

test("malformed glob produces a warning, not a crash", () => {
  const { rules, warnings } = parseBoundaries("- BAN: foo[bad]/* -> bar/*\n");
  assert.equal(rules.length, 0);
  assert.equal(warnings.length, 1);
});

console.log("\n  normalizeImport");

test("Python dotted module → slash path", () => {
  assert.equal(normalizeImport("bot.execution.broker"), "bot/execution/broker");
});

test("relative path → slashed without leading dots", () => {
  assert.equal(normalizeImport("./util/foo"), "util/foo");
  assert.equal(normalizeImport("../execution/broker"), "execution/broker");
});

test("@scoped import → strip @", () => {
  assert.equal(normalizeImport("@app/copilot/x"), "app/copilot/x");
});

console.log("\n  extractImports");

test("JS: import + require detected", () => {
  const code = [
    "import x from \"./a/b\";",
    "import { y } from '../c/d';",
    "const q = require(\"e/f\");",
    "// import wrong from 'commented'",
  ].join("\n");
  const out = extractImports("foo.js", code);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(i => i.spec), ["./a/b", "../c/d", "e/f"]);
});

test("Python: from-import + bare import", () => {
  const code = [
    "from bot.execution import broker",
    "import bot.copilot.foo",
    "import os, sys",
  ].join("\n");
  const out = extractImports("foo.py", code);
  assert.deepEqual(out.map(i => i.spec), ["bot.execution", "bot.copilot.foo", "os", "sys"]);
});

test("unknown language → empty", () => {
  assert.deepEqual(extractImports("foo.rs", "use std::io;"), []);
});

console.log("\n  checkBoundaries — end-to-end (no git)");

function withProject(setup, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-bound-"));
  try { setup(dir); run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("Python: copilot importing execution flagged", () => {
  withProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".arch", "BOUNDARIES.md"),
        "# BOUNDARIES.md\n- BAN: bot/copilot/* -> bot/execution/*\n"
      );
      fs.mkdirSync(path.join(dir, "bot", "copilot"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "bot", "copilot", "discover.py"),
        "from bot.execution import broker\n\ndef go(): pass\n"
      );
    },
    (dir) => {
      const result = checkBoundaries({
        archDir: path.join(dir, ".arch"),
        files: ["bot/copilot/discover.py"],
        cwd: dir,
        hunkLines: null,
      });
      assert.equal(result.violations.length, 1, JSON.stringify(result));
      assert.equal(result.violations[0].file, "bot/copilot/discover.py");
      assert.equal(result.violations[0].imported, "bot.execution");
      assert.equal(result.pass, false);
    }
  );
});

test("Python: copilot importing siblings is clean", () => {
  withProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".arch", "BOUNDARIES.md"),
        "- BAN: bot/copilot/* -> bot/execution/*\n"
      );
      fs.mkdirSync(path.join(dir, "bot", "copilot"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "bot", "copilot", "discover.py"),
        "from bot.copilot import games\nimport os\n"
      );
    },
    (dir) => {
      const result = checkBoundaries({
        archDir: path.join(dir, ".arch"),
        files: ["bot/copilot/discover.py"],
        cwd: dir,
        hunkLines: null,
      });
      assert.equal(result.violations.length, 0, JSON.stringify(result.violations));
      assert.equal(result.pass, true);
    }
  );
});

console.log("\n  end-to-end via `archkit boundary-check --staged --json`");

function withGitProject(setup, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-bound-git-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    setup(dir);
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("--staged flags only NEW import that crosses a BAN line", () => {
  withGitProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".arch", "BOUNDARIES.md"),
        "- BAN: bot/copilot/* -> bot/execution/*\n"
      );
      fs.mkdirSync(path.join(dir, "bot", "copilot"), { recursive: true });
      // Initial file with one allowed import
      fs.writeFileSync(
        path.join(dir, "bot", "copilot", "discover.py"),
        "from bot.copilot import games\n\ndef go(): pass\n"
      );
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
      // Stage a new line that violates the BAN
      fs.writeFileSync(
        path.join(dir, "bot", "copilot", "discover.py"),
        "from bot.copilot import games\nfrom bot.execution import broker\n\ndef go(): pass\n"
      );
      execFileSync("git", ["add", "-A"], { cwd: dir });
    },
    (dir) => {
      let out, status = 0;
      try {
        out = execFileSync("node", [ARCHKIT, "boundary-check", "--staged", "--json"],
          { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      } catch (e) {
        status = e.status;
        out = (e.stdout || "").toString();
      }
      assert.equal(status, 1, "should exit non-zero on violation");
      const result = JSON.parse(out);
      assert.equal(result.violations.length, 1, JSON.stringify(result));
      assert.equal(result.violations[0].line, 2);
    }
  );
});

console.log("\n  v1.7 loud no-op signals — dead-end indicators");

test("BOUNDARIES.md with no BAN directives → hint + nextStep guide the user to add them", () => {
  withProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".arch", "BOUNDARIES.md"),
        "# BOUNDARIES.md\n- NEVER hardcode secrets\n- NEVER use any type\n"
      );
    },
    (dir) => {
      const result = checkBoundaries({
        archDir: path.join(dir, ".arch"),
        files: [],
        cwd: dir,
        hunkLines: null,
      });
      assert.equal(result.rules, 0);
      assert.equal(result.pass, true);
      assert.ok(result.hint && result.hint.includes("BAN"),
        "loud-no-op: should hint that BOUNDARIES.md has no machine-enforceable BAN directives");
      assert.ok(result.nextStep && result.nextStep.includes("BAN"),
        "should suggest adding BAN directives as the next step");
    }
  );
});

test("BAN rules that match no scanned file are reported in unappliedRules", () => {
  withProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".arch", "BOUNDARIES.md"),
        [
          "- BAN: bot/copilot/* -> bot/execution/*",
          "- BAN: bot/missing/* -> bot/anywhere/*",
        ].join("\n") + "\n"
      );
      fs.mkdirSync(path.join(dir, "bot", "copilot"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "bot", "copilot", "discover.py"),
        "from bot.copilot import x\n"
      );
    },
    (dir) => {
      const result = checkBoundaries({
        archDir: path.join(dir, ".arch"),
        files: ["bot/copilot/discover.py"],
        cwd: dir,
        hunkLines: null,
      });
      assert.equal(result.rules, 2);
      assert.ok(Array.isArray(result.unappliedRules));
      assert.equal(result.unappliedRules.length, 1, JSON.stringify(result.unappliedRules));
      assert.equal(result.unappliedRules[0].source, "bot/missing/*");
    }
  );
});

test("clean run → nextStep says no action needed", () => {
  withProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".arch", "BOUNDARIES.md"),
        "- BAN: bot/copilot/* -> bot/execution/*\n");
      fs.mkdirSync(path.join(dir, "bot", "copilot"), { recursive: true });
      fs.writeFileSync(path.join(dir, "bot", "copilot", "ok.py"),
        "from bot.copilot import x\n");
    },
    (dir) => {
      const result = checkBoundaries({
        archDir: path.join(dir, ".arch"),
        files: ["bot/copilot/ok.py"],
        cwd: dir,
        hunkLines: null,
      });
      assert.equal(result.pass, true);
      assert.ok(result.nextStep);
      assert.match(result.nextStep, /No action|respect/i);
    }
  );
});

test("violation → nextStep tells the user how to fix it", () => {
  withProject(
    (dir) => {
      fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".arch", "BOUNDARIES.md"),
        "- BAN: bot/copilot/* -> bot/execution/*\n");
      fs.mkdirSync(path.join(dir, "bot", "copilot"), { recursive: true });
      fs.writeFileSync(path.join(dir, "bot", "copilot", "bad.py"),
        "from bot.execution import broker\n");
    },
    (dir) => {
      const result = checkBoundaries({
        archDir: path.join(dir, ".arch"),
        files: ["bot/copilot/bad.py"],
        cwd: dir,
        hunkLines: null,
      });
      assert.equal(result.pass, false);
      assert.ok(result.nextStep && result.nextStep.toLowerCase().includes("fix"),
        "should tell the user to fix the violation");
    }
  );
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
