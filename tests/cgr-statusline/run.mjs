#!/usr/bin/env node
// Tests for the status-line segment (statusline-archkit-context).
//
// The Claude Code status line is a plain shell subprocess that can't call MCP,
// so `archkit statusline` reads .arch/ goal state off disk and emits a compact
// segment: active goal slug + pending-queue depth. These tests cover the pure
// lib (statuslineSegment) AND the CLI degradation contract (silent + exit 0
// outside a project / when no goal is active / when .arch/ is malformed).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  writeGoal,
  startGoal,
  markTesting,
  statuslineSegment,
} from "../../src/lib/goals.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../bin/archkit.mjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (err) { console.error(`  \x1b[31m✗\x1b[0m ${name}`); console.error(`    ${err.stack || err.message}`); failed++; }
}

function withArchDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-statusline-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(archDir, { recursive: true });
  fs.writeFileSync(path.join(archDir, "SYSTEM.md"),
    "# SYSTEM.md\n## Type: Internal\n## Pattern: layered\n## Rules\n- one\n## Reserved Words\n## Naming\nFiles: kebab\n");
  try { fn({ dir, archDir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Run the CLI with cwd at `dir` (mirrors how the status line invokes it).
function runCli(argv, cwd) {
  return spawnSync(process.execPath, [CLI, "statusline", ...argv], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ARCHKIT_RUN: "" },
  });
}

console.log("\n  statusline-archkit-context — statuslineSegment (pure lib)");

test("null when archDir is missing (outside a project)", () => {
  assert.equal(statuslineSegment(null), null);
  assert.equal(statuslineSegment(""), null);
});

test("null when no live goal (queue only, nothing in-progress)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "a", meta: { title: "A", status: "pending" }, body: "" });
    writeGoal(archDir, { slug: "b", meta: { title: "B", status: "pending" }, body: "" });
    // Silent even though the queue is non-empty — the segment is about ACTIVE work.
    assert.equal(statuslineSegment(archDir), null);
  });
});

test("in-progress goal + queue depth → ⛏ slug (N queued)", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "active-one", meta: { title: "Active", status: "pending" }, body: "" });
    writeGoal(archDir, { slug: "q1", meta: { title: "Q1", status: "pending" }, body: "" });
    writeGoal(archDir, { slug: "q2", meta: { title: "Q2", status: "pending" }, body: "" });
    writeGoal(archDir, { slug: "q3", meta: { title: "Q3", status: "pending" }, body: "" });
    startGoal(archDir, "active-one");
    const seg = statuslineSegment(archDir);
    assert.ok(seg, "segment present");
    assert.equal(seg.slug, "active-one");
    assert.equal(seg.status, "in-progress");
    assert.equal(seg.queued, 3, "3 remaining pending goals");
    assert.equal(seg.text, "⛏ active-one (3 queued)");
  });
});

test("queue-empty active goal omits the (N queued) suffix", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "solo", meta: { title: "Solo", status: "pending" }, body: "" });
    startGoal(archDir, "solo");
    const seg = statuslineSegment(archDir);
    assert.equal(seg.queued, 0);
    assert.equal(seg.text, "⛏ solo", "no (0 queued) noise");
  });
});

test("testing goal uses a distinct glyph and status", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "verify-me", meta: { title: "Verify", status: "pending" }, body: "" });
    writeGoal(archDir, { slug: "q1", meta: { title: "Q1", status: "pending" }, body: "" });
    startGoal(archDir, "verify-me");
    markTesting(archDir, "verify-me");
    const seg = statuslineSegment(archDir);
    assert.equal(seg.status, "testing");
    assert.equal(seg.glyph, "🧪");
    assert.equal(seg.text, "🧪 verify-me (1 queued)");
  });
});

test("in-progress preferred over testing when both live", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "in-prog", meta: { title: "InProg", status: "pending" }, body: "" });
    writeGoal(archDir, { slug: "in-test", meta: { title: "InTest", status: "pending" }, body: "" });
    startGoal(archDir, "in-test");
    markTesting(archDir, "in-test");
    startGoal(archDir, "in-prog");
    const seg = statuslineSegment(archDir);
    assert.equal(seg.slug, "in-prog");
    assert.equal(seg.status, "in-progress");
  });
});

test("custom glyphs are honored", () => {
  withArchDir(({ archDir }) => {
    writeGoal(archDir, { slug: "g", meta: { title: "G", status: "pending" }, body: "" });
    startGoal(archDir, "g");
    const seg = statuslineSegment(archDir, { glyph: ">>" });
    assert.equal(seg.text, ">> g");
  });
});

test("malformed .arch/ does not throw (degrades to null)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-statusline-bad-"));
  const archDir = path.join(dir, ".arch");
  fs.mkdirSync(path.join(archDir, "goals", "queue"), { recursive: true });
  // A goal file with garbage frontmatter must not crash the segment.
  fs.writeFileSync(path.join(archDir, "goals", "queue", "broken.md"), "---\n: : :\nnot yaml\n---\nbody");
  try {
    assert.doesNotThrow(() => statuslineSegment(archDir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log("\n  statusline-archkit-context — CLI degradation contract");

test("CLI prints nothing + exits 0 outside an archkit project", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-statusline-noarch-"));
  try {
    const r = runCli([], dir);
    assert.equal(r.status, 0, "exit 0");
    assert.equal(r.stdout.trim(), "", "no output");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI prints nothing + exits 0 when no goal is active", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "pending-only", meta: { title: "P", status: "pending" }, body: "" });
    const r = runCli([], dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "");
  });
});

test("CLI emits the segment text for an active goal", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "cli-active", meta: { title: "A", status: "pending" }, body: "" });
    writeGoal(archDir, { slug: "cli-q", meta: { title: "Q", status: "pending" }, body: "" });
    startGoal(archDir, "cli-active");
    const r = runCli([], dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "⛏ cli-active (1 queued)");
  });
});

test("CLI accepts an explicit search-root arg (the status line passes $cwd)", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "root-active", meta: { title: "A", status: "pending" }, body: "" });
    startGoal(archDir, "root-active");
    // Run from a neutral cwd, pass the project dir as the arg.
    const neutral = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-statusline-neutral-"));
    try {
      const r = runCli([dir], neutral);
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), "⛏ root-active");
    } finally {
      fs.rmSync(neutral, { recursive: true, force: true });
    }
  });
});

test("CLI --json emits structured fields", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "json-active", meta: { title: "A", status: "pending" }, body: "" });
    writeGoal(archDir, { slug: "json-q", meta: { title: "Q", status: "pending" }, body: "" });
    startGoal(archDir, "json-active");
    const r = runCli(["--json"], dir);
    assert.equal(r.status, 0);
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.slug, "json-active");
    assert.equal(j.status, "in-progress");
    assert.equal(j.queued, 1);
    assert.equal(j.text, "⛏ json-active (1 queued)");
  });
});

test("CLI --json outside a project is empty but valid JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-statusline-jsonempty-"));
  try {
    const r = runCli(["--json"], dir);
    assert.equal(r.status, 0);
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.text, "");
    assert.equal(j.slug, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --color wraps the segment in ANSI", () => {
  withArchDir(({ dir, archDir }) => {
    writeGoal(archDir, { slug: "color-active", meta: { title: "A", status: "pending" }, body: "" });
    startGoal(archDir, "color-active");
    const r = runCli(["--color"], dir);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes("\x1b[91m"), "bright-red open");
    assert.ok(r.stdout.includes("color-active"), "slug present");
    assert.ok(r.stdout.includes("\x1b[0m"), "reset present");
  });
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
