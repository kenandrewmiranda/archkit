// API design and error handling review checks.
// Catches: inconsistent status codes, missing error handling, exposed internals.

export function checkApiPatterns(code, filepath) {
  const findings = [];
  const lines = code.split("\n");

  if (/\.(test|spec)\./i.test(filepath)) return findings;

  // Check for res.status(200) on creation (should be 201)
  for (let i = 0; i < lines.length; i++) {
    if (/\.(?:create|insert|add)\(/i.test(lines[i]) || /\.(?:create|insert|add)\(/i.test(lines[Math.max(0, i-3)] || "")) {
      if (/(?:status\(200\)|\.json\()/i.test(lines[i]) && !/201/.test(lines[i])) {
        // Only flag if this looks like a response after a create
        const context = lines.slice(Math.max(0, i-5), i+1).join("\n");
        if (/create|insert|add/i.test(context) && /res|response|c\.json/i.test(context) && /200/.test(context)) {
          findings.push({
            severity: "info", type: "api", line: i + 1,
            message: "Returning 200 after resource creation — use 201 Created",
            fix: "res.status(201).json(created) — 201 indicates a new resource was created. Ref: RFC 7231 §6.3.2.",
          });
          break;
        }
      }
    }
  }

  // Check for internal error details in responses (OWASP — Improper Error Handling)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isResponseLine = /res|response|json|send|c\.\w+\(/i.test(line);
    if (!isResponseLine) continue;

    // Stack traces in responses
    if (/err\.stack|error\.stack|stack.*trace/i.test(line)) {
      findings.push({
        severity: "error", type: "security", line: i + 1,
        message: "Stack trace exposed in error response — information leakage",
        fix: "Log full error server-side. Return only { type, title, status } to client. Ref: OWASP A09:2021 — Security Logging and Monitoring.",
      });
      break;
    }

    // Raw err.message forwarded to client (may contain DB errors, file paths, SQL)
    if (/err\.message|error\.message/i.test(line) && /json|send|status/i.test(line)) {
      // Check if it's inside a catch block (likely an error handler)
      let inCatch = false;
      for (let j = Math.max(0, i - 5); j < i; j++) {
        if (/catch\s*\(/i.test(lines[j])) { inCatch = true; break; }
      }
      if (inCatch) {
        findings.push({
          severity: "warning", type: "security", line: i + 1,
          message: "Raw error message forwarded to client — may expose internal details",
          fix: "Map errors to safe client messages: DB errors → 500 'Internal Error', validation → 400 with field details only. Ref: OWASP — Improper Error Handling.",
        });
        break;
      }
    }

    // Database-specific fields in response (constraint, table, column, relation)
    if (/constraint|\.table|\.column|\.relation|\.detail|SQLSTATE|duplicate key/i.test(line) && isResponseLine) {
      findings.push({
        severity: "warning", type: "security", line: i + 1,
        message: "Database error details may be exposed in response (constraint, table, column names)",
        fix: "Catch DB errors and return generic messages. Log specifics server-side. Ref: OWASP — Error Handling Cheat Sheet.",
      });
      break;
    }
  }

  // Check for missing global error handler in app entry files
  const isAppEntry = /app\.(ts|js|mjs)|server\.(ts|js|mjs)|index\.(ts|js|mjs)/i.test(filepath);
  if (isAppEntry) {
    const hasGlobalHandler = /\.onError|app\.use\(\s*\(\s*err|errorHandler|errorMiddleware/i.test(code);
    const isFrameworkApp = /Hono|express|fastify|koa/i.test(code);
    if (isFrameworkApp && !hasGlobalHandler) {
      findings.push({
        severity: "warning", type: "security",
        message: "App entry file has no global error handler — unhandled errors will expose framework defaults",
        fix: "Add: app.onError() (Hono) or app.use((err, req, res, next) => {...}) (Express). Framework defaults often include stack traces. Ref: OWASP — Error Handling.",
      });
    }
  }

  // Check for console.log instead of structured logger
  const hasLogger = /logger|winston|pino|bunyan|log4js/i.test(code);
  if (!hasLogger) {
    let consoleCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/console\.(log|info|warn|debug)\(/i.test(lines[i]) && !/eslint-disable|\/\//i.test(lines[i])) {
        consoleCount++;
      }
    }
    if (consoleCount > 2) {
      findings.push({
        severity: "info", type: "logging",
        message: `${consoleCount} console.log calls — use a structured logger instead`,
        fix: "Replace console.log with a structured logger (pino, winston). Enables filtering, JSON output, and log levels. Ref: OWASP Logging Cheat Sheet.",
      });
    }
  }

  // Check for fetch/axios without timeout
  for (let i = 0; i < lines.length; i++) {
    if (/\bfetch\(/.test(lines[i]) && !/timeout|AbortSignal|signal/i.test(lines[i])) {
      const nextFew = lines.slice(i, i + 3).join(" ");
      if (!/timeout|abort|signal/i.test(nextFew)) {
        findings.push({
          severity: "warning", type: "http-client", line: i + 1,
          message: "fetch() without timeout — will hang indefinitely if upstream is unresponsive",
          fix: "fetch(url, { signal: AbortSignal.timeout(5000) }). Ref: AWS SDK Best Practices — Timeouts.",
        });
        break;
      }
    }
    if (/axios\(|axios\.\w+\(/i.test(lines[i]) && !/timeout/i.test(lines[i])) {
      const nextFew = lines.slice(i, i + 3).join(" ");
      if (!/timeout/i.test(nextFew)) {
        findings.push({
          severity: "warning", type: "http-client", line: i + 1,
          message: "axios call without timeout — will hang indefinitely if upstream is unresponsive",
          fix: "axios({ timeout: 5000, ... }). Ref: AWS SDK Best Practices — Timeouts.",
        });
        break;
      }
    }
  }

  // Check for unhandled async (async function without try/catch)
  for (let i = 0; i < lines.length; i++) {
    if (/async\s+(?:function\s+)?\w+\s*\(.*\)\s*\{/.test(lines[i])) {
      // Look for try within the next 5 lines
      const body = lines.slice(i + 1, i + 6).join("\n");
      if (!/try\s*\{|\.catch\(/i.test(body) && /await\s+/i.test(body)) {
        findings.push({
          severity: "info", type: "error-handling", line: i + 1,
          message: "async function with await but no try/catch — unhandled rejection risk",
          fix: "Wrap in try/catch or use centralized error middleware. Ref: Node.js docs — Errors.",
        });
        break;
      }
    }
  }

  // Check for hardcoded port
  for (let i = 0; i < lines.length; i++) {
    if (/\.listen\(\s*\d{4}\s*[,)]/i.test(lines[i]) && !/process\.env/i.test(lines[i])) {
      findings.push({
        severity: "info", type: "config", line: i + 1,
        message: "Hardcoded port number — use process.env.PORT",
        fix: "app.listen(process.env.PORT || 3000). Ref: 12-Factor App §7 — Port Binding.",
      });
      break;
    }
  }

  // Check for hardcoded config values (common patterns)
  for (let i = 0; i < lines.length; i++) {
    if (/(?:const|let|var)\s+(?:DB_|DATABASE_|REDIS_|API_|SECRET)\w*\s*=\s*['"][^'"]+['"]/i.test(lines[i]) && !/process\.env|example|test|mock/i.test(lines[i])) {
      findings.push({
        severity: "warning", type: "config", line: i + 1,
        message: "Hardcoded configuration value — use environment variable",
        fix: "Read from process.env and validate at startup. Ref: 12-Factor App §3 — Config.",
      });
      break;
    }
  }

  return findings;
}
