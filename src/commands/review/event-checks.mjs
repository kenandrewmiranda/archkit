// Event bus checks.
// Catches: emitLocal in production, handlers without emitters,
// emitters without handlers.

export function checkEventPatterns(code, filepath) {
  const findings = [];

  if (/\.(test|spec)\./i.test(filepath)) return findings;

  // 1. emitLocal in production code (should be emit for cross-process delivery)
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/emitLocal\s*\(/i.test(lines[i])) {
      findings.push({
        severity: "warning",
        type: "event-bus",
        line: i + 1,
        message: "emitLocal() in production code — events won't reach other processes/servers",
        fix: "Use emit() instead. It uses pub/sub for cross-process delivery and falls back to local when unavailable.",
        reason: "emitLocal() only reaches handlers in the same process. Multi-process deploys silently lose events. Ref: Valkey pub/sub.",
      });
      break;
    }
  }

  // 2. Controller/handler importing db module directly (bypasses service/repo layers)
  const isController = /\.(controller|cont|route|router|handler)\./i.test(filepath);
  if (isController) {
    for (let i = 0; i < lines.length; i++) {
      // Match: import { query } from "../../shared/db" or similar
      if (/import\s+.*\bfrom\s+['"].*(?:\/db\/|\/db['"]|\/database\/|\/database['"])/i.test(lines[i])) {
        findings.push({
          severity: "error",
          type: "architecture",
          line: i + 1,
          message: "Controller/handler importing database module directly — bypasses service and repository layers",
          fix: "Controllers call services. Services call repositories. Only repositories import the database.",
          reason: "Direct DB access in controllers bypasses business logic, validation, and tenant scoping. Ref: Layered Architecture — C→S→R.",
        });
        break;
      }
    }
  }

  return findings;
}
