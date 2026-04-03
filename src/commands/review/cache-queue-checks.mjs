// Cache and queue pattern checks.
// Catches: missing TTL, shared cache keys, KEYS *, jobs without retry,
// large payloads in job data, no error handling on connections.

export function checkCachePatterns(code, filepath) {
  const findings = [];
  const lines = code.split("\n");

  if (/\.(test|spec)\./i.test(filepath)) return findings;

  const hasRedis = /redis|ioredis|valkey/i.test(code);
  if (!hasRedis) return findings;

  // SET without TTL (EX/PX/EXAT)
  for (let i = 0; i < lines.length; i++) {
    if (/\.set\(\s*['"]/i.test(lines[i]) && !/EX|PX|EXAT|ttl|expire/i.test(lines[i])) {
      const nextLine = lines[i + 1] || "";
      if (!/EX|PX|ttl|expire/i.test(nextLine)) {
        findings.push({
          severity: "warning", type: "cache", line: i + 1,
          message: "Cache SET without TTL — value will persist indefinitely",
          fix: "Add TTL: SET key value EX 3600 (or use client.set(key, value, 'EX', 3600))",
          reason: "Keys without TTL accumulate forever. Memory grows until OOM.",
        });
        break;
      }
    }
  }

  // KEYS * in production code
  for (let i = 0; i < lines.length; i++) {
    if (/\.keys\(\s*['"`]\*['"`]\s*\)/i.test(lines[i]) || /KEYS\s+\*/i.test(lines[i])) {
      findings.push({
        severity: "error", type: "cache", line: i + 1,
        message: "KEYS * blocks Redis while scanning all keys",
        fix: "Use SCAN with cursor for non-blocking iteration.",
        reason: "KEYS * is O(N) and blocks the entire Redis instance.",
      });
      break;
    }
  }

  // Cache key without namespace (looks like a bare string key)
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/\.(?:get|set|del|unlink)\(\s*['"`]([^'"`:{}$]+)['"`]/i);
    if (match && !match[1].includes(":") && !match[1].includes("/")) {
      findings.push({
        severity: "info", type: "cache", line: i + 1,
        message: `Cache key "${match[1]}" has no namespace — risk of collision`,
        fix: "Namespace cache keys: 'feature:entity:id' (e.g., 'user:123:profile')",
        reason: "Flat keys collide across features and leak between tenants.",
      });
      break;
    }
  }

  // No error handler on Redis connection
  if (!/\.on\(\s*['"]error['"]/i.test(code) && /new\s+(?:Redis|IORedis|Valkey)/i.test(code)) {
    findings.push({
      severity: "warning", type: "cache",
      message: "Redis client created without error event handler",
      fix: "Add: redis.on('error', (err) => logger.error('Redis error', err))",
      reason: "Unhandled Redis disconnects crash the process. Ref: ioredis — Auto-reconnect.",
    });
  }

  // Cache access without fallback (try/catch around get)
  for (let i = 0; i < lines.length; i++) {
    if (/await\s+.*\.(get|hget|hgetall)\(/i.test(lines[i])) {
      // Check if wrapped in try/catch
      let hasTryCatch = false;
      for (let j = Math.max(0, i - 5); j < i; j++) {
        if (/try\s*{/i.test(lines[j])) { hasTryCatch = true; break; }
      }
      if (!hasTryCatch) {
        findings.push({
          severity: "info", type: "cache", line: i + 1,
          message: "Cache read without try/catch — no fallback if cache is down",
          fix: "Wrap in try/catch and fall back to DB query. App should degrade, not crash.",
          reason: "Cache failure should not cause application outage. Ref: Microsoft — Cache-Aside pattern.",
        });
        break;
      }
    }
  }

  return findings;
}

export function checkQueuePatterns(code, filepath) {
  const findings = [];
  const lines = code.split("\n");

  if (/\.(test|spec)\./i.test(filepath)) return findings;

  const hasQueue = /bullmq|Queue|Worker/i.test(code);
  if (!hasQueue) return findings;

  // Queue without retry config
  if (/new Queue\(/i.test(code) && !/attempts/i.test(code) && !/backoff/i.test(code)) {
    findings.push({
      severity: "warning", type: "queue",
      message: "Queue created without retry configuration",
      fix: "Add defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }",
      reason: "Jobs fail silently without retries. Always configure attempts + backoff.",
    });
  }

  // Worker without concurrency
  if (/new Worker\(/i.test(code) && !/concurrency/i.test(code)) {
    findings.push({
      severity: "info", type: "queue",
      message: "Worker created without explicit concurrency limit",
      fix: "Add { concurrency: 5 } to prevent overwhelming downstream services.",
      reason: "Unlimited concurrency can exhaust DB connections or rate limits.",
    });
  }

  // Large inline data in job.add
  for (let i = 0; i < lines.length; i++) {
    if (/\.add\(/i.test(lines[i])) {
      // Check if the data arg spans multiple lines (likely a large object)
      let braceCount = 0;
      let dataLines = 0;
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        braceCount += (lines[j].match(/{/g) || []).length - (lines[j].match(/}/g) || []).length;
        dataLines++;
        if (braceCount === 0 && dataLines > 1) break;
      }
      if (dataLines > 10) {
        findings.push({
          severity: "warning", type: "queue", line: i + 1,
          message: "Large inline object in job.add() — consider storing in object storage",
          fix: "Store large payloads in S3/MinIO, pass only the reference URL in job data.",
          reason: "Redis stores entire job in memory. Large payloads bloat Redis.",
        });
        break;
      }
    }
  }

  // Worker without graceful shutdown
  if (/new Worker\(/i.test(code) && !/worker\.close\(\)|graceful|SIGTERM|SIGINT/i.test(code)) {
    findings.push({
      severity: "warning", type: "queue",
      message: "Worker without graceful shutdown — jobs will be abandoned on deploy",
      fix: "process.on('SIGTERM', async () => { await worker.close(); process.exit(0); })",
      reason: "close() waits for active jobs to finish. Without it, deploy kills jobs mid-execution. Ref: BullMQ — Graceful shutdown.",
    });
  }

  // Worker without stalled job detection
  if (/new Worker\(/i.test(code) && !/stalledInterval|maxStalledCount/i.test(code)) {
    findings.push({
      severity: "info", type: "queue",
      message: "Worker without stalled job detection — crashed jobs stay stuck in active state",
      fix: "Add { stalledInterval: 30000, maxStalledCount: 2 } to Worker options.",
      reason: "If worker crashes mid-job, the job stays active forever without stalled checks. Ref: BullMQ — Stalled jobs.",
    });
  }

  return findings;
}
