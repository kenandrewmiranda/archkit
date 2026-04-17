/**
 * skeleton-renderer.mjs
 *
 * Token substitution helper for archkit scaffold skeleton templates.
 * Used by `archkit resolve scaffold` to render per-feature source stubs.
 */

const PREFIXES = {
  ".ts":   "//",
  ".tsx":  "//",
  ".js":   "//",
  ".mjs":  "//",
  ".jsx":  "//",
  ".py":   "#",
  ".sql":  "--",
  ".rb":   "#",
  ".go":   "//",
  ".rs":   "//",
  ".java": "//",
  ".php":  "//",
};

/**
 * Returns the line-comment prefix for the given file extension.
 * Falls back to "//" for unknown extensions.
 *
 * @param {string} ext - File extension including the dot (e.g. ".ts")
 * @returns {string}
 */
export function commentPrefix(ext) {
  return PREFIXES[ext] || "//";
}

/**
 * Renders a skeleton template string by substituting known tokens.
 *
 * Supported tokens:
 *   {feature}        → vars.feature (as-is, lowercase expected)
 *   {Feature}        → vars.feature with first letter capitalised
 *   {commentPrefix}  → line-comment marker derived from fileExt
 *
 * @param {string} template  - Template string containing tokens
 * @param {{ feature?: string }} vars - Token values
 * @param {string} [fileExt=".ts"] - File extension used to resolve {commentPrefix}
 * @returns {string}
 */
export function renderSkeleton(template, vars, fileExt = ".ts") {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  let out = template;
  out = out.replace(/\{commentPrefix\}/g, commentPrefix(fileExt));
  if (vars.feature) {
    out = out.replace(/\{feature\}/g, vars.feature);
    out = out.replace(/\{Feature\}/g, cap(vars.feature));
  }
  return out;
}
