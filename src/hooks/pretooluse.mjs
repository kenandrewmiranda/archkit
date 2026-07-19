// API-doc hard gate — the PreToolUse handler that BLOCKS an Edit/Write/MultiEdit
// which reaches for an external API surface that has not been CLEARED for use.
//
// The clearance model lives in src/lib/api-registry.mjs: an API is cleared ONLY
// when a real doc/SDK reference was registered (archkit_api_register) OR a human
// wrote an explicit override with a reason (archkit_api_override). Anything else
// — unknown, or a pending entry — is blocked. This handler runs the api-
// involvement detector (src/lib/api-detect.mjs) on the POST-EDIT content and,
// for every detected API, asks isApiCleared; if ANY is uncleared it returns a
// deny reason that NAMES the API and both unblock commands verbatim.
//
// Scope — the gate is deliberately narrow so it never gets in the way of the
// things that AREN'T "coding against an API":
//   - apiGate.enabled === false  → no-op (returns null). No config, or a
//     missing/corrupt config, defaults to enabled (see readApiGateConfig).
//   - non-source targets (docs, .arch/**, config, data, lockfiles) are NEVER
//     gated — only code source files, so editing BOUNDARIES.md / apis.json /
//     README / config.json can never trip the gate.
//   - a bare specifier whose head names an existing top-level entry in the
//     project (e.g. `import x from "src/lib/foo"`) is treated as an in-repo path
//     import, not an external API — precision over recall.
//
// Fail-open, exactly like the boundary guardrail (src/lib/pretooluse-eval.mjs):
// any unexpected error yields "allow" (null). A gate that wrongly blocks edits
// destroys trust faster than one that occasionally misses. The bin wrapper
// (bin/archkit-pretooluse-hook.mjs) turns a returned reason string into the
// PreToolUse deny envelope.

import fs from "node:fs";
import path from "node:path";
import { detectApis } from "../lib/api-detect.mjs";
import { isApiCleared, readApiGateConfig } from "../lib/api-registry.mjs";
import { isEditTool, computePostEditContent } from "../lib/pretooluse-eval.mjs";
import { toPosixPath } from "../lib/shared.mjs";

// Code source extensions the gate polices. Anything not in this set — docs
// (.md/.txt/.rst), config/data (.json/.yaml/.toml/.ini/.env), lockfiles,
// binaries — is never gated, satisfying "only source files" (exit criterion 2).
const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".groovy",
  ".php", ".swift", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh",
  ".cs", ".m", ".mm", ".clj", ".cljs", ".cljc", ".ex", ".exs", ".erl",
  ".dart", ".sh", ".bash", ".zsh", ".lua", ".pl", ".pm", ".r", ".jl",
  ".vue", ".svelte",
]);

// Path prefixes that are never source, even if a file under them has a code-ish
// extension. .arch/** is archkit's own metadata; node_modules/.git are vendored.
const NON_SOURCE_PREFIXES = ["/.arch/", "/node_modules/", "/.git/"];

// Is this a code source file the API-doc gate should police? `fileRel` is
// project-relative (POSIX-or-Windows separators tolerated).
export function isGatedSourceFile(fileRel) {
  if (!fileRel || typeof fileRel !== "string") return false;
  const rel = toPosixPath(fileRel);
  const probe = `/${rel}`; // so a leading-segment match works like an interior one
  for (const pfx of NON_SOURCE_PREFIXES) {
    if (probe.includes(pfx)) return false;
  }
  return CODE_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

// A bare specifier whose head names an existing top-level entry in the project
// is almost certainly an in-repo path import (`import x from "src/lib/foo"`),
// not an external SDK — skip it so the gate stays precise. Scoped packages
// (@scope/...) and real SDKs (stripe, openai) won't match a project dir.
function isInRepoHead(projectRoot, api) {
  if (!projectRoot || !api || api.startsWith("@")) return false;
  try {
    return fs.existsSync(path.join(projectRoot, api));
  } catch {
    return false;
  }
}

// Core predicate. Returns a human-facing DENY reason string when the edit
// touches at least one uncleared API, or null to ALLOW. Never throws.
export function evaluateApiGate({ archDir, toolName, toolInput, fileRel, currentContent = "" } = {}) {
  try {
    if (!isEditTool(toolName)) return null; // not an edit we gate
    if (!fileRel) return null;

    const cfg = readApiGateConfig(archDir);
    if (!cfg.enabled) return null; // no-op when the gate is switched off

    if (!isGatedSourceFile(fileRel)) return null; // docs/.arch/config are never gated

    const after = computePostEditContent(toolName, toolInput || {}, currentContent || "");
    if (after === (currentContent || "")) return null; // edit changed nothing

    const detected = detectApis({
      filePath: fileRel,
      content: after,
      internalHosts: cfg.internalHosts,
    });
    if (!detected.length) return null;

    const projectRoot = archDir ? path.dirname(archDir) : null;

    // Collect the uncleared APIs, deduped by id, preserving first-seen order.
    const seen = new Set();
    const uncleared = [];
    for (const d of detected) {
      const api = d && typeof d.api === "string" ? d.api : "";
      if (!api || seen.has(api)) continue;
      if (d.evidence === "sdk-import" && isInRepoHead(projectRoot, api)) continue;
      if (isApiCleared(archDir, api)) continue;
      seen.add(api);
      uncleared.push({ api, evidence: d.evidence });
    }
    if (!uncleared.length) return null;

    return formatApiGateDenyReason(uncleared);
  } catch {
    return null; // fail open — never block on a gate bug
  }
}

// Build the DENY reason. MUST name each uncleared API id and spell out both
// unblock commands verbatim (exit criterion 1): register a doc/SDK ref, or
// explicitly override with a reason.
export function formatApiGateDenyReason(uncleared) {
  const n = uncleared.length;
  const head =
    `archkit blocked this edit — the API-doc hard gate.\n` +
    `It touches ${n} API surface${n === 1 ? "" : "s"} that ${n === 1 ? "has" : "have"} not been cleared for coding:`;

  const bullets = uncleared.map(
    (u) => `  • "${u.api}"${u.evidence ? ` (via ${u.evidence})` : ""} — no doc/SDK reference or override on record`
  );

  const guidance =
    `Clear each API one of two ways, then re-run the edit ` +
    `(nothing was written):`;

  const commands = [];
  for (const u of uncleared) {
    commands.push(`  ${u.api}:`);
    commands.push(`    archkit_api_register ${u.api} --doc <ref>`);
    commands.push(`    archkit_api_override ${u.api} --reason "<why>"`);
  }

  return [head, ...bullets, "", guidance, "", ...commands].join("\n");
}

export default evaluateApiGate;
