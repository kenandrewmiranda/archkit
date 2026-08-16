// src/lib/fslock.mjs
// The shared-state write primitive (ADR 0030): atomic replace as the baseline,
// an advisory lock for read-modify-write, fail OPEN on contention.
//
// Two independent guarantees, deliberately kept in one module because callers
// almost always need both:
//
//   atomicWriteFileSync — write-tmp-then-rename inside the same directory, so a
//     concurrent reader sees the OLD bytes or the NEW bytes and never a
//     truncated file. This is `saveGoalProposal`'s pid-tagged tmp+rename
//     (goals.mjs) promoted out of its one call site and given a Windows retry.
//     It makes each individual write indivisible; it does nothing for
//     read-modify-write, which is what the lock is for.
//
//   acquireLock / withLock — an advisory lockfile created with
//     fs.openSync(path, "wx") (O_CREAT|O_EXCL: an atomic create-if-absent on
//     POSIX and Windows alike), carrying the holder's pid and acquisition time
//     so a holder is identifiable and a corpse is datable. One COARSE lock per
//     archDir (ADR 0030 §3), not per file: consolidateGoals' invariant spans N
//     goal files plus the digest, and per-file locks cannot express that
//     without a lock-ordering discipline and the deadlocks that follow.
//
// Three properties that are easy to get wrong and are therefore contractual:
//
//   FAIL OPEN, and only on ACQUISITION. If the lock cannot be taken within the
//     bounded wait and the holder is not stale, the caller runs UNLOCKED and is
//     TOLD it did (`held:false, failedOpen:true`). These mutators sit on the
//     Stop hook and the MCP request path, so failing closed would convert one
//     stuck lockfile into a hung turn-end in every session — trading a rare
//     lost update for a total outage. Fail-open's worst case is exactly today's
//     behaviour, which is unlocked always. The WRITE never fails open: if the
//     atomic replace fails it throws, because falling back to an in-place write
//     reintroduces the torn write this module exists to prevent.
//
//   STALE LOCKS BREAK ON A TTL, AND THE BREAK IS REPORTED. A lock older than
//     ttlMs is removed and retaken, and the breaker gets `brokeStale` back
//     describing whose corpse it stepped over. A silent break is a bug. TTL is
//     the staleness signal, not pid liveness: pids are reused, and a tree can
//     be shared by processes that cannot see each other's process table.
//
//   RELEASE ON THROW. withLock releases in a `finally`, so a failed mutation
//     cannot strand the lock. The TTL is the backstop for process DEATH, not
//     for ordinary errors.
//
// REENTRANCY: the lock IS reentrant within a single process — a nested acquire
// of the same lock path by the same process re-enters (depth-counted) instead
// of deadlocking against itself, and only the outermost release unlinks. This
// is not a nicety: runGoalComplete calls stampGoalFields, so once the mutators
// adopt this, nesting is the normal case. It is NOT reentrant across processes
// and never can be — that is the entire point of the lock.
//
// No new runtime dependency: node:fs, node:os, node:path, node:crypto only.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { archkitError } from "./errors.mjs";

// Well above the longest legitimate mutation (a whole-tree reconcile is a few
// hundred small-file writes) and well below a human's patience. A lock older
// than this is a corpse, not a worker.
export const LOCK_TTL_MS = 30_000;

// The fail-open budget. Short on purpose: this sits on the Stop hook's hot
// path, and waiting longer than this to *maybe* serialise a sub-millisecond
// write is a worse trade than running unlocked and saying so.
export const LOCK_WAIT_MS = 2_000;

// Poll interval while waiting. Sub-tick polling costs nothing at these
// durations and keeps the common (uncontended-after-a-moment) case snappy.
export const LOCK_POLL_MS = 20;

// The lockfile lives under .arch/board/ because that directory is gitignored
// (ADR 0014) — a lockfile is per-machine runtime scratch and must never be
// committable, unlike everything else under .arch/.
export const LOCK_FILENAME = "goals.lock";

// ── sync sleep ───────────────────────────────────────────────────────────────

// Every entry point here is synchronous (the mutators it will wrap are
// writeFileSync/renameSync all the way down), so the poll loop needs a sleep
// that does not yield to the event loop. Atomics.wait on a SharedArrayBuffer is
// the dependency-free way to block a Node main thread for a bounded time.
const SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(SLEEP_BUF, 0, 0, ms);
}

// ═══════════════════════════════════════════════════════════════════════════
// ATOMIC WRITE
// ═══════════════════════════════════════════════════════════════════════════

// A rename is only atomic within one filesystem, so the temp file MUST be a
// sibling of the target — never in os.tmpdir(), which is routinely a different
// device. pid + random keeps two writers (including two processes that share a
// pid across containers) from colliding on the same temp name.
function tempPathFor(file) {
  return `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
}

// Windows can refuse a replace-rename while any process holds an open handle on
// the destination — including a virus scanner that opened it a millisecond ago.
// These are the transient codes worth retrying; anything else is a real error.
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES", "EEXIST"]);

/**
 * Write a file so that a concurrent reader can never observe a partial write:
 * the bytes land in a sibling temp file which is then renamed over the target.
 *
 * Never falls back to an in-place write. If the replace cannot be completed it
 * throws `atomic_write_failed` (ADR 0030 §7) — a loud failure is recoverable,
 * a torn file is not.
 *
 * @param {string} file - absolute path to write
 * @param {string|Buffer|Uint8Array} data
 * @param {Object} [opts]
 * @param {string} [opts.encoding="utf8"] - used only when `data` is a string
 * @param {number} [opts.mode] - file mode for the temp file (inherited by the target)
 * @param {boolean} [opts.mkdir=true] - create the containing directory first
 * @param {number} [opts.retries=10] - bounded retries for a win32 EPERM/EBUSY replace
 * @param {number} [opts.retryDelayMs=20]
 * @returns {string} the path written
 */
export function atomicWriteFileSync(file, data, opts = {}) {
  const {
    encoding = "utf8",
    mode,
    mkdir = true,
    retries = 10,
    retryDelayMs = 20,
  } = opts;

  if (!file || typeof file !== "string") {
    throw archkitError("invalid_input", "atomicWriteFileSync requires a file path");
  }
  const dir = path.dirname(file);
  if (mkdir) fs.mkdirSync(dir, { recursive: true });

  const tmp = tempPathFor(file);
  const writeOpts = typeof data === "string" ? { encoding } : {};
  if (mode !== undefined) writeOpts.mode = mode;

  try {
    fs.writeFileSync(tmp, data, writeOpts);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw archkitError("atomic_write_failed", `could not stage ${file}: ${err.message}`, { cause: err });
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return file;
    } catch (err) {
      lastErr = err;
      if (!RENAME_RETRY_CODES.has(err.code) || attempt === retries) break;
      sleepSync(retryDelayMs);
    }
  }

  // Give-up path: clean the stage up so a retry storm cannot litter the tree,
  // then report. Reported, never swallowed (ADR 0030 §1).
  try { fs.rmSync(tmp, { force: true }); } catch {}
  throw archkitError(
    "atomic_write_failed",
    `could not atomically replace ${file} after ${retries + 1} attempts: ${lastErr?.message || "unknown error"}`,
    {
      suggestion: "Another process may be holding the file open (common on Windows). Retry, or close the holder.",
      cause: lastErr,
    }
  );
}

/**
 * Atomic write of a JSON value, with the repo's 2-space + trailing-newline
 * house style. Convenience only — same guarantees as atomicWriteFileSync.
 * @param {string} file
 * @param {unknown} value
 * @param {Object} [opts] - forwarded to atomicWriteFileSync
 * @returns {string} the path written
 */
export function atomicWriteJsonSync(file, value, opts = {}) {
  return atomicWriteFileSync(file, `${JSON.stringify(value, null, 2)}\n`, opts);
}

// ═══════════════════════════════════════════════════════════════════════════
// ADVISORY LOCK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The canonical lock path for a resolved archDir. The lock's scope is the
 * RESOLVED archDir (ADR 0030, "most constraining"): two processes that resolve
 * different archDirs take different locks and exclude nothing.
 * @param {string} archDir
 * @returns {string}
 */
export function archLockPath(archDir) {
  if (!archDir || typeof archDir !== "string") {
    throw archkitError("invalid_input", "archLockPath requires an archDir");
  }
  return path.join(archDir, "board", LOCK_FILENAME);
}

// Re-entry registry: resolved lock path -> { depth, token }. Only ever holds
// locks this process REALLY took (a failed-open handle is not registered), so
// re-entry can never be granted against a lock we do not hold.
const heldLocks = new Map();

const hostname = (() => { try { return os.hostname(); } catch { return "unknown"; } })();

/**
 * Read the current holder of a lockfile. Never throws.
 *
 * A holder is datable even when its payload is unreadable: a lockfile is
 * created with "wx" and written a moment later, so a reader can legitimately
 * catch it empty. In that case the file's mtime stands in for the acquisition
 * time, which keeps a corrupt or half-written lockfile from becoming immortal.
 *
 * @param {string} lockPath
 * @param {number} [now=Date.now()]
 * @returns {null|{pid:number|null, host:string|null, token:string|null, acquiredAtMs:number, ageMs:number, meta:unknown, parsed:boolean}}
 */
export function readLockHolder(lockPath, now = Date.now()) {
  let raw;
  let mtimeMs;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch {
    return null; // gone, or unreadable — either way there is no holder to report
  }
  let payload = null;
  try { payload = JSON.parse(raw); } catch {}
  const acquiredAtMs = Number.isFinite(payload?.acquiredAtMs) ? payload.acquiredAtMs : mtimeMs;
  return {
    pid: Number.isFinite(payload?.pid) ? payload.pid : null,
    host: typeof payload?.host === "string" ? payload.host : null,
    token: typeof payload?.token === "string" ? payload.token : null,
    acquiredAt: new Date(acquiredAtMs).toISOString(),
    acquiredAtMs,
    ageMs: Math.max(0, now - acquiredAtMs),
    meta: payload?.meta ?? null,
    parsed: payload !== null,
  };
}

// Create the lockfile exclusively and stamp it with pid + timestamp. Returns
// the token on success, null if someone else already holds it (EEXIST).
function tryCreateLock(lockPath, token, meta) {
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx");
  } catch (err) {
    if (err.code === "EEXIST") return null;
    throw err;
  }
  try {
    const payload = {
      pid: process.pid,
      host: hostname,
      token,
      acquiredAt: new Date().toISOString(),
      acquiredAtMs: Date.now(),
      meta: meta ?? null,
    };
    fs.writeFileSync(fd, `${JSON.stringify(payload)}\n`);
  } catch (err) {
    // Never leave a lockfile we cannot identify ourselves by.
    try { fs.closeSync(fd); } catch {}
    try { fs.rmSync(lockPath, { force: true }); } catch {}
    throw err;
  }
  fs.closeSync(fd);
  return token;
}

// Confirm the lockfile on disk is the one WE just wrote. Two processes can
// decide to break the same corpse at the same instant, and the loser's unlink
// can land after the winner's create — so the file we "own" may already belong
// to someone else. Reading our token back is the only way to know, and a
// mismatch demotes us to "not held" rather than letting us report a lock we do
// not actually have.
function ownsLock(lockPath, token) {
  const holder = readLockHolder(lockPath);
  return !!holder && holder.token === token;
}

/**
 * Acquire the advisory lock at `lockPath`.
 *
 * NEVER THROWS on contention — the whole contract is that acquisition failure
 * degrades to running unlocked and saying so. Inspect the returned handle:
 *
 *   handle.held        — true if this call holds the lock (or re-entered one)
 *   handle.failedOpen  — true if the wait elapsed and the caller must proceed UNLOCKED
 *   handle.reentrant   — true if this was a nested acquire within this process
 *   handle.brokeStale  — non-null if a stale lock was broken to get here: the
 *                        dead holder's { pid, host, acquiredAt, ageMs }
 *   handle.holder      — on failedOpen, whoever is holding it
 *   handle.error       — an unexpected fs error that forced fail-open
 *   handle.release()   — idempotent; only the outermost holder unlinks
 *
 * @param {string} lockPath
 * @param {Object} [opts]
 * @param {number} [opts.ttlMs=LOCK_TTL_MS] - a lock older than this is a corpse
 * @param {number} [opts.waitMs=LOCK_WAIT_MS] - fail-open budget
 * @param {number} [opts.pollMs=LOCK_POLL_MS]
 * @param {unknown} [opts.meta] - free-form holder annotation (e.g. the operation name)
 * @param {(event:Object)=>void} [opts.onEvent] - optional sink for {type:"stale-broken"|"fail-open"}
 */
export function acquireLock(lockPath, opts = {}) {
  const {
    ttlMs = LOCK_TTL_MS,
    waitMs = LOCK_WAIT_MS,
    pollMs = LOCK_POLL_MS,
    meta,
    onEvent,
  } = opts;

  if (!lockPath || typeof lockPath !== "string") {
    throw archkitError("invalid_input", "acquireLock requires a lock path");
  }
  const resolved = path.resolve(lockPath);
  const startedAt = Date.now();

  const report = (event) => {
    if (typeof onEvent === "function") { try { onEvent(event); } catch {} }
    return event;
  };

  // ── re-entry ──────────────────────────────────────────────────────────────
  const existing = heldLocks.get(resolved);
  if (existing) {
    existing.depth++;
    return makeHandle({
      lockPath: resolved,
      held: true,
      reentrant: true,
      waitedMs: 0,
      release: () => releaseHeld(resolved, existing.token),
    });
  }

  const token = crypto.randomBytes(12).toString("hex");
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  } catch (err) {
    // Cannot even host a lockfile. Fail open rather than take the caller down.
    return makeHandle({
      lockPath: resolved,
      held: false,
      failedOpen: true,
      waitedMs: Date.now() - startedAt,
      error: err,
      event: report({ type: "fail-open", lockPath: resolved, reason: err.message }),
    });
  }

  const deadline = startedAt + Math.max(0, waitMs);
  let brokeStale = null;

  for (;;) {
    try {
      if (tryCreateLock(resolved, token, meta) && ownsLock(resolved, token)) {
        heldLocks.set(resolved, { depth: 1, token });
        return makeHandle({
          lockPath: resolved,
          held: true,
          brokeStale,
          waitedMs: Date.now() - startedAt,
          release: () => releaseHeld(resolved, token),
        });
      }
    } catch (err) {
      return makeHandle({
        lockPath: resolved,
        held: false,
        failedOpen: true,
        brokeStale,
        waitedMs: Date.now() - startedAt,
        error: err,
        event: report({ type: "fail-open", lockPath: resolved, reason: err.message }),
      });
    }

    const holder = readLockHolder(resolved);
    // Released between our EEXIST and this read — retry immediately.
    if (!holder) continue;

    if (holder.ageMs > ttlMs) {
      // Re-confirm before breaking. A jittered second look makes it far less
      // likely that a pile of waiters all break the same corpse at once, and it
      // catches the case where the holder was alive and simply slow to be read.
      sleepSync(Math.floor(Math.random() * pollMs));
      const again = readLockHolder(resolved);
      if (!again) continue;
      if (again.acquiredAtMs === holder.acquiredAtMs && again.ageMs > ttlMs) {
        try { fs.rmSync(resolved, { force: true }); } catch {}
        brokeStale = {
          pid: again.pid,
          host: again.host,
          acquiredAt: again.acquiredAt,
          ageMs: again.ageMs,
          ttlMs,
          parsed: again.parsed,
        };
        report({ type: "stale-broken", lockPath: resolved, ...brokeStale });
      }
      continue;
    }

    if (Date.now() >= deadline) {
      // ADR 0030 §7 — proceed UNLOCKED, and say so.
      return makeHandle({
        lockPath: resolved,
        held: false,
        failedOpen: true,
        brokeStale,
        holder,
        waitedMs: Date.now() - startedAt,
        event: report({ type: "fail-open", lockPath: resolved, holder, waitedMs: Date.now() - startedAt }),
      });
    }
    sleepSync(pollMs);
  }
}

// Drop one level of ownership; the lockfile is unlinked when the last level
// goes, whichever handle happens to be the one that drops it (withLock nests
// strictly LIFO, but nothing here depends on that). It only unlinks a lockfile
// that is still OURS — if a stale-breaker took it from us mid-mutation,
// removing the file would evict an innocent third party.
function releaseHeld(resolved, token) {
  const entry = heldLocks.get(resolved);
  if (!entry || entry.token !== token) return { released: false, reason: "not-held" };
  entry.depth--;
  if (entry.depth > 0) return { released: false, reason: "reentrant" };
  heldLocks.delete(resolved);
  if (!ownsLock(resolved, token)) return { released: false, reason: "stolen" };
  try {
    fs.rmSync(resolved, { force: true });
  } catch (err) {
    return { released: false, reason: err.message };
  }
  return { released: true, reason: null };
}

function makeHandle({
  lockPath,
  held = false,
  failedOpen = false,
  reentrant = false,
  brokeStale = null,
  holder = null,
  waitedMs = 0,
  error = null,
  event = null,
  release = () => ({ released: false, reason: "not-held" }),
}) {
  let done = false;
  return {
    lockPath,
    held,
    failedOpen,
    reentrant,
    brokeStale,
    holder,
    waitedMs,
    error,
    event,
    release() {
      if (done) return { released: false, reason: "already-released" };
      done = true;
      return release();
    },
  };
}

/**
 * Run `fn` while holding the advisory lock, releasing in a `finally` so a throw
 * inside the mutation cannot strand the lock (ADR 0030 §6). The throw
 * propagates unchanged — the lock is released, the failure is not swallowed.
 *
 * Fail-open still RUNS `fn`: the caller is told via `held:false` /
 * `failedOpen:true` in the result and in the handle passed to `fn`, and decides
 * what to report. It must NOT skip its own work — unlocked is the status quo
 * this contract improves on, not an error state.
 *
 * SYNCHRONOUS ONLY. An async `fn` would return a pending promise and the
 * `finally` would release before the mutation had happened, which is worse than
 * no lock at all — so a thenable return is refused loudly.
 *
 * @param {string} lockPath
 * @param {(handle:Object)=>any} fn
 * @param {Object} [opts] - forwarded to acquireLock
 * @returns {{value:any, held:boolean, failedOpen:boolean, reentrant:boolean, brokeStale:Object|null, holder:Object|null, waitedMs:number, released:Object}}
 */
export function withLock(lockPath, fn, opts = {}) {
  if (typeof fn !== "function") {
    throw archkitError("invalid_input", "withLock requires a function to run under the lock");
  }
  const handle = acquireLock(lockPath, opts);
  // Built up front so the `finally` can stamp the release outcome onto the very
  // object being returned — the caller sees how the lock ended, not just how it
  // began.
  const out = {
    value: undefined,
    held: handle.held,
    failedOpen: handle.failedOpen,
    reentrant: handle.reentrant,
    brokeStale: handle.brokeStale,
    holder: handle.holder,
    waitedMs: handle.waitedMs,
    released: null,
  };
  try {
    out.value = fn(handle);
    if (out.value && typeof out.value.then === "function") {
      throw archkitError(
        "invalid_input",
        "withLock is synchronous — an async callback would release the lock before the mutation ran",
        { suggestion: "Do the read-modify-write with sync fs calls inside the callback." }
      );
    }
    return out;
  } finally {
    out.released = handle.release();
  }
}

/**
 * withLock scoped to a resolved archDir — the form every CGR mutator should
 * use, so that "the lock" means one thing across the codebase.
 * @param {string} archDir
 * @param {(handle:Object)=>any} fn
 * @param {Object} [opts] - forwarded to acquireLock
 */
export function withArchLock(archDir, fn, opts = {}) {
  return withLock(archLockPath(archDir), fn, opts);
}

/**
 * Test/diagnostic hook: is this process currently holding `lockPath`, and how
 * deep is the re-entry? Never consults the filesystem — this is our own
 * bookkeeping, which is exactly what a reentrancy assertion needs to see.
 * @param {string} lockPath
 * @returns {{held:boolean, depth:number}}
 */
export function lockDepth(lockPath) {
  const entry = heldLocks.get(path.resolve(lockPath));
  return { held: !!entry, depth: entry?.depth ?? 0 };
}
