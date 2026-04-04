// Frontend wiring detection.
// Flags pages that are static shells pretending to be functional:
// no API imports, hardcoded data, forms without handlers, dead buttons.
//
// Ref: This addresses a real failure mode where 68% of AI-generated
// frontend pages were unwired shells that passed all other checks.

export function checkFrontendWiring(code, filepath) {
  const findings = [];
  const lines = code.split("\n");

  // Only check page/route files (Next.js, React Router, etc.)
  const isPage = /page\.(tsx|jsx|ts|js)$/i.test(filepath) ||
                 /\/(pages|views|screens)\//i.test(filepath);
  if (!isPage) return findings;

  // Skip test files
  if (/\.(test|spec)\./i.test(filepath)) return findings;

  // Skip intentionally static pages
  const staticPages = /\/(about|faq|docs|terms|privacy|legal|404|500|not-found)\//i;
  if (staticPages.test(filepath)) return findings;

  // 1. Check for API/data imports
  const hasApiImport = /import\s+.*\bfrom\s+['"].*(?:api|client|service|lib\/api|hooks\/use|trpc|graphql|fetch|axios)/i.test(code);
  const hasUseQuery = /use(?:Query|Mutation|SWR|Fetch|Data|Effect)\s*\(/i.test(code);
  const hasServerAction = /['"]use server['"]/i.test(code);
  const hasFetch = /\bfetch\s*\(|getServerSideProps|getStaticProps|loader\s*\(/i.test(code);

  const isDataConnected = hasApiImport || hasUseQuery || hasServerAction || hasFetch;

  // Check if page is under an authenticated route (dashboard, admin, settings, account)
  const isAuthRoute = /\/(dashboard|admin|settings|account|profile)\//i.test(filepath);

  if (!isDataConnected && isAuthRoute) {
    findings.push({
      severity: "warning",
      type: "frontend-wiring",
      message: `Authenticated page with no API/data imports — likely an unwired shell`,
      fix: "This page is under an auth-protected route but doesn't fetch any data. Import your API client or use data hooks.",
      reason: "Pages under /dashboard/ or /admin/ should display user-specific data, not static content.",
    });
  } else if (!isDataConnected && !isAuthRoute) {
    // Non-auth pages might legitimately be static, but flag if they have interactive elements
    const hasInteractiveElements = /<(?:form|button|input|select|textarea)\b/i.test(code);
    if (hasInteractiveElements) {
      findings.push({
        severity: "info",
        type: "frontend-wiring",
        message: "Page has interactive elements (forms/buttons) but no API imports",
        fix: "If this page should submit data, add API client imports and wire form handlers.",
      });
    }
  }

  // 2. Forms without handlers
  const hasForm = /<form\b/i.test(code);
  if (hasForm) {
    const hasOnSubmit = /onSubmit|action\s*=|handleSubmit|formAction/i.test(code);
    if (!hasOnSubmit) {
      for (let i = 0; i < lines.length; i++) {
        if (/<form\b/i.test(lines[i])) {
          findings.push({
            severity: "warning",
            type: "frontend-wiring",
            line: i + 1,
            message: "Form element without onSubmit or action handler",
            fix: "Add onSubmit handler that calls the API, or add a form action for server actions.",
            reason: "Forms without handlers don't do anything. Users can fill and submit but nothing happens.",
          });
          break;
        }
      }
    }
  }

  // 3. Buttons without handlers (outside of forms)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/<(?:Button|button)\b/i.test(line) && !/type\s*=\s*['"]submit['"]/i.test(line)) {
      // Check this and next 2 lines for onClick
      const context = lines.slice(i, i + 3).join(" ");
      if (!/onClick|onPress|href|to=|Link/i.test(context)) {
        findings.push({
          severity: "info",
          type: "frontend-wiring",
          line: i + 1,
          message: "Button without onClick handler or navigation link",
          fix: "Add onClick handler or wrap in a Link component.",
        });
        break; // Only report first occurrence
      }
    }
  }

  // 4. Hardcoded placeholder data patterns
  const placeholderPatterns = [
    // Hardcoded arrays used as data: [1, 2, 3].map or Array(5).fill
    { pattern: /\[\d+(?:,\s*\d+)+\]\.map\(/i, msg: "Hardcoded array used as data source for rendering" },
    { pattern: /Array\(\d+\)\.fill/i, msg: "Array.fill used to generate placeholder items" },
    // Hidden example divs
    { pattern: /className\s*=\s*['"].*hidden.*['"].*(?:example|placeholder|dummy)/i, msg: "Hidden div with example/placeholder content" },
  ];

  for (const { pattern, msg } of placeholderPatterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        findings.push({
          severity: "warning",
          type: "frontend-wiring",
          line: i + 1,
          message: msg,
          fix: "Replace with actual data from an API call or data hook.",
          reason: "Hardcoded data makes the page look functional but it's a static shell.",
        });
        break;
      }
    }
  }

  // 5. Auth route without useAuth/useSession
  if (isAuthRoute) {
    const hasAuthHook = /useAuth|useSession|useUser|getServerSession|auth\(\)|getSession/i.test(code);
    if (!hasAuthHook) {
      findings.push({
        severity: "warning",
        type: "frontend-wiring",
        message: "Authenticated route without auth check (no useAuth/useSession)",
        fix: "Import and use your auth hook to verify the user is authenticated and get their context.",
        reason: "Pages under /dashboard/ or /admin/ must verify authentication. Without it, unauthenticated users can access the page.",
      });
    }
  }

  return findings;
}
