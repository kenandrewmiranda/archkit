// Database query efficiency checks.
// Catches common LLM-generated anti-patterns: SELECT *, missing WHERE,
// unindexed ORDER BY, N+1 loops, deep OFFSET pagination.

export function checkDatabasePatterns(code, filepath) {
  const findings = [];
  const lines = code.split("\n");

  // Skip test files
  if (/\.(test|spec)\./i.test(filepath)) return findings;

  // 1. SELECT * in raw SQL
  for (let i = 0; i < lines.length; i++) {
    if (/SELECT\s+\*/i.test(lines[i]) && !/COUNT\(\*\)/i.test(lines[i])) {
      findings.push({
        severity: "warning", type: "db-efficiency", line: i + 1,
        message: "SELECT * — specify only the columns you need",
        fix: "Replace SELECT * with explicit column list: SELECT id, name, email",
        reason: "SELECT * fetches all columns including large text/blob fields. Wastes bandwidth and memory.",
      });
      break;
    }
  }

  // 2. Query without WHERE on what looks like a find/select
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Raw SQL: SELECT ... FROM table (no WHERE on same or next line)
    if (/SELECT\s+.+\s+FROM\s+\w+/i.test(line) && !/WHERE/i.test(line)) {
      const nextLine = lines[i + 1] || "";
      if (!/WHERE/i.test(nextLine) && !/COUNT|EXISTS|JOIN/i.test(line)) {
        findings.push({
          severity: "warning", type: "db-efficiency", line: i + 1,
          message: "Query without WHERE clause — may cause full table scan",
          fix: "Add WHERE to scope the query. Always filter by tenant_id, status, or other indexed column.",
          reason: "Unscoped queries scan the entire table. Add WHERE + LIMIT.",
        });
        break;
      }
    }
    // Prisma: findMany without where
    if (/\.findMany\(\s*\)/.test(line) || /\.findMany\(\s*\{[^}]*\}\s*\)/.test(line)) {
      if (!/where/i.test(line) && !/where/i.test(lines[i + 1] || "")) {
        findings.push({
          severity: "warning", type: "db-efficiency", line: i + 1,
          message: "findMany() without where — returns all rows",
          fix: "Add where clause: findMany({ where: { tenantId }, take: 50 })",
          reason: "Unbounded findMany scans the entire table.",
        });
        break;
      }
    }
    // Drizzle: select().from() without .where()
    if (/\.from\(\w+\)/.test(line) && !/\.where\(/.test(line)) {
      const nextFew = lines.slice(i, i + 3).join(" ");
      if (!/\.where\(/.test(nextFew)) {
        findings.push({
          severity: "warning", type: "db-efficiency", line: i + 1,
          message: "Query without .where() — may return all rows",
          fix: "Chain .where(eq(table.column, value)).limit(50) to scope the query.",
          reason: "Unscoped queries return the entire table.",
        });
        break;
      }
    }
  }

  // 3. Large OFFSET pagination
  for (let i = 0; i < lines.length; i++) {
    const offsetMatch = lines[i].match(/OFFSET\s+(\d+)/i);
    if (offsetMatch && parseInt(offsetMatch[1]) > 1000) {
      findings.push({
        severity: "warning", type: "db-efficiency", line: i + 1,
        message: `Deep pagination: OFFSET ${offsetMatch[1]} — use cursor-based pagination`,
        fix: "Replace OFFSET with: WHERE id > $cursor ORDER BY id LIMIT 50",
        reason: "OFFSET scans and discards rows. OFFSET 10000 reads 10050 rows.",
      });
    }
    // Prisma skip
    const skipMatch = lines[i].match(/skip:\s*(\d+)/);
    if (skipMatch && parseInt(skipMatch[1]) > 1000) {
      findings.push({
        severity: "warning", type: "db-efficiency", line: i + 1,
        message: `Deep pagination: skip ${skipMatch[1]} — use cursor-based pagination`,
        fix: "Replace skip with cursor: { cursor: { id: lastId }, take: 50 }",
        reason: "Prisma skip translates to OFFSET, which degrades on large values.",
      });
    }
  }

  // 4. N+1 pattern: query inside a for/forEach/map loop
  let inLoop = false;
  let loopStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bfor\s*\(|\.forEach\(|\.map\(\s*async/.test(line)) {
      inLoop = true;
      loopStart = i;
    }
    if (inLoop && /await\s+.*\.(query|findFirst|findUnique|findMany|execute|select|insert|update|delete)\(/.test(line)) {
      findings.push({
        severity: "error", type: "db-efficiency", line: i + 1,
        message: "Database query inside a loop — N+1 pattern detected",
        fix: "Batch queries: use WHERE id IN (...) or ANY($1::int[]) instead of querying per iteration.",
        reason: "N+1: 100 items = 100 DB round trips. Batch into 1 query.",
      });
      inLoop = false;
      break;
    }
    if (inLoop && /^\s*\}/.test(line)) inLoop = false;
  }

  return findings;
}
