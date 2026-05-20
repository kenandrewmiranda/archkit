// Language gating for JS/TS-ecosystem review checks.
//
// Several check modules (api, db, cache, queue, frontend-wiring, event,
// floating-promise) are heuristics for the JS/TS ecosystem — fetch(), axios,
// Drizzle .from(), Prisma findMany, await/.then(). Applied to .swift, .kt,
// .go, .py, .rs files they collide with identically-named idioms (e.g.
// SwiftData's ModelContext.fetch, Swift's .from(_:) factories) and produce
// nonsense findings with JS fix strings.
//
// Gate per-file by extension first, then fall back to the declared stack
// from SYSTEM.md when the extension is ambiguous.

import path from "path";

const JS_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro"]);

const NON_JS_EXTS = new Set([
  ".swift", ".kt", ".kts", ".java", ".scala", ".groovy",
  ".go", ".rs", ".py", ".rb", ".php", ".ex", ".exs",
  ".cs", ".fs", ".vb",
  ".c", ".h", ".cpp", ".cc", ".hpp", ".m", ".mm",
  ".dart", ".lua", ".pl", ".r", ".jl", ".clj", ".cljs",
  ".sh", ".bash", ".zsh", ".ps1",
]);

const JS_STACK_TOKENS = [
  "javascript", "typescript", "ts", "node", "nodejs", "deno", "bun",
  "react", "next", "nextjs", "remix", "astro", "vite",
  "vue", "nuxt", "svelte", "sveltekit", "angular",
  "express", "hono", "fastify", "koa", "nestjs", "nest",
  "drizzle", "prisma",
];

const NON_JS_STACK_TOKENS = [
  "swift", "swiftui", "swiftdata", "objective-c", "objc",
  "kotlin", "jetpack", "android",
  "java", "spring",
  "go", "golang", "gin", "echo",
  "rust", "actix", "axum", "rocket",
  "python", "django", "flask", "fastapi",
  "ruby", "rails",
  "php", "laravel", "symfony",
  "elixir", "phoenix",
  "c#", "csharp", ".net", "dotnet", "asp.net",
  "dart", "flutter",
];

/**
 * Classify a declared stack string. Returns "js", "non-js", or "unknown".
 * Note: "javascript" contains "java" — check JS tokens first so a TS/JS
 * stack isn't misclassified as Java.
 */
export function classifyStack(stack) {
  if (!stack) return "unknown";
  const s = stack.toLowerCase();
  for (const t of JS_STACK_TOKENS) {
    if (s.includes(t)) return "js";
  }
  for (const t of NON_JS_STACK_TOKENS) {
    if (s.includes(t)) return "non-js";
  }
  return "unknown";
}

/**
 * Decide whether to run JS/TS-ecosystem review checks for a given file.
 *
 *   - JS-like extension (.ts, .tsx, ...): always run.
 *   - Known non-JS extension (.swift, .kt, .go, ...): always skip.
 *   - Anything else (no extension, .md, etc.): fall back to declared stack.
 *     Stack "js" → run, "non-js" → skip, "unknown" → run (preserve prior
 *     behavior for projects that haven't declared a stack).
 */
export function shouldRunJsEcosystemChecks(filepath, stack) {
  const ext = path.extname(filepath || "").toLowerCase();
  if (JS_EXTS.has(ext)) return true;
  if (NON_JS_EXTS.has(ext)) return false;
  const cls = classifyStack(stack);
  if (cls === "non-js") return false;
  return true;
}

// Union of code-file extensions that archkit review will pick up from
// git --staged / --diff / --dir scans. Per-file JS-ecosystem gating decides
// which checks actually run; this set is just the membership filter that
// keeps lockfiles, images, binaries, and markdown out of the review pass.
//
// Adding a new language? Add it to JS_EXTS or NON_JS_EXTS above — they're
// both included here automatically.
export const REVIEWABLE_EXTS = new Set([...JS_EXTS, ...NON_JS_EXTS]);

export function isReviewableFile(filepath) {
  if (!filepath) return false;
  return REVIEWABLE_EXTS.has(path.extname(filepath).toLowerCase());
}
