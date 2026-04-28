// src/mcp/envelope.mjs
// Shape MCP tool responses. Success returns { content: [...] }; failure
// returns { isError: true, content: [...] } with a JSON-encoded archkit envelope
// inside. Keeps the agent's error-handling logic identical to the CLI's
// --json error path.

import { ArchkitError } from "../lib/errors.mjs";

export function toMcpResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function toMcpError(err) {
  const envelope = err instanceof ArchkitError
    ? {
        code: err.code,
        message: err.message,
        suggestion: err.suggestion,
        docsUrl: err.docsUrl,
      }
    : { code: "internal_error", message: err && err.message ? err.message : "unknown error" };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(envelope) }],
  };
}

export function formatZodError(zodError) {
  const issues = zodError.issues || [];
  if (issues.length === 0) return "invalid input";
  return issues.map(i => {
    const p = (i.path || []).join(".") || "<root>";
    return `${p}: ${i.message}`;
  }).join("; ");
}
