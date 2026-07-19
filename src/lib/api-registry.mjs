// API-doc registry — the clearance source of truth for the API-doc gate.
//
// The API-doc gate (PreToolUse) blocks edits that reach for an external/unknown
// API surface until that surface has been VOUCHED FOR: either a real doc/sdk
// reference was registered, or a human wrote an explicit override with a reason.
// This lib owns the manifest that records those clearances and the tolerant
// config reader the detect lane / hooks reuse.
//
// Manifest layout (.arch/apis.json) — a flat list of entries:
//   {
//     id:      string,                                // stable API identifier (e.g. "stripe.charges.create")
//     kind:    'doc' | 'sdk' | 'override',            // how it was cleared
//     ref:     string | null,                         // url | path | package | null
//     reason:  string,                                // free-form justification (required for override)
//     addedAt: ISO-8601 string,                       // when the entry was written
//     status:  'referenced' | 'override' | 'pending', // clearance state
//   }
//
// Design constraints:
//   - ATOMIC writes: serialize to a temp file, then rename over the target, so a
//     crash mid-write never leaves a truncated/half manifest.
//   - TOLERANT reads: a missing, empty, or corrupt manifest is treated as an
//     empty list — this lib NEVER throws on read. A broken manifest must not
//     wedge the gate; it degrades to "nothing is cleared."
//   - Pure: mutators/readers touch only the manifest (and, transitively, the
//     temp file they rename). No other side effects.

import fs from "node:fs";
import path from "node:path";

// Manifest basename lives directly under archDir (conventionally <repo>/.arch),
// beside config.json and goals/. Kept as a repo-relative constant so callers can
// surface the path to the user the way the rest of archkit prints .arch/ paths.
export const APIS_FILENAME = "apis.json";
export const APIS_REL = `.arch/${APIS_FILENAME}`;

const VALID_KINDS = new Set(["doc", "sdk", "override"]);

// Default gate config — used whenever .arch/config.json is missing/invalid or
// omits an `apiGate` section. Internal hosts never require a doc reference: a
// call to localhost/loopback is the project talking to itself, not an external
// surface the gate is meant to police.
const DEFAULT_INTERNAL_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];

export function apisPath(archDir) {
  return path.join(archDir, APIS_FILENAME);
}

// ── Manifest I/O ─────────────────────────────────────────────────────────────

// Read the raw entry list. NEVER throws: missing/empty/corrupt manifest, or a
// manifest whose shape we don't recognize, all degrade to an empty list.
export function listApis(archDir) {
  let raw;
  try {
    raw = fs.readFileSync(apisPath(archDir), "utf8");
  } catch {
    return []; // no manifest yet
  }
  if (!raw || !raw.trim()) return []; // empty file
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // corrupt JSON → treat as empty
  }
  // Accept either a bare array or an { apis: [...] } envelope; anything else is
  // treated as empty rather than trusted.
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray(parsed.apis)
      ? parsed.apis
      : [];
  return arr.filter((e) => e && typeof e === "object" && typeof e.id === "string" && e.id);
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function writeApis(archDir, entries) {
  atomicWrite(apisPath(archDir), entries);
}

// Upsert an entry keyed by id (last write wins) and persist atomically. Returns
// the written entry.
function upsert(archDir, entry) {
  const entries = listApis(archDir).filter((e) => e.id !== entry.id);
  entries.push(entry);
  writeApis(archDir, entries);
  return entry;
}

// ── Mutators ─────────────────────────────────────────────────────────────────

// Register a real doc/sdk reference for an API. `kind` defaults to 'doc'. A
// referenced entry clears the gate. Throws only on bad ARGUMENTS (never on I/O).
export function registerApi(archDir, { id, kind = "doc", ref = null } = {}) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("registerApi: `id` is required");
  }
  const k = VALID_KINDS.has(kind) ? kind : "doc";
  return upsert(archDir, {
    id: id.trim(),
    kind: k,
    ref: ref == null ? null : String(ref),
    reason: "",
    addedAt: new Date().toISOString(),
    status: "referenced",
  });
}

// Explicitly override the gate for an API with a human-supplied reason. An
// override clears the gate even with no doc/sdk ref. Throws only on bad args.
export function overrideApi(archDir, { id, reason } = {}) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("overrideApi: `id` is required");
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new TypeError("overrideApi: a non-empty `reason` is required");
  }
  return upsert(archDir, {
    id: id.trim(),
    kind: "override",
    ref: null,
    reason: reason.trim(),
    addedAt: new Date().toISOString(),
    status: "override",
  });
}

// ── Clearance check ──────────────────────────────────────────────────────────

// The gate's core predicate. true ONLY when the API has a proper doc/sdk
// reference OR an explicit override. Everything else — unknown id, or a
// `pending` entry — is false (blocking).
export function isApiCleared(archDir, apiId) {
  if (typeof apiId !== "string" || !apiId.trim()) return false;
  const target = apiId.trim();
  const entry = listApis(archDir).find((e) => e.id === target);
  if (!entry) return false; // unknown API → blocked
  if (entry.status === "override") return true;
  if (entry.status === "referenced" && VALID_KINDS.has(entry.kind) && entry.kind !== "override") {
    // A referenced doc/sdk entry clears only if it actually carries a ref.
    return entry.ref != null && String(entry.ref).trim() !== "";
  }
  return false; // pending / unrecognized → blocked
}

// ── Gate config ──────────────────────────────────────────────────────────────

// Read the effective apiGate config from .arch/config.json, tolerant of a
// missing/invalid file or section. Returns a fully-populated object so callers
// never have to defend against undefined:
//   { enabled: boolean, internalHosts: string[] }
export function readApiGateConfig(archDir) {
  const defaults = {
    enabled: true,
    internalHosts: [...DEFAULT_INTERNAL_HOSTS],
  };
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(archDir, "config.json"), "utf8"));
  } catch {
    return defaults; // no/invalid config → defaults
  }
  const gate = cfg && typeof cfg === "object" && cfg.apiGate && typeof cfg.apiGate === "object"
    ? cfg.apiGate
    : {};
  return {
    enabled: typeof gate.enabled === "boolean" ? gate.enabled : defaults.enabled,
    internalHosts: Array.isArray(gate.internalHosts) && gate.internalHosts.length
      ? gate.internalHosts.filter((h) => typeof h === "string" && h.trim()).map((h) => h.trim())
      : defaults.internalHosts,
  };
}
