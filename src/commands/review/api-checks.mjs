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

  // Check for stack traces in error responses
  for (let i = 0; i < lines.length; i++) {
    if (/err\.stack|error\.stack|stack.*trace/i.test(lines[i]) && /res|response|json|send/i.test(lines[i])) {
      findings.push({
        severity: "error", type: "api", line: i + 1,
        message: "Stack trace exposed in error response — information leakage",
        fix: "Log the full error server-side. Return only { type, title, status, detail } to the client. Ref: OWASP — Improper Error Handling.",
      });
      break;
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
