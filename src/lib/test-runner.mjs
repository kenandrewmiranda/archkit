// Test-command detection + execution for the CGR test gate (v1.9).
//
// A goal can declare a `verify-command` — the project's test/verify command.
// archkit_goal_verify runs it as a cheap preview; archkit_goal_complete runs
// it as a HARD gate (refuses to complete a goal whose tests are red). This is
// the "bake test confirmation into the goal" feedback-loop ask: "done" should
// provably mean tests pass, not just that the agent says so.
//
// Detection is best-effort and Node-ecosystem-first (archkit is a Node tool):
// we read package.json → scripts.test and pick the runner from the lockfile.
// Returns null when there's no real test script, so projects without tests
// skip the gate gracefully rather than being blocked on a command that fails.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// npm's `npm init` leaves this placeholder behind; treat it as "no tests".
const NPM_PLACEHOLDER = /no test specified/i;

// Pick the package runner from the lockfile so the detected command matches how
// the project is actually driven (pnpm test / yarn test / npm test).
function detectRunner(cwd) {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

// Returns { command, source } or null. `source` is human-readable provenance
// for the verify/complete output so the agent knows where the command came from.
export function detectTestCommand(cwd = process.cwd()) {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch { return null; }
  const testScript = pkg?.scripts?.test;
  if (!testScript || NPM_PLACEHOLDER.test(testScript)) return null;
  const runner = detectRunner(cwd);
  return { command: `${runner} test`, source: "package.json:scripts.test" };
}

// Run a verify command and report pass/fail. Never throws — a failure to spawn
// is reported as ran:false so callers can degrade gracefully.
//
//   { ran, command, passed, exitCode, durationMs, outputTail, timedOut }
//
// outputTail is the last ~2000 chars of combined stdout+stderr — enough to see
// the failing assertion without flooding the tool result.
export function runTests({ cwd = process.cwd(), command, timeoutMs = 180000 } = {}) {
  if (!command || typeof command !== "string") {
    return { ran: false, command: command || null, passed: false, reason: "no verify-command" };
  }
  const startedAt = Date.now();
  let res;
  try {
    res = spawnSync(command, {
      cwd,
      shell: true,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return { ran: false, command, passed: false, reason: err.message };
  }
  const durationMs = Date.now() - startedAt;
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  if (res.error && !timedOut) {
    // Command couldn't be launched at all (e.g. runner not installed).
    return { ran: false, command, passed: false, reason: res.error.message, durationMs };
  }
  const combined = `${res.stdout || ""}${res.stderr || ""}`;
  const outputTail = combined.length > 2000 ? `…${combined.slice(-2000)}` : combined;
  return {
    ran: true,
    command,
    passed: !timedOut && res.status === 0,
    exitCode: res.status,
    durationMs,
    timedOut,
    outputTail: outputTail.trim(),
  };
}
