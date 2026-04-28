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
