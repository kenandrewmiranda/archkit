#!/usr/bin/env node
// Criterion 2's proof obligation: "a goal file is never removed before its raw
// copy is durable."
//
// A SIGKILL test cannot show this. Killing a process leaves the page cache
// intact, so an unsynced write looks exactly like a synced one — the crash that
// loses an unsynced archive copy is a POWER loss, which no test in this suite
// can stage. What IS observable, and is the whole of the claim, is the ORDER of
// the syscalls: the durability barrier on the raw content must precede the
// removal of the source, and the removal must itself be made durable.
//
// So this child instruments node:fs and records the syscall trace of one
// consolidation. goals.mjs holds the same module object this patches (the shim
// in scripts/arch-write-guard.cjs works the same way), so the trace is the real
// call sequence, not a re-implementation of it.
//
// argv: <archDir> <day> <traceFile>

import fs from "node:fs";
import path from "node:path";

const [archDir, day, traceFile] = process.argv.slice(2);

const goalsRoot = path.join(archDir, "goals");
const trace = [];
const fdPaths = new Map();

const rel = (p) => path.relative(archDir, String(p)).split(path.sep).join("/");
// Only goals/ traffic is in scope. The advisory lockfile opens and unlinks on
// every call and would bury the sequence under noise.
const inScope = (p) => String(p).startsWith(goalsRoot);
const record = (line) => trace.push(line);

const realOpen = fs.openSync;
fs.openSync = function (p, ...rest) {
  const fd = realOpen.call(this, p, ...rest);
  fdPaths.set(fd, String(p));
  if (inScope(p)) record(`open ${rel(p)} flags=${rest[0] ?? "r"}`);
  return fd;
};

const realFsync = fs.fsyncSync;
fs.fsyncSync = function (fd) {
  const p = fdPaths.get(fd);
  if (p && inScope(p)) record(`fsync ${rel(p)}`);
  return realFsync.call(this, fd);
};

const realRename = fs.renameSync;
fs.renameSync = function (a, b) {
  if (inScope(a) || inScope(b)) record(`rename ${rel(a)} -> ${rel(b)}`);
  return realRename.call(this, a, b);
};

const realUnlink = fs.unlinkSync;
fs.unlinkSync = function (p) {
  if (inScope(p)) record(`unlink ${rel(p)}`);
  return realUnlink.call(this, p);
};

const realRm = fs.rmSync;
fs.rmSync = function (p, ...rest) {
  if (inScope(p)) record(`rm ${rel(p)}`);
  return realRm.call(this, p, ...rest);
};

const realWriteFile = fs.writeFileSync;
fs.writeFileSync = function (p, ...rest) {
  if (typeof p === "string" && inScope(p)) record(`writeFile ${rel(p)}`);
  return realWriteFile.call(this, p, ...rest);
};

const realAppendFile = fs.appendFileSync;
fs.appendFileSync = function (p, ...rest) {
  if (typeof p === "string" && inScope(p)) record(`appendFile ${rel(p)}`);
  return realAppendFile.call(this, p, ...rest);
};

// Imported AFTER the patch so the instrumented functions are the ones it calls.
const { consolidateGoals } = await import("../../src/lib/goals.mjs");

let error = null;
try {
  consolidateGoals(archDir, { date: day });
} catch (err) {
  error = err.message;
}

realWriteFile.call(fs, traceFile, JSON.stringify({ trace, error }, null, 2));
