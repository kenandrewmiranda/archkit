// src/commands/api.mjs
// Command layer for the API-doc hard gate — thin handlers over the manifest lib.
//
// The API-doc gate (PreToolUse) is a no-op that BLOCKS edits reaching an
// external/unknown API surface until that surface is VOUCHED FOR: either a real
// doc/sdk reference was registered, or a human wrote an explicit override with a
// reason. These three handlers are how that clearance gets RECORDED and
// INSPECTED. The manifest (.arch/apis.json) status is the SOURCE OF TRUTH the
// gate consults — nothing here re-derives clearance.
//
// ALL business logic lives in src/lib/api-registry.mjs. These handlers only:
//   - validate arguments and raise STRUCTURED errors (ArchkitError, never a raw
//     throw) so the MCP layer maps them to a proper error envelope, and
//   - shape the delegated result with a nextStep (the silent-success contract).

import { registerApi, overrideApi, listApis, APIS_REL } from "../lib/api-registry.mjs";
import { archkitError } from "../lib/errors.mjs";

function requireArch(archDir) {
  if (!archDir) {
    throw archkitError("no_arch_dir", "No .arch/ directory found", {
      suggestion: "Run `archkit init` in your project root.",
    });
  }
}

// Register a real doc/SDK reference for an API surface (status `referenced`),
// clearing the gate for it. Delegates the write to registerApi. A referenced
// entry only clears when it carries an actual `ref`, so a missing ref is a
// structured error rather than a silently-uncleared entry.
export function runApiRegister({ archDir, id, kind = "doc", ref = null } = {}) {
  requireArch(archDir);
  if (typeof id !== "string" || !id.trim()) {
    throw archkitError("invalid_input", "archkit_api_register: `id` is required", {
      suggestion: 'Pass the API identifier being cleared, e.g. archkit_api_register(id: "stripe.charges.create", ref: "https://stripe.com/docs/api").',
    });
  }
  if (ref == null || String(ref).trim() === "") {
    throw archkitError("invalid_input", "archkit_api_register: a doc/SDK `ref` is required to clear the gate", {
      suggestion: "Pass a doc URL, a local file path, or an SDK package as `ref` — a referenced entry only clears the gate when it carries an actual reference. To proceed WITHOUT docs, use archkit_api_override with a reason instead.",
    });
  }
  const entry = registerApi(archDir, { id, kind, ref });
  return {
    id: entry.id,
    kind: entry.kind,
    ref: entry.ref,
    status: entry.status,
    addedAt: entry.addedAt,
    manifest: APIS_REL,
    nextStep: `Referenced ${entry.id} (${entry.kind}) in ${APIS_REL} — the API-doc gate now clears edits touching it. Run archkit_api_list to review all clearances.`,
  };
}

// Explicitly override the gate for an API surface WITHOUT a doc/SDK reference
// (status `override`, audit-stamped with the reason + timestamp). This is the
// deliberate escape hatch for surfaces with no public docs. A non-empty reason
// is required; delegates the write to overrideApi.
export function runApiOverride({ archDir, id, reason } = {}) {
  requireArch(archDir);
  if (typeof id !== "string" || !id.trim()) {
    throw archkitError("invalid_input", "archkit_api_override: `id` is required", {
      suggestion: 'Pass the API identifier to override, e.g. archkit_api_override(id: "legacy.internal.thing", reason: "vendored, no public docs").',
    });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw archkitError("invalid_input", "archkit_api_override: a non-empty `reason` is required", {
      suggestion: "An override bypasses the doc requirement, so it must be justified — pass a `reason` explaining why proceeding without docs is acceptable.",
    });
  }
  const entry = overrideApi(archDir, { id, reason });
  return {
    id: entry.id,
    status: entry.status,
    reason: entry.reason,
    addedAt: entry.addedAt,
    manifest: APIS_REL,
    nextStep: `Overrode ${entry.id} in ${APIS_REL} (reason recorded) — the API-doc gate now clears edits touching it despite no doc/SDK. Run archkit_api_list to review all clearances.`,
  };
}

// Report every recorded clearance from the manifest, bucketed into referenced /
// overridden / pending. `pending` is any entry the mutators never produce
// (status neither `referenced` nor `override`) — it is recorded but still
// BLOCKED by the gate. Read-only; delegates the read to listApis.
export function runApiList({ archDir } = {}) {
  requireArch(archDir);
  const entries = listApis(archDir);
  const referenced = entries.filter((e) => e.status === "referenced");
  const overridden = entries.filter((e) => e.status === "override");
  const pending = entries.filter((e) => e.status !== "referenced" && e.status !== "override");

  const nextStep = entries.length === 0
    ? `No API clearances recorded in ${APIS_REL} — the API-doc gate BLOCKS edits touching any external API until you archkit_api_register a doc/SDK ref or archkit_api_override with a reason.`
    : `${referenced.length} referenced, ${overridden.length} overridden, ${pending.length} pending. Pending APIs stay gated until referenced or overridden; the manifest status is the source of truth.`;

  return {
    referenced,
    overridden,
    pending,
    total: entries.length,
    manifest: APIS_REL,
    nextStep,
  };
}
