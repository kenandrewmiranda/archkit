// src/lib/errors.mjs
// Canonical archkit error envelope shared by CLI JSON output and MCP responses.
// Pure run*Json() functions throw ArchkitError; CLI wrappers map to stderr+exit,
// MCP wrappers map to isError: true envelopes.

export class ArchkitError extends Error {
  constructor(code, message, { suggestion, docsUrl, cause } = {}) {
    super(message, { cause });
    this.name = "ArchkitError";
    this.code = code;
    this.suggestion = suggestion;
    this.docsUrl = docsUrl;
  }
}

export function archkitError(code, message, opts) {
  return new ArchkitError(code, message, opts);
}
