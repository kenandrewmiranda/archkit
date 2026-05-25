#!/usr/bin/env node
// Tests skill injection in `archkit resolve preflight` (arch-poly fix).
// Preflight must surface relevant .arch/skills/*.skill files via:
//   - requiredReading: [...] in JSON output
//   - "Required reading: ..." literal line in CLI stdout

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHKIT = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.message}`); failed++; }
}

function withProject(setup, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-preflight-"));
  try { setup(dir); run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function seedArch(dir, { skills = [], graphMentions = [], featureId = "kalshi" } = {}) {
  fs.mkdirSync(path.join(dir, ".arch", "skills"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".arch", "clusters"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src", "features", featureId), { recursive: true });

  fs.writeFileSync(
    path.join(dir, ".arch", "SYSTEM.md"),
    "# SYSTEM.md\n## Type: SaaS\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab-case\n"
  );

  const skillKwLines = skills.map(s => `${s} → $${s}`).join("\n");
  const skillFileLines = skills.map(s => `$${s} → .arch/skills/${s}.skill`).join("\n");
  fs.writeFileSync(
    path.join(dir, ".arch", "INDEX.md"),
    [
      "# INDEX.md",
      "## Conv: src/features/{f}/{f}.{layer}.ts",
      "## Keywords → Nodes",
      `${featureId} → @${featureId}`,
      "## Keywords → Skills",
      skillKwLines,
      "## Nodes → Clusters → Files",
      `@${featureId} = [${featureId}] → src/features/${featureId}/`,
      "## Skills → Files",
      skillFileLines,
      "",
    ].join("\n")
  );

  for (const s of skills) {
    fs.writeFileSync(
      path.join(dir, ".arch", "skills", `${s}.skill`),
      `# ${s} skill\n\nWRONG: example\nRIGHT: example\nWHY: example\n`
    );
  }

  // Cluster graph (optionally mentions $skill ids)
  const graph = [
    `--- ${featureId} ---`,
    `Service [S]: business logic`,
    ...graphMentions.map(s => `Note    [U]: uses $${s} for API quirks`),
    "---",
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, ".arch", "clusters", `${featureId}.graph`), graph);
}

function runPreflight(dir, feature, layer) {
  // Capture stdout + stderr separately. v1.7 moved agent-prefix lines
  // ("Required reading:", "Next:") to stderr so stdout stays pure JSON.
  const result = spawnSync("node", [ARCHKIT, "resolve", "preflight", feature, layer, "--pretty"],
    { cwd: dir, encoding: "utf8" });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const match = stdout.match(/\{[\s\S]*\}\s*$/);
  return { raw: stdout + stderr, stdout, stderr, json: match ? JSON.parse(match[0]) : null };
}

console.log("\n  preflight skill injection — kalshi scenario (arch-poly)");

test("matches skill by exact feature-id match (skill `kalshi` for feature `kalshi`)", () => {
  withProject(
    (dir) => seedArch(dir, { skills: ["kalshi"], featureId: "kalshi" }),
    (dir) => {
      const { json } = runPreflight(dir, "kalshi", "service");
      assert.ok(Array.isArray(json.requiredReading), `expected array, got ${typeof json.requiredReading}`);
      assert.deepEqual(json.requiredReading, [".arch/skills/kalshi.skill"]);
    }
  );
});

test("matches skill referenced via $skill in cluster graph", () => {
  withProject(
    (dir) => seedArch(dir, {
      skills: ["bullmq"],
      graphMentions: ["bullmq"],
      featureId: "billing",
    }),
    (dir) => {
      const { json } = runPreflight(dir, "billing", "service");
      assert.ok(json.requiredReading.includes(".arch/skills/bullmq.skill"));
    }
  );
});

test("CLI prefixes 'Required reading:' line on stderr (stdout is pure JSON)", () => {
  withProject(
    (dir) => seedArch(dir, { skills: ["kalshi"], featureId: "kalshi" }),
    (dir) => {
      const { stdout, stderr } = runPreflight(dir, "kalshi", "service");
      assert.ok(
        stderr.includes("Required reading: .arch/skills/kalshi.skill"),
        `expected stderr to contain 'Required reading:', got stderr=${stderr}`
      );
      // stdout must remain pure JSON for downstream parsers
      assert.doesNotMatch(stdout.split("\n")[0], /^Required reading:/);
    }
  );
});

test("no matching skills → emits 'none matched' note on stderr, empty array in JSON", () => {
  withProject(
    (dir) => seedArch(dir, { skills: [], featureId: "other" }),
    (dir) => {
      const { stderr, json } = runPreflight(dir, "other", "service");
      assert.deepEqual(json.requiredReading, []);
      assert.ok(
        stderr.includes("Required reading: (none matched)"),
        `v1.7 loud no-op: should emit a 'none matched' note instead of silently omitting, got stderr=${stderr}`
      );
      assert.ok(json.requiredReadingNote, "JSON should include requiredReadingNote explanation");
    }
  );
});

console.log(`\n\x1b[1m═══════════════════════════════════════════════════════\x1b[0m`);
console.log(`\x1b[1m${passed + failed} tests\x1b[0m | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
