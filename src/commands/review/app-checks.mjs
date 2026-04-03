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

export function checkDataRules(code, filepath) {
  const findings = [];
  const isApi = /\.(route|controller|api)\./i.test(filepath);
  const isPipeline = /pipeline|pipe|transform|etl/i.test(filepath);

  // API layer querying ClickHouse directly (should go through Cube semantic layer)
  if (isApi) {
    const chImports = [/import.*clickhouse/i, /import.*@clickhouse/i, /require.*clickhouse/i];
    for (const pat of chImports) {
      if (pat.test(code)) {
        const lines = code.split("\n");
        let line;
        for (let i = 0; i < lines.length; i++) { if (pat.test(lines[i])) { line = i + 1; break; } }
        findings.push({
          severity: "error", type: "architecture", line,
          message: "Direct ClickHouse import in API layer — use Cube semantic layer",
          fix: "API routes should query through Cube, not ClickHouse directly.",
          reason: "Rule: All analytical queries go through Cube semantic layer.",
        });
        break;
      }
    }
  }

  // Pipeline with side effects (non-pure functions)
  if (isPipeline) {
    const sideEffects = [/fetch\(/, /axios/, /import.*http/i, /import.*net/i, /sendEmail|sendNotif/i];
    for (const pat of sideEffects) {
      if (pat.test(code)) {
        findings.push({
          severity: "warning", type: "architecture",
          message: "Pipeline transform appears to have side effects (HTTP/notification calls)",
          fix: "Pipeline transforms should be pure functions: data in → data out. No side effects.",
          reason: "Rule: Pipeline transforms are pure functions. Independently testable.",
        });
        break;
      }
    }
  }

  return findings;
}

export function checkMobileRules(code, filepath) {
  const findings = [];
  const isScreen = /screen/i.test(filepath);

  // Business logic in screen components
  if (isScreen) {
    const ifCount = (code.match(/\bif\s*\(/g) || []).length;
    if (ifCount > 3) {
      findings.push({
        severity: "warning", type: "architecture",
        message: `Screen has ${ifCount} conditional branches — extract to custom hook`,
        fix: "Screens compose components and call hooks. ZERO business logic in JSX.",
        reason: "Rule: Screens are THIN. Custom hooks encapsulate all feature logic.",
      });
    }

    // Direct API calls in screen
    const apiPatterns = [/fetch\(/, /axios\./, /import.*api-client/i];
    for (const pat of apiPatterns) {
      if (pat.test(code)) {
        findings.push({
          severity: "warning", type: "architecture",
          message: "Direct API call in screen component — use a custom hook",
          fix: "API calls go through single api-client.ts via custom hooks, not directly in screens.",
          reason: "Rule: Custom hooks encapsulate all feature logic including data fetching.",
        });
        break;
      }
    }
  }

  // FlatList usage (should be FlashList)
  if (/FlatList/i.test(code) && !/FlashList/i.test(code)) {
    const lines = code.split("\n");
    let line;
    for (let i = 0; i < lines.length; i++) { if (/FlatList/i.test(lines[i])) { line = i + 1; break; } }
    findings.push({
      severity: "error", type: "convention", line,
      message: "FlatList detected — use FlashList instead",
      fix: "Replace FlatList with FlashList. Performance is non-negotiable.",
      reason: "Rule: All list rendering uses FlashList. Never FlatList.",
    });
  }

  return findings;
}

export function checkInternalRules(code, filepath) {
  const findings = [];

  // Destructive actions without audit logging
  const destructivePatterns = [/\.delete\(/i, /\.destroy\(/i, /DELETE\s+FROM/i, /\.remove\(/i];
  const hasAudit = /audit|log.*action|logActivity/i.test(code);

  for (const pat of destructivePatterns) {
    if (pat.test(code) && !hasAudit) {
      findings.push({
        severity: "error", type: "architecture",
        message: "Destructive action without audit logging detected",
        fix: "Every destructive action (delete, refund, ban) requires audit logging: { user, action, target, timestamp, old_value, new_value }.",
        reason: "Rule: Audit log is non-negotiable for destructive actions.",
      });
      break;
    }
  }

  // Direct primary DB usage for reads (should use replica)
  const isDisplayRoute = /\b(list|index|get|show|dashboard|report)\b/i.test(filepath);
  if (isDisplayRoute) {
    const primaryPatterns = [/\.query\(/i, /prisma\.\w+\.find/i, /\.findMany\(/i, /\.findFirst\(/i];
    const usesReplica = /replica|readOnly|read_replica|secondary/i.test(code);
    for (const pat of primaryPatterns) {
      if (pat.test(code) && !usesReplica) {
        findings.push({
          severity: "warning", type: "architecture",
          message: "Display query may be hitting primary database — use read replica",
          fix: "All display/read queries should use the read replica, not the primary.",
          reason: "Rule: ALWAYS use read replica for display queries.",
        });
        break;
      }
    }
  }

  // PII displayed without masking
  const piiPatterns = [/email.*\b(text|innerText|display)\b/i, /phone.*\b(text|display)\b/i, /ssn|social.?security/i];
  for (const pat of piiPatterns) {
    if (pat.test(code)) {
      findings.push({
        severity: "warning", type: "convention",
        message: "Possible unmasked PII in display code",
        fix: "Mask PII by default (partial email, last-4 phone). Reveal on click + audit log.",
        reason: "Rule: No sensitive data displayed in full.",
      });
      break;
    }
  }

  return findings;
}

export function checkContentRules(code, filepath) {
  const findings = [];

  // Image without optimization
  const imgPatterns = [/<img\s/i, /Image\s/i];
  for (const pat of imgPatterns) {
    if (pat.test(code)) {
      const hasOptimization = /imgproxy|next\/image|width|height|loading.*lazy/i.test(code);
      if (!hasOptimization) {
        findings.push({
          severity: "warning", type: "convention",
          message: "Image tag without optimization attributes (width, height, lazy loading)",
          fix: "Images ALWAYS go through Imgproxy. Include width, height, alt, loading='lazy'.",
          reason: "Rule: Never serve unoptimized images.",
        });
        break;
      }
    }
  }

  // Client-side JS in content pages (should be islands)
  const isContentPage = /\.(astro|mdx)$/.test(filepath) || /pages\//i.test(filepath);
  if (isContentPage) {
    const clientJS = [/onClick/i, /useState/i, /useEffect/i, /addEventListener/i];
    for (const pat of clientJS) {
      if (pat.test(code)) {
        findings.push({
          severity: "info", type: "architecture",
          message: "Client-side JS detected in content page — consider using interactive islands",
          fix: "Content pages should be static by default. Extract interactive parts to client:only islands.",
          reason: "Rule: Only add client-side JS for interactive islands.",
        });
        break;
      }
    }
  }

  // Missing SEO metadata
  if (isContentPage && !/title|description|og:image|meta/i.test(code)) {
    findings.push({
      severity: "warning", type: "convention",
      message: "Content page may be missing SEO metadata",
      fix: "SEO metadata (title, description, OG image) is MANDATORY on every content type.",
      reason: "Rule: SEO metadata is mandatory.",
    });
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
