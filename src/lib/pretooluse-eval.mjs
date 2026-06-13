// Pure evaluation of a *proposed* Edit/Write/MultiEdit against BAN rules — the
// engine behind the PreToolUse guardrail hook (bin/archkit-pretooluse-hook.mjs).
//
// Unlike boundary-check (which reads files already on disk), the PreToolUse
// hook fires BEFORE the edit lands, so the new content only exists in the tool
// input. These helpers reconstruct the post-edit content and diff its imports
// against the pre-edit content's, flagging only imports the edit INTRODUCES.
//
// Precision-first by design: a false block ("you can't make this edit") is far
// more destructive than a missed PostToolUse flag. So we never block on:
//   - imports that already existed before the edit (touching a dirty file),
//   - edits that REMOVE a banned import (the spec is gone after the edit),
//   - files whose path matches no BAN rule's source glob.
//
// Pure: no fs, no process. The caller (the bin) supplies file contents. This
// keeps src/lib/ side-effect-free per BOUNDARIES.md and makes the logic unit-
// testable without a temp project.

import { parseBoundaries, normalizeImport } from "./boundary-parser.mjs";
import { extractImports } from "./import-detector.mjs";
import { toPosixPath } from "./shared.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

export function isEditTool(name) {
  return EDIT_TOOLS.has(name);
}

// Apply one old->new replacement the way Claude Code's Edit/MultiEdit does:
// first occurrence by default, every occurrence when replace_all is set. An
// empty old_string can't be anchored, so it's a no-op (we never fabricate edits
// that Claude Code wouldn't actually perform).
function applyOne(content, oldStr, newStr, replaceAll) {
  if (!oldStr) return content;
  if (replaceAll) return content.split(oldStr).join(newStr);
  const idx = content.indexOf(oldStr);
  if (idx === -1) return content;
  return content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
}

// Reconstruct the file content that WOULD exist after this tool call, given the
// current on-disk content (pass "" for a brand-new file).
export function computePostEditContent(toolName, toolInput, currentContent = "") {
  if (!toolInput || typeof toolInput !== "object") return currentContent;
  if (toolName === "Write") {
    return typeof toolInput.content === "string" ? toolInput.content : currentContent;
  }
  if (toolName === "Edit") {
    return applyOne(currentContent, toolInput.old_string ?? "", toolInput.new_string ?? "", toolInput.replace_all === true);
  }
  if (toolName === "MultiEdit") {
    let c = currentContent;
    for (const e of (Array.isArray(toolInput.edits) ? toolInput.edits : [])) {
      c = applyOne(c, e?.old_string ?? "", e?.new_string ?? "", e?.replace_all === true);
    }
    return c;
  }
  return currentContent;
}

// Evaluate a proposed edit against BAN rules from BOUNDARIES.md. Returns
// { violations: [{ file, line, imported, rule, source }] }. `filePath` is used
// only for language detection; `fileRel` (project-relative) is matched against
// each rule's source glob.
export function evaluateProposedEdit({ fileRel, filePath, toolName, toolInput, currentContent = "", boundariesContent }) {
  const { rules } = parseBoundaries(boundariesContent || "");
  if (rules.length === 0) return { violations: [] };

  // Match against `/`-delimited BAN globs — normalize Windows backslashes so a
  // proposed edit to `src\lib\x.mjs` matches the glob `src/lib/*`.
  fileRel = toPosixPath(fileRel);

  // Only rules whose source glob covers this file can ever apply.
  const applicable = rules.filter((r) => r.sourceRe.test(fileRel));
  if (applicable.length === 0) return { violations: [] };

  const after = computePostEditContent(toolName, toolInput, currentContent);
  if (after === currentContent) return { violations: [] }; // edit changed nothing relevant

  // Imports the edit introduces = present after, absent before.
  const before = new Set(extractImports(filePath, currentContent).map((i) => i.spec));
  const afterImports = extractImports(filePath, after);

  const violations = [];
  for (const { line, spec } of afterImports) {
    if (before.has(spec)) continue; // pre-existing — not this edit's doing
    const normalized = normalizeImport(spec);
    for (const rule of applicable) {
      if (!rule.targetRe.test(normalized)) continue;
      violations.push({
        file: fileRel,
        line,
        imported: spec,
        rule: `BAN: ${rule.source} -> ${rule.target}`,
        source: `BOUNDARIES.md:${rule.line}`,
      });
      break; // one violation per import is enough to block
    }
  }
  return { violations };
}

// Human-facing block reason for the hook's permissionDecisionReason. Kept here
// so the wording is testable alongside the detection logic.
export function formatBlockReason(violations) {
  const n = violations.length;
  const head = `archkit blocked this edit — it introduces ${n} boundary violation${n === 1 ? "" : "s"}:`;
  const lines = violations.map(
    (v) => `  • ${v.file}:${v.line} imports "${v.imported}" — violates ${v.rule} (${v.source})`
  );
  const tail =
    "Remove the banned import or move the code to an allowed module. If the import is legitimate, narrow the BAN rule in .arch/BOUNDARIES.md.";
  return [head, ...lines, "", tail].join("\n");
}
