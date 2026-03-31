// Rough token estimation for generated context files.
// Uses the ~4 chars per token heuristic (accurate within 10-15% for English text).
// This is intentionally simple — no need for a tiktoken dependency.

export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

export function tokenBudgetWarning(tokens) {
  if (tokens > 3000) return "OVER BUDGET — will consume significant context on every request. Consider --compact mode.";
  if (tokens > 2000) return "HIGH — consider trimming or using lazy loading for non-essential sections.";
  if (tokens > 1000) return "MODERATE — good for always-loaded context.";
  return "EFFICIENT — minimal context overhead.";
}

export function formatTokenReport(files) {
  let total = 0;
  const lines = [];
  for (const { name, content } of files) {
    const tokens = estimateTokens(content);
    total += tokens;
    lines.push({ name, tokens });
  }
  return { files: lines, total, warning: tokenBudgetWarning(total) };
}
