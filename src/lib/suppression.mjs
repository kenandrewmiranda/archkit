const WEAK_REASONS = new Set([
  "n/a", "none", "see comment", "see above", "see below",
  "fixed", "ok", "false positive", "todo", "will fix",
  "ignore", "skip", "intentional", "on purpose", "comment",
]);

const SUPP_RE = /(?:\/\/|#|--)\s*archkit:\s*ignore\s+([\w/-]+)\s*(?:—|--|\s-\s)\s*(.+?)(?:\*\/)?\s*$/;

export function parseSuppressions(code) {
  const lines = code.split("\n");
  const suppressions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(SUPP_RE);
    if (!m) continue;
    const ruleId = m[1];
    const reason = m[2].trim();

    // Standalone comment (only thing on its line) → applies to next non-empty line
    // Trailing comment → applies to current line
    const beforeComment = line.slice(0, line.indexOf("archkit:")).replace(/(?:\/\/|#|--)/, "").trim();
    const isStandalone = beforeComment === "";

    let appliesToLine;
    if (isStandalone) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      appliesToLine = j + 1; // 1-indexed
    } else {
      appliesToLine = i + 1;
    }

    suppressions.push({ ruleId, reason, line: appliesToLine });
  }
  return suppressions;
}

export function isWeakReason(reason) {
  if (!reason) return false;
  return WEAK_REASONS.has(reason.trim().toLowerCase());
}

export function validateReason(reason) {
  if (!reason || reason.trim() === "") return { ok: false, missing: true };
  if (isWeakReason(reason)) return { ok: false, weak: true };
  return { ok: true };
}
