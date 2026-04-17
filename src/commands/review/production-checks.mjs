// Production-readiness checks.
// Flags AI-default failure modes that surface-level generation produces.

const TEST_FILE = /\.(test|spec)\.|__tests__|__mocks__|\/tests?\/|\/scripts?\//i;
const MOCK_FILE = /\.(test|spec)\.|__tests__|__mocks__|\/(tests?|fixtures?|mocks?|stubs?)\//i;

export function checkFloatingPromise(code, filepath) {
  if (TEST_FILE.test(filepath)) return [];
  const findings = [];
  const lines = code.split("\n");
  // Heuristic: identify async function names
  const asyncNames = new Set();
  for (const m of code.matchAll(/(?:async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async)/g)) {
    asyncNames.add(m[1] || m[2]);
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
    for (const name of asyncNames) {
      const re = new RegExp(`(?:^|[^.\\w])${name}\\s*\\(`, "g");
      if (!re.test(line)) continue;
      const idx = line.indexOf(name);
      const prefix = line.slice(0, idx).trimEnd();
      if (/(await|return|void|=|\?\.|=>|function|async)$/.test(prefix)) continue;
      findings.push({
        type: "floating-promise",
        severity: "error",
        line: i + 1,
        message: `Async call '${name}' not awaited`,
      });
    }
  }
  return findings;
}

export function checkMockDataLeftover(code, filepath) {
  if (MOCK_FILE.test(filepath)) return [];
  const findings = [];
  const lines = code.split("\n");
  const fakeNames = /\b(John Doe|Jane Doe|Test User|test user|foo@bar\.com|user@example\.com|example\.com)\b/i;
  const mockComment = /\/\/\s*(mock|fake|test|dummy)\s*data\b/i;
  const generatedUuid = /\b(00000000-0000-0000-0000-000000000000|11111111-1111-1111-1111-111111111111)\b/;
  const isGameCtx = /\b(game|random|simulat|monte)/i.test(filepath);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (mockComment.test(line)) {
      findings.push({ type: "mock-data-leftover", severity: "error", line: i + 1, message: "Mock data comment in non-test file" });
    }
    if (!isGameCtx && /\bMath\.random\s*\(/.test(line)) {
      findings.push({ type: "mock-data-leftover", severity: "error", line: i + 1, message: "Math.random() in non-game context" });
    }
    if (fakeNames.test(line)) {
      findings.push({ type: "mock-data-leftover", severity: "error", line: i + 1, message: "Hardcoded fake name/email" });
    }
    if (generatedUuid.test(line)) {
      findings.push({ type: "mock-data-leftover", severity: "error", line: i + 1, message: "Hardcoded placeholder UUID" });
    }
  }
  return findings;
}

export function checkDeadErrorHandler(code, filepath) {
  const findings = [];
  const re = /catch\s*\(\s*(\w+)\s*\)\s*\{([^}]*)\}/g;
  for (const m of [...code.matchAll(re)]) {
    const varName = m[1];
    const body = m[2].trim();
    const beforeIdx = m.index;
    const lineNum = code.slice(0, beforeIdx).split("\n").length;
    if (body === "") {
      const sev = varName === "_" ? "warning" : "error";
      findings.push({ type: "dead-error-handler", severity: sev, line: lineNum, message: `Empty catch block (caught as '${varName}')` });
      continue;
    }
    if (/throw\s/.test(body)) continue;
    if (/return\s/.test(body)) continue;
    if (/log\.(error|warn)|logger\.(error|warn)/.test(body)) continue;
    if (/^console\.(log|error|warn)\s*\(/.test(body) || /^console\.(log|error|warn).*;?\s*$/.test(body)) {
      findings.push({ type: "dead-error-handler", severity: "error", line: lineNum, message: "catch block only logs (swallows error)" });
    }
  }
  return findings;
}

const TODO_RE = /(?:\/\/|#|\/\*)\s*(TODO|FIXME|XXX)\b(\([^)]*\))?\s*:?/g;

export function checkUntrackedTodo(code, filepath) {
  const findings = [];
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of [...line.matchAll(TODO_RE)]) {
      const ref = m[2] || "";
      if (/\(([A-Z]+-\d+|#\d+|@\w+|\d{4}-\d{2}(-\d{2})?|\d{4}-Q[1-4])\)/.test(ref)) {
        continue;
      }
      findings.push({ type: "untracked-todo", severity: "warning", line: i + 1, message: `${m[1]} without ticket reference` });
    }
  }
  return findings;
}
