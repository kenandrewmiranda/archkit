// App-type-aware architecture checks.
// Loaded dynamically based on the app type in SYSTEM.md.

export function checkRealtimeRules(code, filepath) {
  const findings = [];
  const isHandler = /handler/i.test(filepath);
  const isDomain = /domain/i.test(filepath);

  if (isHandler) {
    // Handler importing DB modules
    const dbImports = [/import.*pg/i, /import.*prisma/i, /import.*knex/i, /import.*pool/i, /require.*pg/i];
    for (const pat of dbImports) {
      if (pat.test(code)) {
        const lines = code.split("\n");
        let line;
        for (let i = 0; i < lines.length; i++) { if (pat.test(lines[i])) { line = i + 1; break; } }
        findings.push({
          severity: "error", type: "architecture", line,
          message: "Database import in handler — handlers should delegate to persistence layer",
          fix: "Move DB access to a persistence module. Handler calls domain logic, not DB directly.",
          reason: "Rule: Handlers process ONE message type each. No DB imports.",
        });
        break;
      }
    }

    // Complex business logic in handler
    const ifCount = (code.match(/\bif\s*\(/g) || []).length;
    if (ifCount > 3) {
      findings.push({
        severity: "warning", type: "architecture",
        message: `Handler has ${ifCount} conditional branches — extract to domain layer`,
        fix: "Domain logic is framework-agnostic pure functions. Move validation and branching there.",
        reason: "Rule: Handlers delegate to domain. Domain is pure functions.",
      });
    }
  }

  if (isDomain) {
    // Domain importing I/O or framework modules
    const ioImports = [/import.*ws/i, /import.*socket/i, /import.*http/i, /import.*express/i, /import.*hono/i, /import.*pg/i, /import.*redis/i, /import.*ioredis/i];
    for (const pat of ioImports) {
      if (pat.test(code)) {
        const lines = code.split("\n");
        let line;
        for (let i = 0; i < lines.length; i++) { if (pat.test(lines[i])) { line = i + 1; break; } }
        findings.push({
          severity: "error", type: "architecture", line,
          message: "I/O or framework import in domain layer — domain must be pure functions",
          fix: "Domain logic: (state, action) → newState. Zero I/O imports.",
          reason: "Rule: Domain logic is framework-agnostic. Zero WebSocket/DB imports.",
        });
        break;
      }
    }
  }

  return findings;
}

export function checkAIRules(code, filepath) {
  const findings = [];
  const isChain = /chain/i.test(filepath);

  if (isChain) {
    // Direct LLM provider import (should use port interface)
    const providerImports = [/import.*anthropic/i, /import.*openai/i, /import.*@google/i, /import.*cohere/i];
    for (const pat of providerImports) {
      if (pat.test(code)) {
        const lines = code.split("\n");
        let line;
        for (let i = 0; i < lines.length; i++) { if (pat.test(lines[i])) { line = i + 1; break; } }
        findings.push({
          severity: "error", type: "architecture", line,
          message: "Direct LLM provider import in chain — use $llm port interface",
          fix: "Import from your LLM port adapter, not the provider SDK directly.",
          reason: "Rule: LLM provider is an ADAPTER. Chains call PortLLM interface.",
        });
        break;
      }
    }

    // Inline prompt strings (long string literals likely to be prompts)
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match string literals > 80 chars that look like prompts
      const stringMatch = line.match(/[`"']([^`"']{80,})[`"']/);
      if (stringMatch && /you are|answer|summarize|context|instruction/i.test(stringMatch[1])) {
        findings.push({
          severity: "warning", type: "architecture", line: i + 1,
          message: "Possible inline prompt string — prompts should be in src/prompts/",
          fix: "Move prompt to a .md file in src/prompts/ and load it at runtime.",
          reason: "Rule: Prompts are version-controlled in src/prompts/. Never inline.",
        });
        break;
      }
    }

    // Missing guardrail import
    if (!/guard|guardrail|filter|sanitize/i.test(code)) {
      findings.push({
        severity: "warning", type: "architecture",
        message: "Chain has no guardrail/filter import — all chains must be wrapped",
        fix: "Import and apply $guard (input filter + output validation + PII detection).",
        reason: "Rule: Guardrails wrap EVERY chain. Not optional.",
      });
    }

    // Missing tracing import
    if (!/trace|langfuse|observe|instrument/i.test(code)) {
      findings.push({
        severity: "warning", type: "architecture",
        message: "Chain has no tracing/observability import",
        fix: "Add Langfuse trace decorator for prompt, response, latency, tokens, quality.",
        reason: "Rule: All LLM calls are traced via Langfuse.",
      });
    }
  }

  return findings;
}

export function getAppType(systemContent) {
  if (!systemContent) return null;
  const match = systemContent.match(/^## Type:\s*(.+)$/m);
  if (!match) return null;
  const typeLine = match[1].toLowerCase();
  if (typeLine.includes("saas") || typeLine.includes("b2b")) return "saas";
  if (typeLine.includes("commerce") || typeLine.includes("marketplace")) return "ecommerce";
  if (typeLine.includes("real-time") || typeLine.includes("realtime") || typeLine.includes("chat")) return "realtime";
  if (typeLine.includes("data") || typeLine.includes("analytics")) return "data";
  if (typeLine.includes("ai") || typeLine.includes("llm")) return "ai";
  if (typeLine.includes("mobile")) return "mobile";
  if (typeLine.includes("internal") || typeLine.includes("admin")) return "internal";
  if (typeLine.includes("content") || typeLine.includes("cms")) return "content";
  return null;
}
