// Preloaded (via NODE_OPTIONS=--require) into every node process the test
// runner starts, and into every node process THOSE start. Its job is to give
// scripts/test.mjs's board-immutability guard something a content hash can
// never provide on its own: ATTRIBUTION.
//
// A sha256 diff of .arch/ answers "did the board change?" but not "who changed
// it". archkit MCP tools always write the MAIN project's .arch/ regardless of
// which worktree the calling agent lives in, so during a multi-agent pass an
// unrelated worker's archkit_goal_handoff lands mid-run and the suite that
// happened to be executing gets blamed for it. This shim closes that gap by
// observing writes at their source, inside the test process tree:
//
//   * every fs write API is wrapped; a target path inside the live .arch/ is
//     appended to the audit log (suite, pid, api, path) and then REFUSED,
//   * child_process is wrapped so an explicit `env` option still carries the
//     preload down — otherwise a suite could spawn out of instrumentation.
//
// So the runner gets a two-sided answer. A board delta with matching audit
// records is the suite's, named and fatal. A board delta with none of them
// provably came from outside this process tree and is reported as a concurrent
// external write, never as a suite failure.
//
// Refusing rather than merely recording is deliberate: it makes a leak fail at
// its source instead of silently corrupting a real board, and it means a
// surviving delta really is external rather than merely unattributed.
//
// Fail-open by design — a bug in here must never take down a test run. Every
// hook is guarded, and an unusable audit log degrades to a no-op.

"use strict";

const ARCH_DIR = process.env.ARCHKIT_TEST_ARCH_DIR;
const AUDIT = process.env.ARCHKIT_TEST_WRITE_AUDIT;
const SUITE = process.env.ARCHKIT_TEST_SUITE || "?";

if (ARCH_DIR && AUDIT) {
  const fs = require("node:fs");
  const path = require("node:path");
  const cp = require("node:child_process");

  const rawAppend = fs.appendFileSync;

  function record(entry) {
    try {
      rawAppend.call(fs, AUDIT, JSON.stringify({ suite: SUITE, pid: process.pid, ...entry }) + "\n");
    } catch {}
  }

  // One boot line per suite, emitted only by the process the runner starts
  // (the marker is cleared so descendants stay quiet). The runner treats a
  // suite with no boot line as UNinstrumented and falls back to blaming it —
  // silence must never be mistaken for innocence.
  if (process.env.ARCHKIT_TEST_SUITE_BOOT) {
    record({ kind: "boot" });
    delete process.env.ARCHKIT_TEST_SUITE_BOOT;
  }

  const sep = path.sep;
  function inArch(p) {
    let s;
    if (typeof p === "string") s = p;
    else if (Buffer.isBuffer(p)) s = p.toString();
    else if (p && typeof p === "object" && p.href !== undefined) {
      try { s = require("node:url").fileURLToPath(p); } catch { return false; }
    } else return false; // fd, or something we cannot resolve to a path
    try { s = path.resolve(s); } catch { return false; }
    return s === ARCH_DIR || s.startsWith(ARCH_DIR + sep);
  }

  function refuse(api, target) {
    record({ kind: "write", api, path: String(target) });
    const err = new Error(
      `archkit test guard: ${api} refused — suite "${SUITE}" tried to write the live .arch/ board ` +
      `(${target}). Spawn archkit bins with an explicit cwd pointing at the suite's temp project.`
    );
    err.code = "EACCES";
    err.path = String(target);
    return err;
  }

  // [api name, indexes of arguments that name a write TARGET]
  const TARGETS = [
    ["writeFile", [0]], ["appendFile", [0]], ["mkdir", [0]], ["rm", [0]], ["rmdir", [0]],
    ["unlink", [0]], ["truncate", [0]], ["copyFile", [1]], ["cp", [1]], ["rename", [0, 1]],
    ["symlink", [1]], ["link", [1]], ["mkdtemp", [0]], ["chmod", [0]], ["utimes", [0]],
  ];

  function targetOf(args, idxs) {
    for (const i of idxs) if (inArch(args[i])) return args[i];
    return null;
  }

  function wrapSync(obj, name, idxs) {
    const orig = obj[name];
    if (typeof orig !== "function") return;
    obj[name] = function (...args) {
      const hit = targetOf(args, idxs);
      if (hit !== null) throw refuse(name, hit);
      return orig.apply(this, args);
    };
  }

  function wrapCb(obj, name, idxs) {
    const orig = obj[name];
    if (typeof orig !== "function") return;
    obj[name] = function (...args) {
      const hit = targetOf(args, idxs);
      if (hit === null) return orig.apply(this, args);
      const err = refuse(name, hit);
      const cb = args[args.length - 1];
      if (typeof cb === "function") return process.nextTick(cb, err);
      throw err;
    };
  }

  function wrapPromise(obj, name, idxs) {
    const orig = obj[name];
    if (typeof orig !== "function") return;
    obj[name] = function (...args) {
      const hit = targetOf(args, idxs);
      if (hit !== null) return Promise.reject(refuse(name, hit));
      return orig.apply(this, args);
    };
  }

  try {
    for (const [name, idxs] of TARGETS) {
      wrapCb(fs, name, idxs);
      wrapSync(fs, name + "Sync", idxs);
      if (fs.promises) wrapPromise(fs.promises, name, idxs);
    }

    // open()/createWriteStream() bypass the list above: they take a mode, not a
    // verb, so the flag string decides whether the call is a write.
    const WRITE_FLAG = /\+|^[wax]/;
    const C = fs.constants;
    const WRITE_BITS = C.O_WRONLY | C.O_RDWR | C.O_CREAT | C.O_APPEND | C.O_TRUNC;
    const isWriteFlag = (f) =>
      f === undefined || f === null ? false            // default is 'r'
      : typeof f === "number" ? (f & WRITE_BITS) !== 0
      : WRITE_FLAG.test(String(f));

    const openSync = fs.openSync;
    fs.openSync = function (p, flags, ...rest) {
      if (isWriteFlag(flags) && inArch(p)) throw refuse("openSync", p);
      return openSync.call(this, p, flags, ...rest);
    };
    const open = fs.open;
    fs.open = function (p, ...rest) {
      const flags = typeof rest[0] === "function" ? "r" : rest[0];
      if (isWriteFlag(flags) && inArch(p)) {
        const cb = rest[rest.length - 1];
        const err = refuse("open", p);
        if (typeof cb === "function") return process.nextTick(cb, err);
        throw err;
      }
      return open.call(this, p, ...rest);
    };
    if (fs.promises) {
      const popen = fs.promises.open;
      fs.promises.open = function (p, flags, ...rest) {
        if (isWriteFlag(flags) && inArch(p)) return Promise.reject(refuse("promises.open", p));
        return popen.call(this, p, flags, ...rest);
      };
    }
    const cws = fs.createWriteStream;
    fs.createWriteStream = function (p, ...rest) {
      if (inArch(p)) throw refuse("createWriteStream", p);
      return cws.call(this, p, ...rest);
    };

    // Keep the preload alive across process boundaries. A suite that passes an
    // explicit `env` would otherwise hand its children a clean environment, and
    // an archkit bin spawned that way could write the board unobserved — which
    // the runner would then read as "external", exactly backwards.
    const CARRY = [
      "NODE_OPTIONS", "ARCHKIT_TEST_ARCH_DIR", "ARCHKIT_TEST_WRITE_AUDIT", "ARCHKIT_TEST_SUITE",
    ];
    function carryEnv(opts) {
      if (!opts || typeof opts !== "object" || !opts.env) return opts;
      const env = { ...opts.env };
      for (const k of CARRY) if (process.env[k] !== undefined) env[k] = process.env[k];
      return { ...opts, env };
    }
    // Options are the last object argument for every one of these signatures.
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
      const orig = cp[name];
      if (typeof orig !== "function") continue;
      cp[name] = function (...args) {
        for (let i = args.length - 1; i >= 1; i--) {
          if (args[i] && typeof args[i] === "object" && !Array.isArray(args[i]) && args[i].env) {
            args[i] = carryEnv(args[i]);
            break;
          }
        }
        return orig.apply(this, args);
      };
    }
  } catch {
    // Instrumentation is best-effort; a partially applied shim still records
    // whatever it wrapped, and the runner's boot-line check covers the rest.
  }
}
